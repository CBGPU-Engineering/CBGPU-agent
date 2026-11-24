#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';import {Writable} from 'node:stream';import {createInterface} from 'node:readline/promises';import {agentConfig,endpoint} from '../lib/config.ts';
const baseURL=process.env.CBGPU_BASE_URL||endpoint;const url=new URL(baseURL);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('Use HTTPS for the API endpoint.');
const dir=path.join(os.homedir(),'.config/cbgpu-agent'),file=path.join(dir,'credentials.json'),args=process.argv.slice(2);
function read(){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return{}}}
if(args[0]==='setup'){
 const {startSetup}=await import('../lib/setup-server.ts');
 const {url,server}=await startSetup();
 console.log('CBGPU 에이전트 설정을 브라우저에서 열었어요.\n'+url+'\n닫으려면 Ctrl+C를 눌러 주세요.');
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{server.close();server.closeAllConnections()});
}else if(args[0]==='--help'||args[0]==='help'){console.log('CBGPU Agent · powered by OpenCode (MIT)\n\ncbgpu setup             Install and connect OpenClaw or Hermes\ncbgpu login             Save your CBGPU AI key privately\ncbgpu                   Open the interactive coding agent\ncbgpu run "task"         Run a coding task\ncbgpu models            List CBGPU models\ncbgpu logout            Remove the local saved key\n\nCreate/revoke keys: https://cbgpu.com/ai?tab=api\nFiles and commands execute on YOUR computer, with approval prompts.\nGPU inference runs on CBGPU when an unreserved GPU is available.');process.exit(0)}
if(args[0]==='logout'){fs.rmSync(file,{force:true});console.log('Local key removed. Revoke the server key at https://cbgpu.com/ai?tab=api if needed.');process.exit(0)}
if(args[0]==='login'){
 if(!process.stdin.isTTY)throw Error('Run cbgpu login in an interactive terminal. Do not pipe keys.');
 let muted=true;const output=new Writable({write(chunk,encoding,done){if(!muted)process.stdout.write(chunk,encoding);done();}});const rl=createInterface({input:process.stdin,output,terminal:true});process.stdout.write('CBGPU API key (hidden): ');let key;try{key=(await rl.question('')).trim()}finally{muted=false;rl.close();process.stdout.write('\n')}
 if(!/^cbgpu_ai_[A-Za-z0-9_-]+$/.test(key))throw Error('Use an API key from CBGPU AI → 개발 API.');
 const response=await fetch(baseURL+'/models',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('The key could not be verified.');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.chmodSync(dir,0o700);fs.writeFileSync(file,JSON.stringify({key})+'\n',{mode:0o600});fs.chmodSync(file,0o600);console.log('Connected to CBGPU. Run cbgpu inside your project.');process.exit(0);
}
if(args[0]!=='setup'){
const key=process.env.CBGPU_API_KEY||read().key;if(!key){console.error('Run cbgpu login first. Create a key at https://cbgpu.com/ai?tab=api');process.exit(1)}
// Do not print keys or place them in argv/project configuration. The child receives a private environment.
const require=createRequire(import.meta.url);const pkgPath=require.resolve('opencode-ai/package.json');const pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));const bin=path.join(path.dirname(pkgPath),typeof pkg.bin==='string'?pkg.bin:pkg.bin.opencode);
const env={...process.env,CBGPU_API_KEY:key,OPENCODE_CONFIG_CONTENT:JSON.stringify(agentConfig(baseURL)),OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_DISABLE_DEFAULT_PLUGINS:'1'};
if(!args.length)args.push('--agent','cbgpu');else if(args[0]==='run'&&!args.includes('--agent'))args.push('--agent','cbgpu');
if(!args.includes('--pure'))args.push('--pure');
const child=spawn(bin,args,{env,stdio:'inherit'});child.on('exit',(code,signal)=>{if(signal)process.kill(process.pid,signal);else process.exitCode=code??1});child.on('error',()=>{console.error('Could not start the OpenCode engine. Reinstall CBGPU Agent.');process.exitCode=1});for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>child.kill(signal));

}
