import { readFile } from 'node:fs/promises';
import { getAsset, isSea } from 'node:sea';

export const setupLogos = ['openclaw.png', 'hermes.png'] as const;

export async function readSetupLogo(file: (typeof setupLogos)[number]) {
  if (isSea()) return Buffer.from(getAsset('logo/' + file));
  for (const folder of ['./setup-assets/', '../../assets/setup/', '../assets/setup/']) {
    try { return await readFile(new URL(folder + file, import.meta.url)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Setup icon unavailable');
}

export async function readSetupModule(file: string) {
  return isSea() ? Buffer.from(getAsset('runtime/' + file)) : readFile(new URL('./' + file, import.meta.url));
}
