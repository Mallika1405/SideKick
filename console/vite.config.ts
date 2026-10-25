import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Share the repo-root .env; only CONVEX_URL (a public deployment URL, not a secret) is exposed to the browser.
export default defineConfig({ plugins: [react()], envDir: '..', envPrefix: ['VITE_', 'CONVEX_URL'], server: { port: 5173 } });
