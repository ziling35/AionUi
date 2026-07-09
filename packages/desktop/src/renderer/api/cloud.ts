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
import type { IProvider } from '@/common/config/storage';
import { createApiClient } from './client';
import { CLOUD_PROVIDER_ID, CLOUD_PROVIDER_NAME, getCloudApiBase, getCloudProxyBase } from './config';

const MODEL_ROUTING_PREFIX = 'aion-route:';

export interface CloudModel {
  id: string;
  routingModelId?: string;
  modelId: string;
  name: string;
  providerId?: string | null;
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

function getCloudModelRoutingId(model: CloudModel): string {
  return model.routingModelId || model.id || model.modelId;
}

function getCloudModelLabel(model: CloudModel): string {
  return model.name || model.modelId;
}

function getCloudProviderGroupKey(model: CloudModel): string {
  return model.providerId || model.provider || 'custom';
}

function getUsableCloudModels(models: CloudModel[]): CloudModel[] {
  return models.filter((model) => model.isActive && model.type !== 'embedding');
}

export function decodeCloudRoutingModelId(modelName: string): string | null {
  if (!modelName.startsWith(MODEL_ROUTING_PREFIX)) return null;
  const payload = modelName.slice(MODEL_ROUTING_PREFIX.length);
  const separatorIndex = payload.indexOf(':');
  if (separatorIndex <= 0) return null;
  try {
    const decodedModelId = decodeURIComponent(payload.slice(separatorIndex + 1));
    return decodedModelId || null;
  } catch {
    return null;
  }
}

export function buildCloudProviderFromModels(models: CloudModel[], token?: string | null): IProvider {
  const usableModels = getUsableCloudModels(models);
  return {
    id: CLOUD_PROVIDER_ID,
    platform: 'custom',
    name: CLOUD_PROVIDER_NAME,
    base_url: getCloudProxyBase(),
    api_key: token || 'guest-not-authenticated',
    models: usableModels.map(getCloudModelRoutingId),
    model_labels: Object.fromEntries(
      usableModels.map((model) => [
        getCloudModelRoutingId(model),
        `${model.provider || CLOUD_PROVIDER_NAME} / ${getCloudModelLabel(model)}`,
      ])
    ),
    enabled: true,
  };
}

export function buildCloudProviderGroupsFromModels(
  models: CloudModel[],
  baseProvider?: Pick<IProvider, 'api_key' | 'base_url'>
): IProvider[] {
  const groups = new Map<string, { name: string; models: CloudModel[] }>();
  for (const model of getUsableCloudModels(models)) {
    const groupKey = getCloudProviderGroupKey(model);
    const existing = groups.get(groupKey);
    if (existing) {
      existing.models.push(model);
    } else {
      groups.set(groupKey, {
        name: model.provider || CLOUD_PROVIDER_NAME,
        models: [model],
      });
    }
  }

  return Array.from(groups.values()).map((group) => ({
    id: CLOUD_PROVIDER_ID,
    platform: 'custom',
    name: group.name,
    base_url: baseProvider?.base_url || getCloudProxyBase(),
    api_key: baseProvider?.api_key || 'guest-not-authenticated',
    models: group.models.map(getCloudModelRoutingId),
    model_labels: Object.fromEntries(
      group.models.map((model) => [getCloudModelRoutingId(model), getCloudModelLabel(model)])
    ),
    enabled: true,
  }));
}

export function getCloudModelDisplayLabel(
  provider: Pick<IProvider, 'model_labels'> | undefined,
  modelName: string
): string {
  return provider?.model_labels?.[modelName] || decodeCloudRoutingModelId(modelName) || modelName;
}

export function getCloudProviderRenderKey(provider: Pick<IProvider, 'id' | 'name'>, index: number): string {
  return provider.id === CLOUD_PROVIDER_ID ? `${provider.id}-${provider.name}-${index}` : provider.id;
}

export function getCloudModelSheetValue(
  provider: Pick<IProvider, 'id' | 'name'>,
  modelName: string,
  index: number
): string {
  return JSON.stringify([getCloudProviderRenderKey(provider, index), modelName]);
}

export function parseCloudModelSheetValue(value: string): { providerKey: string; modelName: string } | null {
  try {
    const parsed = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string'
    ) {
      return { providerKey: parsed[0], modelName: parsed[1] };
    }
  } catch {
    // Backward compatible fallback for legacy `${providerId}::${modelName}` values.
  }
  const separatorIndex = value.indexOf('::');
  if (separatorIndex <= 0) return null;
  return { providerKey: value.slice(0, separatorIndex), modelName: value.slice(separatorIndex + 2) };
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
  const providers = await ipcBridge.mode.listProviders.invoke();
  const existing = findCloudProvider(providers);

  const basePayload = {
    platform: 'custom',
    name: CLOUD_PROVIDER_NAME,
    base_url: getCloudProxyBase(),
    // aioncore requires a non-empty api_key. Use a placeholder for guests —
    // the proxy gateway will reject it with 401, prompting login.
    api_key: token || 'guest-not-authenticated',
    models: buildCloudProviderFromModels(models, token).models,
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
