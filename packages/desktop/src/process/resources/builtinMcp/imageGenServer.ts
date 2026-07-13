/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in MCP server for image generation.
 * Runs as a standalone stdio process spawned by the MCP client.
 * Reads provider config from environment variables.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BUILTIN_IMAGE_GEN_ID, BUILTIN_IMAGE_GEN_NAME } from './constants';
import { executeImageGeneration, type ImageGenResult } from '@/common/chat/imageGenCore';
import { validateImageGenerationToolRequest } from '@/common/chat/imageGenToolPolicy';
import type { TProviderWithModel } from '@/common/config/storage';

type LogLevel = 'info' | 'warn' | 'error';
type LogValue = string | number | boolean | null;

function logImageGen(level: LogLevel, event: string, fields: Record<string, LogValue | undefined> = {}) {
  const payload: Record<string, LogValue> = {
    level,
    event,
  };

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) payload[key] = value;
  }

  console.error(`[ImageGenMCP] ${JSON.stringify(payload)}`);
}

function readImageEnv(primary: string, legacy?: string): string | undefined {
  const value = process.env[primary];
  if (value) return value;
  return legacy ? process.env[legacy] : undefined;
}

// Read provider config from environment variables
function getProviderFromEnv(): TProviderWithModel | null {
  const platform = readImageEnv('LINGAI_IMG_PLATFORM', 'AIONUI_IMG_PLATFORM');
  const base_url = readImageEnv('LINGAI_IMG_BASE_URL', 'AIONUI_IMG_BASE_URL');
  const api_key = readImageEnv('LINGAI_IMG_API_KEY', 'AIONUI_IMG_API_KEY');
  const model = readImageEnv('LINGAI_IMG_MODEL', 'AIONUI_IMG_MODEL');

  if (!platform || !model) {
    const missing: string[] = [];
    if (!platform) missing.push('LINGAI_IMG_PLATFORM');
    if (!model) missing.push('LINGAI_IMG_MODEL');
    logImageGen('error', 'missing_provider_env', { missing: missing.join(',') });
    return null;
  }

  return {
    id: BUILTIN_IMAGE_GEN_ID,
    name: BUILTIN_IMAGE_GEN_NAME,
    platform,
    base_url: base_url || '',
    api_key: api_key || '',
    use_model: model,
  };
}

async function main() {
  const server = new McpServer({
    name: BUILTIN_IMAGE_GEN_NAME,
    version: '1.0.0',
  });

  server.tool(
    'lingai_image_generation',
    `REQUIRED tool for generating or editing images. Use this tool only when the user explicitly asks to create, generate, draw, paint, edit, modify, or transform an image.

CRITICAL: You (the AI assistant) CANNOT generate images directly. You MUST call this tool for:
- Creating/generating any new images from text descriptions
- Drawing, painting, or making any visual content
- Editing or modifying existing images
- Image-to-image transformations when the user explicitly asks to create a new image based on a reference image

Primary Functions:
- Generate new images from English text descriptions
- Edit/modify existing images with English text prompts

IMPORTANT: All prompts must be in English for optimal results.

When to Use (MANDATORY):
- User asks to "generate", "create", "draw", "make", "paint" an image
- User asks for any visual content creation
- User asks to edit or modify an image
- User explicitly asks for image-to-image generation, restyling, redrawing, or image editing

Input Support:
- Multiple local file paths in array format: ["img1.jpg", "img2.png"]
- Multiple HTTP/HTTPS image URLs in array format
- Text prompts for generation, editing, or image-to-image transformation

Do NOT Use For:
- Inspecting, reading, describing, OCR, or analyzing screenshots
- Diagnosing UI screenshots, error screenshots, configuration screenshots, or website screenshots
- Any case where the user only attached an image/file and asked a question about its contents
- Merely because a message mentions @filename or includes an image extension

Output:
- Saves generated/processed images to workspace with timestamp naming
- Returns image path and a short result description

IMPORTANT: When user provides multiple images, ALWAYS pass ALL images to the image_uris parameter as an array.
CRITICAL: You MUST display the generated/edited image in your final chat response to the user using Markdown image syntax: ![Image Description](absolute_file_path). DO NOT just print the raw file path.
CRITICAL FOR IMAGE-TO-IMAGE: If the user uploads an image and asks for "image-to-image" (图生图) or to generate a new image based on it, DO NOT analyze or describe the image yourself. DIRECTLY pass the absolute path of the uploaded image to the \`image_uris\` parameter, and pass their request to the \`prompt\` parameter.`,
    {
      prompt: z
        .string()
        .describe(
          'The text prompt in English that must clearly specify the operation type: "Generate image: [description]" for creating new images, "Edit image: [modifications]" for image editing, or "Image-to-Image: [description]" for generating based on a reference image. Do not use this tool for image recognition, screenshot reading, or image analysis.'
        ),
      image_uris: z
        .array(z.string())
        .optional()
        .describe(
          'Optional: Array of absolute paths to local image files or URLs. Use this only for image-to-image generation or image editing. ALWAYS pass the raw file path directly; do not try to parse it. Examples: ["C:\\path\\to\\img.jpg", "https://example.com/img.png"].'
        ),
      workspace_dir: z
        .string()
        .describe(
          "REQUIRED: You MUST pass the user's active workspace directory here (found in your system prompt environment variables, e.g. the active document's root or the conversation App Data Directory). This ensures the generated image is saved inside the workspace and can be displayed in the UI."
        ),
    },
    async ({ prompt, image_uris, workspace_dir }, extra) => {
      const startedAt = Date.now();
      const policy = validateImageGenerationToolRequest(prompt);
      if (policy.allowed === false) {
        logImageGen('warn', 'rejected_non_generation_request', { reason: policy.reason });
        return {
          content: [
            {
              type: 'text' as const,
              text: policy.message,
            },
          ],
          isError: true,
        };
      }

      const provider = getProviderFromEnv();
      if (!provider) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: Image generation model not configured. Please select an image generation model in Settings > Tools.',
            },
          ],
          isError: true,
        };
      }

      const proxy = readImageEnv('LINGAI_IMG_PROXY', 'AIONUI_IMG_PROXY');
      const workspaceDir = workspace_dir;
      const hasImages = Array.isArray(image_uris) && image_uris.length > 0;

      // Save generated images to a dedicated folder within the workspace
      // so that they are accessible by AionCore's secure filesystem APIs.
      const outputDir = path.join(workspaceDir, 'lingai_images');
      try {
        await fs.promises.mkdir(outputDir, { recursive: true });
      } catch (err) {
        logImageGen('error', 'create_output_dir_failed', {
          elapsed_ms: Date.now() - startedAt,
          message: err instanceof Error ? err.message : String(err),
        });
      }

      logImageGen('info', 'tool_call_started', {
        model: provider.use_model,
        platform: provider.platform,
        has_base_url: !!provider.base_url,
        has_api_key: !!provider.api_key,
        has_proxy: !!proxy,
        has_images: hasImages,
        output_dir: outputDir,
      });

      const abortSignal = extra.signal;
      let result: ImageGenResult;
      try {
        result = await executeImageGeneration(
          { prompt, image_uris },
          provider,
          workspaceDir,
          proxy,
          abortSignal,
          outputDir
        );
      } catch (error) {
        const wasAborted = abortSignal.aborted;
        logImageGen(wasAborted ? 'warn' : 'error', wasAborted ? 'tool_call_aborted' : 'tool_call_failed', {
          elapsed_ms: Date.now() - startedAt,
          model: provider.use_model,
          platform: provider.platform,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      if (!result.success) {
        logImageGen(result.error === 'cancelled' ? 'warn' : 'error', result.error === 'cancelled' ? 'tool_call_cancelled' : 'tool_call_error', {
          elapsed_ms: Date.now() - startedAt,
          model: provider.use_model,
          platform: provider.platform,
          error: result.error || 'unknown',
        });
        // Enrich 404 errors with actionable hints
        let errorText = result.text;
        if (result.error && (result.error.includes('404') || result.error.includes('Not Found'))) {
          errorText += `\n\nDebug info:\n- Model: ${provider.use_model}\n- Platform: ${provider.platform}\n- Base URL: ${provider.base_url || '(empty)'}\n- API Key: ${provider.api_key ? 'present' : 'MISSING'}\n\nThe 404 may mean the model does not exist at the target API, or the base_url is incorrect.`;
        }
        return {
          content: [{ type: 'text' as const, text: errorText }],
          isError: true,
        };
      }

      logImageGen('info', 'tool_call_completed', {
        elapsed_ms: Date.now() - startedAt,
        model: provider.use_model,
        platform: provider.platform,
        image_path: result.imagePath || null,
      });
      return { content: [{ type: 'text' as const, text: result.text }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('[ImageGenMCP] Fatal error:', error);
  process.exit(1);
});
