import { readFile } from 'node:fs/promises';

export const setupLogos = ['openclaw.png', 'hermes.png'] as const;

export async function readSetupLogo(file: (typeof setupLogos)[number]) {
  for (const folder of ['./setup-assets/', '../../assets/setup/', '../assets/setup/']) {
    try { return await readFile(new URL(folder + file, import.meta.url)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Setup icon unavailable');
}
