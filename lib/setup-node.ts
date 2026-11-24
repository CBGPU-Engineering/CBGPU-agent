import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const version = '24.16.0';
const checksums: Record<string, string> = {
  'darwin-arm64.tar.gz': '39189dab4eeb15706c424af0ac08a3044c9e48f7db12a7d77f6b7aafc7dd5df6',
  'darwin-x64.tar.gz': '298b4c7b3cb80765c8703e42b90324a4ece3b6634947b89e769c3c980ab55185',
  'linux-arm64.tar.xz': '524659219d6a207a7400f2bde15d19ba060ffbe0d32a8643319ad67e3bb64c78',
  'linux-x64.tar.xz': 'd804845d34eddc21dc1092b519d643ef40b1f58ec5dec5c22b1f4bd8fabde6c9',
  'win-arm64.zip': '14834611d4c6b3c06054e7007732b90474c16e0b32f395e05b55a571ef71c6d2',
  'win-x64.zip': 'edaca9bd58ec8e92037dac4e877d52f6b8f430b81c18b57e264b4e2fb111cd56',
};
const platform = process.platform === 'win32' ? 'win' : process.platform;
const architecture = process.arch;
const packageName = 'node-v' + version + '-' + platform + '-' + architecture;
const extension = platform === 'win' ? '.zip' : platform === 'linux' ? '.tar.xz' : '.tar.gz';
export const nodeToolchain = (root: string) => path.join(root, 'toolchains', packageName);
const nodeIn = (base: string) => path.join(base, platform === 'win' ? 'node.exe' : 'bin/node');

async function hasFile(location: string) {
  return access(location).then(() => true, () => false);
}

export async function openClawNode(root: string) {
  const bundled = nodeIn(nodeToolchain(root));
  if (await hasFile(bundled)) return bundled;
  const [major, minor] = process.versions.node.split('.').map(Number);
  return (major === 24 && minor >= 16) || (major === 26 && minor >= 1) || major > 26 ? process.execPath : null;
}

export async function installNode(root: string, env: NodeJS.ProcessEnv) {
  const alreadyInstalled = await openClawNode(root);
  if (alreadyInstalled) return alreadyInstalled;
  const expected = checksums[platform + '-' + architecture + extension];
  if (!expected) throw new Error('이 컴퓨터용 OpenClaw 실행 환경을 준비하지 못했어요.');
  const toolchains = path.dirname(nodeToolchain(root));
  await mkdir(toolchains, { recursive: true, mode: 0o700 });
  const stage = await mkdtemp(path.join(toolchains, '.download-'));
  try {
    const url = 'https://nodejs.org/dist/v' + version + '/' + packageName + extension;
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error('OpenClaw에 필요한 Node.js를 내려받지 못했어요.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 90 * 1024 ** 2 || createHash('sha256').update(bytes).digest('hex') !== expected) {
      throw new Error('Node.js 설치 파일의 체크섬이 맞지 않아요.');
    }
    const artifact = path.join(stage, 'node' + extension);
    await writeFile(artifact, bytes, { mode: 0o600, flag: 'wx' });
    await new Promise<void>((resolve, reject) => {
      const child = spawn(platform === 'win' ? 'tar.exe' : 'tar', ['-xf', artifact, '-C', stage],
        { env, windowsHide: true, stdio: 'ignore' });
      child.once('error', () => reject(new Error('압축 프로그램 tar를 찾지 못했어요.')));
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('Node.js 설치 파일을 풀지 못했어요.')));
    });
    const extracted = path.join(stage, packageName);
    if (!await hasFile(nodeIn(extracted))) throw new Error('Node.js 실행 파일을 찾지 못했어요.');
    await rename(extracted, nodeToolchain(root));
    return nodeIn(nodeToolchain(root));
  } finally { await rm(stage, { recursive: true, force: true }); }
}

export function toolchainNpm(nodeExecutable: string) {
  const base = path.dirname(nodeExecutable);
  return platform === 'win' ? path.join(base, 'node_modules/npm/bin/npm-cli.js')
    : path.resolve(base, '../lib/node_modules/npm/bin/npm-cli.js');
}
