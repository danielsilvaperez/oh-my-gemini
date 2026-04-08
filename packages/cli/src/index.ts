import { Command } from 'commander';
import { join } from 'node:path';
import {
  GeminiRunner,
  OmgContext,
  renderHud,
  resolveOmgPaths,
  runDeepInterview,
  runDoctor,
  runExplore,
  runPlan,
  runRalph,
  runSetup,
  runSparkShell,
  runTaskPrompt,
} from './runtime-helpers.js';
import { isNonTrivialTask, selectMode } from '../../core/src/modes.js';
import { renderTeamStatus, resumeTeam, runTeamWorker, shutdownTeam, startTeam } from '../../core/src/team.js';
import { appendJsonl, writeText } from '../../core/src/utils/fs.js';
import { shellQuote } from '../../core/src/utils/process.js';

function printChecks(checks: Array<{ name: string; ok: boolean; detail: string; severity?: string }>) {
  for (const check of checks) {
    const prefix = check.ok ? '✅' : check.severity === 'warning' ? '⚠️' : '❌';
    console.log(`${prefix} ${check.name}: ${check.detail}`);
  }
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = new Command();
  program
    .name('omg')
    .description('OMG — workflow/runtime layer for Gemini CLI')
    .option('--smart', 'run in smart mode')
    .option('--madmax', 'run in madmax mode')
    .option('--high', 'run in high mode (ralph loop)')
    .option('--tmux', 'launch in detached tmux session')
    .argument('[task...]')
    .action(async (taskArgs: string[], options: { smart?: boolean; madmax?: boolean; high?: boolean; tmux?: boolean }) => {
      const paths = resolveOmgPaths(process.cwd());
      const context = new OmgContext(paths);
      await context.ensureLayout();
      const { mode, tmux } = selectMode(options);
      const task = taskArgs.join(' ').trim();
      if (tmux) {
        await launchTmux(paths, mode, task);
        return;
      }
      if (!task) {
        await context.startSession({
          sessionId: `omg-${Date.now()}`,
          mode,
          startedAt: new Date().toISOString(),
          cwd: paths.projectRoot,
          origin: 'interactive',
        });
        const runner = new GeminiRunner(paths);
        const exitCode = await runner.runInteractive(mode);
        process.exitCode = exitCode;
        return;
      }
      if (mode === 'high') {
        const result = await runRalph(paths, task);
        console.log(`Ralph finished with status: ${result.status}`);
        console.log(`State: ${join(paths.projectOmgDir, 'artifacts', 'ralph-state.json')}`);
        return;
      }
      const planSummary = isNonTrivialTask(task) ? (await runPlan(paths, task, mode)).plan.summary : undefined;
      const output = await runTaskPrompt(paths, mode, task, planSummary);
      console.log(output);
    });

  program.command('setup').description('Initialize OMG global/project state and link the extension').action(async () => {
    const paths = resolveOmgPaths(process.cwd());
    printChecks(await runSetup(paths));
  });

  program.command('doctor').description('Verify OMG runtime dependencies and state').action(async () => {
    const paths = resolveOmgPaths(process.cwd());
    printChecks(await runDoctor(paths));
  });

  program.command('deep-interview').description('Generate a clarification brief for a topic')
    .argument('<topic...>')
    .option('--non-interactive', 'skip the Socratic interview loop and synthesize directly')
    .option('--rounds <n>', 'maximum interview rounds', '5')
    .action(async (topicArgs: string[], options: { nonInteractive?: boolean; rounds: string }) => {
      const paths = resolveOmgPaths(process.cwd());
      const result = await runDeepInterview(paths, topicArgs.join(' '), 'smart', {
        interactive: !options.nonInteractive,
        maxRounds: Number(options.rounds || '5'),
      });
      console.log(`Deep interview written to:`);
      console.log(`- ${result.markdownPath}`);
      console.log(`- ${result.jsonPath}`);
      console.log(`- ${result.transcriptPath}`);
    });

  program.command('plan').description('Generate an implementation plan').argument('<task...>').action(async (taskArgs: string[]) => {
    const paths = resolveOmgPaths(process.cwd());
    const result = await runPlan(paths, taskArgs.join(' '), 'smart');
    console.log(`Plan written to:`);
    console.log(`- ${result.markdownPath}`);
    console.log(`- ${result.jsonPath}`);
  });

  program.command('ralph').description('Run the persistent Ralph loop').argument('<task...>').option('--max-iterations <n>', 'max Ralph iterations', '20').action(async (taskArgs: string[], options: { maxIterations: string }) => {
    const paths = resolveOmgPaths(process.cwd());
    const result = await runRalph(paths, taskArgs.join(' '), { maxIterations: Number(options.maxIterations) });
    console.log(`Ralph finished with status: ${result.status}`);
    console.log(`State: ${join(paths.projectOmgDir, 'artifacts', 'ralph-state.json')}`);
  });

  const team = program.command('team').description('Run tmux-backed parallel workers');
  team.argument('<spec>').argument('<task...>').action(async (spec: string, taskArgs: string[]) => {
    const paths = resolveOmgPaths(process.cwd());
    const manifest = await startTeam(paths, spec, taskArgs.join(' '));
    console.log(`Team started: ${manifest.id}`);
    console.log(`tmux session: ${manifest.sessionName}`);
    console.log(`state: ${join(paths.projectOmgDir, 'team', manifest.id, 'manifest.json')}`);
  });
  team.command('status').argument('<id>').action(async (id: string) => {
    const paths = resolveOmgPaths(process.cwd());
    console.log(await renderTeamStatus(paths, id));
  });
  team.command('resume').argument('<id>').action(async (id: string) => {
    const paths = resolveOmgPaths(process.cwd());
    const status = await resumeTeam(paths, id);
    if (!status.tmuxSessionAlive) {
      console.log(`Team ${id} is not attached because tmux session ${status.manifest.sessionName} is no longer alive.`);
      console.log(await renderTeamStatus(paths, id));
    }
  });
  team.command('shutdown').argument('<id>').action(async (id: string) => {
    const paths = resolveOmgPaths(process.cwd());
    const status = await shutdownTeam(paths, id);
    console.log(`Team ${id} shutdown.`);
    console.log(await renderTeamStatus(paths, id));
  });

  program.command('explore').requiredOption('--prompt <prompt>', 'exploration prompt').action(async (options: { prompt: string }) => {
    const paths = resolveOmgPaths(process.cwd());
    console.log(await runExplore(paths, options.prompt));
  });

  program.command('sparkshell').argument('<command...>').action(async (commandArgs: string[]) => {
    const paths = resolveOmgPaths(process.cwd());
    const result = await runSparkShell(paths, commandArgs.join(' '));
    console.log(result.analysis);
    if (result.shell.trim()) {
      console.log('\n--- shell ---');
      console.log(result.shell.trim());
    }
  });

  program.command('hud').description('Watch basic OMG session state').option('--watch', 'watch continuously').action(async (options: { watch?: boolean }) => {
    const paths = resolveOmgPaths(process.cwd());
    if (!options.watch) {
      console.log(await renderHud(paths));
      return;
    }
    // eslint-disable-next-line no-constant-condition
    while (true) {
      console.clear();
      console.log(await renderHud(paths));
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  });

  const internal = program.command('internal').description('Internal OMG commands');
  internal.command('team-worker').argument('<configPath>').action(async (configPath: string) => {
    const paths = resolveOmgPaths(process.cwd());
    await runTeamWorker(paths, configPath);
  });

  try {
    await program.parseAsync(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`OMG error: ${message}`);
    process.exitCode = 1;
  }
}

async function launchTmux(paths: ReturnType<typeof resolveOmgPaths>, mode: 'smart' | 'madmax' | 'high', task: string): Promise<void> {
  const scriptPath = join(paths.projectOmgDir, 'artifacts', `tmux-launch-${Date.now()}.sh`);
  const entry = shellQuote(paths.cliEntrypoint);
  const safeProjectRoot = shellQuote(paths.projectRoot);
  const modeFlag = mode === 'madmax' ? '--madmax ' : '';
  const script = task
    ? `#!/usr/bin/env bash\nset -euo pipefail\ncd -- ${safeProjectRoot}\nexec node ${entry} ${mode === 'high' ? 'ralph ' : modeFlag}${shellQuote(task)}\n`
    : `#!/usr/bin/env bash\nset -euo pipefail\ncd -- ${safeProjectRoot}\nexec env OMG_MODE=${shellQuote(mode)} OMG_HOME=${shellQuote(paths.globalHomeDir)} OMG_PROJECT_DIR=${safeProjectRoot} GEMINI_PROJECT_DIR=${safeProjectRoot} gemini\n`;
  await writeText(scriptPath, script);
  await appendJsonl(join(paths.projectOmgDir, 'logs', 'tmux.jsonl'), { at: new Date().toISOString(), mode, task, scriptPath });
  await runTaskTmux(scriptPath, `omg-${mode}-${Date.now()}`);
}

async function runTaskTmux(scriptPath: string, sessionName: string): Promise<void> {
  const { chmod } = await import('node:fs/promises');
  const { runCommand } = await import('../../core/src/utils/process.js');
  await chmod(scriptPath, 0o755);
  const result = await runCommand('tmux', ['new-session', '-d', '-s', sessionName, scriptPath]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to create tmux session');
  }
  console.log(`tmux session started: ${sessionName}`);
  console.log(`attach with: tmux attach -t ${sessionName}`);
}
