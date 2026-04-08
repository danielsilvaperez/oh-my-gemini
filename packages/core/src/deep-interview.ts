import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as terminalOutput } from 'node:process';
import { z } from 'zod';
import type { DeepInterviewSpec, OmgMode, OmgPaths } from './types.js';
import { OmgContext } from './context.js';
import { GeminiRunner } from './gemini-runner.js';
import { detectRepoCommands } from './repo.js';
import { slugify, writeJson, writeText } from './utils/fs.js';

const SPEC_SCHEMA = z.object({
  topic: z.string(),
  intent: z.string(),
  outcome: z.string(),
  inScope: z.array(z.string()),
  outOfScope: z.array(z.string()),
  decisionBoundaries: z.array(z.string()),
  constraints: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  openQuestions: z.array(z.string()),
  generatedAt: z.string(),
});

const QUESTION_SCHEMA = z.object({
  question: z.string(),
  rationale: z.string(),
  ambiguity: z.number().min(0).max(1),
  focus: z.string(),
  shouldStop: z.boolean(),
});

interface InterviewRound {
  round: number;
  question: string;
  rationale: string;
  focus: string;
  ambiguity: number;
  answer: string;
}

export interface DeepInterviewOptions {
  interactive?: boolean;
  maxRounds?: number;
}

function repoSummary(paths: OmgPaths, verificationCommands: string[]): string {
  return [
    `Project root: ${paths.projectRoot}`,
    `OMG state dir: ${paths.projectOmgDir}`,
    verificationCommands.length
      ? `Verification commands: ${verificationCommands.join(', ')}`
      : 'No package verification commands detected.',
  ].join('\n');
}

function transcriptForPrompt(rounds: InterviewRound[]): string {
  if (!rounds.length) {
    return 'No Q&A yet.';
  }
  return rounds
    .map((round) => [
      `Round ${round.round}`,
      `Question: ${round.question}`,
      `Answer: ${round.answer}`,
      `Focus: ${round.focus}`,
      `Ambiguity after answer: ${round.ambiguity.toFixed(2)}`,
    ].join('\n'))
    .join('\n\n');
}

function buildQuestionPrompt(topic: string, repoContext: string, rounds: InterviewRound[], maxRounds: number): string {
  return [
    'You are OMG deep-interview question generation.',
    'Ask exactly one high-leverage follow-up question that reduces ambiguity and improves implementation readiness.',
    'Prioritize intent, outcome, scope, non-goals, and decision boundaries before implementation details.',
    `Stop after ${maxRounds} rounds or sooner if the brief is ready.`,
    `Repository context:\n${repoContext}`,
    `Transcript so far:\n${transcriptForPrompt(rounds)}`,
    'Return JSON only with { question, rationale, ambiguity, focus, shouldStop }.',
    `Topic: ${topic}`,
  ].join('\n\n');
}

function buildSpecPrompt(topic: string, repoContext: string, rounds: InterviewRound[]): string {
  return [
    'You are OMG deep-interview synthesis.',
    'Turn the topic and transcript into an execution-ready specification.',
    'Make out-of-scope items and decision boundaries explicit.',
    `Repository context:\n${repoContext}`,
    `Transcript:\n${transcriptForPrompt(rounds)}`,
    'Return JSON only with { topic, intent, outcome, inScope, outOfScope, decisionBoundaries, constraints, acceptanceCriteria, openQuestions, generatedAt }.',
    `Topic: ${topic}`,
  ].join('\n\n');
}

function transcriptMarkdown(topic: string, rounds: InterviewRound[]): string {
  return [
    `# Deep Interview Transcript: ${topic}`,
    '',
    ...rounds.flatMap((round) => [
      `## Round ${round.round}`,
      '',
      `**Question:** ${round.question}`,
      '',
      `**Answer:** ${round.answer}`,
      '',
      `- Focus: ${round.focus}`,
      `- Rationale: ${round.rationale}`,
      `- Ambiguity: ${round.ambiguity.toFixed(2)}`,
      '',
    ]),
  ].join('\n');
}

async function askInteractiveQuestion(question: string): Promise<string> {
  const rl = createInterface({ input, output: terminalOutput });
  try {
    return (await rl.question(`${question}\n> `)).trim();
  } finally {
    rl.close();
  }
}

async function generateSpec(paths: OmgPaths, runner: GeminiRunner, topic: string, repoContext: string, rounds: InterviewRound[], mode: OmgMode): Promise<DeepInterviewSpec> {
  return await runner.runPromptJson(
    buildSpecPrompt(topic, repoContext, rounds),
    SPEC_SCHEMA,
    { mode },
  );
}

export async function runDeepInterview(
  paths: OmgPaths,
  topic: string,
  mode: OmgMode = 'smart',
  options: DeepInterviewOptions = {},
): Promise<{ spec: DeepInterviewSpec; markdownPath: string; jsonPath: string; transcriptPath: string }> {
  const runner = new GeminiRunner(paths);
  const commands = await detectRepoCommands(paths);
  const repoContext = repoSummary(paths, commands.defaultVerification);
  const interactive = options.interactive ?? (input.isTTY && terminalOutput.isTTY);
  const maxRounds = options.maxRounds ?? 5;
  const rounds: InterviewRound[] = [];

  if (interactive) {
    for (let round = 1; round <= maxRounds; round += 1) {
      const next = await runner.runPromptJson(
        buildQuestionPrompt(topic, repoContext, rounds, maxRounds),
        QUESTION_SCHEMA,
        { mode },
      );
      if (next.shouldStop && rounds.length >= 2) {
        break;
      }
      console.log(`\nRound ${round} | Focus: ${next.focus} | Ambiguity: ${Math.round(next.ambiguity * 100)}%`);
      const answer = await askInteractiveQuestion(next.question);
      if (!answer) {
        break;
      }
      rounds.push({
        round,
        question: next.question,
        rationale: next.rationale,
        focus: next.focus,
        ambiguity: next.ambiguity,
        answer,
      });
    }
  }

  const spec = await generateSpec(paths, runner, topic, repoContext, rounds, mode);
  const context = new OmgContext(paths);
  const slug = slugify(topic);
  const markdown = [
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
  const saved = await context.writeDeepInterview(slug, spec, markdown);
  const transcriptPath = saved.markdownPath.replace(/\.md$/, '.transcript.md');
  await writeText(transcriptPath, transcriptMarkdown(topic, rounds));
  await writeJson(saved.jsonPath.replace(/\.json$/, '.transcript.json'), { topic, rounds });
  return { spec, ...saved, transcriptPath };
}
