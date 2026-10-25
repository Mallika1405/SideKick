import Anthropic from '@anthropic-ai/sdk';
import { redact } from './redact.js';

export const ANSWER_MODEL = 'claude-sonnet-5-5';

const SYSTEM = `You answer a developer's spoken question about their codebase. Your answer will be read aloud.
Rules:
- At most three short sentences. Plain spoken English; never read code symbols or long identifiers aloud.
- Cite where the answer lives by saying the file name and line number, like "in missing dot py, around line 7". Cite only files and lines present in the provided context.
- Use only the provided context. If it does not contain the answer, say you could not find it rather than guessing.
- No markdown, lists, or code.
Output format, exactly:
Line 1: FOCUS <node key from the architecture list that best matches the question, or none>
Line 2 onward: the spoken answer.`;

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

/** Streams an answer and calls onSentence for each complete sentence. */
export async function answer(i: AnswerInput, onSentence: (s: string) => void, signal: AbortSignal, onFocus: (key: string) => void = () => {}): Promise<string> {
  const stream = new Anthropic().messages.stream(
    { model: ANSWER_MODEL, max_tokens: 350, thinking: { type: 'between_tools' }, system: SYSTEM, messages: [{ role: 'user', content: buildAnswerPrompt(i) }] },
    { signal },
  );
  let buf = '', full = '', headerDone = false;
  const flush = (final: boolean) => {
    let m: RegExpMatchArray | null;
    while ((m = buf.match(/^([\s\S]*?[.!?])(\s+|$)/)) && (final || m[2].length > 0)) {
      buf = buf.slice(m[0].length);
      const s = m[1].trim();
      if (s) { full += (full ? ' ' : '') + s; onSentence(s); }
    }
    if (final && buf.trim()) { full += (full ? ' ' : '') + buf.trim(); onSentence(buf.trim()); buf = ''; }
  };
  stream.on('text', (t) => {
    buf += t;
    if (!headerDone) {
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const m = buf.slice(0, nl).match(/FOCUS\s+(\S+)/);
      if (m && m[1] !== 'none') onFocus(m[1]);
      buf = buf.slice(nl + 1);
      headerDone = true;
    }
    flush(false);
  });
  await stream.finalMessage();
  flush(true);
  return full;
}
