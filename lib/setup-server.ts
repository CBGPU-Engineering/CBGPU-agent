import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import { setTimeout as wait } from 'node:timers/promises';
import path from 'node:path';
import { endpoint } from './config.ts';
import { client, page, stylesheet } from './setup-page.ts';
import { makeProfile, modelsFromCatalog, parsePermissions, parseTelegram, validKey, type Agent } from './setup-profiles.ts';
import { findRuntime, installRuntime, prepareDesktop, openBrowser, runtimeEnvironment } from './setup-runtime.ts';

const systemRoot = path.join(os.homedir(), '.config', 'cbgpu-agent', 'setup');
const parseAgent = (value: unknown): Agent => {
  if (value !== 'openclaw' && value !== 'hermes') throw new Error('설치할 에이전트를 선택해 주세요.');
  return value;
};

async function jsonBody(request: IncomingMessage) {
  if (request.headers['content-type'] !== 'application/json') throw new Error('설치 화면에서 다시 시도해 주세요.');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw new Error('입력한 값이 너무 길어요.');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('입력 내용을 확인해 주세요.');
  return value;
}

async function modelCatalog(key: unknown) {
  if (!validKey(key)) throw new Error('CBGPU에서 만든 API 키를 입력해 주세요.');
  let response;
  try {
    response = await fetch(endpoint + '/models', {
      headers: { authorization: 'Bearer ' + key }, redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  } catch { throw new Error('CBGPU에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'); }
  if (response.status === 401 || response.status === 403) throw new Error('사용할 수 없는 API 키예요. CBGPU에서 키를 확인해 주세요.');
  if (!response.ok) throw new Error('모델 목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  return modelsFromCatalog((await response.json()).data);
}

export function startSetup({
  root = systemRoot, browser = true, getModels = modelCatalog,
  install = installRuntime, runtime = findRuntime, fetchBot = fetch, prepareScreen = prepareDesktop,
} = {}) {
  const ticket = randomBytes(24).toString('base64url');
  let origin = '';
  let busy = false;
  let running: ChildProcess | undefined;
  async function save(folder: string, filename: string, value: unknown, text = false) {
    const temporary = path.join(folder, '.' + filename + '.' + randomBytes(8).toString('hex'));
    await writeFile(temporary, text ? String(value) : JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, path.join(folder, filename));
  }
  async function read(folder: string, filename: string) {
    return JSON.parse(await readFile(path.join(folder, filename), 'utf8'));
  }
  async function configure(payload: Record<string, unknown>) {
    if (busy || running) throw new Error('설치가 진행 중이거나 에이전트가 실행 중이에요.');
    busy = true;
    try {
      if (payload.accepted !== true) throw new Error('설치 전에 접근 권한과 위험을 확인해 주세요.');
      const agent = parseAgent(payload.agent);
      const models = await getModels(payload.key);
      const model = models.find(entry => entry.id === payload.model);
      if (!model) throw new Error('CBGPU에서 사용할 수 있는 모델을 선택해 주세요.');
      const telegram = parseTelegram(payload.token, payload.user);
      const folder = path.join(root, agent);
      const permissions = parsePermissions(payload.permissions);
      const profile = makeProfile(agent, model, folder, telegram, permissions);
      if (telegram) {
        let result;
        try {
          const response = await fetchBot('https://api.telegram.org/bot' + telegram.token + '/getMe', {
            redirect: 'error', signal: AbortSignal.timeout(8000),
          });
          result = response.ok && await response.json();
        } catch { throw new Error('Telegram에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.'); }
        if (!result?.ok || !result.result?.is_bot) throw new Error('BotFather에서 받은 Telegram 봇 토큰을 확인해 주세요.');
      }
      await mkdir(path.join(folder, 'workspace'), { recursive: true, mode: 0o700 });
      await install(agent, folder, permissions);
      if (permissions.screen) await prepareScreen(agent, folder);
      const workspace = path.join(folder, 'workspace');
      const accountInstructions = permissions.accounts
        ? 'When the owner asks you to sign in or create an account, use the enabled browser or desktop tools for the named app or site, including services you have not used before. Complete and submit the requested forms. Fill secrets through the local credential vault when available, or hand the form back to the owner for secret entry. Hand off provider verification steps, such as CAPTCHA or multi-factor authentication, to the owner.'
        : 'Ask the owner to enable account tasks before submitting login or signup forms.';
      const file = path.join(workspace, 'AGENTS.md');
      let existing = '';
      try {
        const info = await lstat(file);
        if (!info.isFile() || info.size > 65536) throw new Error('작업 폴더의 AGENTS.md를 확인해 주세요.');
        existing = await readFile(file, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const grant = '<!-- cbgpu-setup:start -->\n' + accountInstructions + '\n<!-- cbgpu-setup:end -->';
      const bound = /<!-- cbgpu-setup:start -->[\s\S]*?<!-- cbgpu-setup:end -->/;
      const instructions = bound.test(existing) ? existing.replace(bound, grant) : existing.trimEnd() + '\n\n' + grant + '\n';
      await save(workspace, 'AGENTS.md', instructions, true);
      await save(folder, profile.filename, profile.config);
      await save(folder, 'credentials.json', { key: payload.key, telegram, permissions });
      await save(root, 'selection.json', { agent });
      return { ready: true };
    } finally { busy = false; }
  }
  async function launch(agent: Agent, sudoPassword: unknown) {
    const folder = path.join(root, agent);
    const installed = await runtime(agent, folder);
    if (!installed) throw new Error('에이전트를 먼저 설치하고 연결해 주세요.');
    const { key, telegram, permissions } = await read(folder, 'credentials.json');
    if (!validKey(key)) throw new Error('CBGPU에 다시 연결해 주세요.');
    const configFile = agent === 'openclaw' ? 'openclaw.json' : 'config.yaml';
    const config = await read(folder, configFile);
    const context = agent === 'openclaw' ? config.models.providers.cbgpu.models[0].id : config.model.default;
    if (sudoPassword !== undefined && sudoPassword !== '' && (agent !== 'hermes' || !permissions?.sudo ||
        typeof sudoPassword !== 'string' || sudoPassword.length > 256 || sudoPassword.includes('\0'))) {
      throw new Error('이 프로필에서는 sudo 비밀번호를 사용할 수 없어요.');
    }
    const env = {
      ...runtimeEnvironment(), CBGPU_API_KEY: key,
      ...(agent === 'openclaw'
        ? { OPENCLAW_STATE_DIR: folder, OPENCLAW_CONFIG_PATH: path.join(folder, configFile) }
        : { HERMES_HOME: folder, HERMES_CONFIG_BACKEND: 'file',
          ...(!permissions?.outside && { HERMES_WRITE_SAFE_ROOT: path.join(folder, 'workspace') }) }),
      ...(telegram && { TELEGRAM_BOT_TOKEN: telegram.token, TELEGRAM_ALLOWED_USERS: telegram.userId }),
    };
    if (agent === 'hermes' && permissions?.sudo && typeof sudoPassword === 'string' && sudoPassword) {
      Object.assign(env, { TERMINAL_ENV: 'local', SUDO_PASSWORD: sudoPassword });
    }
    const verifiedModel = (await getModels(key)).find(item => item.id === context);
    if (!verifiedModel) throw new Error('연결한 모델을 사용할 수 없어요. 모델을 다시 선택해 주세요.');
    makeProfile(agent, verifiedModel, folder, telegram, permissions);
    const command = agent === 'hermes' && !telegram ? 'dashboard' : 'gateway';
    const child = spawn(installed.program, [...installed.prefix, command], {
      env, cwd: path.join(folder, 'workspace'), stdio: 'ignore', windowsHide: true,
    });
    running = child;
    const clear = () => { if (running === child) running = undefined; };
    child.once('error', clear);
    child.once('exit', clear);
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', () => reject(new Error('에이전트를 시작하지 못했어요. 다시 설치해 주세요.')));
    });
    return {
      message: telegram ? '에이전트를 시작했어요. Telegram에서 내 봇에게 메시지를 보내 연결을 확인해 주세요.'
        : '에이전트를 시작했어요. 창이 열리기까지 잠시 기다려 주세요.',
      url: agent === 'openclaw' && !telegram
        ? 'http://127.0.0.1:19349/#token=' + encodeURIComponent(config.gateway.auth.token)
        : null,
    };
  }
  const assets = new Map([
    ['/', ['text/html; charset=utf-8', page]],
    ['/setup.css', ['text/css; charset=utf-8', stylesheet]],
    ['/setup.js', ['text/javascript; charset=utf-8', client]],
  ]);
  const reply = (response: ServerResponse, status: number, value: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  };
  const server = createServer(async (request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('content-security-policy', "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const pathname = request.url ?? '/';
    if (request.headers.host !== new URL(origin).host) return reply(response, 403, { error: '설치 창을 다시 열어 주세요.' });
    const asset = request.method === 'GET' && assets.get(pathname);
    if (asset) { response.writeHead(200, { 'content-type': asset[0] }); response.end(asset[1]); return; }
    const token = request.headers['x-cbgpu-setup'];
    if (request.method !== 'POST' || request.headers.origin !== origin || typeof token !== 'string' ||
        Buffer.byteLength(token) !== Buffer.byteLength(ticket) || !timingSafeEqual(Buffer.from(token), Buffer.from(ticket))) {
      return reply(response, 403, { error: '이 설치 창을 다시 열어 주세요.' });
    }
    try {
      const payload = await jsonBody(request);
      let result;
      switch (pathname) {
        case '/status': {
          const saved = (await read(root, 'selection.json').catch(() => null))?.agent;
          const current = saved === 'openclaw' || saved === 'hermes' ? await read(path.join(root, saved), 'credentials.json').catch(() => null) : null;
          const permissions = parsePermissions(current?.permissions);
          result = { saved: current ? saved : '', permissions, platform: process.platform };
          break;
        }
        case '/models': result = { models: await getModels(payload.key) }; break;
        case '/install': result = await configure(payload); break;
        case '/start':
          if (busy || running) throw new Error('이미 시작 중이거나 실행 중이에요.');
          busy = true;
          try { result = await launch(parseAgent(payload.agent), payload.sudoPassword); }
          finally { busy = false; }
          break;
        case '/stop': {
          if (busy) throw new Error('시작이 끝난 뒤 멈춰 주세요.');
          const child = running;
          if (child && child.exitCode === null && child.signalCode === null) {
            child.kill();
            for (let tick = 0; tick < 20 && running === child; tick++) await wait(100);
            if (running === child) throw new Error('에이전트가 종료되는 중이에요. 잠시 뒤 다시 확인해 주세요.');
          }
          result = { stopped: true };
          break;
        }
        default: return reply(response, 404, { error: '설치 창을 다시 열어 주세요.' });
      }
      reply(response, 200, result);
    } catch (error) {
      const message = error instanceof Error && /[가-힣]/.test(error.message) && !error.message.includes('cbgpu_ai_')
        ? error.message : '설정을 처리하지 못했어요. 입력 내용을 확인한 뒤 다시 시도해 주세요.';
      reply(response, 400, { error: message });
    }
  });
  server.on('close', () => running?.kill());
  return new Promise<{ url: string; server: typeof server }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { reject(new Error('설치 창을 열지 못했어요.')); return; }
      origin = 'http://127.0.0.1:' + address.port;
      const url = origin + '/#' + ticket;
      if (browser) openBrowser(url);
      resolve({ url, server });
    });
  });
}
