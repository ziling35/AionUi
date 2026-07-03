/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpRawOutput, ToolCallUpdate } from '@/common/types/platform/acpTypes';

const INLINE_IMAGE_RESULT_LIMIT = 64 * 1024;
const IMAGE_PATH_EXTENSION_RE = /\.(?:png|jpe?g|webp|gif)$/i;

const isMcpImageContent = (
  item: unknown
): item is { type: 'image'; data: string; mimeType?: string; mime_type?: string } => {
  if (!item || typeof item !== 'object') return false;
  const content = item as Record<string, unknown>;
  return content.type === 'image' && typeof content.data === 'string' && content.data.length > 0;
};

const imageContentToDataUrl = (item: { data: string; mimeType?: string; mime_type?: string }): string => {
  if (item.data.startsWith('data:image/')) return item.data;
  const mimeType = item.mimeType || item.mime_type || 'image/png';
  return `data:${mimeType};base64,${item.data}`;
};
const getImageContentFromArray = (items: unknown): string | undefined => {
  if (!Array.isArray(items)) return undefined;

  for (const item of items) {
    if (isMcpImageContent(item)) return imageContentToDataUrl(item);

    if (item && typeof item === 'object') {
      const content = item as Record<string, unknown>;
      if (isMcpImageContent(content.content)) return imageContentToDataUrl(content.content);
      const nested = getImageContentFromArray(content.content);
      if (nested) return nested;
    }
  }

  return undefined;
};

const isProbablyInlineImageResult = (value: string): boolean =>
  value.length > INLINE_IMAGE_RESULT_LIMIT &&
  (value.startsWith('iVBORw0KGgo') ||
    value.startsWith('/9j/') ||
    value.startsWith('UklGR') ||
    value.startsWith('data:image/'));

const isImagePath = (path: string): boolean => IMAGE_PATH_EXTENSION_RE.test(path);

/**
 * Extract an image file path from text that contains a pattern like
 * "saved to: C:\\Users\\...\\img-123.png".
 * Used to detect image paths from MCP tool results that only return text.
 */
const IMAGE_PATH_IN_TEXT_RE = /saved to:\s*(.+\.(?:png|jpe?g|webp|gif|bmp|tiff))/i;

function extractImagePathFromText(text: string): string | undefined {
  const match = text.match(IMAGE_PATH_IN_TEXT_RE);
  if (match && match[1]) {
    const extracted = match[1].trim();
    if (isImagePath(extracted)) {
      return extracted;
    }
  }
  return undefined;
}

const mimeTypeFromImagePath = (path: string): string => {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
};

const sanitizeAcpRawOutput = (rawOutput?: AcpRawOutput): AcpRawOutput | undefined => {
  if (!rawOutput) return rawOutput;

  const result = rawOutput.result;
  const savedPath = rawOutput.saved_path;
  if (typeof result !== 'string' || !isProbablyInlineImageResult(result)) {
    return rawOutput;
  }

  const { result: _result, ...rest } = rawOutput;
  const sanitized: AcpRawOutput = {
    ...rest,
    result_omitted: true,
    result_omitted_reason: rawOutput.result_omitted_reason || 'image_base64',
    result_bytes: rawOutput.result_bytes || result.length,
  };

  if (rawOutput.image || (typeof savedPath === 'string' && savedPath)) {
    const path = rawOutput.image?.path || savedPath;
    sanitized.image = rawOutput.image || {
      path,
      mime_type: mimeTypeFromImagePath(path),
      source: 'codex_image_generation',
    };
  }

  return sanitized;
};

export const sanitizeAcpToolUpdate = (update: ToolCallUpdate['update']): ToolCallUpdate['update'] => ({
  ...update,
  rawOutput: sanitizeAcpRawOutput(update.rawOutput),
  raw_output: sanitizeAcpRawOutput(update.raw_output),
});

export const sanitizeAcpToolCallContent = (content: ToolCallUpdate): ToolCallUpdate => ({
  ...content,
  update: sanitizeAcpToolUpdate(content.update),
});

export const getAcpImagePath = (update: ToolCallUpdate['update']): string | undefined => {
  const rawOutput = update.rawOutput || update.raw_output;

  // 0. Prefer MCP image content blocks. These allow inline preview even when the
  //    text result only contains a filesystem path.
  const rawOutputImage = getImageContentFromArray((rawOutput as any)?.content);
  if (rawOutputImage) return rawOutputImage;

  const updateContentImage = getImageContentFromArray(update.content);
  if (updateContentImage) return updateContentImage;

  // 1. Check rawOutput.image.path (set by codex image generation or sanitize_inline_image_result)
  const imagePath = rawOutput?.image?.path;
  if (typeof imagePath === 'string' && imagePath) return imagePath;

  // 2. Check rawOutput.saved_path (set by codex image generation)
  const savedPath = rawOutput?.saved_path;
  if (
    typeof savedPath === 'string' &&
    savedPath &&
    (rawOutput?.result_omitted_reason === 'image_base64' || isImagePath(savedPath))
  ) {
    return savedPath;
  }

  // 3. Check rawOutput.result for image path text (some agents put the tool result text here)
  if (rawOutput && typeof (rawOutput as any).result === 'string') {
    const extracted = extractImagePathFromText((rawOutput as any).result);
    if (extracted) return extracted;
  }

  // 4. Check update.content text blocks for image paths
  //    MCP tool results are often surfaced as text content blocks.
  if (update.content && Array.isArray(update.content)) {
    for (const item of update.content) {
      if (item.type === 'content' && item.content?.text) {
        const extracted = extractImagePathFromText(item.content.text);
        if (extracted) return extracted;
      }
    }
  }

  // 5. Check rawOutput for nested content array (MCP result format: { content: [{ type: 'text', text: '...' }] })
  if (rawOutput && Array.isArray((rawOutput as any).content)) {
    for (const item of (rawOutput as any).content) {
      if (item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string') {
        const extracted = extractImagePathFromText(item.text);
        if (extracted) return extracted;
      }
    }
  }

  return undefined;
};

export const getAcpImageFileName = (path: string): string => {
  if (path.startsWith('data:image/')) {
    const mime = path.match(/^data:image\/([^;]+);/)?.[1]?.toLowerCase();
    const ext = mime === 'jpeg' ? 'jpg' : mime || 'png';
    return `generated-image.${ext}`;
  }
  return path.split(/[/\\]/).pop() || 'generated-image.png';
};
