const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // Create admin user
  const user = await p.user.upsert({
    where: { username: 'ziling' },
    update: {},
    create: {
      username: 'ziling',
      password: '123456',
      deviceId: 'device-1782882492536',
      quota: 100000,
      usedQuota: 0,
    },
  });
  console.log('User:', user.username, 'quota:', user.quota);

  // Upsert provider
  let provider = await p.provider.findFirst({ where: { name: 'cloud-auto' } });
  if (!provider) {
    provider = await p.provider.create({
      data: {
        name: 'cloud-auto',
        platform: 'custom',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        apiKey: 'sk-qHGyYwmxNEa9cCradNdpbz9QB14Izp6o5Z1XWqYza6s0YXCh6cja8Iy3602JFWGi',
        enabled: true,
      },
    });
  }
  console.log('Provider:', provider.name, 'id:', provider.id);

  // Create chat models
  const chatModels = [
    'hy3-preview',
    'mimo-v2.5',
    'mimo-v2.5-pro',
    'mimo-v2-omni',
    'mimo-v2-pro',
    'qwen3.5-plus',
    'qwen3.6-plus',
    'qwen3.7-plus',
    'qwen3.7-max',
    'deepseek-v4-pro',
    'glm-5',
    'glm-5.1',
    'glm-5.2',
    'kimi-k2.5',
    'kimi-k2.6',
    'kimi-k2.7-code',
    'minimax-m2.5',
    'minimax-m2.7',
    'minimax-m3',
    'deepseek-v4-flash',
  ];

  // Create image models
  const imageModels = ['nano-banana-2', 'gpt-image-2', 'nano-banana-pro', 'agnes-image-2.1-flash'];

  const allModels = [
    ...chatModels.map((id) => ({ modelId: id, name: id, type: 'chat', unitPrice: 0 })),
    ...imageModels.map((id) => ({ modelId: id, name: id, type: 'image', unitPrice: 10 })),
  ];

  for (const m of allModels) {
    await p.modelConfig.upsert({
      where: { modelId: m.modelId },
      update: { type: m.type, unitPrice: m.unitPrice || 0, providerId: provider.id },
      create: {
        modelId: m.modelId,
        name: m.name,
        providerId: provider.id,
        multiplier: 1.0,
        isActive: true,
        type: m.type,
        unitPrice: m.unitPrice || 0,
      },
    });
  }

  console.log(`Created ${allModels.length} models (${chatModels.length} chat + ${imageModels.length} image)`);
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
