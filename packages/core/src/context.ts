import { join } from 'node:path';
import type { DeepInterviewSpec, GeneratedPlan, OmgPaths, SessionState } from './types.js';
import { appendJsonl, ensureDir, readJson, writeJson, writeText } from './utils/fs.js';

export class OmgContext {
  constructor(private readonly paths: OmgPaths) {}

  async ensureLayout(): Promise<void> {
    for (const dir of [
      this.paths.globalHomeDir,
      this.paths.globalLogsDir,
      this.paths.globalSessionsDir,
      this.paths.globalSkillsDir,
      this.paths.globalArtifactsDir,
      this.paths.projectOmgDir,
      join(this.paths.projectOmgDir, 'plans'),
      join(this.paths.projectOmgDir, 'logs'),
      join(this.paths.projectOmgDir, 'team'),
      join(this.paths.projectOmgDir, 'artifacts'),
      join(this.paths.projectOmgDir, 'skills'),
    ]) {
      await ensureDir(dir);
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
  }

  async writeDeepInterview(slug: string, spec: DeepInterviewSpec, markdown: string): Promise<{ jsonPath: string; markdownPath: string }> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = join(this.paths.projectOmgDir, 'artifacts', `${slug}-deep-interview-${stamp}`);
    const jsonPath = `${base}.json`;
    const markdownPath = `${base}.md`;
    await writeJson(jsonPath, spec);
    await writeText(markdownPath, markdown);
    await writeJson(join(this.paths.projectOmgDir, 'artifacts', 'latest-deep-interview.json'), spec);
    await writeText(join(this.paths.projectOmgDir, 'artifacts', 'latest-deep-interview.md'), markdown);
    return { jsonPath, markdownPath };
  }

  async writePlan(slug: string, plan: GeneratedPlan, markdown: string): Promise<{ jsonPath: string; markdownPath: string }> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = join(this.paths.projectOmgDir, 'plans', `${slug}-${stamp}`);
    const jsonPath = `${base}.json`;
    const markdownPath = `${base}.md`;
    await writeJson(jsonPath, plan);
    await writeText(markdownPath, markdown);
    await writeJson(join(this.paths.projectOmgDir, 'plan-current.json'), plan);
    await writeText(join(this.paths.projectOmgDir, 'plan-current.md'), markdown);
    return { jsonPath, markdownPath };
  }

  async readCurrentPlan(): Promise<GeneratedPlan | null> {
    return await readJson<GeneratedPlan | null>(join(this.paths.projectOmgDir, 'plan-current.json'), null);
  }
}
