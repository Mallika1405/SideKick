import './env.js';
// Checks the Moss retriever against real code and compares it with the keyword fallback.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot, shadow } from './shadow.js';
import { chunkFile } from './chunker.js';
import { KeywordRetriever, MossRetriever, type Doc, type Retriever } from './retriever.js';
import { relative } from 'node:path';

const root = process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'demo-repo');
snapshot(root);
const docs: Doc[] = [];
for (const [file, text] of shadow) if (file.startsWith(root)) for (const c of chunkFile(file, relative(root, file), text))
  docs.push({ id: c.id, text: c.text, metadata: { file: c.file, startLine: String(c.startLine), endLine: String(c.endLine), kind: 'code' } });
console.log(`${docs.length} chunks from ${root}`);

const t0 = Date.now();
let moss: Retriever;
try { moss = await MossRetriever.create(process.env.MOSS_PROJECT_ID!, process.env.MOSS_PROJECT_KEY!); }
catch (e) { console.error('MOSS FAILED TO START:', (e as Error).message); process.exit(1); }
console.log(`moss session ready in ${Date.now() - t0}ms`);
const t1 = Date.now();
await moss.upsert(docs);
console.log(`moss indexed ${docs.length} chunks in ${Date.now() - t1}ms`);
const kw = new KeywordRetriever();
await kw.upsert(docs);

const queries = (process.argv.slice(3).length ? process.argv.slice(3) : [
  'where do we handle missing sleep hours?',
  'how do we remove students who sleep an impossible amount?',
  'which code makes sure test data is kept separate from training?',
  'where do we turn the results into a picture?',
]);
const short = (h: { id: string }[]) => h.slice(0, 3).map((x) => x.id).join('  ');
for (const q of queries) {
  const m = await moss.query(q, 5), k = await kw.query(q, 5);
  console.log(`\nQ: ${q}\n  moss    (${m.ms}ms): ${short(m.hits)}\n  keyword (${k.ms}ms): ${short(k.hits)}`);
}
process.exit(0);
