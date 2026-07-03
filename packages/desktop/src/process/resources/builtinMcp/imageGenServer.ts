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
import { executeImageGeneration } from '@/common/chat/imageGenCore';
import type { TProviderWithModel } from '@/common/config/storage';

// Read provider config from environment variables
function getProviderFromEnv(): TProviderWithModel | null {
  const platform = process.env.LINGAI_IMG_PLATFORM;
  const base_url = process.env.LINGAI_IMG_BASE_URL;
  const api_key = process.env.LINGAI_IMG_API_KEY;
  const model = process.env.LINGAI_IMG_MODEL;

  if (!platform || !model) {
    const missing: string[] = [];
    if (!platform) missing.push('LINGAI_IMG_PLATFORM');
    if (!model) missing.push('LINGAI_IMG_MODEL');
    console.error(
      `[ImageGenMCP] Missing env vars: ${missing.join(', ')}. Image generation will not work until a model is selected in Settings > Tools.`
    );
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
    `REQUIRED tool for generating or editing images. You MUST use this tool for ANY image generation request.

CRITICAL: You (the AI assistant) CANNOT generate images directly. You MUST call this tool for:
- Creating/generating any new images from text descriptions
- Drawing, painting, or making any visual content
- Editing or modifying existing images

Primary Functions:
- Generate new images from English text descriptions
- Edit/modify existing images with English text prompts

IMPORTANT: All prompts must be in English for optimal results.

When to Use (MANDATORY):
- User asks to "generate", "create", "draw", "make", "paint" an image
- User asks for any visual content creation
- User asks to edit or modify an image
- User mentions @filename with image extensions (.jpg, .jpeg, .png, .gif, .webp, .bmp, .tiff, .svg)

Input Support:
- Multiple local file paths in array format: ["img1.jpg", "img2.png"]
- Multiple HTTP/HTTPS image URLs in array format
- Text prompts for generation or analysis

Output:
- Saves generated/processed images to workspace with timestamp naming
- Returns image path and AI description/analysis

IMPORTANT: When user provides multiple images, ALWAYS pass ALL images to the image_uris parameter as an array.
CRITICAL: You MUST display the generated/edited image in your final chat response to the user using Markdown image syntax: ![Image Description](absolute_file_path). DO NOT just print the raw file path.
CRITICAL FOR IMAGE-TO-IMAGE: If the user uploads an image and asks for "image-to-image" (图生图) or to generate a new image based on it, DO NOT analyze or describe the image yourself. DIRECTLY pass the absolute path of the uploaded image to the \`image_uris\` parameter, and pass their request to the \`prompt\` parameter.`,
    {
      prompt: z
        .string()
        .describe(
          'The text prompt in English that must clearly specify the operation type: "Generate image: [description]" for creating new images, "Analyze image: [what to analyze]" for image recognition/analysis, "Edit image: [modifications]" for image editing, or "Image-to-Image: [description]" for generating based on a reference image.'
        ),
      image_uris: z
        .array(z.string())
        .optional()
        .describe(
          'Optional: Array of absolute paths to local image files or URLs. Use this for image-to-image, editing, or analysis. ALWAYS pass the raw file path directly; do not try to parse it. Examples: ["C:\\path\\to\\img.jpg", "https://example.com/img.png"].'
        ),
      workspace_dir: z
        .string()
        .describe(
          'REQUIRED: You MUST pass the user\'s active workspace directory here (found in your system prompt environment variables, e.g. the active document\'s root or the conversation App Data Directory). This ensures the generated image is saved inside the workspace and can be displayed in the UI.'
        ),
    },
    async ({ prompt, image_uris, workspace_dir }) => {
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

      const proxy = process.env.LINGAI_IMG_PROXY || undefined;
      const workspaceDir = workspace_dir;
      
      // Save generated images to a dedicated folder within the workspace 
      // so that they are accessible by AionCore's secure filesystem APIs.
      const outputDir = path.join(workspaceDir, 'lingai_images');
      try {
        await fs.promises.mkdir(outputDir, { recursive: true });
      } catch (err) {
        console.error('[ImageGenMCP] Failed to create output directory:', err);
      }

      console.error(
        `[ImageGenMCP] Calling model=${provider.use_model}, platform=${provider.platform}, base_url=${provider.base_url ? provider.base_url : '(empty)'}, api_key=${provider.api_key ? 'present' : 'MISSING'}, has_proxy=${!!proxy}`
      );

      const result = await executeImageGeneration(
        { prompt, image_uris },
        provider,
        workspaceDir,
        proxy,
        undefined,
        outputDir
      );

      if (!result.success) {
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

      // Build content blocks: always include text, and add image block when available.
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        { type: 'text' as const, text: result.text },
      ];

      // If an image was saved, read it and include as an MCP image content block
      // so MCP-aware clients can render a preview inline.
      if (result.imagePath) {
        try {
          const imageBuffer = await fs.promises.readFile(result.imagePath);
          const ext = path.extname(result.imagePath).toLowerCase();
          const mimeType =
            ext === '.jpg' || ext === '.jpeg'
              ? 'image/jpeg'
              : ext === '.webp'
                ? 'image/webp'
                : ext === '.gif'
                  ? 'image/gif'
                  : 'image/png';
          content.push({
            type: 'image' as const,
            data: imageBuffer.toString('base64'),
            mimeType,
          });
        } catch (readErr) {
          console.error('[ImageGenMCP] Failed to read generated image for preview:', readErr);
        }
      }

      return { content };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('[ImageGenMCP] Fatal error:', error);
  process.exit(1);
});
