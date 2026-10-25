import Anthropic from '@anthropic-ai/sdk';
import { redact } from './redact.js';
import { LineProtocol, SKETCH_GUIDE, type Directive } from './protocol.js';

export const ANSWER_MODEL = 'claude-sonnet-5-5';

const SYSTEM = `You answer a developer's spoken question about their codebase. Your answer will be read aloud, and you can sketch on a whiteboard next to them.
Rules for the spoken part:
- At most three short sentences (four if you are sketching). Plain spoken English; never read code symbols or long identifiers aloud.
- Cite where the answer lives by saying the file name and line number, like "in missing dot py, around line 7". Cite only files and lines present in the provided context.
- Use only the provided context. If it does not contain the answer, say you could not find it rather than guessing.
- No markdown, lists, or code.
Output format, exactly. One line per directive or spoken sentence:
FOCUS <node key from the architecture list that best matches the question, or none>   (optional, at most once, first)
HIGHLIGHT <file path as given> <startLine>-<endLine>   (optional, right before the sentence about that code)
<one spoken sentence on a single line>
${SKETCH_GUIDE}`;

export type AnswerInput = {
  question: string;
  chunks: { rel: string; start: number; end: number; text: string }[];
  recentEdits: string[];
  graphSummary: string;
};

export function buildAnswerPrompt(i: AnswerInput): string {
  const ctx = i.chunks.map((c) => `--- ${c.rel} lines ${c.start}-${c.end}\n${c.text}`).join('\n\n');
  return redact(
    `Question: ${i.question}\n\nRetrieved code:\n${ctx || '(nothing retrieved)'}\n\nRecent edits:\n${i.recentEdits.join('\n') || '(none)'}\n\nArchitecture summary:\n${i.graphSummary || '(none yet)'}`,
  );
}

/** Streams an answer; each sentence arrives with its directives. `resolveFile` maps a repo-relative path to an absolute one. */
export async function answer(i: AnswerInput, onSentence: (s: string, d: Directive) => void, signal: AbortSignal, resolveFile: (rel: string) => string | undefined): Promise<string> {
  const stream = new Anthropic().messages.stream(
    { model: ANSWER_MODEL, max_tokens: 900, thinking: { type: 'between_tools' }, system: SYSTEM, messages: [{ role: 'user', content: buildAnswerPrompt(i) }] },
    { signal },
  );
  let full = '';
  const proto = new LineProtocol(resolveFile, (s, d) => { if (s) full += (full ? ' ' : '') + s; onSentence(s, d); });
  stream.on('text', (t) => proto.push(t));
  await stream.finalMessage();
  proto.end();
  return full;
}
