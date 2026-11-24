import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { makeProfile, modelsFromCatalog, parseTelegram } from '../lib/setup-profiles.ts';
import { startSetup } from '../lib/setup-server.ts';
import { startupEntry } from '../lib/setup-autostart.ts';

const key = 'cbgpu_ai_fixture_token_1234567';
const token = '123456789:abcdefghijklmnopqrstuvwxyz-ABCD';
const rows = [
  { id: 'cbgpu-chat', name: 'Chat', capabilities: ['tools'], context_window: 8192, max_output_tokens: 2048 },
  { id: 'cbgpu-qwen38', name: 'Qwen3.8', capabilities: ['text','tools'], context_window: 65536, max_output_tokens: 2048 },
  { id: 'cbgpu-embeddings', capabilities: ['embeddings'] },
  { id: 'cbgpu-private', ready: false, capabilities: ['tools'], context_window:65536, max_output_tokens:2048 },
];

test('use only discovered tool-capable models and prefer the verified Qwen preset', () => {
  const models = modelsFromCatalog(rows);
  assert.deepEqual(models.map(model => model.id), ['cbgpu-qwen38', 'cbgpu-chat']);
  assert.throws(() => makeProfile('hermes', models[1], '/tmp/root', null), /대화 길이/);
  assert.throws(() => parseTelegram(token, '*'), /사용자 ID/);
  assert.throws(() => parseTelegram(token, '-10012345'), /사용자 ID/);
  const openclaw = makeProfile('openclaw', models[0], '/tmp/root', { token, userId: '111' });
  assert.doesNotMatch(JSON.stringify(openclaw), new RegExp(token));
  assert.match(JSON.stringify(openclaw), /"allowFrom":\["111"\]/);
  assert.match(JSON.stringify(openclaw), /"groupPolicy":"disabled"/);
  assert.match(JSON.stringify(openclaw), /"bind":"loopback"/);
  assert.throws(() => makeProfile('hermes', models[0], '/tmp/root', null, { skills: true }), /명령 실행/);
  const hermes = makeProfile('hermes', models[0], '/tmp/root', null, { skills: true, shell: true });
  assert.match(JSON.stringify(hermes), /"skills"/);
});

test('loopback setup verifies origin and ticket, preserves runtime settings and stores private credentials', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'cbgpu-setup-test-'));
  const installed: string[] = [];
  const { url, server } = await startSetup({
    root: folder, browser: false,
    async getModels(value) { assert.equal(value, key); return modelsFromCatalog(rows); },
    async install(agent) { installed.push(agent); },
    async fetchBot(input) {
      assert.equal(input, 'https://api.telegram.org/bot' + token + '/getMe');
      return Response.json({ ok: true, result: { is_bot: true } });
    },
  });
  try {
    const { origin, hash } = new URL(url);
    const payload = { agent: 'openclaw', model:'cbgpu-qwen38', key, token, user:'111', accepted:true };
    const request = (route: string, value: unknown, caller = origin, ticket = hash.slice(1)) =>
      fetch(origin + route, { method: 'POST', body: JSON.stringify(value), headers: {
        'content-type': 'application/json', origin: caller, 'x-cbgpu-setup': ticket,
      } });
    assert.equal((await request('/install', payload, 'https://external.example')).status, 403);
    assert.equal((await request('/install', payload, origin, 'wrong')).status, 403);
    assert.equal((await request('/install', { ...payload, accepted: false })).status, 400);
    assert.equal((await request('/install', { ...payload, model:'cbgpu-chat' })).status, 400);
    assert.equal(installed.length, 0);
    assert.equal((await request('/install', payload)).status, 200);
    assert.deepEqual(installed, ['openclaw']);
    const openclaw = path.join(folder, 'openclaw');
    const config = await readFile(path.join(openclaw, 'openclaw.json'), 'utf8');
    assert.doesNotMatch(config, /cbgpu_ai_|abcdefghijklmnopqrstuvwxyz/);
    assert.match(config, /"primary": "cbgpu\/cbgpu-qwen38"/);
    if (process.platform !== 'win32') assert.equal((await stat(path.join(openclaw,'credentials.json'))).mode & 0o777, 0o600);
    const instructions = path.join(openclaw, 'workspace', 'AGENTS.md');
    assert.match(await readFile(instructions, 'utf8'), /Ask the owner to enable account tasks/);
    assert.equal((await request('/install', { ...payload, permissions: { accounts: true } })).status, 400);
    assert.equal((await request('/install', { ...payload, permissions: { accounts: true, browser: true } })).status, 200);
    const updatedInstructions = await readFile(instructions, 'utf8');
    assert.match(updatedInstructions, /including services you have not used before/);
    assert.match(updatedInstructions, /Hand off provider verification steps/);
    assert.equal((updatedInstructions.match(/cbgpu-setup:start/g) ?? []).length, 1);
    assert.match(await readFile(path.join(openclaw, 'openclaw.json'), 'utf8'), /"browser"/);
    const savedStatus = await (await request('/status', {})).json();
    assert.equal(savedStatus.saved, 'openclaw');
    assert.equal(savedStatus.permissions.accounts, true);
    assert.equal(savedStatus.permissions.browser, true);
    assert.doesNotMatch(JSON.stringify(savedStatus), /cbgpu_ai_|abcdefghijklmnopqrstuvwxyz/);
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    const html = await page.text();
    assert.doesNotMatch(html, /cbgpu_ai_fixture_token/);
    assert.match(html, /OpenClaw와 Hermes 모두 Telegram에서 작업을 맡길 수 있어요/);
    for (const logo of ['openclaw', 'hermes']) {
      const response = await fetch(origin + '/marks/' + logo + '.png');
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(folder, { recursive: true, force: true });
  }
});

test('startup entries run under the desktop user and quote the application paths', () => {
  const linux = startupEntry('linux', '/home/user', { XDG_CONFIG_HOME: '/home/user/My Config' },
    '/usr/bin/node', '/home/user/My Config/cbgpu%test/setup-process.js');
  assert.equal(linux.file, '/home/user/My Config/autostart/cbgpu-agent.desktop');
  assert.match(linux.content, /Exec="\/usr\/bin\/node" "\/home\/user\/My Config\/cbgpu%%test\/setup-process.js" --autostart/);
  const mac = startupEntry('darwin', '/Users/user', {}, '/opt/homebrew/bin/node', '/Users/user/A&B/setup-process.js');
  assert.match(mac.content, /A&amp;B\/setup-process\.js/);
  assert.match(mac.content, /<key>RunAtLoad<\/key><true\/>/);
  const windows = startupEntry('win32', 'C:/Users/user', {}, 'C:/Program Files/nodejs/node.exe', 'C:/Users/user/%profile%/setup-process.js');
  assert.match(windows.file, /Startup\\CBGPU Agent\.cmd$/);
  assert.match(windows.content, /start "" \/min "C:\/Program Files\/nodejs\/node\.exe" "C:\/Users\/user\/%%profile%%\/setup-process\.js" --autostart/);
});

test('only a configured Telegram profile may resume at login and does so once', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cbgpu-autostart-test-'));
  const enrolled: boolean[] = [];
  const { url, server, resumeSaved } = await startSetup({
    root, browser: false,
    async getModels() { return modelsFromCatalog(rows); },
    async install() {},
    async enroll(_root, enabled) { enrolled.push(enabled); },
    async fetchBot() { return Response.json({ ok: true, result: { is_bot: true } }); },
    async runtime() {
      return { program: process.execPath, prefix: ['-e',
        "require('node:fs').appendFileSync('boot-check', process.env.SUDO_PASSWORD ? 'secret\\n' : 'started\\n'); setInterval(() => {}, 1000);"] };
    },
  });
  try {
    const { origin, hash } = new URL(url);
    const request = (route: string, value: unknown) => fetch(origin + route, {
      method: 'POST', body: JSON.stringify(value), headers: {
        'content-type': 'application/json', origin, 'x-cbgpu-setup': hash.slice(1),
      },
    });
    const payload = { agent:'openclaw', model:'cbgpu-qwen38', key, accepted:true, autoStart:true,
      permissions: { shell:true, skills:true } };
    assert.equal(await resumeSaved(), false);
    assert.equal((await request('/install', payload)).status, 400);
    assert.equal((await request('/install', { ...payload, token, user:'111' })).status, 200);
    assert.deepEqual(enrolled, [true]);
    assert.match(await readFile(path.join(root, 'openclaw', 'workspace', 'AGENTS.md'), 'utf8'), /openclaw skills search, verify, and install/);
    assert.equal(await resumeSaved(), true);
    assert.equal(await resumeSaved(), true);
    let bootLog = '';
    for (let retry = 0; !bootLog && retry < 40; retry++) {
      await wait(25);
      bootLog = await readFile(path.join(root, 'openclaw', 'workspace', 'boot-check'), 'utf8').catch(() => '');
    }
    assert.equal(bootLog, 'started\n');
    assert.equal((await (await request('/status', {})).json()).running, true);
    assert.equal((await request('/autostart', {enabled:false})).status, 200);
    assert.deepEqual(enrolled, [true, false]);
    assert.equal((await request('/stop', {})).status, 200);
    assert.equal(await resumeSaved(), false);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
