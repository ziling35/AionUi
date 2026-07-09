import { describe, expect, it } from 'vitest';

import { isImageGenerationOrEditPrompt, validateImageGenerationToolRequest } from '@/common/chat/imageGenToolPolicy';

describe('image generation tool policy', () => {
  it('allows explicit image generation prompts', () => {
    expect(isImageGenerationOrEditPrompt('Generate image: a cyberpunk city at night')).toBe(true);
    expect(validateImageGenerationToolRequest('Generate image: a cyberpunk city at night')).toEqual({ allowed: true });
  });

  it('allows explicit image editing prompts', () => {
    expect(validateImageGenerationToolRequest('Edit image: remove the background and upscale it')).toEqual({
      allowed: true,
    });
  });

  it('allows explicit image-to-image prompts with screenshot wording', () => {
    expect(
      validateImageGenerationToolRequest('Image-to-Image: restyle this screenshot as a hand drawn mockup')
    ).toEqual({ allowed: true });
  });

  it('rejects screenshot analysis prompts', () => {
    const result = validateImageGenerationToolRequest(
      'Analyze image: inspect the screenshot and tell me why the reverse proxy config is wrong'
    );

    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.reason).toBe('image-analysis-not-supported');
    expect(result.message).toContain('only for image generation or image editing');
  });

  it('rejects Chinese screenshot-reading prompts', () => {
    const result = validateImageGenerationToolRequest('看一下这个配置截图，为什么站点打不开');

    expect(result.allowed).toBe(false);
  });
});
