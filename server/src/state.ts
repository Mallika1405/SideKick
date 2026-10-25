import type { Toggles, Verbosity } from '@sidekick/shared';
export const state = {
  toggles: { narrate: true, listen: true, review: true, whiteboard: true } as Toggles,
  verbosity: 'terse' as Verbosity,
  lastPrompt: '',
  lastNarrations: [] as string[],
  lastClaudeHookAt: new Map<string, number>(),
};
