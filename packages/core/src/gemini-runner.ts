import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z, type ZodType } from 'zod';
import type { CommandResult, OmgMode, OmgPaths } from './types.js';
import { parseGeminiJsonPayload } from './utils/json.js';
import { appendJsonl } from './utils/fs.js';
import { commandVersion, runCommand, spawnInteractive } from './utils/process.js';

const HEADLESS_SCHEMA = z.object({
  response: z.string().optional(),
  stats: z.unknown().optional(),
  error: z.unknown().optional(),
});

export interface GeminiPromptOptions {
  mode: OmgMode;
  cwd?: string;
  retries?: number;
  extraArgs?: string[];
}

export class GeminiRunner {
  constructor(private readonly paths: OmgPaths) {}

  buildEnv(mode: OmgMode, extraEnv: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...extraEnv,
      OMG_MODE: mode,
      OMG_HOME: this.paths.globalHomeDir,
      OMG_PROJECT_DIR: this.paths.projectRoot,
      GEMINI_PROJECT_DIR: this.paths.projectRoot,
    };
  }

  async checkInstalled(): Promise<CommandResult> {
    return await commandVersion('gemini');
  }

  async runInteractive(mode: OmgMode, extraArgs: string[] = [], cwd = this.paths.projectRoot): Promise<number> {
    return await spawnInteractive('gemini', extraArgs, {
      cwd,
      env: this.buildEnv(mode),
    });
  }

  async runPrompt(prompt: string, options: GeminiPromptOptions): Promise<CommandResult> {
    const retries = options.retries ?? 0;
    let attempt = 0;
    while (true) {
      const result = await runCommand('gemini', ['-p', prompt, ...(options.extraArgs ?? [])], {
        cwd: options.cwd ?? this.paths.projectRoot,
        env: this.buildEnv(options.mode),
      });
      await appendJsonl(join(this.paths.projectOmgDir, 'logs', 'gemini.jsonl'), {
        at: new Date().toISOString(),
        mode: options.mode,
        command: result.command,
        code: result.code,
        stdoutPreview: result.stdout.slice(0, 400),
        stderrPreview: result.stderr.slice(0, 400),
      });
      if (result.code === 0 || attempt >= retries) {
        return result;
      }
      attempt += 1;
    }
  }

  async runPromptJson<T>(prompt: string, schema: ZodType<T>, options: GeminiPromptOptions): Promise<T> {
    const result = await this.runPrompt(prompt, {
      ...options,
      extraArgs: ['--output-format', 'json', ...(options.extraArgs ?? [])],
    });
    if (result.code !== 0) {
      throw new Error(`Gemini prompt failed (${result.code}): ${result.stderr || result.stdout}`);
    }
    const outer = HEADLESS_SCHEMA.parse(JSON.parse(result.stdout));
    if (!outer.response) {
      throw new Error('Gemini returned no response content');
    }
    return schema.parse(parseGeminiJsonPayload<T>(result.stdout));
  }

  extensionManifestExists(): boolean {
    return existsSync(join(this.paths.extensionRoot, 'gemini-extension.json'));
  }
}
