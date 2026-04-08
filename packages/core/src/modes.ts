import type { OmgMode } from './types.js';

export interface ModeSelection {
  mode: OmgMode;
  tmux: boolean;
}

export function selectMode(options: { smart?: boolean; madmax?: boolean; high?: boolean; tmux?: boolean }): ModeSelection {
  const mode: OmgMode = options.high ? 'high' : options.madmax ? 'madmax' : 'smart';
  return { mode, tmux: Boolean(options.tmux) };
}

export function modeInstructions(mode: OmgMode): string {
  if (mode === 'high') {
    return [
      'OMG mode: HIGH.',
      'Plan first.',
      'Execute one bounded step at a time.',
      'Verify each step with explicit evidence.',
      'Continue automatically until complete, blocked, or max-iteration threshold.',
      'Minimize interruptions and ask only when truly blocked.',
    ].join('\n');
  }
  if (mode === 'madmax') {
    return [
      'OMG mode: MADMAX.',
      'Create a plan before acting on non-trivial work.',
      'Execute autonomously with minimal interruptions.',
      'Retry recoverable failures.',
      'Do not stop early.',
    ].join('\n');
  }
  return [
    'OMG mode: SMART.',
    'Use lightweight planning for non-trivial work.',
    'Ask clarifying questions only when materially necessary.',
    'Verify important changes before claiming completion.',
  ].join('\n');
}

export function isNonTrivialTask(task: string): boolean {
  const words = task.trim().split(/\s+/).filter(Boolean);
  return words.length > 8 || /\b(and|then|with|while|across|workflow|runtime|implement|build|refactor)\b/i.test(task);
}
