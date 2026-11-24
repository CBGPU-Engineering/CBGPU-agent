import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeProfile, modelsFromCatalog, parseTelegram } from '../lib/setup-profiles.ts';
import { startSetup } from '../lib/setup-server.ts';

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
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.doesNotMatch(await page.text(), /cbgpu_ai_fixture_token/);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(folder, { recursive: true, force: true });
  }
});
