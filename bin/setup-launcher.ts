import { readSetupLogo, setupLogos } from '../lib/setup-assets.ts';
import { runSetupProcess } from '../lib/setup-process.ts';

process.env.CBGPU_PORTABLE_SETUP = '1';

if (process.argv.includes('--self-test')) {
  const images = await Promise.all(setupLogos.map(readSetupLogo));
  if (images.some(bytes => bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')) {
    throw new Error('The portable setup logos are missing or invalid.');
  }
  console.log('CBGPU Agent Setup self-test passed');
} else {
  try {
    const url = await runSetupProcess({ portable: true });
    if (url) console.log('CBGPU 설치 도우미\n' + url);
  } catch {
    console.error('설치 화면을 열지 못했어요. 열려 있는 설치 창이 있으면 닫고 다시 실행해 주세요.');
    process.exitCode = 1;
  }
}
