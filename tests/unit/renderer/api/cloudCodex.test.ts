import { describe, expect, it } from 'vitest';
import { buildCloudCodexEnv, pickCodexBaseAgent } from '@/renderer/api/cloudCodex';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

const managedAgent = (partial: Partial<ManagedAgent>): ManagedAgent =>
  ({
    id: 'agent-id',
    name: 'Agent',
    agent_type: 'acp',
    agent_source: 'builtin',
    enabled: true,
    available: true,
    installed: true,
    status: 'online',
    ...partial,
  }) as ManagedAgent;

describe('cloudCodex', () => {
  it('builds an OpenAI-compatible cloud environment with the LingAI proxy', () => {
    const env = buildCloudCodexEnv('device-token', 'gpt-cloud');

    expect(env.LINGAI_CLOUD_CODEX_AGENT).toBe('1');
    expect(env.OPENAI_API_KEY).toBe('device-token');
    expect(env.OPENAI_MODEL).toBe('gpt-cloud');
    expect(env.OPENAI_BASE_URL).toBe('https://lingai.ziling.site/api/proxy/openai/v1');
    expect(env.LINGAI_CLOUD_MODEL_LIST_URL).toBe('https://lingai.ziling.site/api/models/list');
  });

  it('uses a guest token placeholder when the user is not signed in', () => {
    const env = buildCloudCodexEnv(null, 'gpt-cloud');

    expect(env.OPENAI_API_KEY).toBe('guest-not-authenticated');
  });

  it('picks the local Codex agent and ignores the generated cloud custom agent', () => {
    const agents = [
      managedAgent({
        id: 'cloud',
        name: 'LingAI Codex Cloud',
        agent_source: 'custom',
        backend: 'codex',
        env: [{ name: 'LINGAI_CLOUD_CODEX_AGENT', value: '1' }],
      }),
      managedAgent({
        id: 'codex',
        name: 'Codex',
        backend: 'codex',
        command: 'codex-acp',
      }),
    ];

    expect(pickCodexBaseAgent(agents)?.id).toBe('codex');
  });
});
