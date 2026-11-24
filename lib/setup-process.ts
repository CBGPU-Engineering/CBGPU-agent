import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { saveSetupFile } from './setup-autostart.ts';
import { openBrowser } from './setup-runtime.ts';
import { startSetup, systemRoot } from './setup-server.ts';

function setupPort(root: string) {
  return 20000 + createHash('sha256').update(root).digest().readUInt16BE(0) % 30000;
}

export async function runSetupProcess({ background = false, root = systemRoot, start = startSetup } = {}) {
  const port = setupPort(root);
  const origin = 'http://127.0.0.1:' + port;
  const record = path.join(root, 'setup-session.json');
  await mkdir(root, { recursive: true, mode: 0o700 });
  let service;
  try {
    service = await start({ root, port, browser: false });
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
        const response = await fetch(origin + (background ? '/resume' : '/status'), {
          method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-cbgpu-setup': ticket },
          body: '{}', redirect: 'error', signal: AbortSignal.timeout(background ? 20000 : 1500),
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
  const { url, server, resumeSaved } = service;
  await saveSetupFile(root, path.basename(record), new URL(url).hash.slice(1)).catch(error => {
    server.close();
    throw error;
  });
  const shutdown = async () => {
    await unlink(record).catch(() => {});
    server.close();
    server.closeAllConnections();
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void shutdown(); });
  if (background) {
    for (let retry = 0; retry < 5; retry++) {
      try {
        if (await resumeSaved()) return url;
        break;
      } catch {
        if (retry < 4) await wait(5000);
      }
    }
    await shutdown();
    return '';
  }
  openBrowser(url);
  return url;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url && process.argv[2] === '--autostart') {
  await runSetupProcess({ background: true }).catch(() => { process.exitCode = 1; });
}
