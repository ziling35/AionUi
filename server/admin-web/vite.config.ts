import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(projectRoot, 'dist');
const officialSiteRoot = resolve(projectRoot, '../../../brand-assets/lingai-official-site');

function officialSitePlugin() {
  const officialSiteEntries = ['index.html', 'assets', 'downloads'];

  return {
    name: 'official-site',
    buildStart() {
      rmSync(distRoot, { recursive: true, force: true });
    },
    closeBundle() {
      if (!existsSync(officialSiteRoot)) {
        console.warn(`Official site directory not found, skip copying: ${officialSiteRoot}`);
        return;
      }

      for (const entry of officialSiteEntries) {
        const source = resolve(officialSiteRoot, entry);

        if (!existsSync(source)) {
          console.warn(`Official site entry not found, skip copying: ${source}`);
          continue;
        }

        cpSync(source, resolve(distRoot, entry), { recursive: true });
      }
    }, 
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: '/admin/',
  plugins: [react(), officialSitePlugin()],
  build: {
    outDir: 'dist/admin',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
