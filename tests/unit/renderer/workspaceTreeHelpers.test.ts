import { describe, expect, it } from 'vitest';
import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import { replaceNodeChildrenByKey } from '@/renderer/pages/conversation/Workspace/utils/treeHelpers';

const folder = (relativePath: string, children: IDirOrFile[] = []): IDirOrFile => ({
  name: relativePath.split('/').pop() || 'root',
  fullPath: `D:/workspace/${relativePath}`,
  relativePath,
  isDir: true,
  isFile: false,
  children,
});

const file = (relativePath: string): IDirOrFile => ({
  name: relativePath.split('/').pop() || relativePath,
  fullPath: `D:/workspace/${relativePath}`,
  relativePath,
  isDir: false,
  isFile: true,
});

describe('workspace tree helpers', () => {
  it('replaces stale children for a refreshed expanded directory', () => {
    const tree = [
      folder('', [folder('brand-assets', [folder('brand-assets/lingai-logo'), file('brand-assets/old.zip')])]),
    ];
    const latestChildren = [
      folder('brand-assets/lingai-logo'),
      folder('brand-assets/lingai-website-concepts'),
      file('brand-assets/lingai-logo-asset-pack.zip'),
    ];

    const updated = replaceNodeChildrenByKey(tree, 'brand-assets', latestChildren);
    const brandAssets = updated[0].children?.[0];

    expect(brandAssets?.children?.map((item) => item.relativePath)).toEqual([
      'brand-assets/lingai-logo',
      'brand-assets/lingai-website-concepts',
      'brand-assets/lingai-logo-asset-pack.zip',
    ]);
  });
});
