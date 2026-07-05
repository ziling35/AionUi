import { describe, expect, it } from 'vitest';
import { buildCliAssistantCloudEnv } from '@process/services/cliAssistantService';

describe('buildCliAssistantCloudEnv', () => {
  it('injects cloud gateway and selected model for OpenAI-compatible CLIs', () => {
    const env = buildCliAssistantCloudEnv({
      id: 'codex',
      apiBaseUrl: 'https://lingai.ziling.site',
      proxyBaseUrl: 'https://lingai.ziling.site/api/proxy/openai/v1',
      token: 'device-token',
      modelId: 'gpt-4.1',
    });

    expect(env.OPENAI_BASE_URL).toBe('https://lingai.ziling.site/api/proxy/openai/v1');
    expect(env.OPENAI_API_KEY).toBe('device-token');
    expect(env.OPENAI_MODEL).toBe('gpt-4.1');
    expect(env.LINGAI_CLOUD_MODEL_LIST_URL).toBe('https://lingai.ziling.site/api/models/list');
  });

  it('also provides best-effort vendor env vars for non-OpenAI CLIs', () => {
    const env = buildCliAssistantCloudEnv({
      id: 'claude-code',
      apiBaseUrl: 'https://lingai.ziling.site',
      proxyBaseUrl: 'https://lingai.ziling.site/api/proxy/openai/v1',
      token: 'device-token',
      modelId: 'claude-sonnet',
    });

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('device-token');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://lingai.ziling.site/api/proxy/anthropic');
    expect(env.GEMINI_API_KEY).toBe('device-token');
  });
});
