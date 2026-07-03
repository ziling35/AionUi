/**
 * Cloud commerce API configuration.
 *
 * The cloud base URL points to the LingAI admin-api server which provides
 * authentication, billing (card secrets / quota) and the OpenAI-compatible
 * proxy gateway. It is overridable per-device via localStorage so that
 * self-hosted deployments can point the client at their own server.
 */

const DEFAULT_CLOUD_API_BASE = 'http://localhost:3000';
const STORAGE_KEY = 'aion_cloud_api_base';

/** Reserved provider id used to identify the auto-synced cloud provider. */
export const CLOUD_PROVIDER_ID = 'aion-cloud-official';

/** Reserved provider name used to identify the auto-synced cloud provider. */
export const CLOUD_PROVIDER_NAME = 'LingAI Cloud';

/**
 * Resolve the cloud API base URL. Trailing slashes are stripped so callers can
 * safely concatenate paths.
 */
export function getCloudApiBase(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored.replace(/\/+$/, '');
  } catch {
    // localStorage may be unavailable (SSR / sandbox); fall back to default.
  }
  return DEFAULT_CLOUD_API_BASE;
}

/** Persist a custom cloud API base URL (used by the account settings UI). */
export function setCloudApiBase(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, url.replace(/\/+$/, ''));
  } catch {
    // ignore write failures
  }
}

/** OpenAI-compatible proxy gateway base URL (appended `/chat/completions` by aioncore). */
export function getCloudProxyBase(): string {
  return `${getCloudApiBase()}/api/proxy/openai/v1`;
}
