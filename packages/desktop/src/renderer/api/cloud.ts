/**
 * Cloud model module — bridges the LingAI admin-api server with the local
 * aioncore provider system.
 *
 * The admin-api server exposes an OpenAI-compatible proxy gateway that performs
 * token-based billing. To let users chat with cloud models transparently, we
 * sync a dedicated provider (id = `CLOUD_PROVIDER_ID`) into aioncore's provider
 * list, pointing its `base_url` at the proxy gateway and its `api_key` at the
 * user's auth token. aioncore then forwards chat requests to the gateway, which
 * authenticates the user, deducts quota, and proxies to the real upstream.
 */

import { ipcBridge } from '@/common';
import { createApiClient } from './client';
import { CLOUD_PROVIDER_ID, CLOUD_PROVIDER_NAME, getCloudApiBase, getCloudProxyBase } from './config';

export interface CloudModel {
  id: string;
  modelId: string;
  name: string;
  provider: string;
  multiplier: number;
  isActive: boolean;
  type?: 'chat' | 'image' | 'embedding';
}

interface ListModelsResponse {
  success: boolean;
  models: CloudModel[];
}

function client() {
  return createApiClient(getCloudApiBase());
}

/** Fetch the active cloud models from the admin-api server. */
export async function listCloudModels(): Promise<CloudModel[]> {
  const res = await client().get<ListModelsResponse>('/api/models/list');
  return (res?.models ?? []).filter((m) => m.isActive);
}

type ProviderLike = Awaited<ReturnType<typeof ipcBridge.mode.listProviders.invoke>>[number];

/** Find the existing cloud provider by reserved id or name. */
function findCloudProvider(providers: ProviderLike[]): ProviderLike | undefined {
  return providers.find((p) => p.id === CLOUD_PROVIDER_ID || p.name === CLOUD_PROVIDER_NAME);
}

/**
 * Create or update the cloud provider in aioncore so that cloud models become
 * available in the model picker.
 *
 * When `token` is omitted or empty, the provider is still synced (so models are
 * visible in the picker) but the api_key is set to an empty string — the proxy
 * gateway will return 401 on any chat request, prompting the user to log in.
 * After login, call again with the real token to enable actual usage.
 *
 * Failures are non-fatal (the user is still logged in; models just won't appear
 * until the next sync).
 */
export async function syncCloudProvider(token?: string | null): Promise<void> {
  const models = await listCloudModels();
  const modelIds = models.map((m) => m.modelId);

  const providers = await ipcBridge.mode.listProviders.invoke();
  const existing = findCloudProvider(providers);

  const basePayload = {
    platform: 'custom',
    name: CLOUD_PROVIDER_NAME,
    base_url: getCloudProxyBase(),
    // aioncore requires a non-empty api_key. Use a placeholder for guests —
    // the proxy gateway will reject it with 401, prompting login.
    api_key: token || 'guest-not-authenticated',
    models: modelIds,
    enabled: true,
  };

  if (existing) {
    await ipcBridge.mode.updateProvider.invoke({ id: existing.id, ...basePayload });
  } else {
    await ipcBridge.mode.createProvider.invoke({ id: CLOUD_PROVIDER_ID, ...basePayload });
  }
}

/**
 * On logout, keep the cloud provider visible (models stay in the picker) but
 * clear the api_key so actual chat requests are rejected until the user logs
 * in again. This implements the "browse models without login, use with login"
 * commercial flow.
 */
export async function disableCloudProvider(): Promise<void> {
  const providers = await ipcBridge.mode.listProviders.invoke();
  const existing = findCloudProvider(providers);
  if (existing) {
    await ipcBridge.mode.updateProvider.invoke({ id: existing.id, api_key: 'guest-not-authenticated', enabled: true });
  }
}
