import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Issue } from '@sidekick/shared';
import { redact } from './redact.js';

export const REVIEW_MODEL = 'claude-haiku-5-5';

const SYSTEM = `You are a careful code reviewer watching a student's analysis code change. Find likely BUGS in the changed code, with special attention to:
- data leakage (test or validation data influencing training: scaling, imputing, selecting features, or encoding before the train/test split),
- wrong or reused variables, off-by-one errors, division by zero, silently dropped rows, mutated inputs, wrong columns,
- statistical mistakes that would invalidate a reported result.
Return ONLY a JSON array (no prose, no code fences) of at most 5 objects: {"line": <line number in the new file>, "severity": "info"|"warn"|"bug", "message": "<one sentence>"}.
Rules:
- Report only problems visible in the provided code; never speculate about code you were not shown. If unsure, use "warn" or "info".
- Use "bug" only when you are confident the code is wrong.
- A narrator already describes WHAT changed aloud, so do not restate the change. Lead with what goes wrong and the concrete consequence (for example: "a 10 percent discount would remove the entire price"), in one sentence.
- Write each message in plain spoken English a listener can follow: no code symbols, no backticks, name things by what they do.
- Return [] if you find nothing.`;

const Item = z.object({ line: z.number().int().min(1), severity: z.enum(['info', 'warn', 'bug']), message: z.string().min(1) });

function parse(text: string): z.infer<typeof Item>[] {
  const a = text.indexOf('['), b = text.lastIndexOf(']');
  if (a < 0 || b < a) throw new Error('no JSON array');
  return z.array(Item).parse(JSON.parse(text.slice(a, b + 1)));
}

export async function review(file: string, rel: string, diff: string, numbered: string): Promise<Issue[]> {
  const client = new Anthropic();
  const user = redact(`FILE: ${rel}\nDIFF:\n${diff}\n\nCURRENT FILE (with line numbers):\n${numbered}`);
  for (let attempt = 0; attempt < 2; attempt++) { // retry once on invalid JSON
    const msg = await client.messages.create({
      model: REVIEW_MODEL, max_tokens: 800, thinking: { type: 'disabled' }, system: SYSTEM,
      messages: [{ role: 'user', content: attempt ? `${user}\n\nReturn ONLY a valid JSON array.` : user }],
    });
    const text = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
    try { return parse(text).map((i) => ({ id: randomUUID(), file, line: i.line, severity: i.severity, message: i.message, spoken: false })); }
    catch (e) { console.warn('[review] invalid reply, attempt', attempt + 1, (e as Error).message.slice(0, 100)); }
  }
  return [];
}
