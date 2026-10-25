import { MossClient } from '@moss-dev/moss';

export type Doc = { id: string; text: string; metadata: { file: string; startLine: string; endLine: string; kind: 'code' | 'edit' | 'narration' | 'graph' } };
export type Hit = Doc & { score: number };
export interface Retriever {
  readonly name: string;
  upsert(docs: Doc[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  query(text: string, topK: number): Promise<{ hits: Hit[]; ms: number }>;
}

const tokens = (s: string) =>
  s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);

/** Dependency-free fallback: TF-IDF over identifier-aware tokens. */
export class KeywordRetriever implements Retriever {
  readonly name = 'keyword';
  private docs = new Map<string, { doc: Doc; tf: Map<string, number> }>();
  async upsert(docs: Doc[]) {
    for (const doc of docs) {
      const tf = new Map<string, number>();
      for (const t of tokens(doc.text)) tf.set(t, (tf.get(t) ?? 0) + 1);
      this.docs.set(doc.id, { doc, tf });
    }
  }
  async remove(ids: string[]) { for (const id of ids) this.docs.delete(id); }
  async query(text: string, topK: number) {
    const t0 = performance.now();
    const q = [...new Set(tokens(text))];
    const n = this.docs.size || 1;
    const idf = new Map(q.map((t) => {
      let df = 0;
      for (const d of this.docs.values()) if (d.tf.has(t)) df++;
      return [t, Math.log(1 + n / (1 + df))] as const;
    }));
    const hits: Hit[] = [];
    for (const { doc, tf } of this.docs.values()) {
      let score = 0;
      for (const t of q) { const f = tf.get(t); if (f) score += (1 + Math.log(f)) * idf.get(t)!; }
      if (score > 0) hits.push({ ...doc, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return { hits: hits.slice(0, topK), ms: Math.round(performance.now() - t0) };
  }
}

/** Moss in-process session index (embeddings computed locally; cloud only for auth/model). */
export class MossRetriever implements Retriever {
  readonly name = 'moss';
  private constructor(private session: Awaited<ReturnType<MossClient['session']>>) {}
  static async create(projectId: string, projectKey: string): Promise<MossRetriever> {
    const client = new MossClient(projectId, projectKey);
    return new MossRetriever(await client.session(`sidekick-${Date.now()}`, 'moss-minilm'));
  }
  async upsert(docs: Doc[]) { if (docs.length) await this.session.addDocs(docs, { upsert: true }); }
  async remove(ids: string[]) { if (ids.length) await this.session.deleteDocs(ids); }
  async query(text: string, topK: number) {
    const t0 = performance.now();
    const res = await this.session.query(text, { topK });
    const ms = res.timeTakenInMs ?? Math.round(performance.now() - t0);
    const hits = res.docs.map((d) => ({ id: d.id, text: d.text, score: d.score, metadata: d.metadata as Doc['metadata'] }));
    return { hits, ms };
  }
}

export async function createRetriever(): Promise<Retriever> {
  const { MOSS_PROJECT_ID: id, MOSS_PROJECT_KEY: key } = process.env;
  if (id && key) {
    try { return await MossRetriever.create(id, key); } catch (e) { console.warn('[retriever] Moss unavailable, using keyword search:', (e as Error).message); }
  }
  return new KeywordRetriever();
}
