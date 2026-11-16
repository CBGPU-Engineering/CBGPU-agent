import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
const banned=/\.(?:[cm]?js|jsx|py|sh|bash|cs|kt|swift|java|go|c|cpp|h)$/i;
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(file=>file&&existsSync(file)&&banned.test(file));
if(files.length)throw Error('Owned executable sources must use TypeScript or Rust: '+files.join(', '));
console.log('Source language policy passed: TypeScript/Rust only.');
