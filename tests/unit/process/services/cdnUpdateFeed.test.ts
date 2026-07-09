/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { UpdateInfo } from 'electron-updater';
import type { AppUpdater } from 'electron-updater/out/AppUpdater';
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider';
import { CdnGenericProvider } from '@/process/services/cdnGenericProvider';
import { buildCdnFeedOptions, ADMIN_UPDATE_BASE_URL } from '@/process/services/updateFeed';

const makeRuntimeOptions = (): ProviderRuntimeOptions => ({
  isUseMultipleRangeRequest: true,
  platform: 'darwin',
  executor: {
    request: vi.fn(),
  } as unknown as ProviderRuntimeOptions['executor'],
});

describe('CDN update feed options', () => {
  it('builds a custom electron-updater provider pointed at the release CDN', () => {
    const options = buildCdnFeedOptions();

    expect(options.provider).toBe('custom');
    expect(options.url).toBe(ADMIN_UPDATE_BASE_URL);
    expect(options.updateProvider).toBe(CdnGenericProvider);
  });
});

describe('CdnGenericProvider', () => {
  it('resolves relative update files under the version directory', () => {
    const provider = new CdnGenericProvider(
      {
        provider: 'custom',
        url: 'https://static.lingai.com/releases',
      },
      {} as AppUpdater,
      makeRuntimeOptions()
    );

    const files = provider.resolveFiles({
      version: '2.1.14',
      files: [
        {
          url: 'LingAI-2.1.14-mac-arm64.dmg',
          sha512: 'sha512-value',
        },
      ],
      path: 'LingAI-2.1.14-mac-arm64.dmg',
      sha512: 'sha512-value',
      releaseDate: '2026-06-08T00:00:00.000Z',
    } satisfies UpdateInfo);

    expect(files[0]?.url.href).toBe('https://static.lingai.com/releases/2.1.14/LingAI-2.1.14-mac-arm64.dmg');
  });

  it('keeps absolute update file URLs unchanged', () => {
    const provider = new CdnGenericProvider(
      {
        provider: 'custom',
        url: 'https://lingai.ziling.site/api/updates/feed',
      },
      {} as AppUpdater,
      makeRuntimeOptions()
    );

    const files = provider.resolveFiles({
      version: '1.0.0',
      files: [
        {
          url: 'https://downloads.example.com/signed/LingAI-1.0.0-win-x64.exe?token=abc',
          sha512: 'sha512-value',
        },
      ],
      path: 'LingAI-1.0.0-win-x64.exe',
      sha512: 'sha512-value',
      releaseDate: '2026-07-09T00:00:00.000Z',
    } satisfies UpdateInfo);

    expect(files[0]?.url.href).toBe('https://downloads.example.com/signed/LingAI-1.0.0-win-x64.exe?token=abc');
  });
});
