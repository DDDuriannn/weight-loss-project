import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { renderDocument } from './src/render-page.js';

const contentFiles = ['src/data/challenge.json', 'src/page.html'].map((path) => fileURLToPath(new URL(path, import.meta.url)));

export default defineConfig({
  base: './',
  plugins: [{
    name: 'challenge-static-page',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => renderDocument(html),
    },
    configureServer(server) {
      server.watcher.add(contentFiles);
      server.watcher.on('change', (path) => {
        if (contentFiles.includes(path)) server.ws.send({ type: 'full-reload' });
      });
    },
  }],
});
