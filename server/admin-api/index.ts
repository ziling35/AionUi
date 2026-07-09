import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const prisma = new PrismaClient();

app.use(cors());
// Default JSON body parser for all routes except audio/transcriptions
app.use(express.json({ limit: '25mb' }));
// Raw body for multipart/form-data (audio transcriptions and image edits)
app.use('/api/proxy/openai/v1/audio/transcriptions', express.raw({ type: 'multipart/form-data', limit: '25mb' }));
app.use('/api/proxy/openai/v1/images/edits', express.raw({ type: 'multipart/form-data', limit: '50mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'LingAI Admin API is running' });
});

const RELEASES_DIR = process.env.RELEASES_DIR || '/data/releases';
const QUOTA_PLAN_BALANCE = 'balance';
const QUOTA_PLAN_RESET_WINDOW = 'reset_window';
const DEFAULT_RESET_WINDOW_HOURS = 4;
const DEFAULT_RESET_WINDOW_VALID_DAYS = 30;
const LINGCODEX_TOKEN_PREFIX = 'lingcodex_';
const DEFAULT_LINGCODEX_TOKEN_TTL_SECONDS = 60 * 60;

function compareVersions(a: string, b: string): number {
  const pa = a
    .replace(/^v/, '')
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10) || 0);
  const pb = b
    .replace(/^v/, '')
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10) || 0);
  const max = Math.max(pa.length, pb.length);
  for (let i = 0; i < max; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getPublicBaseUrl(req: express.Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (configured) return configured;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function parseDirectDownloadUrl(value: string): URL | null {
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

function getUrlSearchParamCaseInsensitive(url: URL, name: string): string | null {
  const normalizedName = name.toLowerCase();
  for (const [key, value] of url.searchParams.entries()) {
    if (key.toLowerCase() === normalizedName) return value;
  }
  return null;
}

function decodeContentDispositionFileName(value: string): string | null {
  const trimmed = value.trim().replace(/^"(.*)"$/, '$1');
  if (!trimmed) return null;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function getContentDispositionFileName(disposition: string | null): string | null {
  if (!disposition) return null;

  const filenameStar = /(?:^|;)\s*filename\*\s*=\s*(?:utf-8'')?([^;]+)/i.exec(disposition);
  const filenameStarValue = filenameStar?.[1] ? decodeContentDispositionFileName(filenameStar[1]) : null;
  if (filenameStarValue) return filenameStarValue;

  const filename = /(?:^|;)\s*filename\s*=\s*("[^"]+"|[^;]+)/i.exec(disposition);
  return filename?.[1] ? decodeContentDispositionFileName(filename[1]) : null;
}

function getDirectDownloadFileName(url: URL, fallbackVersion: string): string {
  const disposition = getUrlSearchParamCaseInsensitive(url, 'response-content-disposition');
  const dispositionName = getContentDispositionFileName(disposition);
  if (dispositionName) return dispositionName;

  const rawName = path.posix.basename(url.pathname);
  if (rawName && path.posix.extname(rawName)) {
    try {
      return decodeURIComponent(rawName);
    } catch {
      return rawName;
    }
  }
  return `LingAI-${fallbackVersion}.exe`;
}

function getReleaseDownloadFileName(release: { fileName: string; version: string }): string {
  const directUrl = parseDirectDownloadUrl(release.fileName);
  return directUrl ? getDirectDownloadFileName(directUrl, release.version) : release.fileName;
}

function yamlQuoted(value: string): string {
  return JSON.stringify(value);
}

function getReleaseDownloadAsset(
  release: NonNullable<Awaited<ReturnType<typeof findLatestRelease>>>,
  req: express.Request
) {
  const directUrl = parseDirectDownloadUrl(release.fileName);
  if (directUrl) {
    return {
      name: getDirectDownloadFileName(directUrl, release.version),
      url: directUrl.toString(),
    };
  }

  const baseUrl = getPublicBaseUrl(req);
  const fileName = getReleaseDownloadFileName(release);
  return {
    name: fileName,
    url: `${baseUrl}/api/updates/feed/${encodeURIComponent(release.version)}/${encodeURIComponent(fileName)}`,
  };
}

function parseFeedFile(fileName: string): { channel: string; platform: string; arch: string } {
  if (fileName === 'latest-win-arm64.yml') return { channel: 'latest-win-arm64', platform: 'win32', arch: 'arm64' };
  if (fileName === 'latest-arm64-mac.yml') return { channel: 'latest-arm64', platform: 'darwin', arch: 'arm64' };
  if (fileName === 'latest-mac.yml') return { channel: 'latest', platform: 'darwin', arch: 'x64' };
  if (fileName === 'latest-linux-arm64.yml') return { channel: 'latest', platform: 'linux', arch: 'arm64' };
  if (fileName === 'latest-linux.yml') return { channel: 'latest', platform: 'linux', arch: 'x64' };
  return { channel: 'latest', platform: 'win32', arch: 'x64' };
}

async function findLatestRelease(platform: string, arch: string, channel = 'latest') {
  const releases = await prisma.appRelease.findMany({
    where: { enabled: true, platform, arch, channel },
    orderBy: { createdAt: 'desc' },
  });
  return releases.toSorted((a, b) => compareVersions(b.version, a.version))[0] || null;
}

function toReleasePayload(release: NonNullable<Awaited<ReturnType<typeof findLatestRelease>>>, req: express.Request) {
  const baseUrl = getPublicBaseUrl(req);
  const downloadAsset = getReleaseDownloadAsset(release, req);
  const asset = {
    name: downloadAsset.name,
    url: downloadAsset.url,
    size: release.size || 0,
    contentType: 'application/octet-stream',
  };
  return {
    tagName: `v${release.version}`,
    version: release.version,
    name: `LingAI ${release.version}`,
    body: release.releaseNotes || '',
    htmlUrl: `${baseUrl}/api/updates/latest?platform=${release.platform}&arch=${release.arch}`,
    publishedAt: release.releaseDate.toISOString(),
    prerelease: release.version.includes('-'),
    draft: false,
    forceUpdate: release.forceUpdate,
    assets: [asset],
    recommendedAsset: asset,
  };
}

function renderLatestYml(release: NonNullable<Awaited<ReturnType<typeof findLatestRelease>>>): string {
  const filePath = getReleaseDownloadFileName(release);
  const lines = [
    `version: ${release.version}`,
    'files:',
    `  - url: ${yamlQuoted(filePath)}`,
    `    sha512: ${release.sha512}`,
  ];
  if (release.size) lines.push(`    size: ${release.size}`);
  lines.push(`path: ${yamlQuoted(filePath)}`);
  lines.push(`sha512: ${release.sha512}`);
  lines.push(`releaseDate: '${release.releaseDate.toISOString()}'`);
  if (release.releaseNotes) {
    lines.push('releaseNotes: |');
    for (const line of release.releaseNotes.split(/\r?\n/)) {
      lines.push(`  ${line}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function validateReleaseInput(input: {
  version?: unknown;
  fileName?: unknown;
  sha512?: unknown;
  size?: unknown;
}): string | null {
  const version = String(input.version || '');
  const fileName = String(input.fileName || '');
  const sha512 = String(input.sha512 || '');

  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    return 'Version must use full semantic version format, for example 2.2.0';
  }
  if (!fileName.trim()) {
    return 'fileName is required';
  }
  const directUrl = parseDirectDownloadUrl(fileName);
  if (directUrl && directUrl.protocol !== 'https:') {
    return 'fileName direct download URL must use HTTPS';
  }
  if (!/^[A-Za-z0-9+/=]{80,120}$/.test(sha512)) {
    return 'sha512 must be copied from the generated latest.yml file';
  }
  if (input.size !== undefined && input.size !== null && input.size !== '' && Number(input.size) < 0) {
    return 'size must be greater than or equal to 0';
  }
  return null;
}

type NormalizedModelInput = {
  modelId: string;
  name: string;
  multiplier: number;
  billingMode: string;
  inputTokenPrice: number;
  outputTokenPrice: number;
  fixedCost: number;
  minCost: number;
  reserveCost: number;
  sortOrder: number;
  isActive: boolean;
  type: string;
  unitPrice: number;
};

function isNormalizedModelInput(model: NormalizedModelInput | null): model is NormalizedModelInput {
  return model !== null;
}

function normalizeModelInput(model: any): NormalizedModelInput | null {
  const modelId = typeof model === 'string' ? model : model?.modelId || model?.id;
  if (!modelId) return null;
  return {
    modelId,
    name: typeof model === 'string' ? model : model.name || modelId,
    multiplier: parseFloat(model?.multiplier) || 1.0,
    billingMode: model?.billingMode || (Number(model?.unitPrice || 0) > 0 ? 'per_call' : 'per_token'),
    inputTokenPrice: Number.parseFloat(model?.inputTokenPrice) || 1.0,
    outputTokenPrice: Number.parseFloat(model?.outputTokenPrice) || 1.0,
    fixedCost: Math.max(0, Math.ceil(Number.parseFloat(model?.fixedCost) || 0)),
    minCost: Math.max(1, Math.ceil(Number.parseFloat(model?.minCost) || 1)),
    reserveCost: Math.max(0, Math.ceil(Number.parseFloat(model?.reserveCost) || 0)),
    sortOrder: Math.max(0, Math.ceil(Number.parseFloat(model?.sortOrder) || 0)),
    isActive: model?.isActive !== false,
    type: model?.type || 'chat',
    unitPrice: parseFloat(model?.unitPrice) || 0,
  };
}

const ORPHANED_PROVIDER_ID = '__orphaned__';
const MODEL_ROUTING_PREFIX = 'aion-route:';

function providerScopeToId(providerId: string | null | undefined): string {
  return providerId || ORPHANED_PROVIDER_ID;
}

function providerIdFromScope(providerScope: string): string | null {
  return providerScope === ORPHANED_PROVIDER_ID ? null : providerScope;
}

function encodeModelRoutingId(providerId: string | null | undefined, modelId: string): string {
  return `${MODEL_ROUTING_PREFIX}${encodeURIComponent(providerScopeToId(providerId))}:${encodeURIComponent(modelId)}`;
}

function decodeModelRoutingId(value: unknown): { providerId: string | null; modelId: string } | null {
  if (typeof value !== 'string' || !value.startsWith(MODEL_ROUTING_PREFIX)) return null;
  const payload = value.slice(MODEL_ROUTING_PREFIX.length);
  const separatorIndex = payload.indexOf(':');
  if (separatorIndex <= 0) return null;
  try {
    const providerScope = decodeURIComponent(payload.slice(0, separatorIndex));
    const modelId = decodeURIComponent(payload.slice(separatorIndex + 1));
    if (!providerScope || !modelId) return null;
    return { providerId: providerIdFromScope(providerScope), modelId };
  } catch {
    return null;
  }
}

function getFirstString(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}

function rewriteJsonModelBody(body: unknown, modelId: string): unknown {
  if (!body || typeof body !== 'object' || Buffer.isBuffer(body)) return body;
  return { ...(body as Record<string, unknown>), model: modelId };
}

function isLingCodexTextModelConfig(modelConfig: any): boolean {
  const type = String(modelConfig?.type || 'chat').toLowerCase();
  if (type === 'embedding' || type === 'image') return false;
  const modelId = String(modelConfig?.modelId || '').toLowerCase();
  return !modelId.includes('image');
}

function toOpenAiModelListItem(model: any) {
  const routingModelId = encodeModelRoutingId(model.providerId, model.modelId);
  return {
    id: routingModelId,
    modelId: routingModelId,
    name: model.name || model.modelId,
    object: 'model',
    created: Math.floor(model.createdAt.getTime() / 1000),
    owned_by: model.provider?.name || 'lingai',
  };
}

function scopedModelWhere(providerIdParam: string, modelId: string): { providerId: string | null; modelId: string } {
  return {
    providerId: providerIdParam === ORPHANED_PROVIDER_ID ? null : providerIdParam,
    modelId,
  };
}

function dedupeModelInputs(models: NormalizedModelInput[]): NormalizedModelInput[] {
  const seen = new Set<string>();
  const result: NormalizedModelInput[] = [];
  for (const model of models) {
    if (seen.has(model.modelId)) continue;
    seen.add(model.modelId);
    result.push(model);
  }
  return result;
}

type AuthenticatedCloudUser = {
  id: string;
  username: string | null;
  deviceId: string | null;
  quota: number;
  usedQuota: number;
  quotaPlanType: string;
  quotaWindowHours: number | null;
  quotaWindowLimit: number | null;
  quotaWindowUsed: number;
  quotaWindowStartedAt: Date | null;
  quotaWindowEndsAt: Date | null;
  quotaExpiresAt: Date | null;
  cloudHistoryEnabled: boolean;
};

type CloudHistorySyncMessageInput = {
  id?: unknown;
  msg_id?: unknown;
  type?: unknown;
  position?: unknown;
  status?: unknown;
  hidden?: unknown;
  created_at?: unknown;
  content?: unknown;
};

type CloudHistorySyncConversationInput = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  source?: unknown;
  extra?: unknown;
  created_at?: unknown;
  modified_at?: unknown;
  messages?: unknown;
};

const MAX_CLOUD_HISTORY_CONVERSATIONS_PER_SYNC = 20;
const MAX_CLOUD_HISTORY_MESSAGES_PER_CONVERSATION = 200;
const MAX_CLOUD_HISTORY_ARRAY_ITEMS = 200;
const MAX_CLOUD_HISTORY_STRING_LENGTH = 20_000;
const MAX_CLOUD_HISTORY_JSON_LENGTH = 200_000;
const MAX_CLOUD_HISTORY_DEPTH = 8;
const SENSITIVE_CLOUD_HISTORY_KEY_PATTERN =
  /(api[_-]?key|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|secret|password|cookie|workspace|cli[_-]?path|bearer)/i;

async function getAuthenticatedCloudUser(
  req: express.Request,
  res: express.Response
): Promise<AuthenticatedCloudUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { deviceId: token },
    select: {
      id: true,
      username: true,
      deviceId: true,
      quota: true,
      usedQuota: true,
      quotaPlanType: true,
      quotaWindowHours: true,
      quotaWindowLimit: true,
      quotaWindowUsed: true,
      quotaWindowStartedAt: true,
      quotaWindowEndsAt: true,
      quotaExpiresAt: true,
      cloudHistoryEnabled: true,
    },
  });

  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return null;
  }

  return refreshUserQuotaWindow(user);
}

type LingCodexTokenPayload = {
  typ: 'lingcodex';
  sub: string;
  did: string | null;
  model: string;
  cid: string | null;
  iat: number;
  exp: number;
  nonce: string;
};

type ProxyAuthenticatedUser =
  | {
      ok: true;
      user: AuthenticatedCloudUser;
      lingcodex?: LingCodexTokenPayload;
    }
  | {
      ok: false;
      status: number;
      error: { message: string };
    };

function extractBearerToken(authHeader: unknown): string | null {
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  return token || null;
}

function getLingCodexTokenSecret(): string | null {
  const secret = process.env.LINGCODEX_TOKEN_SECRET || process.env.ADMIN_API_SECRET || process.env.JWT_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function getLingCodexTokenTtlSeconds(): number {
  const configured = Number.parseInt(process.env.LINGCODEX_TOKEN_TTL_SECONDS || '', 10);
  if (Number.isFinite(configured) && configured >= 60 && configured <= 24 * 60 * 60) return configured;
  return DEFAULT_LINGCODEX_TOKEN_TTL_SECONDS;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signLingCodexPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function issueLingCodexToken(params: {
  user: Pick<AuthenticatedCloudUser, 'id' | 'deviceId'>;
  model: string;
  conversationId?: string | null;
  secret: string;
}): { token: string; expiresIn: number } {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = getLingCodexTokenTtlSeconds();
  const payload: LingCodexTokenPayload = {
    typ: 'lingcodex',
    sub: params.user.id,
    did: params.user.deviceId,
    model: params.model,
    cid: params.conversationId || null,
    iat: now,
    exp: now + expiresIn,
    nonce: randomBytes(16).toString('base64url'),
  };
  const encodedPayload = base64UrlJson(payload);
  const signature = signLingCodexPayload(encodedPayload, params.secret);
  return {
    token: `${LINGCODEX_TOKEN_PREFIX}${encodedPayload}.${signature}`,
    expiresIn,
  };
}

function parseLingCodexTokenPayload(value: unknown): LingCodexTokenPayload | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Partial<LingCodexTokenPayload>;
  if (payload.typ !== 'lingcodex') return null;
  if (typeof payload.sub !== 'string' || !payload.sub) return null;
  if (payload.did !== null && typeof payload.did !== 'string') return null;
  if (typeof payload.model !== 'string' || !payload.model) return null;
  if (payload.cid !== null && typeof payload.cid !== 'string') return null;
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
  if (typeof payload.nonce !== 'string' || !payload.nonce) return null;
  return payload as LingCodexTokenPayload;
}

function verifyLingCodexToken(token: string, secret: string): LingCodexTokenPayload | null {
  if (!token.startsWith(LINGCODEX_TOKEN_PREFIX)) return null;
  const body = token.slice(LINGCODEX_TOKEN_PREFIX.length);
  const separatorIndex = body.lastIndexOf('.');
  if (separatorIndex <= 0) return null;

  const encodedPayload = body.slice(0, separatorIndex);
  const signature = body.slice(separatorIndex + 1);
  const expectedSignature = signLingCodexPayload(encodedPayload, secret);
  if (!safeStringEqual(signature, expectedSignature)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    const payload = parseLingCodexTokenPayload(parsed);
    if (!payload) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function resolveProxyAuthenticatedUser(authHeader: unknown): Promise<ProxyAuthenticatedUser> {
  const token = extractBearerToken(authHeader);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: { message: 'Missing or invalid Authorization header. Please use Bearer <token>' },
    };
  }

  if (token.startsWith(LINGCODEX_TOKEN_PREFIX)) {
    const secret = getLingCodexTokenSecret();
    if (!secret) {
      return {
        ok: false,
        status: 500,
        error: { message: 'LingCodex token signing secret is not configured.' },
      };
    }
    const payload = verifyLingCodexToken(token, secret);
    if (!payload) {
      return { ok: false, status: 401, error: { message: 'Invalid or expired LingCodex session token.' } };
    }
    const rawUser = await prisma.user.findUnique({ where: { id: payload.sub } });
    const user = rawUser ? await refreshUserQuotaWindow(rawUser) : null;
    if (!user || (payload.did && user.deviceId !== payload.did)) {
      return { ok: false, status: 401, error: { message: 'User not found or invalid LingCodex token.' } };
    }
    return { ok: true, user, lingcodex: payload };
  }

  const rawUser = await prisma.user.findUnique({ where: { deviceId: token } });
  const user = rawUser ? await refreshUserQuotaWindow(rawUser) : null;
  if (!user) {
    return { ok: false, status: 401, error: { message: 'User not found or invalid token.' } };
  }
  return { ok: true, user };
}

function getOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getBoundedString(value: unknown, fallback: string): string {
  const text = getOptionalString(value) ?? fallback;
  return text.slice(0, 500);
}

function toDateFromMillis(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sanitizeCloudHistoryValue(value: unknown, depth = 0): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (depth > MAX_CLOUD_HISTORY_DEPTH) {
    return '[Max depth]';
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value.length <= MAX_CLOUD_HISTORY_STRING_LENGTH) {
      return value;
    }
    return `${value.slice(0, MAX_CLOUD_HISTORY_STRING_LENGTH)}...[truncated]`;
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_CLOUD_HISTORY_ARRAY_ITEMS).map((item) => sanitizeCloudHistoryValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_CLOUD_HISTORY_KEY_PATTERN.test(key)) {
        output[key] = '[REDACTED]';
        continue;
      }
      output[key] = sanitizeCloudHistoryValue(child, depth + 1);
    }
    return output;
  }

  return String(value);
}

function stringifyCloudHistoryValue(value: unknown): string {
  const serialized = JSON.stringify(sanitizeCloudHistoryValue(value) ?? null);
  if (serialized.length <= MAX_CLOUD_HISTORY_JSON_LENGTH) {
    return serialized;
  }

  return JSON.stringify({
    truncated: true,
    preview: serialized.slice(0, MAX_CLOUD_HISTORY_JSON_LENGTH),
  });
}

function getBoundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function safeJsonStringify(value: unknown, maxLength = 500_000): string | null {
  if (value === undefined || value === null) return null;
  try {
    const text = JSON.stringify(value);
    return text.length > maxLength ? text.slice(0, maxLength) : text;
  } catch {
    return null;
  }
}

function parseJsonOrNull(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeFeedbackAttachments(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).map((attachment) => {
    const item = attachment as Record<string, unknown>;
    const filename = getBoundedString(item.filename, 'attachment').slice(0, 160);
    const contentType = getBoundedString(item.contentType, 'application/octet-stream').slice(0, 100);
    const dataBase64 = typeof item.dataBase64 === 'string' ? item.dataBase64.slice(0, 8_000_000) : '';
    const size = getBoundedNumber(item.size, Math.floor((dataBase64.length * 3) / 4), 0, 8_000_000);
    return { filename, contentType, size, dataBase64 };
  });
}

function toFeedbackPayload(report: any, includeAttachments = false) {
  const attachments = parseJsonOrNull(report.attachmentsJson);
  const attachmentList = Array.isArray(attachments) ? attachments : [];
  return {
    id: report.id,
    module: report.module,
    moduleLabel: report.moduleLabel,
    description: report.description,
    status: report.status,
    tags: parseJsonOrNull(report.tagsJson),
    extra: parseJsonOrNull(report.extraJson),
    attachments: includeAttachments
      ? attachmentList
      : attachmentList.map((attachment: any) => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
        })),
    attachmentCount: report.attachmentCount,
    appVersion: report.appVersion,
    platform: report.platform,
    userAgent: report.userAgent,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function getPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function isResetWindowQuotaPlan(user: { quotaPlanType?: string | null }): boolean {
  return user.quotaPlanType === QUOTA_PLAN_RESET_WINDOW;
}

async function refreshUserQuotaWindow<
  T extends {
    id: string;
    quotaPlanType?: string | null;
    quotaWindowHours?: number | null;
    quotaWindowLimit?: number | null;
    quotaWindowEndsAt?: Date | null;
    quotaExpiresAt?: Date | null;
  },
>(user: T): Promise<T> {
  if (!isResetWindowQuotaPlan(user)) return user;

  const now = new Date();
  const expiresAt = user.quotaExpiresAt;
  if (expiresAt && expiresAt <= now) {
    if ((user as any).quota === 0) return user;
    return (await prisma.user.update({
      where: { id: user.id },
      data: { quota: 0 },
    })) as unknown as T;
  }

  const windowHours = getPositiveInt(user.quotaWindowHours, DEFAULT_RESET_WINDOW_HOURS);
  const windowLimit = getPositiveInt(user.quotaWindowLimit, 0);
  if (windowLimit <= 0) return user;

  if (!user.quotaWindowEndsAt || user.quotaWindowEndsAt <= now) {
    return (await prisma.user.update({
      where: { id: user.id },
      data: {
        quota: windowLimit,
        quotaWindowUsed: 0,
        quotaWindowStartedAt: now,
        quotaWindowEndsAt: addHours(now, windowHours),
      },
    })) as unknown as T;
  }

  return user;
}

function buildQuotaPlanPayload(user: any) {
  const mode = isResetWindowQuotaPlan(user) ? QUOTA_PLAN_RESET_WINDOW : QUOTA_PLAN_BALANCE;
  const total =
    mode === QUOTA_PLAN_RESET_WINDOW
      ? Math.max(0, Number(user.quotaWindowLimit || 0))
      : Math.max(0, Number(user.quota || 0) + Number(user.usedQuota || 0));
  const remaining = Math.max(0, Number(user.quota || 0));
  const used =
    mode === QUOTA_PLAN_RESET_WINDOW
      ? Math.max(0, Number(user.quotaWindowUsed || 0))
      : Math.max(0, Number(user.usedQuota || 0));
  const progress = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const resetAt = user.quotaWindowEndsAt ? new Date(user.quotaWindowEndsAt) : null;
  const expiresAt = user.quotaExpiresAt ? new Date(user.quotaExpiresAt) : null;
  const now = Date.now();

  return {
    mode,
    label: mode === QUOTA_PLAN_RESET_WINDOW ? 'reset_window' : 'balance',
    total,
    remaining,
    used,
    progress,
    windowHours:
      mode === QUOTA_PLAN_RESET_WINDOW ? getPositiveInt(user.quotaWindowHours, DEFAULT_RESET_WINDOW_HOURS) : null,
    resetAt: resetAt?.toISOString() ?? null,
    expiresAt: expiresAt?.toISOString() ?? null,
    secondsUntilReset: resetAt ? Math.max(0, Math.ceil((resetAt.getTime() - now) / 1000)) : null,
    isExpired: Boolean(expiresAt && expiresAt.getTime() <= now),
  };
}

function toUserPayload(user: any) {
  return {
    id: user.id,
    username: user.username,
    quota: user.quota,
    usedQuota: user.usedQuota,
    quotaPlan: buildQuotaPlanPayload(user),
    cloudHistoryEnabled: user.cloudHistoryEnabled,
  };
}

// ─── Auth API ──────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) return res.status(400).json({ error: 'Username already exists' });

    const user = await prisma.user.create({
      data: {
        username,
        password,
        deviceId: `device-${Date.now()}`,
      },
    });

    res.json({
      success: true,
      token: user.deviceId,
      user: toUserPayload(user),
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    res.json({
      success: true,
      token: user.deviceId,
      user: toUserPayload(await refreshUserQuotaWindow(user)),
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];

    const user = await prisma.user.findUnique({ where: { deviceId: token } });
    if (!user) return res.status(401).json({ error: 'User not found' });

    const refreshedUser = await refreshUserQuotaWindow(user);

    res.json({
      success: true,
      user: toUserPayload(refreshedUser),
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/lingcodex-token', async (req, res) => {
  try {
    const user = await getAuthenticatedCloudUser(req, res);
    if (!user) return;

    const model = getFirstString(req.body?.model);
    if (!model) {
      return res.status(400).json({ error: 'Missing LingCodex model.' });
    }

    const secret = getLingCodexTokenSecret();
    if (!secret) {
      return res.status(500).json({ error: 'LingCodex token signing secret is not configured.' });
    }

    const issued = issueLingCodexToken({
      user,
      model,
      conversationId: getFirstString(req.body?.conversationId),
      secret,
    });

    res.json({
      success: true,
      token: issued.token,
      expiresIn: issued.expiresIn,
    });
  } catch (error) {
    console.error('Error issuing LingCodex token:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Cloud History API ─────────────────────────────────────

app.get('/api/cloud-history/settings', async (req, res) => {
  try {
    const user = await getAuthenticatedCloudUser(req, res);
    if (!user) return;

    res.json({ success: true, enabled: user.cloudHistoryEnabled });
  } catch (error) {
    console.error('Error fetching cloud history settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/cloud-history/settings', async (req, res) => {
  try {
    const user = await getAuthenticatedCloudUser(req, res);
    if (!user) return;

    const enabled = req.body?.enabled === true;
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { cloudHistoryEnabled: enabled },
      select: { cloudHistoryEnabled: true },
    });

    res.json({ success: true, enabled: updated.cloudHistoryEnabled });
  } catch (error) {
    console.error('Error updating cloud history settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/cloud-history/sync', async (req, res) => {
  try {
    const user = await getAuthenticatedCloudUser(req, res);
    if (!user) return;

    if (!user.cloudHistoryEnabled) {
      return res.status(403).json({ error: 'Cloud history is disabled' });
    }

    const rawConversations = Array.isArray(req.body?.conversations) ? req.body.conversations : [];
    const conversations = rawConversations.slice(
      0,
      MAX_CLOUD_HISTORY_CONVERSATIONS_PER_SYNC
    ) as CloudHistorySyncConversationInput[];

    let syncedConversations = 0;
    let syncedMessages = 0;

    for (const conversation of conversations) {
      const localConversationId = getOptionalString(conversation.id);
      if (!localConversationId) {
        continue;
      }

      const now = new Date();
      const cloudConversation = await prisma.cloudConversation.upsert({
        where: {
          userId_localConversationId: {
            userId: user.id,
            localConversationId,
          },
        },
        update: {
          name: getBoundedString(conversation.name, 'Untitled'),
          type: getBoundedString(conversation.type, 'unknown'),
          source: getOptionalString(conversation.source),
          extraJson: conversation.extra === undefined ? null : stringifyCloudHistoryValue(conversation.extra),
          localCreatedAt: toDateFromMillis(conversation.created_at),
          localUpdatedAt: toDateFromMillis(conversation.modified_at),
          syncedAt: now,
        },
        create: {
          userId: user.id,
          localConversationId,
          name: getBoundedString(conversation.name, 'Untitled'),
          type: getBoundedString(conversation.type, 'unknown'),
          source: getOptionalString(conversation.source),
          extraJson: conversation.extra === undefined ? null : stringifyCloudHistoryValue(conversation.extra),
          localCreatedAt: toDateFromMillis(conversation.created_at),
          localUpdatedAt: toDateFromMillis(conversation.modified_at),
          syncedAt: now,
        },
      });

      syncedConversations += 1;

      const rawMessages = Array.isArray(conversation.messages) ? conversation.messages : [];
      const messages = rawMessages.slice(
        0,
        MAX_CLOUD_HISTORY_MESSAGES_PER_CONVERSATION
      ) as CloudHistorySyncMessageInput[];

      for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (!message) {
          continue;
        }

        const type = getBoundedString(message.type, 'unknown');
        const localCreatedAt = toDateFromMillis(message.created_at);
        const localMessageId =
          getOptionalString(message.id) ||
          getOptionalString(message.msg_id) ||
          `${type}:${localCreatedAt?.getTime() ?? Date.now()}:${index}`;

        await prisma.cloudMessage.upsert({
          where: {
            cloudConversationId_localMessageId: {
              cloudConversationId: cloudConversation.id,
              localMessageId,
            },
          },
          update: {
            msgId: getOptionalString(message.msg_id),
            type,
            position: getOptionalString(message.position),
            status: getOptionalString(message.status),
            hidden: message.hidden === true,
            contentJson: stringifyCloudHistoryValue(message.content),
            localCreatedAt,
          },
          create: {
            cloudConversationId: cloudConversation.id,
            localMessageId,
            msgId: getOptionalString(message.msg_id),
            type,
            position: getOptionalString(message.position),
            status: getOptionalString(message.status),
            hidden: message.hidden === true,
            contentJson: stringifyCloudHistoryValue(message.content),
            localCreatedAt,
          },
        });
        syncedMessages += 1;
      }
    }

    res.json({ success: true, syncedConversations, syncedMessages });
  } catch (error) {
    console.error('Error syncing cloud history:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/cloud-history/conversations', async (req, res) => {
  try {
    const user = await getAuthenticatedCloudUser(req, res);
    if (!user) return;

    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const conversations = await prisma.cloudConversation.findMany({
      where: { userId: user.id },
      orderBy: [{ localUpdatedAt: 'desc' }, { syncedAt: 'desc' }],
      take: limit,
      include: { _count: { select: { messages: true } } },
    });

    res.json({
      success: true,
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        localConversationId: conversation.localConversationId,
        name: conversation.name,
        type: conversation.type,
        source: conversation.source,
        extra: conversation.extraJson ? JSON.parse(conversation.extraJson) : null,
        localCreatedAt: conversation.localCreatedAt?.toISOString() ?? null,
        localUpdatedAt: conversation.localUpdatedAt?.toISOString() ?? null,
        syncedAt: conversation.syncedAt.toISOString(),
        messageCount: conversation._count.messages,
      })),
    });
  } catch (error) {
    console.error('Error listing cloud history conversations:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/cloud-history/conversations/:id/messages', async (req, res) => {
  try {
    const user = await getAuthenticatedCloudUser(req, res);
    if (!user) return;

    const conversation = await prisma.cloudConversation.findFirst({
      where: {
        userId: user.id,
        OR: [{ id: req.params.id }, { localConversationId: req.params.id }],
      },
    });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const messages = await prisma.cloudMessage.findMany({
      where: { cloudConversationId: conversation.id },
      orderBy: [{ localCreatedAt: 'asc' }, { createdAt: 'asc' }],
    });

    res.json({
      success: true,
      messages: messages.map((message) => ({
        id: message.id,
        localMessageId: message.localMessageId,
        msgId: message.msgId,
        type: message.type,
        position: message.position,
        status: message.status,
        hidden: message.hidden,
        content: JSON.parse(message.contentJson),
        localCreatedAt: message.localCreatedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    console.error('Error listing cloud history messages:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const refreshedUsers = await Promise.all(users.map((user) => refreshUserQuotaWindow(user)));
    res.json({
      success: true,
      users: refreshedUsers.map((user) => ({
        ...user,
        quotaPlan: buildQuotaPlanPayload(user),
      })),
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/feedback/reports', async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = getBoundedNumber(req.query.limit, 100, 1, 200);
    const reports = await prisma.feedbackReport.findMany({
      where: status && status !== 'ALL' ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({ success: true, reports: reports.map((report) => toFeedbackPayload(report)) });
  } catch (error) {
    console.error('Error fetching feedback reports:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/feedback/reports/:id', async (req, res) => {
  try {
    const report = await prisma.feedbackReport.findUnique({ where: { id: req.params.id } });
    if (!report) return res.status(404).json({ error: 'Feedback report not found' });
    res.json({ success: true, report: toFeedbackPayload(report, true) });
  } catch (error) {
    console.error('Error fetching feedback report:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/feedback/reports', async (req, res) => {
  try {
    const module = getBoundedString(req.body?.module, 'other').slice(0, 80);
    const moduleLabel = getBoundedString(req.body?.moduleLabel, module).slice(0, 120);
    const description = getBoundedString(req.body?.description, '').slice(0, 20_000);
    if (!description.trim()) {
      return res.status(400).json({ error: 'Description is required' });
    }

    const attachments = normalizeFeedbackAttachments(req.body?.attachments);
    const report = await prisma.feedbackReport.create({
      data: {
        module,
        moduleLabel,
        description,
        tagsJson: safeJsonStringify(req.body?.tags, 80_000),
        extraJson: safeJsonStringify(req.body?.extra, 200_000),
        attachmentsJson: safeJsonStringify(attachments, 24_000_000),
        attachmentCount: attachments.length,
        appVersion: getOptionalString(req.body?.appVersion)?.slice(0, 80) ?? null,
        platform: getOptionalString(req.body?.platform)?.slice(0, 80) ?? null,
        userAgent: getOptionalString(req.headers['user-agent'])?.slice(0, 500) ?? null,
      },
    });

    res.json({ success: true, report: toFeedbackPayload(report) });
  } catch (error) {
    console.error('Error creating feedback report:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/feedback/reports/:id', async (req, res) => {
  try {
    const allowedStatuses = new Set(['NEW', 'READ', 'RESOLVED', 'IGNORED']);
    const status = typeof req.body?.status === 'string' ? req.body.status.toUpperCase() : '';
    if (!allowedStatuses.has(status)) {
      return res.status(400).json({ error: 'Invalid feedback status' });
    }
    const report = await prisma.feedbackReport.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json({ success: true, report: toFeedbackPayload(report) });
  } catch (error) {
    console.error('Error updating feedback report:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/dashboard/overview', async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      newUsersToday,
      userQuotaAggregate,
      totalCards,
      unusedCards,
      usedCards,
      cardAmountAggregate,
      usedCardAmountAggregate,
      payingUsers,
      totalProviders,
      enabledProviders,
      totalModels,
      activeModels,
      modelTypes,
      totalReleases,
      enabledReleases,
      forceReleases,
      recentUsers,
      recentCards,
      recentReleases,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.user.aggregate({ _sum: { quota: true, usedQuota: true } }),
      prisma.cardSecret.count(),
      prisma.cardSecret.count({ where: { status: 'UNUSED' } }),
      prisma.cardSecret.count({ where: { status: 'USED' } }),
      prisma.cardSecret.aggregate({ _sum: { amount: true } }),
      prisma.cardSecret.aggregate({ where: { status: 'USED' }, _sum: { amount: true } }),
      prisma.cardSecret.findMany({
        where: { usedById: { not: null } },
        distinct: ['usedById'],
        select: { usedById: true },
      }),
      prisma.provider.count(),
      prisma.provider.count({ where: { enabled: true } }),
      prisma.modelConfig.count(),
      prisma.modelConfig.count({ where: { isActive: true } }),
      prisma.modelConfig.groupBy({
        by: ['type'],
        _count: { type: true },
        orderBy: { _count: { type: 'desc' } },
      }),
      prisma.appRelease.count(),
      prisma.appRelease.count({ where: { enabled: true } }),
      prisma.appRelease.count({ where: { forceUpdate: true, enabled: true } }),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          username: true,
          email: true,
          quota: true,
          usedQuota: true,
          createdAt: true,
        },
      }),
      prisma.cardSecret.findMany({
        where: { status: 'USED' },
        orderBy: { usedAt: 'desc' },
        take: 6,
        include: {
          usedBy: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
        },
      }),
      prisma.appRelease.findMany({
        orderBy: { releaseDate: 'desc' },
        take: 5,
        select: {
          id: true,
          version: true,
          platform: true,
          arch: true,
          enabled: true,
          forceUpdate: true,
          releaseDate: true,
        },
      }),
    ]);

    const remainingQuota = userQuotaAggregate._sum.quota || 0;
    const usedQuota = userQuotaAggregate._sum.usedQuota || 0;
    const issuedQuota = cardAmountAggregate._sum.amount || 0;
    const activatedQuota = usedCardAmountAggregate._sum.amount || 0;
    const allocatedQuota = remainingQuota + usedQuota;

    res.json({
      success: true,
      overview: {
        generatedAt: new Date().toISOString(),
        users: {
          total: totalUsers,
          newToday: newUsersToday,
          paying: payingUsers.length,
        },
        quota: {
          remaining: remainingQuota,
          used: usedQuota,
          allocated: allocatedQuota,
          issuedByCards: issuedQuota,
          activatedByCards: activatedQuota,
          burnRate: allocatedQuota > 0 ? usedQuota / allocatedQuota : 0,
        },
        cards: {
          total: totalCards,
          unused: unusedCards,
          used: usedCards,
          activationRate: totalCards > 0 ? usedCards / totalCards : 0,
        },
        providers: {
          total: totalProviders,
          enabled: enabledProviders,
        },
        models: {
          total: totalModels,
          active: activeModels,
          byType: modelTypes.map((item) => ({
            type: item.type || 'chat',
            count: item._count.type,
          })),
        },
        releases: {
          total: totalReleases,
          enabled: enabledReleases,
          forceEnabled: forceReleases,
        },
        recent: {
          users: recentUsers,
          cardActivations: recentCards.map((card) => ({
            id: card.id,
            code: card.code,
            amount: card.amount,
            usedAt: card.usedAt,
            user: card.usedBy
              ? {
                  id: card.usedBy.id,
                  username: card.usedBy.username,
                  email: card.usedBy.email,
                }
              : null,
          })),
          releases: recentReleases,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching dashboard overview:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Provider API (provider-centric, mirrors LingAI client) ─

/**
 * GET /api/providers/list
 * Returns all providers with their nested models.
 * Also includes a virtual "未分组模型" provider for orphaned models
 * (ModelConfig records with providerId = null) so they are visible
 * and manageable in the admin panel.
 */
// ─── App Release / Auto Update API ─────────────────────────────────────

app.get('/api/releases', async (req, res) => {
  try {
    const releases = await prisma.appRelease.findMany({
      orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({ success: true, releases });
  } catch (error) {
    console.error('Error fetching releases:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/releases', async (req, res) => {
  try {
    const {
      version,
      channel,
      platform,
      arch,
      fileName,
      sha512,
      size,
      releaseDate,
      releaseNotes,
      forceUpdate,
      enabled,
    } = req.body;
    if (!version || !fileName || !sha512) {
      return res.status(400).json({ error: 'version, fileName and sha512 are required' });
    }
    const validationError = validateReleaseInput({ version, fileName, sha512, size });
    if (validationError) return res.status(400).json({ error: validationError });

    const release = await prisma.appRelease.create({
      data: {
        version,
        channel: channel || 'latest',
        platform: platform || 'win32',
        arch: arch || 'x64',
        fileName,
        sha512,
        size: size ? Number(size) : null,
        releaseDate: releaseDate ? new Date(releaseDate) : new Date(),
        releaseNotes: releaseNotes || null,
        forceUpdate: Boolean(forceUpdate),
        enabled: enabled !== false,
      },
    });
    res.json({ success: true, release });
  } catch (error: any) {
    console.error('Error creating release:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

app.put('/api/releases/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      version,
      channel,
      platform,
      arch,
      fileName,
      sha512,
      size,
      releaseDate,
      releaseNotes,
      forceUpdate,
      enabled,
    } = req.body;
    const existing = await prisma.appRelease.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Release not found' });
    const validationError = validateReleaseInput({
      version: version ?? existing.version,
      fileName: fileName ?? existing.fileName,
      sha512: sha512 ?? existing.sha512,
      size: size ?? existing.size,
    });
    if (validationError) return res.status(400).json({ error: validationError });

    const release = await prisma.appRelease.update({
      where: { id },
      data: {
        ...(version !== undefined && { version }),
        ...(channel !== undefined && { channel }),
        ...(platform !== undefined && { platform }),
        ...(arch !== undefined && { arch }),
        ...(fileName !== undefined && { fileName }),
        ...(sha512 !== undefined && { sha512 }),
        ...(size !== undefined && { size: size ? Number(size) : null }),
        ...(releaseDate !== undefined && { releaseDate: releaseDate ? new Date(releaseDate) : new Date() }),
        ...(releaseNotes !== undefined && { releaseNotes: releaseNotes || null }),
        ...(forceUpdate !== undefined && { forceUpdate: Boolean(forceUpdate) }),
        ...(enabled !== undefined && { enabled: Boolean(enabled) }),
      },
    });
    res.json({ success: true, release });
  } catch (error: any) {
    console.error('Error updating release:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

app.delete('/api/releases/:id', async (req, res) => {
  try {
    await prisma.appRelease.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting release:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

app.get('/api/updates/latest', async (req, res) => {
  try {
    const platform = String(req.query.platform || 'win32');
    const arch = String(req.query.arch || 'x64');
    const channel = String(req.query.channel || 'latest');
    const release = await findLatestRelease(platform, arch, channel);
    res.json({ success: true, latest: release ? toReleasePayload(release, req) : null });
  } catch (error) {
    console.error('Error fetching latest update:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/updates/feed/:fileName', async (req, res) => {
  try {
    const { channel, platform, arch } = parseFeedFile(req.params.fileName);
    const release = await findLatestRelease(platform, arch, channel);
    if (!release) return res.status(404).send('No release available');
    res.type('text/yaml').send(renderLatestYml(release));
  } catch (error) {
    console.error('Error rendering update feed:', error);
    res.status(500).send('Server error');
  }
});

app.get('/api/updates/feed/:version/:fileName', async (req, res) => {
  try {
    const releases = await prisma.appRelease.findMany({
      where: { enabled: true, version: req.params.version },
    });
    const directRelease = releases.find((release) => {
      const directUrl = parseDirectDownloadUrl(release.fileName);
      return directUrl && getDirectDownloadFileName(directUrl, release.version) === req.params.fileName;
    });
    if (directRelease) {
      const directUrl = parseDirectDownloadUrl(directRelease.fileName);
      if (directUrl) return res.redirect(302, directUrl.toString());
    }

    const filePath = path.resolve(RELEASES_DIR, req.params.version, req.params.fileName);
    const releasesRoot = path.resolve(RELEASES_DIR);
    if (!filePath.startsWith(releasesRoot)) return res.status(400).send('Invalid file path');
    res.download(filePath, req.params.fileName);
  } catch (error) {
    console.error('Error downloading update file:', error);
    res.status(500).send('Server error');
  }
});

app.get('/api/providers/list', async (req, res) => {
  try {
    const [providers, orphanedModels] = await Promise.all([
      prisma.provider.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          models: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
        },
      }),
      prisma.modelConfig.findMany({
        where: { providerId: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    // Append orphaned models as a virtual provider so the admin UI can
    // display and manage them (edit multiplier, toggle active, delete, etc.).
    if (orphanedModels.length > 0) {
      providers.push({
        id: ORPHANED_PROVIDER_ID,
        name: '未分组模型',
        platform: 'custom',
        baseUrl: null,
        apiKey: null,
        enabled: true,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        models: orphanedModels,
      });
    }

    res.json({ success: true, providers });
  } catch (error) {
    console.error('Error fetching providers:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/providers/add
 * Create a new provider. Optionally include an array of model IDs to create
 * under this provider in the same transaction.
 *
 * Body: { name, platform, baseUrl, apiKey, enabled, models: [{ modelId, name, multiplier, type, isActive }] }
 */
app.post('/api/providers/add', async (req, res) => {
  try {
    const { name, platform, baseUrl, apiKey, enabled, models } = req.body;

    if (!name) return res.status(400).json({ error: 'Provider name is required' });
    const normalizedModels = dedupeModelInputs(
      Array.isArray(models) ? models.map(normalizeModelInput).filter(isNormalizedModelInput) : []
    );

    const newProvider = await prisma.provider.create({
      data: {
        name,
        platform: platform || 'custom',
        baseUrl: baseUrl || null,
        apiKey: apiKey || null,
        enabled: enabled !== false,
        models:
          normalizedModels.length > 0
            ? {
                create: normalizedModels,
              }
            : undefined,
      },
      include: { models: true },
    });
    res.json({ success: true, provider: newProvider });
  } catch (error: any) {
    console.error('Error adding provider:', error);
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: `Duplicate modelId in provider: ${error.meta?.target}` });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/providers/:id
 * Update provider fields (name, platform, baseUrl, apiKey, enabled).
 */
app.put('/api/providers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, platform, baseUrl, apiKey, enabled } = req.body;

    const updated = await prisma.provider.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(platform !== undefined && { platform }),
        ...(baseUrl !== undefined && { baseUrl }),
        ...(apiKey !== undefined && { apiKey }),
        ...(enabled !== undefined && { enabled }),
      },
      include: { models: true },
    });
    res.json({ success: true, provider: updated });
  } catch (error) {
    console.error('Error updating provider:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/providers/:id
 * Delete a provider. Cascading delete removes all its models.
 */
app.delete('/api/providers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.provider.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting provider:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/providers/:id/models/add
 * Add one or more models to an existing provider.
 *
 * Body: { models: [{ modelId, name, multiplier, type, unitPrice, isActive }] }
 */
app.post('/api/providers/:id/models/add', async (req, res) => {
  try {
    const { id } = req.params;
    const { models } = req.body;
    if (!models || !Array.isArray(models) || models.length === 0) {
      return res.status(400).json({ error: 'models array is required' });
    }

    // Verify provider exists
    const provider = await prisma.provider.findUnique({ where: { id } });
    if (!provider) return res.status(404).json({ error: 'Provider not found' });

    // Create models — skip duplicates that already exist by modelId
    const results = [];
    for (const m of models) {
      const normalizedModel = normalizeModelInput(m);
      if (!normalizedModel) continue;
      const existingModel = await prisma.modelConfig.findFirst({
        where: { providerId: id, modelId: normalizedModel.modelId },
      });
      if (existingModel) continue;
      try {
        const created = await prisma.modelConfig.create({
          data: {
            ...normalizedModel,
            providerId: id,
          },
        });
        results.push(created);
      } catch (error: any) {
        if (error?.code === 'P2002') continue;
        throw error;
      }
    }

    const updatedProvider = await prisma.provider.findUnique({
      where: { id },
      include: { models: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
    });
    res.json({ success: true, provider: updatedProvider, addedCount: results.length });
  } catch (error) {
    console.error('Error adding models to provider:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/providers/:id/models/:modelId
 * Update a single model's fields (name, billing rules, type, isActive).
 */
app.put('/api/providers/:id/models/:modelId', async (req, res) => {
  try {
    const { id, modelId } = req.params;
    const {
      name,
      multiplier,
      billingMode,
      inputTokenPrice,
      outputTokenPrice,
      fixedCost,
      minCost,
      reserveCost,
      sortOrder,
      type,
      unitPrice,
      isActive,
    } = req.body;

    const existingModel = await prisma.modelConfig.findFirst({
      where: scopedModelWhere(id, modelId),
    });
    if (!existingModel) return res.status(404).json({ error: 'Model not found in provider' });

    const updated = await prisma.modelConfig.update({
      where: { id: existingModel.id },
      data: {
        ...(name !== undefined && { name }),
        ...(multiplier !== undefined && { multiplier: parseFloat(multiplier) }),
        ...(billingMode !== undefined && { billingMode }),
        ...(inputTokenPrice !== undefined && { inputTokenPrice: parseFloat(inputTokenPrice) }),
        ...(outputTokenPrice !== undefined && { outputTokenPrice: parseFloat(outputTokenPrice) }),
        ...(fixedCost !== undefined && { fixedCost: Math.max(0, Math.ceil(Number(fixedCost) || 0)) }),
        ...(minCost !== undefined && { minCost: Math.max(1, Math.ceil(Number(minCost) || 1)) }),
        ...(reserveCost !== undefined && { reserveCost: Math.max(0, Math.ceil(Number(reserveCost) || 0)) }),
        ...(sortOrder !== undefined && { sortOrder: Math.max(0, Math.ceil(Number(sortOrder) || 0)) }),
        ...(type !== undefined && { type }),
        ...(unitPrice !== undefined && { unitPrice: parseFloat(unitPrice) }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    res.json({ success: true, model: updated });
  } catch (error) {
    console.error('Error updating model:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/providers/:id/models/:modelId
 * Remove a single model from a provider.
 */
app.delete('/api/providers/:id/models/:modelId', async (req, res) => {
  try {
    const { id, modelId } = req.params;
    const existingModel = await prisma.modelConfig.findFirst({
      where: scopedModelWhere(id, modelId),
    });
    if (!existingModel) return res.status(404).json({ error: 'Model not found in provider' });
    await prisma.modelConfig.delete({ where: { id: existingModel.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting model:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/providers/fetch-remote
 * Fetch available models from a remote API endpoint.
 * Does NOT auto-insert — returns the list for the frontend to present
 * as a multi-select, mirroring the LingAI client behaviour.
 *
 * Body: { baseUrl, apiKey }
 */
app.post('/api/providers/fetch-remote', async (req, res) => {
  try {
    let { baseUrl, apiKey } = req.body;
    if (!baseUrl) return res.status(400).json({ error: 'Missing baseUrl' });
    baseUrl = baseUrl.replace(/\/$/, '');

    const fetchUrl = `${baseUrl}/models`;
    const fetchRes = await fetch(fetchUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey || ''}`,
      },
    });

    if (!fetchRes.ok) {
      return res.status(fetchRes.status).json({ error: `Failed to fetch from remote: ${fetchRes.statusText}` });
    }

    const data: any = await fetchRes.json();
    if (data && data.data && Array.isArray(data.data)) {
      const models = data.data.map((m: any) => ({ id: m.id, name: m.id }));
      res.json({ success: true, models });
    } else {
      res.status(400).json({ error: 'Invalid response format from remote API' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// ─── Legacy Model API (kept for backward compat with existing clients) ────

app.get('/api/models/list', async (req, res) => {
  try {
    // Return all models — resolve credentials from the linked Provider
    // when available, falling back to the model's own apiBaseUrl/apiKey.
    const models = await prisma.modelConfig.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: { provider: true },
    });

    const modelPayloads = models.map((m) => ({
      id: encodeModelRoutingId(m.providerId, m.modelId),
      routingModelId: encodeModelRoutingId(m.providerId, m.modelId),
      modelId: m.modelId,
      name: m.name,
      providerId: m.providerId,
      provider: m.provider?.name || 'custom',
      multiplier: m.multiplier,
      billingMode: m.billingMode,
      inputTokenPrice: m.inputTokenPrice,
      outputTokenPrice: m.outputTokenPrice,
      fixedCost: m.fixedCost,
      minCost: m.minCost,
      reserveCost: m.reserveCost,
      sortOrder: m.sortOrder,
      isActive: m.isActive,
      type: m.type || 'chat',
    }));
    const providerPayloads = Array.from(
      modelPayloads
        .reduce((map, model) => {
          const providerId = providerScopeToId(model.providerId);
          const existing = map.get(providerId);
          if (existing) {
            existing.models.push(model);
          } else {
            map.set(providerId, {
              id: providerId,
              name: model.provider,
              models: [model],
            });
          }
          return map;
        }, new Map<string, { id: string; name: string; models: typeof modelPayloads }>())
        .values()
    );

    res.json({
      success: true,
      models: modelPayloads,
      providers: providerPayloads,
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Card Secret API ───────────────────────────────────────

app.get('/api/cards', async (req, res) => {
  try {
    const cards = await prisma.cardSecret.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, cards });
  } catch (error) {
    console.error('Error fetching cards:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/cards/generate', async (req, res) => {
  try {
    const { count, amount } = req.body;
    const planType = req.body.planType === QUOTA_PLAN_RESET_WINDOW ? QUOTA_PLAN_RESET_WINDOW : QUOTA_PLAN_BALANCE;
    const windowHours =
      planType === QUOTA_PLAN_RESET_WINDOW ? getPositiveInt(req.body.windowHours, DEFAULT_RESET_WINDOW_HOURS) : null;
    const validDays =
      planType === QUOTA_PLAN_RESET_WINDOW ? getPositiveInt(req.body.validDays, DEFAULT_RESET_WINDOW_VALID_DAYS) : null;
    const cards = [];
    for (let i = 0; i < count; i++) {
      const code = `AION-${Math.random().toString(36).substring(2, 10).toUpperCase()}-${Date.now().toString().slice(-4)}`;
      cards.push({ code, amount, planType, windowHours, validDays });
    }

    await prisma.cardSecret.createMany({ data: cards });
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/cards/activate', async (req, res) => {
  try {
    const { code, userId } = req.body;

    const card = await prisma.cardSecret.findUnique({ where: { code } });
    if (!card) return res.status(404).json({ error: 'Card not found' });
    if (card.status === 'USED') return res.status(400).json({ error: 'Card already used' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const now = new Date();
    const isResetWindowCard = card.planType === QUOTA_PLAN_RESET_WINDOW;
    const windowHours = getPositiveInt(card.windowHours, DEFAULT_RESET_WINDOW_HOURS);
    const validDays = getPositiveInt(card.validDays, DEFAULT_RESET_WINDOW_VALID_DAYS);
    const nextUserData = isResetWindowCard
      ? {
          quota: card.amount,
          quotaPlanType: QUOTA_PLAN_RESET_WINDOW,
          quotaWindowHours: windowHours,
          quotaWindowLimit: card.amount,
          quotaWindowUsed: 0,
          quotaWindowStartedAt: now,
          quotaWindowEndsAt: addHours(now, windowHours),
          quotaExpiresAt: addDays(now, validDays),
        }
      : {
          quota: user.quota + card.amount,
        };

    await prisma.$transaction([
      prisma.cardSecret.update({
        where: { id: card.id },
        data: { status: 'USED', usedById: user.id, usedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: nextUserData,
      }),
    ]);

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    res.json({
      success: true,
      newQuota: updatedUser?.quota ?? 0,
      quotaPlan: updatedUser ? buildQuotaPlanPayload(updatedUser) : null,
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Proxy Gateway API ────────────────────────────────────

/**
 * Resolve proxy context: authenticate user, find model config, resolve upstream credentials.
 * Shared by all proxy endpoints.
 *
 * @param req - Express request with Authorization header and model in body
 * @param expectedType - Expected model type (e.g. 'chat', 'image', 'audio').
 *                         Pass undefined to skip type validation.
 * @param pathSuffix - The API path suffix to append to the upstream base URL
 *                     (e.g. '/chat/completions', '/images/generations', '/audio/speech').
 */
async function resolveProxyContext(
  req: express.Request,
  expectedType: string | undefined,
  pathSuffix: string
): Promise<
  | {
      ok: true;
      user: { id: string; deviceId: string | null; quota: number };
      modelConfig: any;
      upstreamKey: string;
      upstreamUrl: string;
      proxyBody: unknown;
    }
  | {
      ok: false;
      status: number;
      error: { message: string };
    }
> {
  const auth = await resolveProxyAuthenticatedUser(req.headers.authorization);
  if (!auth.ok) return auth;
  const { user } = auth;

  if (isResetWindowQuotaPlan(user) && user.quotaExpiresAt && user.quotaExpiresAt <= new Date()) {
    return { ok: false, status: 402, error: { message: 'Quota package expired. Please recharge.' } };
  }

  if (user.quota <= 0) {
    return { ok: false, status: 402, error: { message: 'Insufficient quota. Please recharge.' } };
  }

  const modelId =
    getFirstString((req.body as any)?.model) ||
    getFirstString(req.headers['x-aion-model']) ||
    getFirstString(req.query.model);
  if (!modelId) {
    return { ok: false, status: 400, error: { message: 'Missing model in request body or headers.' } };
  }
  const routedModel = decodeModelRoutingId(modelId);
  const modelConfig = routedModel
    ? await prisma.modelConfig.findFirst({
        where: { providerId: routedModel.providerId, modelId: routedModel.modelId },
        include: { provider: true },
      })
    : await (async () => {
        const candidates = await prisma.modelConfig.findMany({
          where: { modelId },
          include: { provider: true },
          take: 2,
        });
        if (candidates.length > 1) {
          return {
            ambiguous: true,
          };
        }
        return candidates[0] || null;
      })();
  if (modelConfig && 'ambiguous' in modelConfig) {
    return {
      ok: false,
      status: 409,
      error: {
        message: `Model ${modelId} exists under multiple providers. Please use provider-scoped routingModelId.`,
      },
    };
  }
  if (!modelConfig || !modelConfig.isActive) {
    return { ok: false, status: 404, error: { message: `Model ${modelId} is not available or inactive.` } };
  }

  if (auth.lingcodex && !isLingCodexTextModelConfig(modelConfig)) {
    return { ok: false, status: 400, error: { message: 'LingCodex requires an active text model.' } };
  }

  if (modelConfig.provider && !modelConfig.provider.enabled) {
    return { ok: false, status: 403, error: { message: `Provider for model ${modelId} is disabled.` } };
  }

  if (expectedType && modelConfig.type !== expectedType) {
    return {
      ok: false,
      status: 400,
      error: { message: `Model ${modelId} is of type '${modelConfig.type}', expected '${expectedType}'.` },
    };
  }

  const upstreamKey = modelConfig.provider?.apiKey || modelConfig.apiKey || process.env.UPSTREAM_OPENAI_KEY || '';
  if (!upstreamKey) {
    return { ok: false, status: 500, error: { message: `Model ${modelId} is missing API Key configuration.` } };
  }

  const providerBaseUrl = (modelConfig.provider?.baseUrl || modelConfig.apiBaseUrl || '').replace(/\/$/, '');
  let upstreamUrl = process.env.UPSTREAM_OPENAI_URL || `https://api.openai.com/v1${pathSuffix}`;
  if (providerBaseUrl) {
    // Normalize: ensure OpenAI-compatible endpoints have /v1 prefix.
    // If the admin configured baseUrl as "https://api.example.com" (without /v1),
    // the upstream call would hit a non-existent path and return 404.
    const normalizedBaseUrl = /\/v\d+\b/.test(providerBaseUrl) ? providerBaseUrl : `${providerBaseUrl}/v1`;
    upstreamUrl = `${normalizedBaseUrl}${pathSuffix}`;
  }

  return {
    ok: true,
    user,
    modelConfig,
    upstreamKey,
    upstreamUrl,
    proxyBody: rewriteJsonModelBody(req.body, modelConfig.modelId),
  };
}

type BillingStatus = 'SUCCESS' | 'UPSTREAM_ERROR' | 'SETTLEMENT_FAILED';

type BillingTokenUsage = {
  promptTokens: number;
  completionTokens: number;
};

type BillingContext = {
  userId: string;
  deviceId: string | null;
  modelConfig: any;
  endpoint: string;
  reservedPoints: number;
  billingMode: string;
};

const DEFAULT_MAX_COMPLETION_TOKENS = 8192;
const TEXT_CHARS_PER_TOKEN = 4;
const INLINE_IMAGE_PROMPT_TOKENS = 1000;
const DATA_IMAGE_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

function getBillingMode(modelConfig: any): string {
  if (modelConfig.billingMode) return modelConfig.billingMode;
  return Number(modelConfig.unitPrice || 0) > 0 ? 'per_call' : 'per_token';
}

function getFixedCost(modelConfig: any): number {
  const configuredFixedCost = Number(modelConfig.fixedCost || 0);
  const legacyUnitPrice = Number(modelConfig.unitPrice || 0);
  const baseCost = configuredFixedCost > 0 ? configuredFixedCost : legacyUnitPrice;
  return Math.max(1, Math.ceil(baseCost * Number(modelConfig.multiplier || 1)));
}

function getMinCost(modelConfig: any): number {
  return Math.max(1, Math.ceil(Number(modelConfig.minCost || 1) * Number(modelConfig.multiplier || 1)));
}

function isInlineImageDataUrl(value: string): boolean {
  return DATA_IMAGE_URL_RE.test(value);
}

function estimateStringPromptTokens(value: string): number {
  if (isInlineImageDataUrl(value)) return INLINE_IMAGE_PROMPT_TOKENS;
  return Math.ceil(value.length / TEXT_CHARS_PER_TOKEN);
}

function readImageUrl(value: Record<string, unknown>): string | null {
  const imageUrl = value.image_url ?? value.imageUrl ?? value.url;
  if (typeof imageUrl === 'string') return imageUrl;
  if (isRecord(imageUrl) && typeof imageUrl.url === 'string') return imageUrl.url;
  return null;
}

function estimateImagePromptTokens(imageUrl: string | null): number {
  if (!imageUrl || isInlineImageDataUrl(imageUrl)) return INLINE_IMAGE_PROMPT_TOKENS;
  return INLINE_IMAGE_PROMPT_TOKENS + estimateStringPromptTokens(imageUrl);
}

function estimatePromptValueTokens(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return estimateStringPromptTokens(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return estimateStringPromptTokens(String(value));
  }
  if (Buffer.isBuffer(value)) return Math.ceil(value.byteLength / TEXT_CHARS_PER_TOKEN);
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + estimatePromptValueTokens(item), 0);
  }
  if (!isRecord(value)) return estimateStringPromptTokens(String(value));

  const contentType = typeof value.type === 'string' ? value.type : '';
  if (contentType === 'image_url' || contentType === 'input_image') {
    return estimateImagePromptTokens(readImageUrl(value));
  }
  if (contentType === 'image') {
    const source = value.source;
    if (isRecord(source) && (typeof source.data === 'string' || typeof source.url === 'string')) {
      return INLINE_IMAGE_PROMPT_TOKENS;
    }
    return estimateImagePromptTokens(readImageUrl(value));
  }
  if (contentType === 'text' || contentType === 'input_text') {
    return estimatePromptValueTokens(value.text);
  }

  return Object.entries(value).reduce((total, [key, child]) => {
    return total + estimateStringPromptTokens(key) + estimatePromptValueTokens(child);
  }, 0);
}

function estimatePromptTokens(body: any): number {
  const payload = body?.messages ?? body?.input ?? body?.prompt ?? body ?? '';
  return Math.max(1, Math.ceil(estimatePromptValueTokens(payload)));
}

function estimateMaxCompletionTokens(body: any): number {
  const configured = Number(body?.max_tokens || body?.max_completion_tokens || body?.max_output_tokens || 0);
  if (Number.isFinite(configured) && configured > 0) return Math.ceil(configured);
  return DEFAULT_MAX_COMPLETION_TOKENS;
}

type StreamTextReplayState = {
  offset: number;
  suppressed: string;
};

type StreamTextNormalizerState = {
  textBuffer: string;
  replay?: StreamTextReplayState;
};

type NormalizedSseLine = {
  line: string;
  completionText?: string;
  usage?: BillingTokenUsage;
};

const DUPLICATE_FULL_TEXT_MIN_LENGTH = 8;
const REPLAY_PREFIX_MIN_BUFFER_LENGTH = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeStreamTextDelta(state: StreamTextNormalizerState, content: string): string | undefined {
  if (!content) return undefined;

  if (!state.textBuffer) {
    state.textBuffer = content;
    return content;
  }

  if (content === state.textBuffer && content.length >= DUPLICATE_FULL_TEXT_MIN_LENGTH) {
    state.replay = undefined;
    return undefined;
  }

  if (content.length > state.textBuffer.length && content.startsWith(state.textBuffer)) {
    const suffix = content.slice(state.textBuffer.length);
    state.textBuffer = content;
    state.replay = undefined;
    return suffix || undefined;
  }

  if (state.replay) {
    const replay = state.replay;
    state.replay = undefined;
    const remainingReplay = state.textBuffer.slice(replay.offset);

    if (remainingReplay.startsWith(content)) {
      const nextOffset = replay.offset + content.length;
      if (nextOffset < state.textBuffer.length) {
        state.replay = {
          offset: nextOffset,
          suppressed: replay.suppressed + content,
        };
      }
      return undefined;
    }

    if (content.startsWith(remainingReplay)) {
      const suffix = content.slice(remainingReplay.length);
      if (!suffix) return undefined;
      state.textBuffer += suffix;
      return suffix;
    }

    const restored = replay.suppressed + content;
    state.textBuffer += restored;
    return restored;
  }

  if (state.textBuffer.length >= REPLAY_PREFIX_MIN_BUFFER_LENGTH && state.textBuffer.startsWith(content)) {
    state.replay = {
      offset: content.length,
      suppressed: content,
    };
    return undefined;
  }

  state.textBuffer += content;
  return content;
}

function readChatCompletionUsage(
  parsed: Record<string, unknown>,
  fallbackPromptTokens: number
): BillingTokenUsage | undefined {
  const usage = parsed.usage;
  if (!isRecord(usage)) return undefined;

  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? fallbackPromptTokens);
  const completionTokens = Number(
    usage.completion_tokens ?? usage.output_tokens ?? Math.max(0, Number(usage.total_tokens ?? 0) - promptTokens)
  );

  if (!Number.isFinite(promptTokens) && !Number.isFinite(completionTokens)) return undefined;

  return {
    promptTokens: Number.isFinite(promptTokens) ? Math.max(0, Math.ceil(promptTokens)) : fallbackPromptTokens,
    completionTokens: Number.isFinite(completionTokens) ? Math.max(0, Math.ceil(completionTokens)) : 0,
  };
}

function readResponsesUsage(
  parsed: Record<string, unknown>,
  fallbackPromptTokens: number
): BillingTokenUsage | undefined {
  const response = isRecord(parsed.response) ? parsed.response : parsed;
  const usage = response.usage;
  if (!isRecord(usage)) return undefined;

  const promptTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? fallbackPromptTokens);
  const completionTokens = Number(
    usage.output_tokens ?? usage.completion_tokens ?? Math.max(0, Number(usage.total_tokens ?? 0) - promptTokens)
  );

  if (!Number.isFinite(promptTokens) && !Number.isFinite(completionTokens)) return undefined;

  return {
    promptTokens: Number.isFinite(promptTokens) ? Math.max(0, Math.ceil(promptTokens)) : fallbackPromptTokens,
    completionTokens: Number.isFinite(completionTokens) ? Math.max(0, Math.ceil(completionTokens)) : 0,
  };
}

function readResponsesTextDelta(parsed: Record<string, unknown>): string | null {
  const delta = parsed.delta;
  if (typeof delta === 'string') return delta;
  if (isRecord(delta) && typeof delta.text === 'string') return delta.text;
  if (typeof parsed.text === 'string' && String(parsed.type || '').endsWith('.delta')) return parsed.text;
  return null;
}

function normalizeChatCompletionSseLine(
  line: string,
  state: StreamTextNormalizerState,
  fallbackPromptTokens: number
): NormalizedSseLine {
  if (!line.startsWith('data:')) return { line };

  const data = line.slice(5).trim();
  if (!data || data === '[DONE]') return { line };

  try {
    const parsed = JSON.parse(data) as unknown;
    if (!isRecord(parsed)) return { line };

    const result: NormalizedSseLine = {
      line,
      usage: readChatCompletionUsage(parsed, fallbackPromptTokens),
    };
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const firstChoice = choices[0];
    if (!isRecord(firstChoice)) return result;

    const delta = firstChoice.delta;
    if (!isRecord(delta) || typeof delta.content !== 'string' || !delta.content) return result;

    const normalizedContent = normalizeStreamTextDelta(state, delta.content);
    result.completionText = normalizedContent;
    if (normalizedContent !== delta.content) {
      delta.content = normalizedContent ?? '';
      result.line = `data: ${JSON.stringify(parsed)}`;
    }
    return result;
  } catch {
    return { line };
  }
}

function calculateTokenCost(modelConfig: any, usage: BillingTokenUsage): number {
  const multiplier = Number(modelConfig.multiplier || 1);
  const inputTokenPrice = Number(modelConfig.inputTokenPrice || 1);
  const outputTokenPrice = Number(modelConfig.outputTokenPrice || 1);
  const inputCost = (Math.max(0, usage.promptTokens) / 1000) * inputTokenPrice;
  const outputCost = (Math.max(0, usage.completionTokens) / 1000) * outputTokenPrice;
  return Math.max(getMinCost(modelConfig), Math.ceil((inputCost + outputCost) * multiplier));
}

function calculateActualCost(modelConfig: any, endpoint: string, usage: BillingTokenUsage, requestBody?: any): number {
  const billingMode = getBillingMode(modelConfig);
  if (billingMode === 'per_call' || billingMode === 'fixed') return getFixedCost(modelConfig);
  if (billingMode === 'per_character') {
    const inputLength = String(requestBody?.input || requestBody?.text || '').length;
    return Math.max(getMinCost(modelConfig), Math.ceil((inputLength / 1000) * Number(modelConfig.multiplier || 1)));
  }
  if (endpoint.includes('/images/') || endpoint.includes('/audio/')) {
    const fixedCost = Number(modelConfig.fixedCost || modelConfig.unitPrice || 0);
    if (fixedCost > 0) return getFixedCost(modelConfig);
  }
  return calculateTokenCost(modelConfig, usage);
}

function calculateReserveCost(modelConfig: any, endpoint: string, requestBody?: any): number {
  const configuredReserve = Number(modelConfig.reserveCost || 0);
  const billingMode = getBillingMode(modelConfig);
  if (configuredReserve > 0) {
    return Math.max(getMinCost(modelConfig), Math.ceil(configuredReserve * Number(modelConfig.multiplier || 1)));
  }
  if (billingMode === 'per_call' || billingMode === 'fixed') return getFixedCost(modelConfig);
  if (endpoint.includes('/images/') || endpoint.includes('/audio/')) {
    const fixedCost = Number(modelConfig.fixedCost || modelConfig.unitPrice || 0);
    if (fixedCost > 0) return getFixedCost(modelConfig);
  }
  return calculateTokenCost(modelConfig, {
    promptTokens: estimatePromptTokens(requestBody),
    completionTokens: estimateMaxCompletionTokens(requestBody),
  });
}

class BillingError extends Error {
  constructor(
    message: string,
    public readonly status = 402
  ) {
    super(message);
  }
}

async function decrementQuotaAtomically(userId: string, points: number) {
  if (points <= 0) return;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new BillingError('User not found or invalid token.', 401);
  }
  if (isResetWindowQuotaPlan(user) && user.quotaExpiresAt && user.quotaExpiresAt <= new Date()) {
    throw new BillingError('Quota package expired. Please recharge.');
  }
  const result = await prisma.user.updateMany({
    where: {
      id: userId,
      quota: { gte: points },
    },
    data: {
      quota: { decrement: points },
      usedQuota: { increment: points },
      ...(isResetWindowQuotaPlan(user) && { quotaWindowUsed: { increment: points } }),
    },
  });
  if (result.count !== 1) {
    throw new BillingError('Insufficient quota. Please recharge.');
  }
}

async function refundQuota(userId: string, points: number) {
  if (points <= 0) return;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  await prisma.user.update({
    where: { id: userId },
    data: {
      quota: { increment: points },
      usedQuota: { decrement: points },
      ...(user && isResetWindowQuotaPlan(user) && { quotaWindowUsed: { decrement: points } }),
    },
  });
}

async function beginBilling(ctx: {
  userId: string;
  deviceId: string | null;
  modelConfig: any;
  endpoint: string;
  requestBody?: any;
}): Promise<BillingContext> {
  const billingMode = getBillingMode(ctx.modelConfig);
  const reservedPoints = calculateReserveCost(ctx.modelConfig, ctx.endpoint, ctx.requestBody);
  await decrementQuotaAtomically(ctx.userId, reservedPoints);
  return {
    userId: ctx.userId,
    deviceId: ctx.deviceId,
    modelConfig: ctx.modelConfig,
    endpoint: ctx.endpoint,
    reservedPoints,
    billingMode,
  };
}

async function recordUsage(
  ctx: BillingContext,
  params: {
    status: BillingStatus;
    usage?: BillingTokenUsage;
    chargedPoints: number;
    refundedPoints?: number;
    detail?: string;
  }
) {
  const usage = params.usage || { promptTokens: 0, completionTokens: 0 };
  await prisma.usageRecord.create({
    data: {
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      modelId: ctx.modelConfig.modelId,
      providerId: ctx.modelConfig.providerId || null,
      endpoint: ctx.endpoint,
      billingMode: ctx.billingMode,
      status: params.status,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.promptTokens + usage.completionTokens,
      reservedPoints: ctx.reservedPoints,
      chargedPoints: params.chargedPoints,
      refundedPoints: params.refundedPoints || 0,
      detail: params.detail || null,
    },
  });
}

async function refundFailedBilling(ctx: BillingContext, detail: string) {
  await refundQuota(ctx.userId, ctx.reservedPoints);
  await recordUsage(ctx, {
    status: 'UPSTREAM_ERROR',
    chargedPoints: 0,
    refundedPoints: ctx.reservedPoints,
    detail,
  });
}

async function settleBilling(ctx: BillingContext, usage: BillingTokenUsage, requestBody?: any, detail?: string) {
  const actualCost = calculateActualCost(ctx.modelConfig, ctx.endpoint, usage, requestBody);
  const extraCharge = Math.max(0, actualCost - ctx.reservedPoints);
  const refund = Math.max(0, ctx.reservedPoints - actualCost);

  try {
    await decrementQuotaAtomically(ctx.userId, extraCharge);
    await refundQuota(ctx.userId, refund);
    await recordUsage(ctx, {
      status: 'SUCCESS',
      usage,
      chargedPoints: actualCost,
      refundedPoints: refund,
      detail,
    });
  } catch (error) {
    await recordUsage(ctx, {
      status: 'SETTLEMENT_FAILED',
      usage,
      chargedPoints: ctx.reservedPoints,
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ─── Chat Completions Proxy (supports chat, embedding, image-via-chat) ───

app.get('/api/proxy/openai/v1/models', async (req, res) => {
  try {
    const auth = await resolveProxyAuthenticatedUser(req.headers.authorization);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    if (auth.lingcodex) {
      const models = await prisma.modelConfig.findMany({
        where: {
          isActive: true,
          OR: [{ providerId: null }, { provider: { enabled: true } }],
        },
        include: { provider: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      const textModels = models.filter(isLingCodexTextModelConfig);
      return res.json({
        object: 'list',
        data: textModels.map(toOpenAiModelListItem),
      });
    }

    const models = await prisma.modelConfig.findMany({
      where: {
        isActive: true,
        OR: [{ providerId: null }, { provider: { enabled: true } }],
      },
      include: { provider: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    res.json({
      object: 'list',
      data: models.map(toOpenAiModelListItem),
    });
  } catch (error) {
    console.error('Models Proxy Error:', error);
    res.status(500).json({ error: { message: 'Server error' } });
  }
});

app.post('/api/proxy/openai/v1/responses', async (req, res) => {
  let billing: BillingContext | null = null;
  try {
    const ctx = await resolveProxyContext(req, undefined, '/responses');
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const { user, modelConfig, upstreamKey, upstreamUrl, proxyBody } = ctx;
    billing = await beginBilling({
      userId: user.id,
      deviceId: user.deviceId,
      modelConfig,
      endpoint: '/responses',
      requestBody: proxyBody,
    });

    const fetchRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${upstreamKey}`,
      },
      body: JSON.stringify(proxyBody),
    });

    const isStream = (proxyBody as { stream?: unknown }).stream === true;

    if (isStream) {
      if (!fetchRes.ok) {
        const text = await fetchRes.text().catch(() => '');
        await refundFailedBilling(billing, `upstream status=${fetchRes.status}`);
        return res.status(fetchRes.status).json({ error: { message: text || 'Upstream request failed' } });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let promptTokens = estimatePromptTokens(proxyBody);
      let completionTokens = 0;
      let hasUsageTokens = false;
      const decoder = new TextDecoder();
      let pendingLine = '';

      const writeLine = (line: string) => {
        res.write(`${line}\n`);
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          if (!isRecord(parsed)) return;
          const usage = readResponsesUsage(parsed, promptTokens);
          if (usage) {
            promptTokens = usage.promptTokens || promptTokens;
            completionTokens = usage.completionTokens || completionTokens;
            hasUsageTokens = true;
            return;
          }
          const textDelta = readResponsesTextDelta(parsed);
          if (!hasUsageTokens && textDelta) completionTokens += Math.ceil(textDelta.length / 4);
        } catch {}
      };

      if (fetchRes.body) {
        // @ts-ignore
        for await (const chunk of fetchRes.body) {
          const text = decoder.decode(chunk, { stream: true });
          const lines = (pendingLine + text).split(/\r?\n/);
          pendingLine = lines.pop() ?? '';
          for (const line of lines) writeLine(line);
        }
      }
      const finalText = decoder.decode();
      if (finalText) {
        const lines = (pendingLine + finalText).split(/\r?\n/);
        pendingLine = lines.pop() ?? '';
        for (const line of lines) writeLine(line);
      }
      if (pendingLine) writeLine(pendingLine);
      res.end();

      await settleBilling(billing, { promptTokens, completionTokens }, proxyBody, 'stream, endpoint=/responses');
      return;
    }

    const data: any = await fetchRes.json().catch(() => null);
    if (!fetchRes.ok) {
      await refundFailedBilling(billing, `upstream status=${fetchRes.status}`);
      return res.status(fetchRes.status).json(data || { error: { message: 'Upstream request failed' } });
    }
    if (data === null) {
      const text = await fetchRes.text().catch(() => '');
      await refundFailedBilling(billing, `non-json upstream status=${fetchRes.status}`);
      return res.status(fetchRes.status || 502).json({
        error: {
          message: `Upstream returned non-JSON response (status ${fetchRes.status}): ${text.substring(0, 200)}`,
        },
      });
    }

    const usage = isRecord(data) ? readResponsesUsage(data, estimatePromptTokens(proxyBody)) : undefined;
    await settleBilling(
      billing,
      usage || { promptTokens: estimatePromptTokens(proxyBody), completionTokens: 0 },
      proxyBody,
      'json, endpoint=/responses'
    );
    res.status(fetchRes.status).json(data);
  } catch (error: any) {
    console.error('Responses Proxy Error:', error);
    if (billing && !(error instanceof BillingError)) {
      await refundFailedBilling(billing, error.message || 'responses proxy error').catch((refundError) => {
        console.error('Billing refund failed:', refundError);
      });
    }
    if (!res.headersSent) {
      res.status(error instanceof BillingError ? error.status : 500).json({
        error: { message: error.message || 'Proxy error' },
      });
    }
  }
});

app.post('/api/proxy/openai/v1/chat/completions', async (req, res) => {
  let billing: BillingContext | null = null;
  try {
    const ctx = await resolveProxyContext(req, undefined, '/chat/completions');
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const { user, modelConfig, upstreamKey, upstreamUrl, proxyBody } = ctx;
    billing = await beginBilling({
      userId: user.id,
      deviceId: user.deviceId,
      modelConfig,
      endpoint: '/chat/completions',
      requestBody: proxyBody,
    });

    const fetchRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${upstreamKey}`,
      },
      body: JSON.stringify(proxyBody),
    });

    const isStream = (proxyBody as { stream?: unknown }).stream === true;

    if (!fetchRes.ok && !isStream) {
      const data: any = await fetchRes.json().catch(() => null);
      await refundFailedBilling(billing, `upstream status=${fetchRes.status}`);
      return res.status(fetchRes.status).json(data || { error: { message: 'Upstream request failed' } });
    }

    if (isStream) {
      if (!fetchRes.ok) {
        const text = await fetchRes.text().catch(() => '');
        await refundFailedBilling(billing, `upstream status=${fetchRes.status}`);
        return res.status(fetchRes.status).json({ error: { message: text || 'Upstream request failed' } });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let promptTokens = estimatePromptTokens(proxyBody);
      let completionTokens = 0;
      const textNormalizerState: StreamTextNormalizerState = { textBuffer: '' };
      const decoder = new TextDecoder();
      let pendingLine = '';
      let hasUsageTokens = false;

      const writeNormalizedLine = (line: string) => {
        const normalized = normalizeChatCompletionSseLine(line, textNormalizerState, promptTokens);
        res.write(`${normalized.line}\n`);

        if (normalized.usage) {
          promptTokens = normalized.usage.promptTokens || promptTokens;
          completionTokens = normalized.usage.completionTokens || completionTokens;
          hasUsageTokens = true;
        }
        if (!hasUsageTokens && normalized.completionText) {
          completionTokens += Math.ceil(normalized.completionText.length / 4);
        }
      };

      if (fetchRes.body) {
        // @ts-ignore
        for await (const chunk of fetchRes.body) {
          const text = decoder.decode(chunk, { stream: true });
          const lines = (pendingLine + text).split(/\r?\n/);
          pendingLine = lines.pop() ?? '';
          for (const line of lines) {
            writeNormalizedLine(line);
          }
        }
      }
      const finalText = decoder.decode();
      if (finalText) {
        const lines = (pendingLine + finalText).split(/\r?\n/);
        pendingLine = lines.pop() ?? '';
        for (const line of lines) {
          writeNormalizedLine(line);
        }
      }
      if (pendingLine) {
        writeNormalizedLine(pendingLine);
      }
      res.end();

      await settleBilling(billing, { promptTokens, completionTokens }, proxyBody, 'stream, endpoint=/chat/completions');
    } else {
      const data: any = await fetchRes.json().catch(() => null);
      if (data === null) {
        const text = await fetchRes.text().catch(() => '');
        await refundFailedBilling(billing, `non-json upstream status=${fetchRes.status}`);
        return res.status(fetchRes.status || 502).json({
          error: {
            message: `Upstream returned non-JSON response (status ${fetchRes.status}): ${text.substring(0, 200)}`,
          },
        });
      }

      const promptTokens = data.usage?.prompt_tokens || data.usage?.input_tokens || estimatePromptTokens(proxyBody);
      const completionTokens =
        data.usage?.completion_tokens ||
        data.usage?.output_tokens ||
        Math.max(0, (data.usage?.total_tokens || 0) - promptTokens);
      await settleBilling(billing, { promptTokens, completionTokens }, proxyBody, 'json, endpoint=/chat/completions');
      res.status(fetchRes.status).json(data);
    }
  } catch (error: any) {
    console.error('Proxy Error:', error);
    if (billing && !(error instanceof BillingError)) {
      await refundFailedBilling(billing, error.message || 'proxy error').catch((refundError) => {
        console.error('Billing refund failed:', refundError);
      });
    }
    if (!res.headersSent) {
      res.status(error instanceof BillingError ? error.status : 500).json({
        error: { message: error.message || 'Internal Proxy Error' },
      });
    }
  }
});

// ─── Image Generations Proxy (DALL-E, etc.) ───────────────

app.post('/api/proxy/openai/v1/images/generations', async (req, res) => {
  let billing: BillingContext | null = null;
  try {
    // Don't restrict model type for images/generations — many image models
    // are configured as type 'chat' in the DB but still support /images/generations
    const ctx = await resolveProxyContext(req, undefined, '/images/generations');
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const { user, modelConfig, upstreamKey, upstreamUrl, proxyBody } = ctx;
    billing = await beginBilling({
      userId: user.id,
      deviceId: user.deviceId,
      modelConfig,
      endpoint: '/images/generations',
      requestBody: proxyBody,
    });

    const fetchRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${upstreamKey}`,
      },
      body: JSON.stringify(proxyBody),
    });

    const data: any = await fetchRes.json().catch(() => null);
    if (data === null) {
      // Upstream returned non-JSON (e.g. HTML error page)
      const text = await fetchRes.text().catch(() => '');
      await refundFailedBilling(billing, `non-json upstream status=${fetchRes.status}`);
      return res.status(fetchRes.status || 502).json({
        error: {
          message: `Upstream returned non-JSON response (status ${fetchRes.status}): ${text.substring(0, 200)}`,
        },
      });
    }

    if (!fetchRes.ok) {
      await refundFailedBilling(billing, `upstream status=${fetchRes.status}`);
      return res.status(fetchRes.status).json(data);
    }
    await settleBilling(billing, { promptTokens: 0, completionTokens: 0 }, proxyBody, 'endpoint=/images/generations');
    res.status(fetchRes.status).json(data);
  } catch (error: any) {
    console.error('Image Generation Proxy Error:', error);
    if (billing && !(error instanceof BillingError)) {
      await refundFailedBilling(billing, error.message || 'image generation proxy error').catch((refundError) => {
        console.error('Billing refund failed:', refundError);
      });
    }
    if (!res.headersSent) {
      res.status(error instanceof BillingError ? error.status : 500).json({
        error: { message: error.message || 'Internal Proxy Error' },
      });
    }
  }
});

// ─── Image Edits Proxy ───────────────────────────────────

app.post('/api/proxy/openai/v1/images/edits', async (req, res) => {
  let billing: BillingContext | null = null;
  try {
    // Don't restrict model type — same rationale as /images/generations
    const ctx = await resolveProxyContext(req, undefined, '/images/edits');
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const { user, modelConfig, upstreamKey, upstreamUrl, proxyBody } = ctx;
    billing = await beginBilling({
      userId: user.id,
      deviceId: user.deviceId,
      modelConfig,
      endpoint: '/images/edits',
      requestBody: proxyBody,
    });

    const contentType = req.headers['content-type'] || 'application/json';
    const fetchRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        Authorization: `Bearer ${upstreamKey}`,
      },
      // If it's express.raw (Buffer) we send it directly, otherwise we stringify JSON
      body: Buffer.isBuffer(proxyBody) ? proxyBody : JSON.stringify(proxyBody),
    });

    const data: any = await fetchRes.json().catch(() => null);
    if (data === null) {
      const text = await fetchRes.text().catch(() => '');
      await refundFailedBilling(billing, `non-json upstream status=${fetchRes.status}`);
      return res.status(fetchRes.status || 502).json({
        error: {
          message: `Upstream returned non-JSON response (status ${fetchRes.status}): ${text.substring(0, 200)}`,
        },
      });
    }

    if (!fetchRes.ok) {
      await refundFailedBilling(billing, `upstream status=${fetchRes.status}`);
      return res.status(fetchRes.status).json(data);
    }
    await settleBilling(billing, { promptTokens: 0, completionTokens: 0 }, proxyBody, 'endpoint=/images/edits');
    res.status(fetchRes.status).json(data);
  } catch (error: any) {
    console.error('Image Edits Proxy Error:', error);
    if (billing && !(error instanceof BillingError)) {
      await refundFailedBilling(billing, error.message || 'image edit proxy error').catch((refundError) => {
        console.error('Billing refund failed:', refundError);
      });
    }
    if (!res.headersSent) {
      res.status(error instanceof BillingError ? error.status : 500).json({
        error: { message: error.message || 'Internal Proxy Error' },
      });
    }
  }
});

// ─── Audio Speech (TTS) Proxy ─────────────────────────────

app.post('/api/proxy/openai/v1/audio/speech', async (req, res) => {
  let billing: BillingContext | null = null;
  try {
    const ctx = await resolveProxyContext(req, 'audio', '/audio/speech');
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const { user, modelConfig, upstreamKey, upstreamUrl, proxyBody } = ctx;
    billing = await beginBilling({
      userId: user.id,
      deviceId: user.deviceId,
      modelConfig,
      endpoint: '/audio/speech',
      requestBody: proxyBody,
    });

    const fetchRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${upstreamKey}`,
      },
      body: JSON.stringify(proxyBody),
    });

    // Pass through Content-Type and other relevant headers from upstream
    const contentType = fetchRes.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    const contentLength = fetchRes.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    if (!fetchRes.ok) {
      const errorData = await fetchRes.text();
      await refundFailedBilling(billing, `upstream status=${fetchRes.status}`);
      return res.status(fetchRes.status).json({ error: { message: errorData || 'Upstream TTS error' } });
    }

    // Stream binary audio data back to client
    if (fetchRes.body) {
      // @ts-ignore
      for await (const chunk of fetchRes.body) {
        res.write(chunk);
      }
    }
    res.end();

    await settleBilling(
      billing,
      { promptTokens: estimatePromptTokens(proxyBody), completionTokens: 0 },
      proxyBody,
      'endpoint=/audio/speech'
    );
  } catch (error: any) {
    console.error('Audio Speech Proxy Error:', error);
    if (billing && !(error instanceof BillingError)) {
      await refundFailedBilling(billing, error.message || 'audio speech proxy error').catch((refundError) => {
        console.error('Billing refund failed:', refundError);
      });
    }
    if (!res.headersSent) {
      res.status(error instanceof BillingError ? error.status : 500).json({
        error: { message: error.message || 'Internal Proxy Error' },
      });
    }
  }
});

// ─── Audio Transcriptions (STT) Proxy ────────────────────

app.post('/api/proxy/openai/v1/audio/transcriptions', async (req, res) => {
  let billing: BillingContext | null = null;
  try {
    const ctx = await resolveProxyContext(req, 'audio', '/audio/transcriptions');
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const { user, modelConfig, upstreamKey, upstreamUrl, proxyBody } = ctx;
    billing = await beginBilling({
      userId: user.id,
      deviceId: user.deviceId,
      modelConfig,
      endpoint: '/audio/transcriptions',
      requestBody: proxyBody,
    });

    // Forward the raw multipart/form-data body
    const contentType = req.headers['content-type'];
    const fetchRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        ...(contentType ? { 'Content-Type': contentType } : {}),
        Authorization: `Bearer ${upstreamKey}`,
      },
      body: req.body as Buffer,
    });

    const data: any = await fetchRes.json().catch(() => null);
    if (data === null) {
      const text = await fetchRes.text().catch(() => '');
      await refundFailedBilling(billing, `non-json upstream status=${fetchRes.status}`);
      return res.status(fetchRes.status || 502).json({
        error: { message: text || 'Upstream transcription returned non-JSON response' },
      });
    }
    if (!fetchRes.ok) {
      await refundFailedBilling(billing, `upstream status=${fetchRes.status}`);
      return res.status(fetchRes.status).json(data);
    }
    await settleBilling(billing, { promptTokens: 0, completionTokens: 0 }, proxyBody, 'endpoint=/audio/transcriptions');
    res.status(fetchRes.status).json(data);
  } catch (error: any) {
    console.error('Audio Transcriptions Proxy Error:', error);
    if (billing && !(error instanceof BillingError)) {
      await refundFailedBilling(billing, error.message || 'audio transcription proxy error').catch((refundError) => {
        console.error('Billing refund failed:', refundError);
      });
    }
    if (!res.headersSent) {
      res.status(error instanceof BillingError ? error.status : 500).json({
        error: { message: error.message || 'Internal Proxy Error' },
      });
    }
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Admin API server running on port ${PORT}`);
});

server.on('error', (error) => {
  console.error('Failed to start server:', error);
});

// Windows Bun keep-alive fallback
setInterval(() => {}, 1000 * 60 * 60);
