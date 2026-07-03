import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

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

    res.json({ success: true, user: { id: user.id, username: user.username, quota: user.quota } });
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
      user: { id: user.id, username: user.username, quota: user.quota },
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

    res.json({
      success: true,
      user: { id: user.id, username: user.username, quota: user.quota, usedQuota: user.usedQuota },
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, users });
  } catch (error) {
    console.error('Error fetching users:', error);
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
app.get('/api/providers/list', async (req, res) => {
  try {
    const [providers, orphanedModels] = await Promise.all([
      prisma.provider.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          models: {
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      prisma.modelConfig.findMany({
        where: { providerId: null },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // Append orphaned models as a virtual provider so the admin UI can
    // display and manage them (edit multiplier, toggle active, delete, etc.).
    if (orphanedModels.length > 0) {
      providers.push({
        id: '__orphaned__',
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

    const newProvider = await prisma.provider.create({
      data: {
        name,
        platform: platform || 'custom',
        baseUrl: baseUrl || null,
        apiKey: apiKey || null,
        enabled: enabled !== false,
        models:
          models && models.length > 0
            ? {
                create: models.map((m: any) => ({
                  modelId: m.modelId,
                  name: m.name || m.modelId,
                  multiplier: parseFloat(m.multiplier) || 1.0,
                  isActive: m.isActive !== false,
                  type: m.type || 'chat',
                  unitPrice: parseFloat(m.unitPrice) || 0,
                })),
              }
            : undefined,
      },
      include: { models: true },
    });
    res.json({ success: true, provider: newProvider });
  } catch (error: any) {
    console.error('Error adding provider:', error);
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: `Duplicate modelId: ${error.meta?.target}` });
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
      try {
        const created = await prisma.modelConfig.create({
          data: {
            modelId: m.modelId,
            name: m.name || m.modelId,
            multiplier: parseFloat(m.multiplier) || 1.0,
            isActive: m.isActive !== false,
            type: m.type || 'chat',
            unitPrice: parseFloat(m.unitPrice) || 0,
            providerId: id,
          },
        });
        results.push(created);
      } catch {
        // Skip duplicate modelId — already exists
      }
    }

    const updatedProvider = await prisma.provider.findUnique({
      where: { id },
      include: { models: { orderBy: { createdAt: 'asc' } } },
    });
    res.json({ success: true, provider: updatedProvider, addedCount: results.length });
  } catch (error) {
    console.error('Error adding models to provider:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/providers/:id/models/:modelId
 * Update a single model's fields (name, multiplier, type, unitPrice, isActive).
 */
app.put('/api/providers/:id/models/:modelId', async (req, res) => {
  try {
    const { modelId } = req.params;
    const { name, multiplier, type, unitPrice, isActive } = req.body;

    const updated = await prisma.modelConfig.update({
      where: { modelId },
      data: {
        ...(name !== undefined && { name }),
        ...(multiplier !== undefined && { multiplier: parseFloat(multiplier) }),
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
    const { modelId } = req.params;
    await prisma.modelConfig.delete({ where: { modelId } });
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
      orderBy: { createdAt: 'desc' },
      include: { provider: true },
    });

    res.json({
      success: true,
      models: models.map((m) => ({
        id: m.modelId,
        modelId: m.modelId,
        name: m.name,
        provider: m.provider?.name || 'custom',
        multiplier: m.multiplier,
        isActive: m.isActive,
        type: m.type || 'chat',
      })),
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
    const cards = [];
    for (let i = 0; i < count; i++) {
      const code = `AION-${Math.random().toString(36).substring(2, 10).toUpperCase()}-${Date.now().toString().slice(-4)}`;
      cards.push({ code, amount });
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

    await prisma.$transaction([
      prisma.cardSecret.update({
        where: { id: card.id },
        data: { status: 'USED', usedById: user.id, usedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { quota: user.quota + card.amount },
      }),
    ]);

    res.json({ success: true, newQuota: user.quota + card.amount });
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
    }
  | {
      ok: false;
      status: number;
      error: { message: string };
    }
> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      status: 401,
      error: { message: 'Missing or invalid Authorization header. Please use Bearer <userId>' },
    };
  }

  const userId = authHeader.split(' ')[1];
  const user = await prisma.user.findUnique({ where: { deviceId: userId } });
  if (!user) {
    return { ok: false, status: 401, error: { message: 'User not found or invalid token.' } };
  }

  if (user.quota <= 0) {
    return { ok: false, status: 402, error: { message: 'Insufficient quota. Please recharge.' } };
  }

  const modelId = (req.body as any)?.model || req.headers['x-aion-model'] || req.query.model;
  if (!modelId) {
    return { ok: false, status: 400, error: { message: 'Missing model in request body or headers.' } };
  }

  const modelConfig = await prisma.modelConfig.findUnique({
    where: { modelId },
    include: { provider: true },
  });
  if (!modelConfig || !modelConfig.isActive) {
    return { ok: false, status: 404, error: { message: `Model ${modelId} is not available or inactive.` } };
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

  return { ok: true, user, modelConfig, upstreamKey, upstreamUrl };
}

/**
 * Deduct quota from a user after a successful API call.
 */
async function deductQuota(userId: string, deviceId: string | null, cost: number, detail: string) {
  // Re-fetch current quota to avoid race conditions
  const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { quota: true } });
  if (!currentUser) return;
  await prisma.user.update({
    where: { id: userId },
    data: {
      quota: Math.max(0, currentUser.quota - cost),
      usedQuota: { increment: cost },
    },
  });
  console.log(`Deducted ${cost} quota from user ${deviceId} (${detail})`);
}

// ─── Chat Completions Proxy (supports chat, embedding, image-via-chat) ───

app.post('/api/proxy/openai/v1/chat/completions', async (req, res) => {
  try {
    const ctx = await resolveProxyContext(req, undefined, '/chat/completions');
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const { user, modelConfig, upstreamKey, upstreamUrl } = ctx;
    const multiplier = modelConfig.multiplier;
    const modelType = modelConfig.type || 'chat';
    const unitPrice = modelConfig.unitPrice || 0;

    const fetchRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${upstreamKey}`,
      },
      body: JSON.stringify(req.body),
    });

    const isStream = req.body.stream === true;

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let promptTokens = 0;
      let completionTokens = 0;

      if (fetchRes.body) {
        // @ts-ignore
        for await (const chunk of fetchRes.body) {
          res.write(chunk);

          const text = chunk.toString();
          for (const line of text.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.usage?.total_tokens) {
                promptTokens = parsed.usage.prompt_tokens || promptTokens;
                completionTokens = parsed.usage.completion_tokens || completionTokens;
              }
              if (parsed.choices?.[0]?.delta?.content) {
                completionTokens += Math.ceil(parsed.choices[0].delta.content.length / 4);
              }
            } catch {
              // not JSON, skip
            }
          }
        }
      }
      res.end();

      // Billing: image/video/audio with unitPrice > 0 → per-call; otherwise token-based
      if ((modelType === 'image' || modelType === 'video' || modelType === 'audio') && unitPrice > 0) {
        const cost = Math.ceil(unitPrice * multiplier);
        await deductQuota(user.id, user.deviceId, cost, `per-call, type=${modelType}, multiplier=${multiplier}`);
      } else {
        const totalTokens =
          promptTokens + completionTokens > 0 ? promptTokens + completionTokens : Math.max(1, completionTokens);
        const cost = Math.ceil((totalTokens / 1000) * multiplier);
        await deductQuota(
          user.id,
          user.deviceId,
          cost,
          `tokens=${totalTokens}, type=${modelType}, multiplier=${multiplier}`
        );
      }
    } else {
      const data: any = await fetchRes.json().catch(() => null);
      if (data === null) {
        const text = await fetchRes.text().catch(() => '');
        return res.status(fetchRes.status || 502).json({
          error: {
            message: `Upstream returned non-JSON response (status ${fetchRes.status}): ${text.substring(0, 200)}`,
          },
        });
      }
      res.status(fetchRes.status).json(data);

      // Billing: image/video/audio with unitPrice > 0 → per-call; otherwise token-based
      if ((modelType === 'image' || modelType === 'video' || modelType === 'audio') && unitPrice > 0) {
        const cost = Math.ceil(unitPrice * multiplier);
        await deductQuota(user.id, user.deviceId, cost, `per-call, type=${modelType}, multiplier=${multiplier}`);
      } else if (data.usage?.total_tokens) {
        const cost = Math.ceil((data.usage.total_tokens / 1000) * multiplier);
        await deductQuota(
          user.id,
          user.deviceId,
          cost,
          `tokens=${data.usage.total_tokens}, type=${modelType}, multiplier=${multiplier}`
        );
      }
    }
  } catch (error: any) {
    console.error('Proxy Error:', error);
    res.status(500).json({ error: { message: error.message || 'Internal Proxy Error' } });
  }
});

// ─── Image Generations Proxy (DALL-E, etc.) ───────────────

app.post('/api/proxy/openai/v1/images/generations', async (req, res) => {
  try {
    // Don't restrict model type for images/generations — many image models
    // are configured as type 'chat' in the DB but still support /images/generations
    const ctx = await resolveProxyContext(req, undefined, '/images/generations');
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const { user, modelConfig, upstreamKey, upstreamUrl } = ctx;
    const multiplier = modelConfig.multiplier;
    const unitPrice = modelConfig.unitPrice || 0;

    const fetchRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${upstreamKey}`,
      },
      body: JSON.stringify(req.body),
    });

    const data: any = await fetchRes.json().catch(() => null);
    if (data === null) {
      // Upstream returned non-JSON (e.g. HTML error page)
      const text = await fetchRes.text().catch(() => '');
      return res.status(fetchRes.status || 502).json({
        error: {
          message: `Upstream returned non-JSON response (status ${fetchRes.status}): ${text.substring(0, 200)}`,
        },
      });
    }
    res.status(fetchRes.status).json(data);

    // Billing: per-call if unitPrice > 0, only on successful response
    if (fetchRes.ok && unitPrice > 0) {
      const cost = Math.ceil(unitPrice * multiplier);
      await deductQuota(
        user.id,
        user.deviceId,
        cost,
        `image-generation, model=${req.body.model}, multiplier=${multiplier}`
      );
    }
  } catch (error: any) {
    console.error('Image Generation Proxy Error:', error);
    res.status(500).json({ error: { message: error.message || 'Internal Proxy Error' } });
  }
});

// ─── Image Edits Proxy ───────────────────────────────────

app.post('/api/proxy/openai/v1/images/edits', async (req, res) => {
  try {
    // Don't restrict model type — same rationale as /images/generations
    const ctx = await resolveProxyContext(req, undefined, '/images/edits');
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const { user, modelConfig, upstreamKey, upstreamUrl } = ctx;
    const multiplier = modelConfig.multiplier;
    const unitPrice = modelConfig.unitPrice || 0;

    const contentType = req.headers['content-type'] || 'application/json';
    const fetchRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        Authorization: `Bearer ${upstreamKey}`,
      },
      // If it's express.raw (Buffer) we send it directly, otherwise we stringify JSON
      body: Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body),
    });

    const data: any = await fetchRes.json().catch(() => null);
    if (data === null) {
      const text = await fetchRes.text().catch(() => '');
      return res.status(fetchRes.status || 502).json({
        error: {
          message: `Upstream returned non-JSON response (status ${fetchRes.status}): ${text.substring(0, 200)}`,
        },
      });
    }
    res.status(fetchRes.status).json(data);

    if (fetchRes.ok && unitPrice > 0) {
      const cost = Math.ceil(unitPrice * multiplier);
      await deductQuota(user.id, user.deviceId, cost, `image-edit, model=${req.body.model}, multiplier=${multiplier}`);
    }
  } catch (error: any) {
    console.error('Image Edits Proxy Error:', error);
    res.status(500).json({ error: { message: error.message || 'Internal Proxy Error' } });
  }
});

// ─── Audio Speech (TTS) Proxy ─────────────────────────────

app.post('/api/proxy/openai/v1/audio/speech', async (req, res) => {
  try {
    const ctx = await resolveProxyContext(req, 'audio', '/audio/speech');
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const { user, modelConfig, upstreamKey, upstreamUrl } = ctx;
    const multiplier = modelConfig.multiplier;
    const unitPrice = modelConfig.unitPrice || 0;

    const fetchRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${upstreamKey}`,
      },
      body: JSON.stringify(req.body),
    });

    // Pass through Content-Type and other relevant headers from upstream
    const contentType = fetchRes.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    const contentLength = fetchRes.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    if (!fetchRes.ok) {
      const errorData = await fetchRes.text();
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

    // Billing: per-call if unitPrice > 0, otherwise estimate by input character count
    if (unitPrice > 0) {
      const cost = Math.ceil(unitPrice * multiplier);
      await deductQuota(user.id, user.deviceId, cost, `tts, model=${req.body.model}, multiplier=${multiplier}`);
    } else {
      // Fallback: charge 1 quota per 1000 input characters
      const inputLength = (req.body.input as string)?.length || 0;
      const cost = Math.max(1, Math.ceil((inputLength / 1000) * multiplier));
      await deductQuota(user.id, user.deviceId, cost, `tts, chars=${inputLength}, multiplier=${multiplier}`);
    }
  } catch (error: any) {
    console.error('Audio Speech Proxy Error:', error);
    res.status(500).json({ error: { message: error.message || 'Internal Proxy Error' } });
  }
});

// ─── Audio Transcriptions (STT) Proxy ────────────────────

app.post('/api/proxy/openai/v1/audio/transcriptions', async (req, res) => {
  try {
    const ctx = await resolveProxyContext(req, 'audio', '/audio/transcriptions');
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });

    const { user, modelConfig, upstreamKey, upstreamUrl } = ctx;
    const multiplier = modelConfig.multiplier;
    const unitPrice = modelConfig.unitPrice || 0;

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

    const data: any = await fetchRes.json();
    res.status(fetchRes.status).json(data);

    // Billing: per-call if unitPrice > 0, otherwise charge 1 quota per request
    if (unitPrice > 0) {
      const cost = Math.ceil(unitPrice * multiplier);
      await deductQuota(
        user.id,
        user.deviceId,
        cost,
        `stt, model=${req.body.model || 'unknown'}, multiplier=${multiplier}`
      );
    } else {
      const cost = Math.max(1, Math.ceil(multiplier));
      await deductQuota(user.id, user.deviceId, cost, `stt, per-request, multiplier=${multiplier}`);
    }
  } catch (error: any) {
    console.error('Audio Transcriptions Proxy Error:', error);
    res.status(500).json({ error: { message: error.message || 'Internal Proxy Error' } });
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
