import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import rootPackage from '../package.json';

function getCommitId(): string {
  const deploymentCommit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (deploymentCommit) return deploymentCommit.slice(0, 7);

  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'local';
  }
}

const commitId = getCommitId();

export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(`v${rootPackage.version} · ${commitId}${mode === 'development' ? ' · dev' : ''}`),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3030',
        changeOrigin: true,
      },
      '/admin': {
        target: 'http://localhost:3030',
        changeOrigin: true,
      },
    }
  },
  resolve: {
    conditions: ['source', 'import'],
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'CityZen',
        short_name: 'CityZen',
        description: 'A multiplayer city-building game',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'fullscreen',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html}'],
        globIgnores: ['**/textures/**'],
        runtimeCaching: [],
      },
    }),
  ],
}));
