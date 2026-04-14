import { join } from 'node:path';
import type { DeepInterviewSpec, GeneratedPlan, OmgPaths, ProjectMemory, SessionState } from './types.js';
import { updateModeState } from './state.js';
import { appendTraceEvent } from './trace.js';
import { appendJsonl, ensureDir, pathExists, readJson, writeJson, writeText } from './utils/fs.js';

function defaultProjectMemory(paths: OmgPaths): ProjectMemory {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    projectRoot: paths.projectRoot,
    techStack: [],
    conventions: [],
    directives: [],
    notes: [],
  };
}

function defaultNotepad(): string {
  return [
    '# OMG Notepad',
    '',
    '## Priority Context',
    '',
    '_Add the most important session context here._',
    '',
    '## Working Notes',
    '',
    '_Use for ephemeral implementation notes._',
    '',
    '## Manual Notes',
    '',
    '_Use for durable hand-written notes._',
    '',
  ].join('\n');
}

export class OmgContext {
  constructor(private readonly paths: OmgPaths) {}

  async ensureLayout(): Promise<void> {
    for (const dir of [
      this.paths.globalHomeDir,
      this.paths.globalLogsDir,
      this.paths.globalSessionsDir,
      this.paths.globalSkillsDir,
      this.paths.globalArtifactsDir,
      this.paths.globalStateDir,
      this.paths.projectOmgDir,
      this.paths.projectContextDir,
      this.paths.projectStateDir,
      this.paths.projectPlansDir,
      this.paths.projectLogsDir,
      this.paths.projectTeamDir,
      this.paths.projectArtifactsDir,
      this.paths.projectSkillsDir,
      this.paths.projectSessionsDir,
    ]) {
      await ensureDir(dir);
    }
    if (!(await pathExists(this.paths.projectMemoryPath))) {
      await writeJson(this.paths.projectMemoryPath, defaultProjectMemory(this.paths));
    }
    if (!(await pathExists(this.paths.projectNotepadPath))) {
      await writeText(this.paths.projectNotepadPath, defaultNotepad());
    }
  }

  async startSession(session: SessionState): Promise<void> {
    await this.ensureLayout();
    await writeJson(join(this.paths.projectOmgDir, 'session.json'), session);
    await writeJson(join(this.paths.projectOmgDir, 'mode.json'), {
      mode: session.mode,
      sessionId: session.sessionId,
      task: session.task ?? null,
      tmux: session.tmux ?? false,
      updatedAt: new Date().toISOString(),
    });
    await appendJsonl(join(this.paths.globalSessionsDir, 'sessions.jsonl'), session);
    await appendJsonl(join(this.paths.projectSessionsDir, 'history.jsonl'), session);
    await updateModeState(this.paths, session.origin === 'interactive' || session.origin === 'cli' ? session.mode : session.origin, {
      active: true,
      currentPhase: 'started',
      startedAt: session.startedAt,
      updatedAt: new Date().toISOString(),
      task: session.task,
      sessionId: session.sessionId,
      metadata: { cwd: session.cwd, tmux: session.tmux ?? false },
    });
    await appendTraceEvent(this.paths, {
      at: new Date().toISOString(),
      kind: 'session-start',
      mode: session.origin === 'interactive' || session.origin === 'cli' ? session.mode : session.origin,
      sessionId: session.sessionId,
      task: session.task,
      detail: { cwd: session.cwd, origin: session.origin, tmux: session.tmux ?? false },
    });
  }

  async writeDeepInterview(slug: string, spec: DeepInterviewSpec, markdown: string): Promise<{ jsonPath: string; markdownPath: string }> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = join(this.paths.projectArtifactsDir, `${slug}-deep-interview-${stamp}`);
    const jsonPath = `${base}.json`;
    const markdownPath = `${base}.md`;
    await writeJson(jsonPath, spec);
    await writeText(markdownPath, markdown);
    await writeJson(join(this.paths.projectArtifactsDir, 'latest-deep-interview.json'), spec);
    await writeText(join(this.paths.projectArtifactsDir, 'latest-deep-interview.md'), markdown);
    return { jsonPath, markdownPath };
  }

  async writePlan(slug: string, plan: GeneratedPlan, markdown: string): Promise<{ jsonPath: string; markdownPath: string }> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = join(this.paths.projectPlansDir, `${slug}-${stamp}`);
    const jsonPath = `${base}.json`;
    const markdownPath = `${base}.md`;
    await writeJson(jsonPath, plan);
    await writeText(markdownPath, markdown);
    await writeJson(this.paths.projectCurrentPlanJsonPath, plan);
    await writeText(this.paths.projectCurrentPlanMarkdownPath, markdown);
    return { jsonPath, markdownPath };
  }

  async writeTestSpec(slug: string, plan: GeneratedPlan, markdown: string): Promise<{ jsonPath: string; markdownPath: string }> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = join(this.paths.projectPlansDir, `${slug}-test-spec-${stamp}`);
    const jsonPath = `${base}.json`;
    const markdownPath = `${base}.md`;
    await writeJson(jsonPath, plan.testSpec);
    await writeText(markdownPath, markdown);
    await writeJson(this.paths.projectCurrentTestSpecJsonPath, plan.testSpec);
    await writeText(this.paths.projectCurrentTestSpecMarkdownPath, markdown);
    return { jsonPath, markdownPath };
  }

  async readCurrentPlan(): Promise<GeneratedPlan | null> {
    return await readJson<GeneratedPlan | null>(this.paths.projectCurrentPlanJsonPath, null);
  }
}
