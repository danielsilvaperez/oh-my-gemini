export type OmgMode = 'smart' | 'madmax' | 'high';
export type OmgRuntimeMode = OmgMode | 'deep-interview' | 'plan' | 'ralph' | 'team' | 'setup' | 'doctor';

export interface OmgPaths {
  workspaceRoot: string;
  projectRoot: string;
  projectOmgDir: string;
  projectGeminiDir: string;
  projectContextDir: string;
  projectStateDir: string;
  projectPlansDir: string;
  projectLogsDir: string;
  projectTeamDir: string;
  projectArtifactsDir: string;
  projectSkillsDir: string;
  projectSessionsDir: string;
  projectCurrentPlanJsonPath: string;
  projectCurrentPlanMarkdownPath: string;
  projectCurrentTestSpecJsonPath: string;
  projectCurrentTestSpecMarkdownPath: string;
  projectMemoryPath: string;
  projectNotepadPath: string;
  globalHomeDir: string;
  globalLogsDir: string;
  globalSessionsDir: string;
  globalSkillsDir: string;
  globalArtifactsDir: string;
  globalStateDir: string;
  globalConfigPath: string;
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

export interface TestSuiteSpec {
  id: string;
  title: string;
  objective: string;
  commands: string[];
  checks: string[];
}

export interface GeneratedTestSpec {
  summary: string;
  suites: TestSuiteSpec[];
  regressionRisks: string[];
  generatedAt: string;
}

export interface GeneratedPlan {
  task: string;
  summary: string;
  assumptions: string[];
  successCriteria: string[];
  steps: PlanStep[];
  risks: string[];
  verificationCommands: string[];
  testSpec: GeneratedTestSpec;
  generatedAt: string;
}

export interface ProjectMemory {
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  projectRoot: string;
  techStack: string[];
  conventions: string[];
  directives: string[];
  notes: Array<{
    category: string;
    content: string;
    createdAt: string;
  }>;
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
  testSpecPath: string;
  iteration: number;
  maxIterations: number;
  stepAttempts: Record<string, number>;
  status: 'running' | 'complete' | 'blocked' | 'failed';
  currentPhase: 'planning' | 'executing' | 'verifying' | 'complete' | 'blocked';
  startedAt: string;
  updatedAt: string;
  history: RalphIterationRecord[];
}

export interface RalphRuntimeContext {
  sessionId: string;
  task: string;
  statePath: string;
}

export interface ModeRuntimeState {
  mode: OmgRuntimeMode;
  active: boolean;
  currentPhase: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  task?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface TraceEvent {
  at: string;
  kind: string;
  mode?: OmgRuntimeMode;
  sessionId?: string;
  task?: string;
  detail?: Record<string, unknown>;
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

export interface TeamMailboxMessage {
  at: string;
  teamId: string;
  workerId?: string;
  lane?: string;
  kind: 'team-started' | 'worker-started' | 'worker-finished' | 'worker-failed' | 'team-shutdown' | 'handoff';
  message: string;
}

export interface TeamManifest {
  id: string;
  sessionName: string;
  task: string;
  role: string;
  count: number;
  cwd: string;
  startedAt: string;
  parentTeamId?: string;
  fixIteration?: number;
  currentPhase: 'planning' | 'executing' | 'verifying' | 'fixing' | 'complete' | 'stopped';
  status: 'starting' | 'running' | 'completed' | 'failed' | 'stopped';
  workers: TeamWorkerStatus[];
}

export interface TeamStatusReport {
  manifest: TeamManifest;
  tmuxSessionAlive: boolean;
}

export interface TeamControllerDecision {
  phase: TeamManifest['currentPhase'];
  status: TeamManifest['status'];
  nextAction: string;
  shouldAttach: boolean;
}

export interface TeamReconcileResult {
  report: TeamStatusReport;
  decision: TeamControllerDecision;
}

export interface TeamAutoFixResult {
  previous: TeamReconcileResult;
  fixManifest: TeamManifest | null;
  message: string;
}

export interface TeamLoopIteration {
  teamId: string;
  phase: TeamManifest['currentPhase'];
  status: TeamManifest['status'];
  nextAction: string;
  spawnedFixTeamId?: string;
}

export interface TeamLoopResult {
  finalTeamId: string;
  status: 'complete' | 'waiting' | 'stopped';
  iterations: TeamLoopIteration[];
  message: string;
}
