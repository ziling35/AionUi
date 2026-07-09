import { describe, expect, it, vi } from 'vitest';

vi.mock('@/common', () => ({
  ipcBridge: {
    mode: {
      listProviders: { invoke: vi.fn() },
      updateProvider: { invoke: vi.fn() },
      createProvider: { invoke: vi.fn() },
    },
  },
}));

import {
  buildCloudProviderFromModels,
  buildCloudProviderGroupsFromModels,
  decodeCloudRoutingModelId,
  getCloudModelDisplayLabel,
} from '@renderer/api/cloud';
import { CLOUD_PROVIDER_ID } from '@renderer/api/config';

describe('cloud model provider mapping', () => {
  const models = [
    {
      id: 'aion-route:provider-a:gpt-4o',
      routingModelId: 'aion-route:provider-a:gpt-4o',
      modelId: 'gpt-4o',
      name: 'gpt-4o',
      providerId: 'provider-a',
      provider: 'Provider A',
      multiplier: 1,
      isActive: true,
      type: 'chat' as const,
    },
    {
      id: 'aion-route:provider-b:gpt-4o',
      routingModelId: 'aion-route:provider-b:gpt-4o',
      modelId: 'gpt-4o',
      name: 'gpt-4o',
      providerId: 'provider-b',
      provider: 'Provider B',
      multiplier: 1,
      isActive: true,
      type: 'chat' as const,
    },
  ];

  it('uses provider-scoped routing ids for duplicate upstream model ids', () => {
    const provider = buildCloudProviderFromModels(models, 'token');

    expect(provider.models).toEqual(['aion-route:provider-a:gpt-4o', 'aion-route:provider-b:gpt-4o']);
    expect(new Set(provider.models).size).toBe(2);
    expect(provider.model_labels?.['aion-route:provider-a:gpt-4o']).toBe('Provider A / gpt-4o');
  });

  it('groups cloud models by upstream provider for display', () => {
    const groups = buildCloudProviderGroupsFromModels(models, {
      api_key: 'token',
      base_url: 'https://example.com/api/proxy/openai/v1',
    });

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.id)).toEqual([CLOUD_PROVIDER_ID, CLOUD_PROVIDER_ID]);
    expect(groups.map((group) => group.name)).toEqual(['Provider A', 'Provider B']);
    expect(groups[0]?.models).toEqual(['aion-route:provider-a:gpt-4o']);
    expect(getCloudModelDisplayLabel(groups[0], groups[0]?.models[0] ?? '')).toBe('gpt-4o');
  });

  it('decodes route ids when no display label is available', () => {
    expect(decodeCloudRoutingModelId('aion-route:provider-a:gpt-4o')).toBe('gpt-4o');
    expect(getCloudModelDisplayLabel(undefined, 'aion-route:provider-a:gpt-4o')).toBe('gpt-4o');
  });
});
