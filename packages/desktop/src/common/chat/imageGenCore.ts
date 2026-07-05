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
import { ClientFactory, type RotatingClient } from '@/common/api/ClientFactory';
import type { OpenAIRotatingClient } from '@/common/api/OpenAIRotatingClient';
import type { TProviderWithModel } from '@/common/config/storage';
import type { UnifiedChatCompletionResponse } from '@/common/api/RotatingApiClient';
import { IMAGE_EXTENSIONS, MIME_TYPE_MAP, MIME_TO_EXT_MAP, DEFAULT_IMAGE_EXTENSION } from '@/common/config/constants';

const API_TIMEOUT_MS = 120000; // 2 minutes for image generation API calls

type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

// ===== Utility Functions =====

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

  let processedUri = imageUri;
  if (imageUri.startsWith('@')) {
    processedUri = imageUri.substring(1);
  }

  let fullPath = processedUri;
  if (!path.isAbsolute(processedUri)) {
    fullPath = path.join(workspaceDir, processedUri);
  }

  try {
    await fs.promises.access(fullPath, fs.constants.F_OK);

    if (!isImageFile(fullPath)) {
      throw new Error(`File is not a supported image type: ${fullPath}`);
    }

    const base64Data = await fileToBase64(fullPath);
    const mimeType = getImageMimeType(fullPath);
    return {
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${base64Data}`, detail: 'auto' },
    };
  } catch (error) {
    const possiblePaths = [imageUri, path.join(workspaceDir, imageUri)].filter((p, i, arr) => arr.indexOf(p) === i);
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('Image file not found') || errorMessage.includes('not a supported image type')) {
      throw error;
    }

    throw new Error(
      `Image file not found. Searched paths:\n${possiblePaths.map((p) => `- ${p}`).join('\n')}\n\nPlease ensure the image file exists and has a valid image extension (.jpg, .png, .gif, .webp, etc.)`,
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

    // Create the rotating client — shared by both API paths
    const rotatingClient: RotatingClient = await ClientFactory.createRotatingClient(provider, {
      proxy,
      rotatingOptions: { maxRetries: 3, retryDelay: 1000 },
    });

    // ── Path A: Try Images API first ───────────────────────────
    if (!hasImages) {
      // Generation: POST /v1/images/generations
      try {
        // createImage is only available on OpenAIRotatingClient
        if (!('createImage' in rotatingClient)) {
          throw new Error('Images API not supported for this provider type');
        }
        const imageResponse = await (rotatingClient as OpenAIRotatingClient).createImage(
          {
            model: provider.use_model,
            prompt: params.prompt,
            n: 1,
            response_format: 'b64_json',
          },
          { signal, timeout: API_TIMEOUT_MS }
        );

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
      } catch (imagesApiError) {
        console.warn(
          '[ImageGen] Images API failed, falling back to Chat Completions:',
          imagesApiError instanceof Error ? imagesApiError.message : String(imagesApiError)
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

        // If OpenAIRotatingClient has editImage, use it to ensure proper proxy and multipart handling
        if ('editImage' in rotatingClient) {
          const firstImageContent = successful[0];
          const firstUri = imageUris[0];
          const fullPath = path.isAbsolute(firstUri) ? firstUri : path.join(workspaceDir, firstUri);
          
          let fileStream: any = undefined;
          try {
            await fs.promises.access(fullPath, fs.constants.F_OK);
            fileStream = fs.createReadStream(fullPath);
          } catch {
             throw new Error('Image edit requires a local file path for OpenAI SDK.');
          }

          // Pass X-Aion-Model header so admin-api can extract the model ID even if body is multipart buffer
          const editRes = await (rotatingClient as OpenAIRotatingClient).editImage(
            {
              model: provider.use_model,
              prompt: params.prompt,
              image: fileStream,
              response_format: 'b64_json',
            },
            { 
              signal, 
              timeout: API_TIMEOUT_MS,
              headers: { 'X-Aion-Model': provider.use_model }
            }
          );

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
          } else if (editRes?.data?.[0]?.url) {
            const url = editRes.data[0].url;
            return {
              success: true,
              text: `Image edited successfully. URL: ${url}`,
            };
          }
        } else {
          throw new Error('Images API not supported for this provider type');
        }
        // If edits endpoint fails, fall through to Chat Completions
        console.warn('[ImageGen] Images edits API failed, falling back to Chat Completions');
      } catch (editsApiError) {
        console.warn(
          '[ImageGen] Images edits API error, falling back to Chat Completions:',
          editsApiError instanceof Error ? editsApiError.message : String(editsApiError)
        );
      }
    }

    // ── Path B: Fall back to Chat Completions ──────────────────
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
              await fs.promises.access(fullPath);
              const base64Data = await fileToBase64(fullPath);
              const mimeType = getImageMimeType(fullPath);
              processedImages.push({
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Data}` },
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
