import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, normalizePath } from 'vite';
import { renderDocument } from './src/render-page.js';

const projectDirectory = fileURLToPath(new URL('.', import.meta.url));
const inputs = ['index.html', 'questions/index.html', 'questions/admin/index.html']
  .map((path) => fileURLToPath(new URL(path, import.meta.url)));
const home = normalizePath(inputs[0]);
const contentFiles = ['src/data/challenge.json', 'src/page.html'].map((path) => fileURLToPath(new URL(path, import.meta.url)));

export function qaSupabaseOrigin(value = '') {
  if (value.trim() !== value || !/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(value)) return null;
  return new URL(value).origin;
}

function requireQaConfig(env) {
  const requirements = [
    ['VITE_QA_SUPABASE_URL', qaSupabaseOrigin, 'an HTTPS project origin such as https://<project-ref>.supabase.co'],
    ['VITE_QA_SUPABASE_PUBLISHABLE_KEY', (value) => /^sb_publishable_[A-Za-z0-9_-]+$/.test(value), 'a Supabase sb_publishable_ key'],
    ['VITE_QA_TURNSTILE_SITE_KEY', (value) => /^0x[A-Za-z0-9_-]{20,30}$/.test(value), 'a production Cloudflare Turnstile site key'],
  ];
  const errors = [];
  for (const [name, isValid, expected] of requirements) {
    const value = env[name];
    if (!value) errors.push(`${name} is missing`);
    else if (value.trim() !== value || !isValid(value)) errors.push(`${name} must be ${expected}`);
  }
  if (errors.length) {
    throw new Error(`Invalid Q&A configuration for GitHub Pages. Set the github-pages environment variables.\n${errors.join('\n')}`);
  }
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && process.env.QA_REQUIRE_CONFIG === '1') {
    requireQaConfig(loadEnv(mode, projectDirectory, 'VITE_QA_'));
  }

  return {
    base: './',
    build: { rolldownOptions: { input: inputs } },
    plugins: [{
      name: 'challenge-static-page',
      transformIndexHtml: {
        order: 'pre',
        handler: (html, context) => normalizePath(context.filename) === home ? renderDocument(html) : html,
      },
      configureServer(server) {
        server.watcher.add(contentFiles);
        server.watcher.on('change', (path) => {
          if (contentFiles.includes(path)) server.ws.send({ type: 'full-reload' });
        });
      },
    }],
  };
});
