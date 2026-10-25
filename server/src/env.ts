// Minimal .env loader (repo root); avoids depending on node's --env-file flag.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
try {
  const txt = readFileSync(fileURLToPath(new URL('../../.env', import.meta.url)), 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* no .env */ }
