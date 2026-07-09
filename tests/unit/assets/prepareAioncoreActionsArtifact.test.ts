import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const {
  getActionsArtifactName,
  getActionsArtifactMissingMessage,
  getReusableExistingBundle,
} = require('../../../packages/shared-scripts/src/prepare-aioncore');

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-aioncore-test-'));
  tempDirs.push(dir);
  return dir;
}

function writeFile(filePath: string) {
  fs.mkdirSync(dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function createManagedAcpToolFixture({
  managedResourcesDir,
  toolId,
  version,
  runtimeKey,
  entrypoint,
  platformExecutableParts,
}: {
  managedResourcesDir: string;
  toolId: string;
  version: string;
  runtimeKey: string;
  entrypoint: string;
  platformExecutableParts: string[];
}) {
  const platformRoot = join(managedResourcesDir, 'acp', toolId, version, runtimeKey);

  writeJson(join(platformRoot, 'manifest.json'), { entrypoint, path_entries: [] });
  writeFile(join(platformRoot, entrypoint));
  fs.mkdirSync(join(platformRoot, 'node_modules'), { recursive: true });
  writeFile(join(platformRoot, ...platformExecutableParts));
}

function createCompleteWin32X64ManagedResources(targetDir: string) {
  const managedResourcesDir = join(targetDir, 'managed-resources');

  writeFile(join(managedResourcesDir, 'node', 'node-v24.11.0-win-x64', 'node.exe'));

  createManagedAcpToolFixture({
    managedResourcesDir,
    toolId: 'codex-acp',
    version: '0.16.0',
    runtimeKey: 'win32-x64',
    entrypoint: 'node_modules/@zed-industries/codex-acp/bin/codex-acp.js',
    platformExecutableParts: ['node_modules', '@zed-industries', 'codex-acp-win32-x64', 'bin', 'codex-acp.exe'],
  });

  createManagedAcpToolFixture({
    managedResourcesDir,
    toolId: 'codex-cli',
    version: '0.143.0',
    runtimeKey: 'win32-x64',
    entrypoint: 'node_modules/@openai/codex/bin/codex.js',
    platformExecutableParts: [
      'node_modules',
      '@openai',
      'codex-win32-x64',
      'vendor',
      'x86_64-pc-windows-msvc',
      'bin',
      'codex.exe',
    ],
  });

  createManagedAcpToolFixture({
    managedResourcesDir,
    toolId: 'claude-agent-acp',
    version: '0.39.0',
    runtimeKey: 'win32-x64',
    entrypoint: 'node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe',
    platformExecutableParts: ['node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe'],
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('prepare-aioncore GitHub Actions artifact resolver', () => {
  it.each([
    ['win32', 'x64', 'aioncore-manual-windows-x64'],
    ['win32', 'arm64', 'aioncore-manual-windows-arm64'],
    ['darwin', 'x64', 'aioncore-manual-macos-x64'],
    ['darwin', 'arm64', 'aioncore-manual-macos-arm64'],
    ['linux', 'x64', 'aioncore-manual-linux-x64'],
    ['linux', 'arm64', 'aioncore-manual-linux-arm64'],
  ])('maps %s-%s to %s', (platform, arch, artifactName) => {
    expect(getActionsArtifactName(platform, arch)).toBe(artifactName);
  });

  it('explains which AionCore manual artifact is missing for the requested platform', () => {
    expect(
      getActionsArtifactMissingMessage({
        runId: '27319522909',
        platform: 'win32',
        arch: 'x64',
        expectedArtifactName: 'aioncore-manual-windows-x64',
        availableArtifactNames: ['aioncore-manual-macos-arm64', 'aioncore-manual-linux-x64'],
      })
    ).toBe(
      [
        'AionCore run 27319522909 does not contain artifact [ aioncore-manual-windows-x64 ] required for [ win32-x64 ].',
        'Available artifacts: aioncore-manual-macos-arm64, aioncore-manual-linux-x64.',
        'Re-run AionCore Manual Build with platform [ windows-x64 ] or all.',
      ].join(' ')
    );
  });
});

describe('prepare-aioncore existing bundle resolver', () => {
  it('reuses an existing bundle binary but regenerates incomplete managed resources', () => {
    const resourcesDir = makeTempDir();
    const targetDir = path.join(resourcesDir, 'bundled-aioncore', 'win32-x64');
    const binaryName = 'aioncore.exe';
    writeFile(path.join(targetDir, binaryName));
    writeFile(path.join(targetDir, 'managed-resources', 'manifest.json'));

    expect(
      getReusableExistingBundle({
        targetDir,
        binaryName,
        platform: 'win32',
        arch: 'x64',
        tag: 'v0.1.42',
      })
    ).toMatchObject({
      hasManagedResources: false,
      manifestMatched: false,
    });
  });

  it('reuses complete managed resources from an existing bundle', () => {
    const resourcesDir = makeTempDir();
    const targetDir = path.join(resourcesDir, 'bundled-aioncore', 'win32-x64');
    const binaryName = 'aioncore.exe';
    writeFile(path.join(targetDir, binaryName));
    createCompleteWin32X64ManagedResources(targetDir);

    expect(
      getReusableExistingBundle({
        targetDir,
        binaryName,
        platform: 'win32',
        arch: 'x64',
        tag: 'v0.1.42',
      })
    ).toMatchObject({
      hasManagedResources: true,
      manifestMatched: false,
    });
  });

  it('does not reuse an existing bundle when manifest version differs', () => {
    const targetDir = makeTempDir();
    const binaryName = 'aioncore.exe';
    fs.writeFileSync(path.join(targetDir, binaryName), '');
    fs.writeFileSync(
      path.join(targetDir, 'manifest.json'),
      JSON.stringify({ platform: 'win32', arch: 'x64', version: 'v0.1.41' })
    );

    expect(
      getReusableExistingBundle({
        targetDir,
        binaryName,
        platform: 'win32',
        arch: 'x64',
        tag: 'v0.1.42',
      })
    ).toBeNull();
  });
});
