import { randomUUID } from 'node:crypto';
import type { Edit } from '@sidekick/shared';
import { lineRange } from './diffing.js';

type Pending = { first: Edit; last: Edit; edits: Edit[] };
const QUIET_MS = 1500;

/** Groups edits per file; flushes after quiet or on demand (Stop hook). */
export class Batcher {
  private pending = new Map<string, Pending>();
  private timer: NodeJS.Timeout | null = null;
  constructor(private onFlush: (batch: Pending[]) => void) {}

  add(e: Omit<Edit, 'id' | 'startLine' | 'endLine'>) {
    const edit: Edit = { ...e, id: randomUUID(), ...lineRange(e.before, e.after) };
    const p = this.pending.get(edit.file);
    if (p) { p.last = edit; p.edits.push(edit); } else this.pending.set(edit.file, { first: edit, last: edit, edits: [edit] });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), QUIET_MS);
    return edit;
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = [...this.pending.values()].filter((p) => p.first.before !== p.last.after);
    this.pending.clear();
    if (batch.length) this.onFlush(batch);
  }
}
