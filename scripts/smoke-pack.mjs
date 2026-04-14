#!/usr/bin/env node
import { chmod, mkdir, mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

async function run(command, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      encoding: 'utf8',
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message,
    };
  }
}

function assertOk(result, context) {
  if (result.code !== 0) {
    throw new Error(`${context} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}

async function main() {
  const scratch = await mkdtemp(join(tmpdir(), 'omg-pack-'));
  const homeDir = join(scratch, 'home');
  const binDir = join(scratch, 'bin');
  const installDir = join(scratch, 'install');
  const geminiName = 'oh-my-gemini';
  const fakeGeminiPath = join(binDir, 'gemini');
  const tarballs = [];

  try {
    await mkdir(homeDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await mkdir(installDir, { recursive: true });
    await writeFile(fakeGeminiPath, `#!/usr/bin/env bash
set -euo pipefail
cmd="\${1:-}"
if [[ "$cmd" == "--version" ]]; then
  echo "fake-gemini 0.0.0"
  exit 0
fi
if [[ "$cmd" != "extensions" ]]; then
  echo "unsupported gemini command: $*" >&2
  exit 1
fi
sub="\${2:-}"
case "$sub" in
  validate)
    ext_path="\${3:-}"
    [[ -f "$ext_path/gemini-extension.json" ]] || { echo "missing gemini-extension.json" >&2; exit 1; }
    echo "validated $ext_path"
    ;;
  link)
    ext_path="\${3:-}"
    ext_name="$(node -e "const fs=require('fs'); const path=process.argv[1]; process.stdout.write(JSON.parse(fs.readFileSync(path,'utf8')).name || '')" "$ext_path/gemini-extension.json")"
    [[ -n "$ext_name" ]] || { echo "missing extension name" >&2; exit 1; }
    mkdir -p "$HOME/.gemini/extensions"
    target="$HOME/.gemini/extensions/$ext_name"
    rm -rf "$target"
    ln -s "$ext_path" "$target"
    echo "linked $ext_name"
    ;;
  list)
    mkdir -p "$HOME/.gemini/extensions"
    find "$HOME/.gemini/extensions" -mindepth 1 -maxdepth 1 -printf "%f\\n" | sort
    ;;
  *)
    echo "unsupported gemini extensions subcommand: $sub" >&2
    exit 1
    ;;
esac
`, 'utf8');
    await chmod(fakeGeminiPath, 0o755);

    const packResult = await run('npm', ['pack', '--json']);
    assertOk(packResult, 'npm pack --json');
    const packInfo = JSON.parse(packResult.stdout);
    const tarballName = packInfo[0]?.filename;
    if (!tarballName) {
      throw new Error(`npm pack --json did not return a tarball name: ${packResult.stdout}`);
    }
    const tarballPath = resolve(repoRoot, tarballName);
    tarballs.push(tarballPath);

    const installResult = await run('npm', ['install', tarballPath], {
      cwd: installDir,
      env: {
        HOME: homeDir,
        PATH: `${binDir}:${process.env.PATH}`,
      },
    });
    assertOk(installResult, 'npm install tarball');

    const omgBinary = join(installDir, 'node_modules', '.bin', 'omg');
    const setupResult = await run(omgBinary, ['setup'], {
      cwd: installDir,
      env: {
        HOME: homeDir,
        PATH: `${binDir}:${process.env.PATH}`,
      },
    });
    assertOk(setupResult, 'packaged omg setup');

    const linkedExtension = join(homeDir, '.gemini', 'extensions', geminiName);
    const linkedTarget = await realpath(linkedExtension);
    const expectedMirror = join(homeDir, '.omg', 'extension');
    if (linkedTarget !== expectedMirror) {
      throw new Error(`Expected ${linkedExtension} -> ${expectedMirror}, got ${linkedTarget}`);
    }

    const doctorResult = await run(omgBinary, ['doctor'], {
      cwd: installDir,
      env: {
        HOME: homeDir,
        PATH: `${binDir}:${process.env.PATH}`,
      },
    });
    assertOk(doctorResult, 'packaged omg doctor');
  } finally {
    await Promise.all(tarballs.map(async (tarballPath) => {
      try {
        await unlink(tarballPath);
      } catch {
        // Ignore cleanup errors.
      }
    }));
    await rm(scratch, { recursive: true, force: true });
  }
}

await main();
