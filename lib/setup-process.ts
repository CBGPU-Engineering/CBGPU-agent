import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { saveSetupFile } from './setup-autostart.ts';
import { openBrowser } from './setup-runtime.ts';
import { startSetup, systemRoot } from './setup-server.ts';
import type { Agent } from './setup-profiles.ts';

function setupPort(root: string) {
  return 20000 + createHash('sha256').update(root).digest().readUInt16BE(0) % 30000;
}

export async function runSetupProcess({ background = false, root = systemRoot, start = startSetup, portable = false,
  manual = undefined as Agent | undefined } = {}) {
  const port = setupPort(root);
  const origin = 'http://127.0.0.1:' + port;
  const record = path.join(root, 'setup-session.json');
  await mkdir(root, { recursive: true, mode: 0o700 });
  let service;
  try {
    service = await start({ root, port, browser: false, portable });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    for (let retry = 0; retry < 8; retry++) {
      const ticket = (await readFile(record, 'utf8').catch(() => '')).trim();
      if (/^[A-Za-z0-9_-]{32}$/.test(ticket)) {
        const challenge = randomBytes(16).toString('hex');
        const proof = await fetch(origin + '/session-check?challenge=' + challenge, {
          redirect: 'error', signal: AbortSignal.timeout(1000),
        }).then(response => response.ok ? response.json() : null).catch(() => null);
        if (proof?.proof !== createHmac('sha256', ticket).update(challenge).digest('hex')) {
          await wait(250);
          continue;
        }
        const response = await fetch(origin + (background ? '/resume' : manual ? '/start' : '/status'), {
          method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-cbgpu-setup': ticket },
          body: JSON.stringify({agent: manual}), redirect: 'error', signal: AbortSignal.timeout(background || manual ? 25000 : 1500),
        }).catch(() => null);
        if (response?.ok) {
          const url = origin + '/#' + ticket;
          if (!background) openBrowser(url);
          return url;
        }
      }
      await wait(250);
    }
    throw new Error('설치 화면이 사용하는 포트가 바빠요. 실행 중인 창을 확인해 주세요.');
  }
  const { url, server, resumeSaved, startManually } = service;
  await saveSetupFile(root, path.basename(record), new URL(url).hash.slice(1)).catch(error => {
    server.close();
    throw error;
  });
  const shutdown = async () => {
    await unlink(record).catch(() => {});
    server.close();
    server.closeAllConnections();
  };
  server.once('close', () => { void unlink(record).catch(() => {}); });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void shutdown(); });
  if (background) {
    let active = false;
    for (let retry = 0; retry < 5; retry++) {
      try {
        const result = await resumeSaved();
        active = result.active;
        if (!result.pending) break;
      } catch { /* Retry when network startup or another action is in progress. */ }
      if (retry < 4) await wait(5000);
    }
    if (active) return url;
    await shutdown();
    return '';
  }
  if (manual) await startManually(manual).catch(() => {});
  openBrowser(url);
  return url;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const argument = process.argv[2];
  const manual = argument === '--open-openclaw' ? 'openclaw' : argument === '--open-hermes' ? 'hermes' : undefined;
  if (manual || argument === '--autostart') {
    await runSetupProcess({ background: argument === '--autostart', manual }).catch(() => { process.exitCode = 1; });
  }
}
