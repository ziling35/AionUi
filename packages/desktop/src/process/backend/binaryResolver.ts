/**
 * Resolve the aioncore binary path.
 *
 * Search order:
 *  1. Bundled with app (production — process.resourcesPath)
 *  2. Dev-mode project resources (walk up from __dirname)
 *  3. System PATH
 */

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

const BINARY_NAME = 'aioncore';
const MAX_DIR_ENTRIES = 20;
const MAX_LOOKUP_TEXT_LENGTH = 1000;

type BackendBinaryResolveDiagnostics = {
  resourcesPath?: string;
  runtimeKey: string;
  binaryName: string;
  checkedBundledPath?: string;
  bundledDirExists?: boolean;
  runtimeDirExists?: boolean;
  resourcesDirEntries?: string[];
  runtimeDirEntries?: string[];
  pathLookupCommand: string;
  pathLookupResult?: string;
  pathLookupError?: string;
};

class BackendBinaryResolveError extends Error {
  readonly diagnostics: BackendBinaryResolveDiagnostics;

  constructor(message: string, diagnostics: BackendBinaryResolveDiagnostics) {
    super(message);
    this.name = 'BackendBinaryResolveError';
    this.diagnostics = diagnostics;
  }
}

function getBinaryName(): string {
  return process.platform === 'win32' ? `${BINARY_NAME}.exe` : BINARY_NAME;
}

function getRuntimeKey(): string {
  return `${process.platform}-${process.arch}`;
}

function listDirEntries(dirPath: string): string[] | undefined {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .slice(0, MAX_DIR_ENTRIES)
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
  } catch {
    return undefined;
  }
}

function trimLookupText(text: string): string {
  return text.trim().slice(0, MAX_LOOKUP_TEXT_LENGTH);
}

/**
 * Resolve the aioncore binary path.
 * Returns the absolute path to the binary, or throws if not found.
 */
export function resolveBinaryPath(): string {
  const runtimeKey = getRuntimeKey();
  const binaryName = getBinaryName();
  const diagnostics: BackendBinaryResolveDiagnostics = {
    runtimeKey,
    binaryName,
    pathLookupCommand: process.platform === 'win32' ? `where ${BINARY_NAME}` : `which ${BINARY_NAME}`,
  };

  const bundled = bundledPath(runtimeKey, binaryName, diagnostics);
  if (bundled) return bundled;

  const devBundled = resolveDevBundledPath(runtimeKey, binaryName, diagnostics);
  if (devBundled) return devBundled;

  const fromPath = resolveFromSystemPATH(diagnostics);
  if (fromPath) return fromPath;

  throw new BackendBinaryResolveError(
    `Cannot find "${BINARY_NAME}" binary. Checked bundled location, dev resources, and system PATH.`,
    diagnostics
  );
}

/**
 * Check bundled binary in resources directory.
 * Layout: bundled-aioncore/{platform}-{arch}/aioncore[.exe]
 */
function bundledPath(
  runtimeKey: string,
  binaryName: string,
  diagnostics: BackendBinaryResolveDiagnostics
): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) return null;
  diagnostics.resourcesPath = resourcesPath;

  const bundledDir = join(resourcesPath, 'bundled-aioncore');
  const runtimeDir = join(bundledDir, runtimeKey);
  const candidate = join(runtimeDir, binaryName);
  diagnostics.checkedBundledPath = candidate;
  diagnostics.bundledDirExists = existsSync(bundledDir);
  diagnostics.runtimeDirExists = existsSync(runtimeDir);
  diagnostics.resourcesDirEntries = listDirEntries(resourcesPath);
  diagnostics.runtimeDirEntries = listDirEntries(runtimeDir);

  if (existsSync(candidate)) return candidate;
  return null;
}

/**
 * Dev-mode fallback: walk up from __dirname to find the project's
 * resources/bundled-aioncore/{runtimeKey}/{binaryName}.
 *
 * In dev mode, process.resourcesPath points to Electron's dist directory
 * (e.g. node_modules/electron/dist/resources), not the project's resources/
 * folder. The built main process is at out/main/ (or out/main/chunks/ for
 * split chunks), so walking up from __dirname will find the project root's
 * resources/ directory.
 */
const MAX_DEV_PATH_WALK_UP = 6;

function resolveDevBundledPath(
  runtimeKey: string,
  binaryName: string,
  diagnostics: BackendBinaryResolveDiagnostics
): string | null {
  let dir = __dirname;
  for (let i = 0; i < MAX_DEV_PATH_WALK_UP; i++) {
    const candidate = join(dir, 'resources', 'bundled-aioncore', runtimeKey, binaryName);
    if (existsSync(candidate)) {
      diagnostics.checkedBundledPath = candidate;
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Try to find the binary on the system PATH.
 */
function resolveFromSystemPATH(diagnostics: BackendBinaryResolveDiagnostics): string | null {
  try {
    const result = execSync(diagnostics.pathLookupCommand, { encoding: 'utf-8', timeout: 5000 }).trim();
    diagnostics.pathLookupResult = trimLookupText(result);
    const firstMatch = result.split(/\r?\n/).find((line) => line.trim());
    if (firstMatch && existsSync(firstMatch.trim())) return firstMatch.trim();
  } catch (error) {
    diagnostics.pathLookupError = error instanceof Error ? trimLookupText(error.message) : String(error);
    return null;
  }
  return null;
}

export type { BackendBinaryResolveDiagnostics };
