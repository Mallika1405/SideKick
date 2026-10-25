import { SketchPatchSchema, type SketchPatch } from '@sidekick/shared';

/** What the model attached to a spoken sentence: where to point in the editor, what to draw, which map node to focus. */
export type Directive = { highlight?: { file: string; start: number; end: number }; sketches: SketchPatch[]; focus?: string };

export const SKETCH_GUIDE = `SKETCH lines draw on a shared whiteboard while you talk, like a colleague sketching next to the listener.
Syntax: the word SKETCH, a space, then ONE line of valid JSON:
{"clear":true,"title":"short title","layout":"LR","nodes":[{"id":"a","type":"box","label":"All rows","color":"blue"},{"id":"p","type":"plot","plot":"scatter","trend":"up","label":"sleep vs score"},{"id":"t","type":"table","columns":["x","y"],"rows":[["...","..."]]},{"id":"n","type":"note","label":"test rows leak in","color":"red"}],"edges":[{"from":"a","to":"p","label":"plotted as","style":"solid"}]}
Node types: box, note (callout), circle (a value or data), plot (plot is scatter|line|bar|hist; trend is up|down|flat|u|peak), table (columns and rows). Colors: blue green orange red purple gray. layout is LR or TB.
Sketching rules:
- Every line that is not a HIGHLIGHT, SKETCH or FOCUS directive is spoken aloud verbatim, so never write commentary, labels, or talk about the drawing itself (never say "let me sketch" or "sketching the order").
- A SKETCH line goes BEFORE the spoken sentence it illustrates, never after.
- Sketch when a picture genuinely helps the listener. Usually yes for: a change to the ORDER or FLOW of steps (a stage added, removed or reordered, e.g. scaling before vs after a split), data being split, merged or filtered, a new model or feature and how it connects to the others, a statistical idea behind a bug (leakage, overfitting, outliers, a distribution), or a before/after comparison. Sketching is encouraged for these even when the spoken part is one short sentence; the spoken length limit still applies.
- Usually no for: a comment, a rename, a constant or threshold tweak, formatting, a docstring, or any change whose one sentence already says it all. When in doubt about a trivial change, draw NOTHING.
- Build the drawing step by step. Put each SKETCH line right before the sentence it illustrates and add only a few new nodes or edges per line (a node with an existing id is updated). The first SKETCH of a new drawing has "clear":true. Use 1 to 4 SKETCH lines in total and at most 8 nodes.
- Labels are at most 4 words. Use a red note for a problem.
- Plots are schematic only: never invent numbers or axis values. Table cells may hold "..." but never made-up data.`;

/** Parses the model's line-oriented output: directive lines (HIGHLIGHT, SKETCH, FOCUS) apply to the next spoken sentence line. */
export class LineProtocol {
  private buf = '';
  private pending: Directive = { sketches: [] };
  constructor(
    private resolveFile: (name: string) => string | undefined,
    private onSentence: (sentence: string, d: Directive) => void,
  ) {}

  push(text: string) {
    this.buf += text;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) { this.line(this.buf.slice(0, nl)); this.buf = this.buf.slice(nl + 1); }
  }
  end() {
    this.line(this.buf); this.buf = '';
    const p = this.pending; // directives that arrived after the last sentence still get shown (with nothing new to say)
    if (p.highlight || p.sketches.length || p.focus) { this.pending = { sketches: [] }; this.onSentence('', p); }
  }

  private line(raw: string) {
    const line = raw.trim();
    if (!line) return;
    const h = line.match(/^HIGHLIGHT\s+(.+?)\s+(\d+)\s*[-–]\s*(\d+)\s*$/);
    if (h) { const file = this.resolveFile(h[1]); if (file) this.pending.highlight = { file, start: +h[2], end: +h[3] }; return; }
    if (line.startsWith('SKETCH')) {
      try { this.pending.sketches.push(SketchPatchSchema.parse(JSON.parse(line.slice(6)))); }
      catch (e) { console.warn('[sketch] dropped invalid patch:', (e as Error).message.slice(0, 120)); }
      return;
    }
    const f = line.match(/^FOCUS\s+(\S+)/);
    if (f) { if (f[1] !== 'none') this.pending.focus = f[1]; return; }
    if (/^(HIGHLIGHT|SKETCH|FOCUS)\b/.test(line)) return; // malformed directive: never speak it
    const d = this.pending;
    this.pending = { sketches: [] };
    this.onSentence(line, d);
  }
}
