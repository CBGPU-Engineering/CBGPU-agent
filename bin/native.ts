#!/usr/bin/env node
/** Candidate launcher only. The published 1.1.0 entry remains unchanged until native artifacts pass all OS checks. */
import{spawn}from'node:child_process';import{createRequire}from'node:module';import fs from'node:fs';import{readFile,lstat}from'node:fs/promises';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';import path from'node:path';
try{
 const override=process.env.CBGPU_AGENT_NATIVE_BINARY;let binary:string;
 if(override){if(!path.isAbsolute(override))throw Error('CBGPU_AGENT_NATIVE_BINARY must be an absolute path.');binary=override;}
 else{
  const platform=process.platform+'-'+process.arch,name=process.platform==='win32'?'cbgpu.exe':'cbgpu';
  binary=fileURLToPath(new URL('../native/'+platform+'/'+name,import.meta.url));
  const manifest=JSON.parse(await readFile(new URL('../native/manifest.json',import.meta.url),'utf8'));
  if(manifest.version!=='0.2.0'||typeof manifest.sha256?.[platform]!=='string')throw Error('No verified native artifact for this platform. Build the native candidate or use the current pinned release.');
  const digest=createHash('sha256').update(await readFile(binary)).digest('hex');if(digest!==manifest.sha256[platform])throw Error('Native artifact checksum mismatch. Reinstall the verified release.');
 }
 const metadata=await lstat(binary);if(!metadata.isFile()||metadata.isSymbolicLink())throw Error('Native Agent executable must be a regular file.');
 const require=createRequire(import.meta.url);const pkgPath=require.resolve('opencode-ai/package.json');const pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));const engine=path.resolve(path.dirname(pkgPath),typeof pkg.bin==='string'?pkg.bin:pkg.bin.opencode);
 const child=spawn(binary,process.argv.slice(2),{stdio:'inherit',shell:false,windowsHide:false,env:{...process.env,CBGPU_AGENT_OPENCODE_PATH:engine}});for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{child.kill(signal)});child.on('error',()=>{console.error('Cannot start the native CBGPU Agent executable.');process.exitCode=1});child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0)});
}catch(error){console.error(error instanceof Error&&error.message.startsWith('ENOENT')?'Native candidate is not packaged for this platform. Build it with npm run build:native; the published release remains unchanged.':error instanceof Error?error.message:'Cannot locate native Agent.');process.exitCode=1}
