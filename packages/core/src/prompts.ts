import type { DeepInterviewSpec, GeneratedPlan, OmgMode, PlanStep, RepoCommandSet, TeamWorkerAssignment } from './types.js';

function jsonOnly(schema: string): string {
  return `Return JSON only. Do not wrap it in markdown. Schema: ${schema}`;
}

export function buildTaskPrompt(mode: OmgMode, task: string, planSummary?: string): string {
  return [
    mode === 'high'
      ? 'You are operating in OMG HIGH mode.'
      : mode === 'madmax'
        ? 'You are operating in OMG MADMAX mode.'
        : 'You are operating in OMG SMART mode.',
    planSummary ? `Approved plan summary:\n${planSummary}` : '',
    'Complete the user task directly. Respect the current repository and use tools when needed.',
    `Task: ${task}`,
  ].filter(Boolean).join('\n\n');
}

export function buildDeepInterviewPrompt(topic: string, repoSummary: string): string {
  return [
    'You are OMG deep-interview.',
    'Turn the user topic into an execution-ready specification.',
    'Use the repository summary as brownfield grounding when relevant.',
    repoSummary ? `Repository context:\n${repoSummary}` : '',
    jsonOnly(`{"topic":string,"intent":string,"outcome":string,"inScope":string[],"outOfScope":string[],"decisionBoundaries":string[],"constraints":string[],"acceptanceCriteria":string[],"openQuestions":string[],"generatedAt":string}`),
    `Topic: ${topic}`,
  ].filter(Boolean).join('\n\n');
}

export function buildPlanPrompt(task: string, context: string, repoCommands: RepoCommandSet): string {
  const verificationHints = repoCommands.defaultVerification.length
    ? `Prefer these repository verification commands when relevant: ${repoCommands.defaultVerification.join(', ')}`
    : 'If no repository verification commands are obvious, return step-specific validation suggestions.';

  return [
    'You are OMG plan mode.',
    'Create an implementation plan that is executable, bounded, and verification-heavy.',
    context ? `Additional context:\n${context}` : '',
    verificationHints,
    jsonOnly(`{"task":string,"summary":string,"assumptions":string[],"successCriteria":string[],"steps":[{"id":string,"title":string,"description":string,"acceptanceCriteria":string[],"verificationCommands":string[]}],"risks":string[],"verificationCommands":string[],"generatedAt":string}`),
    `Task: ${task}`,
  ].filter(Boolean).join('\n\n');
}

export function buildRalphExecutePrompt(task: string, plan: GeneratedPlan, step: PlanStep, repoCommands: RepoCommandSet, iteration: number): string {
  const planContext = plan.steps
    .map((item) => `- ${item.id}: ${item.title} [${item.status ?? 'pending'}]`)
    .join('\n');
  return [
    'You are OMG Ralph execution.',
    'Execute exactly one bounded step from the approved plan.',
    'Do the work in the repository if changes are required, then report structured execution status.',
    `Iteration: ${iteration}`,
    `Task: ${task}`,
    `Plan summary: ${plan.summary}`,
    `Plan state:\n${planContext}`,
    `Current step:\n- id: ${step.id}\n- title: ${step.title}\n- description: ${step.description}`,
    step.acceptanceCriteria.length ? `Acceptance criteria:\n- ${step.acceptanceCriteria.join('\n- ')}` : '',
    step.verificationCommands.length ? `Step verification commands: ${step.verificationCommands.join(', ')}` : '',
    repoCommands.defaultVerification.length ? `Repository verification commands available: ${repoCommands.defaultVerification.join(', ')}` : '',
    jsonOnly(`{"summary":string,"changedFiles":string[],"decision":"ready_for_verification"|"blocked","blocker":string|null,"notes":string[]}`),
  ].filter(Boolean).join('\n\n');
}

export function buildTeamWorkerPrompt(task: string, assignment: TeamWorkerAssignment, sharedStatePath: string): string {
  return [
    `You are OMG team worker ${assignment.index + 1}.`,
    `Role: ${assignment.role}`,
    `Lane: ${assignment.lane}`,
    `Objective: ${assignment.objective}`,
    assignment.writable
      ? 'You may make repository changes if needed, but stay within your assignment.'
      : 'Prefer read-only work, validation, and reporting unless a small change is essential to unblock your lane.',
    `Primary task: ${task}`,
    `Shared state root: ${sharedStatePath}`,
    'When you finish, return JSON only with keys summary, changedFiles, risks, verification, nextSteps.',
  ].join('\n\n');
}

export function planToMarkdown(plan: GeneratedPlan): string {
  const lines: string[] = [
    `# Plan: ${plan.task}`,
    '',
    '## Requirements Summary',
    '',
    plan.summary,
    '',
    '## Acceptance Criteria',
    '',
    ...plan.successCriteria.map((item) => `- ${item}`),
    '',
    '## Implementation Steps',
    '',
  ];
  for (const step of plan.steps) {
    lines.push(`### ${step.id} — ${step.title}`);
    lines.push('');
    lines.push(step.description);
    lines.push('');
    if (step.acceptanceCriteria.length) {
      lines.push('**Done when**');
      lines.push('');
      lines.push(...step.acceptanceCriteria.map((item) => `- ${item}`));
      lines.push('');
    }
    if (step.verificationCommands.length) {
      lines.push('**Verification commands**');
      lines.push('');
      lines.push(...step.verificationCommands.map((item) => `- \`${item}\``));
      lines.push('');
    }
  }
  lines.push('## Risks and Mitigations');
  lines.push('');
  lines.push(...plan.risks.map((item) => `- ${item}`));
  lines.push('');
  lines.push('## Verification Steps');
  lines.push('');
  lines.push(...plan.verificationCommands.map((item) => `- \`${item}\``));
  lines.push('');
  return lines.join('\n');
}

export function deepInterviewToMarkdown(spec: DeepInterviewSpec): string {
  return [
    `# Deep Interview: ${spec.topic}`,
    '',
    '## Intent',
    '',
    spec.intent,
    '',
    '## Desired Outcome',
    '',
    spec.outcome,
    '',
    '## In Scope',
    '',
    ...spec.inScope.map((item) => `- ${item}`),
    '',
    '## Out of Scope',
    '',
    ...spec.outOfScope.map((item) => `- ${item}`),
    '',
    '## Decision Boundaries',
    '',
    ...spec.decisionBoundaries.map((item) => `- ${item}`),
    '',
    '## Constraints',
    '',
    ...spec.constraints.map((item) => `- ${item}`),
    '',
    '## Acceptance Criteria',
    '',
    ...spec.acceptanceCriteria.map((item) => `- ${item}`),
    '',
    '## Open Questions',
    '',
    ...spec.openQuestions.map((item) => `- ${item}`),
    '',
  ].join('\n');
}
