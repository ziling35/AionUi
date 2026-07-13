/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared image generation logic used by both:
 * - The built-in MCP server (imageGenServer.ts)
 * - The legacy Gemini-specific tool (img-gen.ts)
 */

import * as fs from 'fs';
import * as path from 'path';
import { jsonrepair } from 'jsonrepair';
import type OpenAI from 'openai';
import { ClientFactory, normalizeNewApiBaseUrl, type RotatingClient } from '@/common/api/ClientFactory';
import type { OpenAIRotatingClient } from '@/common/api/OpenAIRotatingClient';
import type { TProviderWithModel } from '@/common/config/storage';
import type { UnifiedChatCompletionResponse } from '@/common/api/RotatingApiClient';
import { IMAGE_EXTENSIONS, MIME_TYPE_MAP, MIME_TO_EXT_MAP, DEFAULT_IMAGE_EXTENSION } from '@/common/config/constants';
import { getProviderAuthType } from '@/common/utils/platformAuthType';
import { isNewApiPlatform } from '@/common/utils/platformConstants';

const API_TIMEOUT_MS = 240000; // Keep image calls inside the 300s outer tool timeout budget.
const MODEL_ROUTING_PREFIX = 'aion-route:';
const CHAT_IMAGE_MODEL_PATTERNS = [/gemini.*(?:image|flash)/i, /flash.*image/i, /nano-banana/i];

type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

type ImageFileMetadata = {
  mimeType: string;
  extension: ImageExtension;
  detectedFromContent: boolean;
};

function normalizeImageMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0].trim().toLowerCase();
}

function getImageExtensionFromMimeType(mimeType: string): ImageExtension {
  const normalized = normalizeImageMimeType(mimeType);
  const subtype = normalized.replace(/^image\//, '');
  return (MIME_TO_EXT_MAP[normalized] || MIME_TO_EXT_MAP[subtype] || DEFAULT_IMAGE_EXTENSION) as ImageExtension;
}

function detectImageMimeTypeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buffer.length >= 6) {
    const gifHeader = buffer.subarray(0, 6).toString('ascii');
    if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))
  ) {
    return 'image/tiff';
  }
  const prefix = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8').trimStart().toLowerCase();
  if (prefix.startsWith('<svg') || prefix.startsWith('<?xml')) return 'image/svg+xml';
  return null;
}

function getImageFileMetadata(buffer: Buffer, file_path: string): ImageFileMetadata {
  const detectedMimeType = detectImageMimeTypeFromBuffer(buffer);
  const mimeType = detectedMimeType || getImageMimeType(file_path);
  return {
    mimeType,
    extension: getImageExtensionFromMimeType(mimeType),
    detectedFromContent: !!detectedMimeType,
  };
}

function normalizeLocalImageUri(imageUri: string): string {
  return imageUri.startsWith('@') ? imageUri.substring(1) : imageUri;
}

function resolveLocalImagePath(imageUri: string, workspaceDir: string): string {
  const processedUri = normalizeLocalImageUri(imageUri);
  return path.isAbsolute(processedUri) ? processedUri : path.join(workspaceDir, processedUri);
}

function areEquivalentImageExtensions(left: string, right: string): boolean {
  const normalize = (value: string) => (value.toLowerCase() === '.jpeg' ? '.jpg' : value.toLowerCase());
  return normalize(left) === normalize(right);
}

async function prepareImageUploadPath(file_path: string): Promise<string> {
  const fileBuffer = await fs.promises.readFile(file_path);
  const metadata = getImageFileMetadata(fileBuffer, file_path);
  const currentExtension = path.extname(file_path).toLowerCase();

  if (!metadata.detectedFromContent || areEquivalentImageExtensions(currentExtension, metadata.extension)) {
    return file_path;
  }

  const uploadDir = path.join(path.dirname(file_path), '.lingai_image_uploads');
  await fs.promises.mkdir(uploadDir, { recursive: true });
  const baseName = (path.basename(file_path, currentExtension).replace(/[^a-z0-9_.-]+/gi, '_') || 'image').slice(0, 80);
  const uploadPath = path.join(
    uploadDir,
    `${baseName}-${Date.now()}-${Math.random().toString(36).slice(2)}${metadata.extension}`
  );
  await fs.promises.writeFile(uploadPath, fileBuffer);
  return uploadPath;
}

// ===== Utility Functions =====

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getEffectiveModelId(model: string): string {
  if (!model.startsWith(MODEL_ROUTING_PREFIX)) return model;
  const payload = model.slice(MODEL_ROUTING_PREFIX.length);
  const separatorIndex = payload.indexOf(':');
  if (separatorIndex <= 0) return model;
  try {
    const decodedModelId = decodeURIComponent(payload.slice(separatorIndex + 1));
    return decodedModelId || model;
  } catch {
    return model;
  }
}

function isGptImageModel(model: string): boolean {
  const normalized = getEffectiveModelId(model).toLowerCase();
  return /^gpt-image(?:-|$)/.test(normalized);
}

function isOpenAIImagesOnlyModel(model: string): boolean {
  const normalized = getEffectiveModelId(model).toLowerCase();
  return /^gpt-image(?:-|$)/.test(normalized) || /^dall-e(?:-|$)/.test(normalized);
}

function isCodexChatGptAccountImageModelError(message: string): boolean {
  return /not supported when using Codex with a ChatGPT account/i.test(message);
}

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown; code?: unknown }).status ?? (error as { code?: unknown }).code;
  return typeof status === 'number' ? status : undefined;
}

function shouldRetryWithUrlResponse(error: unknown): boolean {
  const status = getErrorStatus(error);
  const message = getErrorMessage(error);
  return (
    (status === 400 || status === 422) &&
    /response_format|b64_json|base64|unsupported|unknown parameter|invalid parameter/i.test(message)
  );
}

function buildImagesApiFailureResult(model: string, error: unknown): ImageGenResult {
  const errorMessage = getErrorMessage(error);
  const gatewayTimeoutHint = /504|gateway time-?out/i.test(errorMessage)
    ? ' The image provider or a reverse proxy timed out before the upstream image job completed. Increase proxy_read_timeout/proxy_send_timeout on every Nginx/Caddy/CDN layer in front of the API; the bundled Nginx is configured for 600 seconds.'
    : '';
  const codexHint = isCodexChatGptAccountImageModelError(errorMessage)
    ? ' The selected image model is being called through Codex/ChatGPT-account credentials; use an OpenAI API-key-backed image provider or select another image provider in Settings > Tools.'
    : ' This model must be called through an image-generation endpoint/tool, not Chat Completions. Check the image provider, API key, base URL, and selected model in Settings > Tools.';
  return {
    success: false,
    text: `Error generating image: ${errorMessage}\n\nModel: ${getEffectiveModelId(model)}\n\nHint:${gatewayTimeoutHint || codexHint}`,
    error: errorMessage,
  };
}

function getOpenAICompatibleBaseUrl(provider: TProviderWithModel): string {
  const authType = getProviderAuthType(provider);
  return isNewApiPlatform(provider.platform) ? normalizeNewApiBaseUrl(provider.base_url, authType) : provider.base_url;
}

function buildOpenAIImagesEndpointUrl(provider: TProviderWithModel, operation: 'edits' | 'generations'): string {
  const baseUrl = getOpenAICompatibleBaseUrl(provider).replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('Image provider base URL is empty.');
  }
  return `${baseUrl}/images/${operation}`;
}

function getFirstProviderApiKey(apiKeys: string): string {
  const apiKey = apiKeys
    .split(/[,\n]/)
    .map((key) => key.replace(/[\s\r\n\t]/g, '').trim())
    .find((key) => key.length > 0);

  if (!apiKey) {
    throw new Error('Image provider API key is empty.');
  }

  return apiKey;
}

function createCombinedTimeoutSignal(parentSignal?: AbortSignal): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Image API request timed out after ${API_TIMEOUT_MS}ms.`));
  }, API_TIMEOUT_MS);

  const abortFromParent = () => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

async function buildImageApiError(response: Response): Promise<Error & { status?: number; code?: number }> {
  const responseText = await response.text();
  let errorMessage = responseText || response.statusText;

  try {
    const parsed = JSON.parse(responseText) as {
      error?: { message?: string; code?: string | number };
      message?: string;
    };
    errorMessage = parsed.error?.message || parsed.message || errorMessage;
  } catch {}

  const error = new Error(`Images API error ${response.status}: ${errorMessage}`) as Error & {
    status?: number;
    code?: number;
  };
  error.status = response.status;
  error.code = response.status;
  return error;
}

async function postOpenAIImageEditMultipart(
  provider: TProviderWithModel,
  prompt: string,
  imagePaths: string[],
  signal?: AbortSignal,
  responseFormat?: 'b64_json' | 'url'
): Promise<OpenAI.Images.ImagesResponse> {
  if (imagePaths.length === 0) {
    throw new Error('Image edit requires at least one local image file.');
  }
  if (imagePaths.length > 16) {
    throw new Error('Image edit supports up to 16 input images.');
  }

  const formData = new FormData();
  const imageFieldName = imagePaths.length > 1 ? 'image[]' : 'image';

  formData.append('model', provider.use_model);
  formData.append('prompt', prompt);
  for (const imagePath of imagePaths) {
    const uploadPath = await prepareImageUploadPath(imagePath);
    const imageBuffer = await fs.promises.readFile(uploadPath);
    const metadata = getImageFileMetadata(imageBuffer, uploadPath);
    formData.append(imageFieldName, new Blob([imageBuffer], { type: metadata.mimeType }), path.basename(uploadPath));
  }
  if (responseFormat) {
    formData.append('response_format', responseFormat);
  }

  const timeoutSignal = createCombinedTimeoutSignal(signal);
  try {
    const response = await fetch(buildOpenAIImagesEndpointUrl(provider, 'edits'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getFirstProviderApiKey(provider.api_key)}`,
        'HTTP-Referer': 'https://lingai.com',
        'X-Aion-Model': provider.use_model,
        'X-Title': 'LingAI',
      },
      body: formData,
      signal: timeoutSignal.signal,
    });

    if (!response.ok) {
      throw await buildImageApiError(response);
    }

    return (await response.json()) as OpenAI.Images.ImagesResponse;
  } finally {
    timeoutSignal.dispose();
  }
}
export function safeJsonParse<T = unknown>(jsonString: string, fallbackValue: T): T {
  if (!jsonString || typeof jsonString !== 'string') {
    return fallbackValue;
  }

  try {
    return JSON.parse(jsonString) as T;
  } catch (_error) {
    try {
      const repairedJson = jsonrepair(jsonString);
      return JSON.parse(repairedJson) as T;
    } catch (_repairError) {
      console.warn('[ImageGen] JSON parse failed:', jsonString.substring(0, 50));
      return fallbackValue;
    }
  }
}

export function isImageFile(file_path: string): boolean {
  const ext = path.extname(file_path).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext as ImageExtension);
}

export function isHttpUrl(str: string): boolean {
  return str.startsWith('http://') || str.startsWith('https://');
}

export async function fileToBase64(file_path: string): Promise<string> {
  try {
    const fileBuffer = await fs.promises.readFile(file_path);
    return fileBuffer.toString('base64');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('ENOENT') || errorMessage.includes('no such file')) {
      throw new Error(`Image file not found: ${file_path}`, { cause: error });
    }
    throw new Error(`Failed to read image file: ${errorMessage}`, { cause: error });
  }
}

export function getImageMimeType(file_path: string): string {
  const ext = path.extname(file_path).toLowerCase();
  return MIME_TYPE_MAP[ext] || MIME_TYPE_MAP[DEFAULT_IMAGE_EXTENSION];
}

export function getFileExtensionFromDataUrl(dataUrl: string): string {
  const mimeTypeMatch = dataUrl.match(/^data:image\/([^;]+);base64,/);
  if (mimeTypeMatch && mimeTypeMatch[1]) {
    const mimeType = mimeTypeMatch[1].toLowerCase();
    return MIME_TO_EXT_MAP[mimeType] || DEFAULT_IMAGE_EXTENSION;
  }
  return DEFAULT_IMAGE_EXTENSION;
}

export async function saveGeneratedImage(base64Data: string, outputDir: string): Promise<string> {
  const timestamp = Date.now();
  const fileExtension = getFileExtensionFromDataUrl(base64Data);
  const file_name = `img-${timestamp}${fileExtension}`;
  const file_path = path.join(outputDir, file_name);

  const base64WithoutPrefix = base64Data.replace(/^data:image\/[^;]+;base64,/, '');
  const imageBuffer = Buffer.from(base64WithoutPrefix, 'base64');

  try {
    await fs.promises.writeFile(file_path, imageBuffer);
    return file_path;
  } catch (error) {
    console.error('[ImageGen] Failed to save image file:', error);
    throw new Error(`Failed to save image: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

async function saveGeneratedImageFromUrl(imageUrl: string, outputDir: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(imageUrl, { signal });
  if (!response.ok) {
    throw new Error(`Failed to download generated image: HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || 'image/png';
  const extension = getImageExtensionFromMimeType(contentType);
  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const file_path = path.join(outputDir, `img-${Date.now()}${extension}`);
  await fs.promises.writeFile(file_path, imageBuffer);
  return file_path;
}

function supportsChatImageGeneration(model: string): boolean {
  const effectiveModel = getEffectiveModelId(model);
  if (isOpenAIImagesOnlyModel(effectiveModel)) return false;
  return CHAT_IMAGE_MODEL_PATTERNS.some((pattern) => pattern.test(effectiveModel));
}

// ===== Image Content Processing =====

interface ImageContent {
  type: 'image_url';
  image_url: {
    url: string;
    detail: 'auto' | 'low' | 'high';
  };
}

export async function processImageUri(imageUri: string, workspaceDir: string): Promise<ImageContent | null> {
  if (isHttpUrl(imageUri)) {
    return {
      type: 'image_url',
      image_url: { url: imageUri, detail: 'auto' },
    };
  }

  const fullPath = resolveLocalImagePath(imageUri, workspaceDir);

  try {
    const fileBuffer = await fs.promises.readFile(fullPath);
    const detectedMimeType = detectImageMimeTypeFromBuffer(fileBuffer);

    if (!detectedMimeType && !isImageFile(fullPath)) {
      throw new Error(`File is not a supported image type: ${fullPath}`);
    }

    const metadata = getImageFileMetadata(fileBuffer, fullPath);
    const base64Data = fileBuffer.toString('base64');
    return {
      type: 'image_url',
      image_url: { url: `data:${metadata.mimeType};base64,${base64Data}`, detail: 'auto' },
    };
  } catch (error) {
    const normalizedUri = normalizeLocalImageUri(imageUri);
    const possiblePaths = [normalizedUri, path.join(workspaceDir, normalizedUri)].filter(
      (candidate, index, array) => array.indexOf(candidate) === index
    );
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('Image file not found') || errorMessage.includes('not a supported image type')) {
      throw error;
    }

    throw new Error(
      `Image file not found. Searched paths:\n${possiblePaths.map((candidate) => `- ${candidate}`).join('\n')}\n\nPlease ensure the image file exists and has a valid image extension (.jpg, .png, .gif, .webp, etc.)`,
      { cause: error }
    );
  }
}

// ===== Core Execution =====

export interface ImageGenParams {
  prompt: string;
  image_uris?: string[] | string;
}

export interface ImageGenResult {
  success: boolean;
  text: string;
  imagePath?: string;
  relativeImagePath?: string;
  error?: string;
}

/**
 * Core image generation function shared between MCP server and Gemini tool.
 *
 * Strategy:
 * 1. **Generation (no input images)**: Try the OpenAI Images API
 *    (`/v1/images/generations`) first. This is the standard endpoint for
 *    DALL-E, gpt-image-*, and compatible providers. If the provider does
 *    not support it (e.g. Gemini chat-based image models), fall back to
 *    Chat Completions.
 * 2. **Editing (with input images)**: Try a direct fetch to
 *    `/v1/images/edits` with a JSON body first (supported by some
 *    providers like wisart). If that fails, fall back to Chat
 *    Completions with multimodal content parts.
 */
export async function executeImageGeneration(
  params: ImageGenParams,
  provider: TProviderWithModel,
  workspaceDir: string,
  proxy?: string,
  signal?: AbortSignal,
  outputDir?: string
): Promise<ImageGenResult> {
  if (signal?.aborted) {
    return { success: false, text: 'Image generation was cancelled.', error: 'cancelled' };
  }

  // Use outputDir for saving generated images; fall back to workspaceDir for backward compat.
  const saveDir = outputDir || workspaceDir;

  try {
    // Parse image URIs
    let imageUris: string[] = [];
    if (params.image_uris) {
      if (typeof params.image_uris === 'string') {
        const parsed = safeJsonParse<string[]>(params.image_uris, null);
        imageUris = Array.isArray(parsed) ? parsed : [params.image_uris];
      } else if (Array.isArray(params.image_uris)) {
        imageUris = params.image_uris;
      }
    }

    const hasImages = imageUris.length > 0;
    const allowChatImageFallback = supportsChatImageGeneration(provider.use_model);

    // Create the rotating client 闁?shared by both API paths
    const rotatingClient: RotatingClient = await ClientFactory.createRotatingClient(provider, {
      proxy,
      timeout: API_TIMEOUT_MS,
      rotatingOptions: { maxRetries: 1, retryDelay: 500 },
    });

    // 闁冲厜鍋撻柍鍏夊亾 Path A: Try Images API first 闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋?
    if (!hasImages) {
      // Generation: POST /v1/images/generations
      try {
        // createImage is only available on OpenAIRotatingClient
        if (!('createImage' in rotatingClient)) {
          throw new Error('Images API not supported for this provider type');
        }
        let imageResponse: OpenAI.Images.ImagesResponse;
        try {
          const imageGenerateParams: OpenAI.Images.ImageGenerateParams = {
            model: provider.use_model,
            prompt: params.prompt,
            n: 1,
          };
          if (!isGptImageModel(provider.use_model)) {
            imageGenerateParams.response_format = 'b64_json';
          }
          imageResponse = await (rotatingClient as OpenAIRotatingClient).createImage(imageGenerateParams, {
            signal,
            timeout: API_TIMEOUT_MS,
          });
        } catch (b64Error) {
          if (isGptImageModel(provider.use_model) || !shouldRetryWithUrlResponse(b64Error)) {
            throw b64Error;
          }
          console.warn('[ImageGen] b64_json response failed, retrying with url:', getErrorMessage(b64Error));
          imageResponse = await (rotatingClient as OpenAIRotatingClient).createImage(
            {
              model: provider.use_model,
              prompt: params.prompt,
              n: 1,
              response_format: 'url',
            },
            { signal, timeout: API_TIMEOUT_MS }
          );
        }

        const b64Data = imageResponse?.data?.[0]?.b64_json;
        if (b64Data) {
          const dataUrl = `data:image/png;base64,${b64Data}`;
          const imagePath = await saveGeneratedImage(dataUrl, saveDir);
          const relativeImagePath = path.relative(saveDir, imagePath);
          const responseText = imageResponse?.data?.[0]?.revised_prompt || 'Image generated successfully.';
          return {
            success: true,
            text: `${responseText}\n\nGenerated image saved to: ${imagePath}`,
            imagePath,
            relativeImagePath,
          };
        }

        const imageUrl = imageResponse?.data?.[0]?.url;
        if (imageUrl) {
          const imagePath = await saveGeneratedImageFromUrl(imageUrl, saveDir, signal);
          const relativeImagePath = path.relative(saveDir, imagePath);
          const responseText = imageResponse?.data?.[0]?.revised_prompt || 'Image generated successfully.';
          return {
            success: true,
            text: `${responseText}

Generated image saved to: ${imagePath}`,
            imagePath,
            relativeImagePath,
          };
        }
      } catch (imagesApiError) {
        if (isOpenAIImagesOnlyModel(provider.use_model) || !allowChatImageFallback) {
          console.warn('[ImageGen] Images API failed for non-chat-image model:', getErrorMessage(imagesApiError));
          return buildImagesApiFailureResult(provider.use_model, imagesApiError);
        }
        console.warn(
          '[ImageGen] Images API failed, falling back to Chat Completions:',
          getErrorMessage(imagesApiError)
        );
      }
    } else {
      // Editing: Try direct fetch to /v1/images/edits with JSON body
      try {
        const processedImages = await Promise.allSettled(imageUris.map((uri) => processImageUri(uri, workspaceDir)));
        const successful: ImageContent[] = [];
        const errors: string[] = [];

        processedImages.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value) {
            successful.push(result.value);
          } else {
            const error = result.status === 'rejected' ? result.reason : 'Unknown error';
            const errorMessage = error instanceof Error ? error.message : String(error);
            errors.push(`Image ${index + 1} (${imageUris[index]}): ${errorMessage}`);
          }
        });

        if (successful.length === 0) {
          return {
            success: false,
            text: `Error: Failed to process any images. Errors:\n${errors.join('\n')}`,
            error: errors.join('\n'),
          };
        }

        if ('editImage' in rotatingClient) {
          const editableImagePaths = imageUris
            .filter((uri) => !isHttpUrl(uri))
            .map((uri) => resolveLocalImagePath(uri, workspaceDir));

          if (editableImagePaths.length === 0) {
            throw new Error('Image edit requires local image file paths for OpenAI-compatible Images API.');
          }

          try {
            await Promise.all(editableImagePaths.map((imagePath) => fs.promises.access(imagePath, fs.constants.F_OK)));
          } catch {
            throw new Error('Image edit requires valid local image file paths for OpenAI-compatible Images API.');
          }

          let editRes: OpenAI.Images.ImagesResponse;
          try {
            editRes = await postOpenAIImageEditMultipart(
              provider,
              params.prompt,
              editableImagePaths,
              signal,
              isGptImageModel(provider.use_model) ? undefined : 'b64_json'
            );
          } catch (b64Error) {
            if (isGptImageModel(provider.use_model) || !shouldRetryWithUrlResponse(b64Error)) {
              throw b64Error;
            }
            console.warn('[ImageGen] b64_json edit response failed, retrying with url:', getErrorMessage(b64Error));
            editRes = await postOpenAIImageEditMultipart(provider, params.prompt, editableImagePaths, signal, 'url');
          }

          const b64Data = editRes?.data?.[0]?.b64_json;
          if (b64Data) {
            const dataUrl = `data:image/png;base64,${b64Data}`;
            const imagePath = await saveGeneratedImage(dataUrl, saveDir);
            const relativeImagePath = path.relative(saveDir, imagePath);
            const responseText = editRes?.data?.[0]?.revised_prompt || 'Image edited successfully.';
            return {
              success: true,
              text: `${responseText}\n\nEdited image saved to: ${imagePath}`,
              imagePath,
              relativeImagePath,
            };
          }

          const imageUrl = editRes?.data?.[0]?.url;
          if (imageUrl) {
            const imagePath = await saveGeneratedImageFromUrl(imageUrl, saveDir, signal);
            const relativeImagePath = path.relative(saveDir, imagePath);
            const responseText = editRes?.data?.[0]?.revised_prompt || 'Image edited successfully.';
            return {
              success: true,
              text: `${responseText}

Edited image saved to: ${imagePath}`,
              imagePath,
              relativeImagePath,
            };
          }
        } else {
          throw new Error('Images API not supported for this provider type');
        }
        // If edits endpoint fails, fall through to Chat Completions
        console.warn('[ImageGen] Images edits API failed, falling back to Chat Completions');
      } catch (editsApiError) {
        if (isOpenAIImagesOnlyModel(provider.use_model) || !allowChatImageFallback) {
          console.warn('[ImageGen] Images edits API failed for non-chat-image model:', getErrorMessage(editsApiError));
          return buildImagesApiFailureResult(provider.use_model, editsApiError);
        }
        console.warn(
          '[ImageGen] Images edits API error, falling back to Chat Completions:',
          getErrorMessage(editsApiError)
        );
      }
    }

    // 闁冲厜鍋撻柍鍏夊亾 Path B: Fall back to Chat Completions 闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾闁冲厜鍋撻柍鍏夊亾
    // This path works for providers that support image generation via
    // chat (e.g. Gemini flash-image models).
    let enhancedPrompt: string;
    if (hasImages) {
      enhancedPrompt = `Analyze/Edit image: ${params.prompt}`;
    } else {
      enhancedPrompt = `Generate image: ${params.prompt}`;
    }

    const contentParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [{ type: 'text', text: enhancedPrompt }];

    if (hasImages) {
      const imageResults = await Promise.allSettled(imageUris.map((uri) => processImageUri(uri, workspaceDir)));
      const successful: ImageContent[] = [];
      const errors: string[] = [];

      imageResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          successful.push(result.value);
        } else {
          const error = result.status === 'rejected' ? result.reason : 'Unknown error';
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`Image ${index + 1} (${imageUris[index]}): ${errorMessage}`);
        }
      });

      successful.forEach((imageContent) => contentParts.push(imageContent));

      if (successful.length === 0) {
        return {
          success: false,
          text: `Error: Failed to process any images. Errors:\n${errors.join('\n')}`,
          error: errors.join('\n'),
        };
      }
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: 'user', content: contentParts }];

    const completion: UnifiedChatCompletionResponse = await rotatingClient.createChatCompletion(
      { model: provider.use_model, messages: messages as any },
      { signal, timeout: API_TIMEOUT_MS }
    );

    const choice = completion.choices[0];
    if (!choice) {
      return { success: false, text: 'No response from image generation API', error: 'No response' };
    }

    const responseText = choice.message.content || 'Image generated successfully.';
    let images = choice.message.images;

    // Extract images from markdown in content if not in images field
    if ((!images || images.length === 0) && responseText) {
      const dataUrlRegex = /!\[[^\]]*\]\((data:image\/[^;]+;base64,[^)]+)\)/g;
      const dataUrlMatches = [...responseText.matchAll(dataUrlRegex)];
      if (dataUrlMatches.length > 0) {
        images = dataUrlMatches.map((match) => ({
          type: 'image_url' as const,
          image_url: { url: match[1] },
        }));
      } else {
        const file_pathRegex = /!\[[^\]]*\]\(([^)]+\.(?:jpg|jpeg|png|gif|webp|bmp|tiff|svg))\)/gi;
        const file_pathMatches = [...responseText.matchAll(file_pathRegex)];
        if (file_pathMatches.length > 0) {
          const processedImages: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
          for (const match of file_pathMatches) {
            const file_path = match[1];
            const fullPath = path.isAbsolute(file_path) ? file_path : path.join(workspaceDir, file_path);
            try {
              const fileBuffer = await fs.promises.readFile(fullPath);
              const metadata = getImageFileMetadata(fileBuffer, fullPath);
              processedImages.push({
                type: 'image_url',
                image_url: { url: `data:${metadata.mimeType};base64,${fileBuffer.toString('base64')}` },
              });
            } catch (_fileError) {
              console.warn(`[ImageGen] Could not load image file: ${file_path}`);
            }
          }
          if (processedImages.length > 0) {
            images = processedImages;
          }
        }
      }
    }

    if (!images || images.length === 0) {
      const warningMessage = `Image generation did not produce any images.\n\nModel response: ${responseText}\n\nTip: Make sure your image generation model supports this type of request. Current model: ${provider.use_model}`;
      return { success: true, text: warningMessage };
    }

    const firstImage = images[0];
    if (firstImage.type === 'image_url' && firstImage.image_url?.url) {
      const imagePath = await saveGeneratedImage(firstImage.image_url.url, saveDir);
      const relativeImagePath = path.relative(saveDir, imagePath);

      const cleanText = responseText.replace(
        /!\[[^\]]*\]\(data:image\/[^;]+;base64,[^)]+\)/g,
        '[embedded image extracted]'
      );

      return {
        success: true,
        text: `${cleanText}\n\nGenerated image saved to: ${imagePath}`,
        imagePath,
        relativeImagePath,
      };
    }

    return { success: true, text: responseText };
  } catch (error) {
    if (signal?.aborted) {
      return { success: false, text: 'Image generation was cancelled.', error: 'cancelled' };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[ImageGen] API call failed:`, error);
    return { success: false, text: `Error generating image: ${errorMessage}`, error: errorMessage };
  }
}
