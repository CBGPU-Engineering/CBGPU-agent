import { spawn } from 'node:child_process';
import { access, mkdir, writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installNode, openClawNode, toolchainNpm } from './setup-node.ts';
import type { Agent, Permissions } from './setup-profiles.ts';

const windows = process.platform === 'win32';
const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
const passthrough = [pathKey, 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'PROGRAMDATA', 'APPDATA',
  'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'XDG_CACHE_HOME', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_SESSION_TYPE', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'XAUTHORITY'];

export function runtimeEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(passthrough.map(key => [key, process.env[key]]).filter(entry => entry[1]));
}

async function existing(candidates: string[]) {
  for (const candidate of candidates) {
    if (await access(candidate).then(() => true, () => false)) return candidate;
  }
  return null;
}

function directories() {
  return (process.env[pathKey] ?? '').split(path.delimiter).filter(entry => path.isAbsolute(entry));
}

function run(executable: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { env, stdio: 'ignore', windowsHide: true });
    child.once('error', () => reject(new Error('설치 프로그램을 실행하지 못했어요.')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('설치를 마치지 못했어요. 인터넷 연결과 설치 환경을 확인해 주세요.')));
  });
}

async function openClawCommand(root: string) {
  const packageRoot = path.join(root, 'runtime', 'node_modules', 'openclaw');
  try {
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.openclaw;
    if (manifest.name !== 'openclaw' || typeof bin !== 'string') return null;
    const entry = path.resolve(packageRoot, bin);
    if (!entry.startsWith(packageRoot + path.sep) || !await existing([entry])) return null;
    const program = await openClawNode(root);
    return program ? { program, prefix: [entry] } : null;
  } catch { return null; }
}

async function hermesCommand() {
  if (windows) {
    const root = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    const command = await existing([path.join(root, 'hermes', 'bin', 'hermes.exe'),
      ...directories().map(dir => path.join(dir, 'hermes.exe'))]);
    if (command) return { program: command, prefix: [] };
    const script = await existing([path.join(root, 'hermes', 'bin', 'hermes.ps1'),
      ...directories().map(dir => path.join(dir, 'hermes.ps1'))]);
    if (script) return { program: 'powershell.exe', prefix: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script] };
    const python = await existing([path.join(root, 'hermes', 'hermes-agent', '.venv', 'Scripts', 'python.exe'),
      path.join(root, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe')]);
    if (python) return { program: python, prefix: ['-m', 'hermes_cli.main'] };
    return null;
  }
  const command = await existing([...directories().map(dir => path.join(dir, 'hermes')), path.join(os.homedir(), '.local', 'bin', 'hermes')]);
  return command ? { program: command, prefix: [] } : null;
}

export function findRuntime(agent: Agent, root: string) {
  return agent === 'openclaw' ? openClawCommand(root) : hermesCommand();
}

async function npmCommand() {
  const dirs = [...directories(), path.dirname(process.execPath)];
  const candidates = dirs.flatMap(dir => [
    path.join(dir, 'node_modules/npm/bin/npm-cli.js'),
    path.join(dir, '../lib/node_modules/npm/bin/npm-cli.js'),
    path.join(dir, '../share/nodejs/npm/bin/npm-cli.js'),
  ]);
  const reported = process.env.npm_execpath;
  if (reported && path.isAbsolute(reported) && path.basename(reported) === 'npm-cli.js') candidates.unshift(reported);
  const npm = await existing(candidates);
  if (!npm) throw new Error('Node.js와 함께 npm을 설치한 뒤 다시 열어 주세요.');
  return npm;
}

export async function installRuntime(agent: Agent, root: string, permissions: Permissions = {}) {
  if (await findRuntime(agent, root)) return;
  const env = runtimeEnvironment();
  if (agent === 'openclaw') {
    const prefix = path.join(root, 'runtime');
    await mkdir(prefix, { recursive: true, mode: 0o700 });
    const node = await installNode(root, env);
    const npm = await existing([toolchainNpm(node)]) ?? await npmCommand();
    env.npm_config_cache = path.join(root, 'npm-cache');
    env[pathKey] = path.dirname(node) + path.delimiter + (env[pathKey] ?? '');
    await run(node, [npm, 'install', '--registry=https://registry.npmjs.org/',
      '--prefix', prefix, '--no-fund', '--no-audit', '--omit=dev', 'openclaw@2026.11.7'], env);
  } else {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'cbgpu-hermes-'));
    try {
      const filename = windows ? 'install.ps1' : 'install.sh';
      const target = path.join(folder, filename);
      const url = 'https://raw.githubusercontent.com/NousResearch/hermes-agent/v0.23.3/scripts/' + filename;
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('Hermes 공식 설치 파일을 내려받지 못했어요.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 256 || bytes.length > 2000000) throw new Error('Hermes 설치 파일을 확인하지 못했어요.');
      await writeFile(target, bytes, { mode: 0o600, flag: 'wx' });
      await (windows
        ? run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', target, '-NonInteractive', '-Branch', 'v0.23.3', ...(permissions.browser ? [] : ['-SkipBrowser']), '-SkipComputerUse'], env)
        : run('bash', [target, '--non-interactive', '--branch', 'v0.23.3', ...(permissions.browser ? [] : ['--skip-browser']), '--skip-computer-use'], env));
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }
  if (!await findRuntime(agent, root)) throw new Error('설치한 에이전트 실행 파일을 찾지 못했어요.');
}

export async function prepareDesktop(agent: Agent, root: string) {
  const runtime = await findRuntime(agent, root);
  if (!runtime) throw new Error('화면 제어에 필요한 에이전트를 찾지 못했어요.');
  if (agent === 'openclaw') {
    if (process.platform !== 'darwin') {
      const env = { ...runtimeEnvironment(), OPENCLAW_STATE_DIR: root };
      await run(runtime.program, [...runtime.prefix, 'doctor', '--lint', '--only', 'cua-computer/driver-artifacts'], env);
    }
    return;
  }
  const env = { ...runtimeEnvironment(), HERMES_HOME: root, HERMES_CONFIG_BACKEND: 'file' };
  await run(runtime.program, [...runtime.prefix, 'computer-use', 'install'], env);
}

export function openBrowser(url: string) {
  const [program, args] = process.platform === 'darwin' ? ['open', [url]]
    : windows ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  const child = spawn(program, args, { stdio: 'ignore', detached: true, windowsHide: true });
  child.on('error', () => {});
  child.unref();
}
