import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { runtimeModules } from '../lib/setup-autostart.ts';
import { setupLogos } from '../lib/setup-assets.ts';

const release = path.resolve('release-setup');
const stage = await mkdtemp(path.join(os.tmpdir(), 'cbgpu-setup-build-'));
const base = 'CBGPU-Agent-Setup';
const platform = process.platform;
const arch = process.arch;
const appImages = {
  x64: { label: 'x86_64', tool: 'e8c1169c4af66c3184d7ee110713d4be04befe671fa358e2c1591ee840553b03', runtime: '617aa77314d57c8b8e4fae9c3f0b35af7b30d5529cb69e98f64f92510ed98a46' },
  arm64: { label: 'aarch64', tool: 'd6a061996de690434996c2a523eafedd0a23780aaf02d69ce364537e71607e94', runtime: '9a72a744d221576c9347ec074243acc5c3c7568896b12714e0e82e9f0bf47900' },
};
const notices = ['OPENCLAW-LICENSE', 'HERMES-LICENSE', 'NODE-LICENSE'];

async function fetchTool(url: string, sha256: string, file: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('Could not download the pinned AppImage build tools.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('AppImage tool digest does not match.');
  await writeFile(file, bytes, { mode: 0o755, flag: 'wx' });
}

function run(program: string, args: string[], env = process.env) {
  execFileSync(program, args, { env, stdio: 'inherit' });
}

try {
  await mkdir(release, { recursive: true });
  const buildMain = path.join(stage, 'launcher.mjs');
  const logos = Object.fromEntries(setupLogos.map(file => ['logo/' + file, path.resolve('assets/setup', file)]));
  const modules = Object.fromEntries(runtimeModules.map(file => ['runtime/' + file, path.resolve('dist/lib', file)]));
  const mac = platform === 'darwin';
  let artifact: string;
  if (mac) {
    const app = path.join(stage, base + '.app');
    const executable = path.join(app, 'Contents', 'MacOS', base);
    const resources = path.join(app, 'Contents', 'Resources');
    await mkdir(path.dirname(executable), { recursive: true });
    await mkdir(path.join(resources, 'dist', 'bin'), { recursive: true });
    await mkdir(path.join(resources, 'dist', 'lib'), { recursive: true });
    await mkdir(path.join(resources, 'assets', 'setup'), { recursive: true });
    await copyFile(process.execPath, path.join(resources, 'node'));
    await chmod(path.join(resources, 'node'), 0o755);
    await Promise.all([
      ...runtimeModules.map(file => copyFile(modules['runtime/' + file], path.join(resources, 'dist', 'lib', file))),
      ...setupLogos.map(file => copyFile(logos['logo/' + file], path.join(resources, 'assets', 'setup', file))),
      copyFile('dist/bin/setup-launcher.js', path.join(resources, 'dist', 'bin', 'setup-launcher.js')),
    ]);
    await writeFile(path.join(resources, 'package.json'), '{"type":"module","private":true}\n');
    await writeFile(executable, '#!/bin/sh\nbase="$(dirname "$0")/../Resources"\nexec "$base/node" "$base/dist/bin/setup-launcher.js" "$@"\n', { mode: 0o755 });
    await writeFile(path.join(app, 'Contents', 'Info.plist'),
      '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>' +
      '<key>CFBundlePackageType</key><string>APPL</string><key>CFBundleIdentifier</key><string>com.cbgpu.agent.setup</string>' +
      '<key>CFBundleExecutable</key><string>' + base + '</string><key>CFBundleName</key><string>CBGPU Agent Setup</string>' +
      '</dict></plist>\n');
    await Promise.all(notices.map(file => copyFile(path.join('assets/setup', file), path.join(resources, file))));
    run('codesign', ['--force', '--deep', '--sign', '-', app]);
    run(executable, ['--self-test']);
    artifact = path.join(release, base + '-macOS-' + arch + '.zip');
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, artifact]);
  } else {
    if (platform !== 'win32' && (platform !== 'linux' || !(arch in appImages))) throw new Error('Unsupported setup build host.');
    await build({ entryPoints: ['bin/setup-launcher.ts'], outfile: buildMain, bundle: true,
      platform: 'node', format: 'esm', target: 'node26', legalComments: 'none' });
    const output = path.join(stage, base + (platform === 'win32' ? '.exe' : ''));
    const config = path.join(stage, 'sea.json');
    await writeFile(config, JSON.stringify({ main: buildMain, mainFormat: 'module', output,
      disableExperimentalSEAWarning: true, execArgvExtension: 'none', assets: { ...logos, ...modules,
        ...Object.fromEntries(notices.map(file => ['notices/' + file, path.resolve('assets/setup', file)])) } }));
    run(process.execPath, ['--build-sea', config]);
    await chmod(output, 0o755);
    run(output, ['--self-test']);
    if (platform === 'win32') {
      artifact = path.join(release, base + '-Windows-' + arch + '.exe');
      await copyFile(output, artifact);
    } else {
      const info = appImages[arch as keyof typeof appImages];
      const appDir = path.join(stage, 'CBGPU.AppDir');
      const tool = path.join(stage, 'appimagetool.AppImage');
      const runtime = path.join(stage, 'appimage-runtime');
      await Promise.all([
        fetchTool('https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-' + info.label + '.AppImage', info.tool, tool),
        fetchTool('https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-' + info.label, info.runtime, runtime),
        mkdir(appDir),
      ]);
      await copyFile(output, path.join(appDir, base));
      await chmod(path.join(appDir, base), 0o755);
      await copyFile('assets/setup/cbgpu.png', path.join(appDir, 'cbgpu-agent-setup.png'));
      await writeFile(path.join(appDir, 'AppRun'), '#!/bin/sh\nexec "$APPDIR/CBGPU-Agent-Setup" "$@"\n', { mode: 0o755 });
      await writeFile(path.join(appDir, 'cbgpu-agent-setup.desktop'),
        '[Desktop Entry]\nType=Application\nName=CBGPU Agent Setup\nExec=CBGPU-Agent-Setup\nIcon=cbgpu-agent-setup\nCategories=Utility;\n');
      await Promise.all(notices.map(file => copyFile(path.join('assets/setup', file), path.join(appDir, file))));
      artifact = path.join(release, base + '-Linux-' + arch + '.AppImage');
      const appImageEnv = { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', ARCH: info.label, SOURCE_DATE_EPOCH: '0' };
      run(tool, ['--runtime-file', runtime, '--no-appstream', appDir, artifact], appImageEnv);
      run(artifact, ['--self-test'], appImageEnv);
    }
  }
  const digest = createHash('sha256').update(await readFile(artifact)).digest('hex');
  await writeFile(artifact + '.sha256', digest + '  ' + path.basename(artifact) + '\n');
  const fullNotices = await Promise.all(notices.map(file => readFile(path.join('assets/setup', file), 'utf8')));
  await writeFile(path.join(release, 'CBGPU-Agent-Setup-Notices.txt'), fullNotices.join('\n\n'));
} finally {
  await rm(stage, { recursive: true, force: true });
}
