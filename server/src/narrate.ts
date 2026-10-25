import Anthropic from '@anthropic-ai/sdk';
import type { Verbosity } from '@sidekick/shared';
import { redact } from './redact.js';
import { LineProtocol, SKETCH_GUIDE, type Directive } from './protocol.js';

export const NARRATE_MODEL = 'claude-haiku-5-5';
const client = () => new Anthropic(); // reads ANTHROPIC_API_KEY

const LENGTH: Record<Verbosity, string> = {
  terse: 'Exactly one sentence of at most 20 words. Mention only the single most important change.',
  normal: 'At most two sentences, 40 words total.',
  detailed: 'At most three sentences, including why the change likely matters.',
};

export const NARRATE_SYSTEM = (v: Verbosity) => `You narrate code changes aloud for a developer who is listening, not reading, and you can sketch on a whiteboard next to them.
Rules for the spoken part:
- ${LENGTH[v]}
- Write for the ear: plain spoken English. Never read code symbols, punctuation, or long identifiers aloud; describe them ("the function that loads the data").
- Say what changed, based only on the diff. Do not guess intent beyond what the diff shows.
- Be neutral: describe the change, never judge whether it is correct, wrong, risky or a bug. A separate reviewer does that; do not pre-empt or repeat the reviewer's job.
- If the diff touches code outside the provided context, say "I'm not sure" about that part.
- Never name a function, class or variable that does not appear in the provided diff or context.
Output format, exactly. One line per directive or spoken sentence:
HIGHLIGHT <file path as given> <startLine>-<endLine>   (changed lines in the new file that the next sentence is about)
<one spoken sentence on a single line>
If the change spans several files, use a separate HIGHLIGHT + sentence pair per file, in the order you mention them (at most 3 pairs, respecting the length rule above). No markdown.
${SKETCH_GUIDE}`;

export type FileChange = { file: string; rel: string; diff: string; context: string };
export type NarrateInput = { changes: FileChange[]; lastNarrations: string[]; userPrompt: string; verbosity: Verbosity };

export function buildUserMessage(i: NarrateInput): string {
  const parts: string[] = [];
  if (i.userPrompt) parts.push(`The developer's request to the coding assistant (background only):\n${i.userPrompt}`);
  if (i.lastNarrations.length) parts.push(`Your last narrations (do not repeat):\n- ${i.lastNarrations.join('\n- ')}`);
  for (const c of i.changes) parts.push(`FILE: ${c.rel}\nDIFF:\n${c.diff}\nCONTEXT (new file, with line numbers):\n${c.context}`);
  return redact(parts.join('\n\n'));
}

/** Streams a narration. Each spoken sentence arrives with the editor highlight / sketch steps that go with it. */
export async function narrate(i: NarrateInput, onSentence: (s: string, d: Directive) => void, signal: AbortSignal): Promise<string> {
  const stream = client().messages.stream(
    { model: NARRATE_MODEL, max_tokens: 900, thinking: { type: 'disabled' }, system: NARRATE_SYSTEM(i.verbosity), messages: [{ role: 'user', content: buildUserMessage(i) }] },
    { signal },
  );
  let full = '';
  const resolve = (name: string) => (i.changes.find((c) => c.rel === name || c.file === name) ?? i.changes.find((c) => name.endsWith(c.rel) || c.rel.endsWith(name)) ?? i.changes[0]).file;
  const proto = new LineProtocol(resolve, (s, d) => { if (s) full += (full ? ' ' : '') + s; onSentence(s, d); });
  stream.on('text', (t) => proto.push(t));
  await stream.finalMessage();
  proto.end();
  return full;
}
