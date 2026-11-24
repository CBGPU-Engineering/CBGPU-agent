import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const runtimeModules = [
  'config.js', 'setup-autostart.js', 'setup-node.js', 'setup-page.js', 'setup-process.js',
  'setup-profiles.js', 'setup-runtime.js', 'setup-server.js',
];

export async function saveSetupFile(folder: string, file: string, value: string | Uint8Array) {
  const temporary = path.join(folder, '.' + file + '.' + randomBytes(8).toString('hex'));
  await writeFile(temporary, value, { flag: 'wx', mode: 0o600 });
  try { await rename(temporary, path.join(folder, file)); }
  finally { await unlink(temporary).catch(() => {}); }
}

function xml(value: string) {
  const escaped: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  return value.replace(/[&<>"']/g, char => escaped[char]);
}

function desktopArgument(value: string) {
  // Exec quoting has two decoding passes: desktop entry strings, then quoted arguments.
  return '"' + value.replace(/[%\\`"$]/g, char => {
    if (char === '%') return '%%';
    if (char === '\\') return '\\\\\\\\';
    return '\\\\' + char;
  }) + '"';
}

const commandArgument = (value: string) => '"' + value.replaceAll('%', '%%') + '"';

export function startupEntry(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv, program: string, script: string) {
  if ([program, script].some(value => /[\x00-\x1f]/.test(value))) throw new Error('설치 폴더의 이름을 확인해 주세요.');
  if (platform === 'linux') {
    const config = env.XDG_CONFIG_HOME && path.posix.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.posix.join(home, '.config');
    return { file: path.posix.join(config, 'autostart', 'cbgpu-agent.desktop'), content:
      '[Desktop Entry]\nType=Application\nName=CBGPU Agent\nTerminal=false\nExec=' +
      desktopArgument(program) + ' ' + desktopArgument(script) + ' --autostart\n' };
  }
  if (platform === 'darwin') {
    return { file: path.posix.join(home, 'Library', 'LaunchAgents', 'com.cbgpu.agent.plist'), content:
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
      '<plist version="1.0"><dict><key>Label</key><string>com.cbgpu.agent</string>' +
      '<key>ProgramArguments</key><array><string>' + xml(program) + '</string><string>' + xml(script) +
      '</string><string>--autostart</string></array><key>RunAtLoad</key><true/></dict></plist>\n' };
  }
  if (platform === 'win32' && ![program, script].some(value => value.includes('"'))) {
    const appData = env.APPDATA || path.win32.join(home, 'AppData', 'Roaming');
    return { file: path.win32.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'CBGPU Agent.cmd'),
      content: '@echo off\r\nsetlocal DisableDelayedExpansion\r\nstart "" /min ' +
        commandArgument(program) + ' ' + commandArgument(script) + ' --autostart\r\n' };
  }
  throw new Error('이 환경에서는 자동 시작을 설정할 수 없어요.');
}

export async function configureAutostart(root: string, enabled: boolean) {
  let script = path.join(root, 'setup-process.js');
  if (enabled) {
    const modules = await Promise.all(runtimeModules.map(file => readFile(new URL('./' + file, import.meta.url))));
    const version = createHash('sha256');
    for (const content of modules) version.update(content);
    const folder = path.join(root, 'startup-runtime', version.digest('hex').slice(0, 20));
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await Promise.all(runtimeModules.map((file, index) => saveSetupFile(folder, file, modules[index])));
    await saveSetupFile(folder, 'package.json', '{"type":"module","private":true}\n');
    script = path.join(folder, 'setup-process.js');
  }
  const entry = startupEntry(process.platform, os.homedir(), process.env, process.execPath, script);
  if (enabled) {
    await mkdir(path.dirname(entry.file), { recursive: true, mode: 0o700 });
    const file = await lstat(entry.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (file && !file.isFile()) throw new Error('기존 자동 시작 항목을 확인해 주세요.');
    await saveSetupFile(path.dirname(entry.file), path.basename(entry.file), entry.content);
  } else {
    await unlink(entry.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
