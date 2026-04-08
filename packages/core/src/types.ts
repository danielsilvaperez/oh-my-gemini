export type OmgMode = 'smart' | 'madmax' | 'high';

export interface OmgPaths {
  workspaceRoot: string;
  projectRoot: string;
  projectOmgDir: string;
  projectGeminiDir: string;
  globalHomeDir: string;
  globalLogsDir: string;
  globalSessionsDir: string;
  globalSkillsDir: string;
  globalArtifactsDir: string;
  extensionRoot: string;
  cliEntrypoint: string;
}

export interface SessionState {
  sessionId: string;
  mode: OmgMode;
  startedAt: string;
  cwd: string;
  origin: 'cli' | 'setup' | 'doctor' | 'deep-interview' | 'plan' | 'ralph' | 'team' | 'interactive';
  task?: string;
  tmux?: boolean;
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  verificationCommands: string[];
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';
  notes?: string[];
}

export interface GeneratedPlan {
  task: string;
  summary: string;
  assumptions: string[];
  successCriteria: string[];
  steps: PlanStep[];
  risks: string[];
  verificationCommands: string[];
  generatedAt: string;
}

export interface DeepInterviewSpec {
  topic: string;
  intent: string;
  outcome: string;
  inScope: string[];
  outOfScope: string[];
  decisionBoundaries: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  openQuestions: string[];
  generatedAt: string;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  severity?: 'info' | 'warning' | 'error';
}

export interface CommandResult {
  command: string;
  code: number;
  stdout: string;
  stderr: string;
}

export interface RepoCommandSet {
  packageManager: 'npm' | 'pnpm' | 'yarn';
  build?: string;
  test?: string;
  lint?: string;
  typecheck?: string;
  defaultVerification: string[];
}

export interface RalphIterationRecord {
  iteration: number;
  stepId: string;
  stepTitle: string;
  attempt: number;
  executionSummary: string;
  changedFiles: string[];
  verification: CommandResult[];
  decision: 'continue' | 'retry' | 'blocked' | 'done';
  createdAt: string;
}

export interface RalphState {
  task: string;
  planPath: string;
  planJsonPath: string;
  iteration: number;
  maxIterations: number;
  stepAttempts: Record<string, number>;
  status: 'running' | 'complete' | 'blocked' | 'failed';
  startedAt: string;
  updatedAt: string;
  history: RalphIterationRecord[];
}

export interface TeamWorkerAssignment {
  id: string;
  index: number;
  role: string;
  lane: string;
  objective: string;
  writable: boolean;
}

export interface TeamWorkerStatus extends TeamWorkerAssignment {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
  tmuxPane?: string;
  startedAt?: string;
  finishedAt?: string;
  lastUpdateAt?: string;
  resultPath?: string;
  logPath: string;
  workDir: string;
  summary?: string;
  verificationSummary?: string[];
  risks?: string[];
}

export interface TeamManifest {
  id: string;
  sessionName: string;
  task: string;
  role: string;
  count: number;
  cwd: string;
  startedAt: string;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'stopped';
  workers: TeamWorkerStatus[];
}

export interface TeamStatusReport {
  manifest: TeamManifest;
  tmuxSessionAlive: boolean;
}
