import { relative } from 'node:path';
import { chunkFile } from './chunker.js';
import { shadow } from './shadow.js';
import type { Doc, Retriever } from './retriever.js';

/** Keeps the retriever in sync with file contents, edits and narrations. */
export class CodeIndex {
  private idsByFile = new Map<string, string[]>();
  constructor(private retriever: Retriever, public root: () => string) {}
  rel = (file: string) => (this.root() ? relative(this.root(), file) : file);

  async indexFile(file: string, text: string) {
    await this.retriever.remove(this.idsByFile.get(file) ?? []);
    const chunks = chunkFile(file, this.rel(file), text);
    this.idsByFile.set(file, chunks.map((c) => c.id));
    await this.retriever.upsert(chunks.map((c) => ({
      id: c.id, text: c.text, metadata: { file: c.file, startLine: String(c.startLine), endLine: String(c.endLine), kind: 'code' as const },
    })));
  }
  async indexAll(prefix: string) {
    const t0 = Date.now();
    let n = 0;
    for (const [file, text] of shadow) if (file.startsWith(prefix)) { await this.indexFile(file, text); n++; }
    console.log(`[index] ${n} files via ${this.retriever.name} in ${Date.now() - t0}ms`);
  }
  async addNote(doc: Doc) { await this.retriever.upsert([doc]); }
  async addNotes(docs: Doc[]) { await this.retriever.upsert(docs); }
  query(text: string, topK = 5) { return this.retriever.query(text, topK); }
}
