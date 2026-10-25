import { createPatch, structuredPatch } from 'diff';

export function lineRange(before: string, after: string): { startLine: number; endLine: number } {
  const hunks = structuredPatch('a', 'a', before, after, '', '', { context: 0 }).hunks;
  if (!hunks.length) return { startLine: 1, endLine: 1 };
  const first = hunks[0], last = hunks[hunks.length - 1];
  return { startLine: Math.max(1, first.newStart), endLine: Math.max(first.newStart, last.newStart + Math.max(last.newLines, 1) - 1) };
}
export const unified = (file: string, before: string, after: string) => createPatch(file, before, after, '', '', { context: 3 });
export function contextAround(text: string, start: number, end: number, pad = 20): string {
  const lines = text.split('\n');
  const a = Math.max(0, start - 1 - pad), b = Math.min(lines.length, end + pad);
  return lines.slice(a, b).map((l, i) => `${a + i + 1}: ${l}`).join('\n');
}
