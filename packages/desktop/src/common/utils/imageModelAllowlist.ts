/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Allowlist for built-in image generation tool.
 *
 * The tool supports OpenAI-compatible Images API models first
 * (`/v1/images/generations` and `/v1/images/edits`) and falls back to
 * chat-completions multimodal output for providers such as Gemini image models.
 *
 * Model selection therefore must be a platform+model allowlist of providers
 * known to work, rather than a coarse name-substring match. Otherwise users
 * see unrelated image-analysis or vision models in the dropdown that are
 * guaranteed to fail at runtime.
 *
 * Rules below mirror `useConfigModelListWithImage.ts` — the same providers we
 * auto-supplement with default image models.
 */

type ProviderShape = {
  id?: string;
  platform?: string;
  base_url?: string;
  name?: string;
};

const IMAGE_NAME_PATTERN = /(image|banana|imagine)/i;

/**
 * Check if a model supports image generation.
 *
 * Primary signal: the `type` field from the admin-api (authoritative — set by
 * the platform operator in the admin panel).
 * Fallback: model name pattern matching for user-configured providers that
 * don't have a `type` (legacy / custom providers).
 */
export const isImageGenSupported = (provider: ProviderShape, modelName: string, modelType?: string): boolean => {
  // Authoritative: admin-api sets type="image" for image generation models
  if (modelType === 'image') return true;
  if (modelType === 'chat' || modelType === 'embedding') return false;

  // Fallback: name-based detection for providers without explicit type
  if (!IMAGE_NAME_PATTERN.test(modelName)) return false;

  const RULES: Array<(provider: ProviderShape) => boolean> = [
    (p) => p.platform === 'gemini' || p.platform === 'gemini-vertex-ai',
    (p) => !!p.base_url?.includes('openrouter.ai'),
    (p) => !!p.name?.toLowerCase().includes('antigravity'),
    (p) => p.id === 'aion-cloud-official' || p.name === 'LingAI Cloud',
    (p) => p.platform === 'custom' || p.platform === 'openai',
  ];

  return RULES.some((rule) => rule(provider));
};
