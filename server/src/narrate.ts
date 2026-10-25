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
Output format, exactly. Write one line per spoken sentence, each preceded by a highlight line, so the editor can jump to the code you are talking about:
HIGHLIGHT <file path as given> <startLine>-<endLine>   (the changed lines, in the new file, that the next sentence is about)
<one spoken sentence on a single line>
If the change spans several files, use a separate HIGHLIGHT + sentence pair per file, in the order you mention them (at most 3 pairs, respecting the length rule above). No markdown.`;

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

/** Streams a narration. Each completed line is either a HIGHLIGHT directive or a spoken sentence; sentences carry the highlight that precedes them. */
export async function narrate(
  i: NarrateInput,
  cb: { onSentence(s: string, highlight?: Highlight): void },
  signal: AbortSignal,
): Promise<string> {
  const stream = client().messages.stream(
    { model: NARRATE_MODEL, max_tokens: 400, thinking: { type: 'disabled' }, system: NARRATE_SYSTEM(i.verbosity), messages: [{ role: 'user', content: buildUserMessage(i) }] },
    { signal },
  );
  let buf = '', full = '', pending: Highlight | undefined;
  const handle = (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    const h = line.match(/^HIGHLIGHT\s+(.+?)\s+(\d+)\s*[-\u2013]\s*(\d+)\s*$/);
    if (h) {
      const file = i.changes.find((c) => c.file === h[1])?.file ?? i.changes.find((c) => h[1].endsWith(c.file) || c.file.endsWith(h[1]))?.file ?? i.changes[0].file;
      pending = { file, start: +h[2], end: +h[3] };
      return;
    }
    if (/^HIGHLIGHT\b/.test(line)) return; // malformed directive: never speak it
    full += (full ? ' ' : '') + line;
    cb.onSentence(line, pending);
    pending = undefined;
  };
  stream.on('text', (t) => {
    buf += t;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
  });
  await stream.finalMessage();
  handle(buf);
  return full;
}
