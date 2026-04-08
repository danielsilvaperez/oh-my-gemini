import { join } from 'node:path';
import type { OmgPaths, RepoCommandSet } from './types.js';
import { pathExists, readJson } from './utils/fs.js';

interface PackageJsonShape {
  scripts?: Record<string, string>;
}

export async function detectRepoCommands(paths: OmgPaths): Promise<RepoCommandSet> {
  const packageManager: RepoCommandSet['packageManager'] = (await pathExists(join(paths.projectRoot, 'pnpm-lock.yaml')))
    ? 'pnpm'
    : (await pathExists(join(paths.projectRoot, 'yarn.lock')))
      ? 'yarn'
      : 'npm';

  const packageJson = await readJson<PackageJsonShape>(join(paths.projectRoot, 'package.json'), {});
  const scripts = packageJson.scripts ?? {};
  const prefix = packageManager === 'npm' ? 'npm run' : packageManager === 'pnpm' ? 'pnpm' : 'yarn';
  const build = scripts.build ? `${prefix} build` : undefined;
  const test = scripts.test ? `${prefix} test` : undefined;
  const lint = scripts.lint ? `${prefix} lint` : undefined;
  const typecheck = scripts.typecheck ? `${prefix} typecheck` : undefined;
  const defaultVerification = [lint, typecheck, test, build].filter((value): value is string => Boolean(value));

  return {
    packageManager,
    build,
    test,
    lint,
    typecheck,
    defaultVerification,
  };
}
