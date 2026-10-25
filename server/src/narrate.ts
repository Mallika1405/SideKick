import Anthropic from '@anthropic-ai/sdk';
import type { Verbosity } from '@sidekick/shared';
import { redact } from './redact.js';

export const NARRATE_MODEL = 'claude-haiku-5-5';
const client = () => new Anthropic(); // reads ANTHROPIC_API_KEY

const LENGTH: Record<Verbosity, string> = {
  terse: 'Exactly one sentence of at most 20 words. Mention only the single most important change.',
  normal: 'At most two sentences, 40 words total.',
  detailed: 'At most three sentences, including why the change likely matters.',
};

export const NARRATE_SYSTEM = (v: Verbosity) => `You narrate code changes aloud for a developer who is listening, not reading.
Rules:
- ${LENGTH[v]}
- Write for the ear: plain spoken English. Never read code symbols, punctuation, or long identifiers aloud; describe them ("the function that loads the data").
- Say what changed, based only on the diff. Do not guess intent beyond what the diff shows.
- If the diff touches code outside the provided context, say "I'm not sure" about that part.
- Never name a function, class or variable that does not appear in the provided diff or context.
Output format, exactly:
Line 1: HIGHLIGHT <file path as given> <startLine>-<endLine>  (the most important changed lines, in the new file)
Line 2 onward: the spoken sentences. No markdown.`;

export type FileChange = { file: string; diff: string; context: string };
export type NarrateInput = { changes: FileChange[]; lastNarrations: string[]; userPrompt: string; verbosity: Verbosity };
export type Highlight = { file: string; start: number; end: number };

export function buildUserMessage(i: NarrateInput): string {
  const parts: string[] = [];
  if (i.userPrompt) parts.push(`The developer's request to the coding assistant (background only):\n${i.userPrompt}`);
  if (i.lastNarrations.length) parts.push(`Your last narrations (do not repeat):\n- ${i.lastNarrations.join('\n- ')}`);
  for (const c of i.changes) parts.push(`FILE: ${c.file}\nDIFF:\n${c.diff}\nCONTEXT (new file, with line numbers):\n${c.context}`);
  return redact(parts.join('\n\n'));
}

/** Streams a narration. onHighlight fires once; onSentence fires per complete spoken sentence. */
export async function narrate(
  i: NarrateInput,
  cb: { onHighlight(h: Highlight): void; onSentence(s: string): void },
  signal: AbortSignal,
): Promise<string> {
  const stream = client().messages.stream(
    { model: NARRATE_MODEL, max_tokens: 300, thinking: { type: 'disabled' }, system: NARRATE_SYSTEM(i.verbosity), messages: [{ role: 'user', content: buildUserMessage(i) }] },
    { signal },
  );
  let buf = '', headerDone = false, full = '';
  const flushSentences = (final: boolean) => {
    let m: RegExpMatchArray | null;
    while ((m = buf.match(/^([\s\S]*?[.!?])(\s+|$)/)) && (final || m[2].length > 0)) {
      const s = m[1].trim();
      buf = buf.slice(m[0].length);
      if (s) { full += (full ? ' ' : '') + s; cb.onSentence(s); }
    }
    if (final && buf.trim()) { full += (full ? ' ' : '') + buf.trim(); cb.onSentence(buf.trim()); buf = ''; }
  };
  stream.on('text', (t) => {
    buf += t;
    if (!headerDone) {
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const m = buf.slice(0, nl).match(/HIGHLIGHT\s+(.+?)\s+(\d+)-(\d+)/);
      if (m) { const f = i.changes.find((c) => c.file === m[1])?.file ?? i.changes[0].file; cb.onHighlight({ file: f, start: +m[2], end: +m[3] }); }
      buf = buf.slice(nl + 1);
      headerDone = true;
    }
    flushSentences(false);
  });
  await stream.finalMessage();
  flushSentences(true);
  return full;
}
