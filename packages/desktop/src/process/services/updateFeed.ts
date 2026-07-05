/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { CdnGenericProvider } from './cdnGenericProvider';
import type { CdnGenericProviderConfiguration } from './cdnGenericProvider';

export const ADMIN_UPDATE_BASE_URL = 'https://lingai.ziling.site/api/updates/feed';

const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '');

export function getUpdateBaseUrl(): string {
  const configured = process.env.LINGAI_UPDATE_BASE_URL?.trim();
  return configured ? normalizeBaseUrl(configured) : ADMIN_UPDATE_BASE_URL;
}

export function getUpdateCheckUrl(): string | undefined {
  const configured = process.env.LINGAI_UPDATE_CHECK_URL?.trim();
  if (configured) return configured;

  const baseUrl = getUpdateBaseUrl();
  if (baseUrl.endsWith('/feed')) return `${baseUrl.slice(0, -'/feed'.length)}/latest`;
  return `${baseUrl}/latest`;
}

export type CdnFeedOptions = CdnGenericProviderConfiguration & {
  updateProvider: typeof CdnGenericProvider;
};

export function buildCdnFeedOptions(): CdnFeedOptions {
  return {
    provider: 'custom',
    url: getUpdateBaseUrl(),
    updateProvider: CdnGenericProvider,
  };
}
