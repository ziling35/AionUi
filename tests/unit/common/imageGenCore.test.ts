import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { processImageUri } from '@/common/chat/imageGenCore';

const createdDirs: string[] = [];

describe('imageGenCore', () => {
  afterEach(async () => {
    await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('detects image MIME from file content when extension is wrong', async () => {
    const workspaceDir = await mkdtemp(path.join(tmpdir(), 'lingai-image-core-'));
    createdDirs.push(workspaceDir);
    const imagePath = path.join(workspaceDir, 'logo.png');
    await writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));

    const result = await processImageUri('logo.png', workspaceDir);

    expect(result?.image_url.url.startsWith('data:image/jpeg;base64,')).toBe(true);
  });
});
