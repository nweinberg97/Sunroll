import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE is "/" for a root domain, or "/<repo>/" for a GitHub Pages project site.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE || '/';
  const publicUrl = (env.VITE_PUBLIC_URL || '').replace(/\/$/, '');
  return {
    base,
    plugins: [
      react(),
      {
        name: 'sunroll-html-env',
        transformIndexHtml: {
          order: 'pre',
          handler: (html: string) => html.replaceAll('%BASE_URL%', base).replaceAll('%VITE_PUBLIC_URL%', publicUrl || base.replace(/\/$/, '')),
        },
      },
    ],
    build: { target: 'es2022', sourcemap: true },
  };
});
