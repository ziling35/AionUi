const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const models = [
    'minimax-m3',
    'minimax-m2.7',
    'minimax-m2.5',
    'kimi-k2.7-code',
    'kimi-k2.6',
    'kimi-k2.5',
    'glm-5.2',
    'glm-5.1',
    'glm-5',
    'deepseek-v4-pro',
    'deepseek-v4-flash',
    'qwen3.7-max',
    'qwen3.7-plus',
    'qwen3.6-plus',
    'qwen3.5-plus',
    'mimo-v2-pro',
    'mimo-v2-omni',
    'mimo-v2.5-pro',
    'mimo-v2.5',
    'hy3-preview',
  ];
  for (const m of models) {
    await prisma.modelConfig.upsert({
      where: { modelId: m },
      update: { name: m, isActive: true },
      create: {
        modelId: m,
        name: m,
        provider: 'cloud-auto',
        apiBaseUrl: 'https://opencode.ai/zen/go/v1',
        apiKey: 'sk-qHGyYwmxNEa9cCradNdpbz9QB14Izp6o5Z1XWqYza6s0YXCh6cja8Iy3602JFWGi',
        multiplier: 1.0,
        isActive: true,
      },
    });
  }
  console.log('Successfully seeded ' + models.length + ' models into the database!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
