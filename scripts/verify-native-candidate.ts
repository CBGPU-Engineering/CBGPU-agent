/** Verify the assembled archive without logging in, deploying or contacting CBGPU. */
import {readFile,writeFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
const root=path.resolve('release-candidate'),metadata=JSON.parse(await readFile(path.join(root,'candidate.json'),'utf8'));
assert(/^[a-z0-9.-]+-[a-f0-9]{40}\.tar\.gz$/.test(metadata.archive));
const digest=createHash('sha256').update(await readFile(path.join(root,metadata.archive))).digest('hex');assert.equal(digest,metadata.archive_sha256);assert.equal(await readFile(path.join(root,'SHA256SUMS'),'utf8'),`${digest}  ${metadata.archive}\n`);
const temp=await mkdtemp(path.join(os.tmpdir(),'cbgpu-native-bundle-'));
try{
 const unpack=spawnSync('tar',['-xzf',path.join(root,metadata.archive),'-C',temp],{encoding:'utf8',shell:false});assert.equal(unpack.status,0,unpack.stderr);
 assert.deepEqual((await readdir(temp)).sort(),['LICENSE','OPENCODE-LICENSE','README.md','candidate.json','dist']);
 assert.deepEqual((await readdir(path.join(temp,'dist'))).sort(),['bin','native']);
 const inner=JSON.parse(await readFile(path.join(temp,'candidate.json'),'utf8'));assert.equal(inner.source.commit,metadata.source.commit);assert.equal(inner.platform,process.platform+'-'+process.arch);
 const notices=await readFile(path.join(temp,'dist/native/THIRD_PARTY_NOTICES.txt'),'utf8');assert(notices.includes('Native Rust third-party software notices'));assert(notices.includes('reqwest'));
 const launch=spawnSync(process.execPath,[path.join(temp,'dist/bin/native.js'),'--help'],{cwd:temp,encoding:'utf8',shell:false,env:{...process.env,CBGPU_AGENT_NATIVE_BINARY:''}});assert.equal(launch.status,0,launch.stderr);assert(launch.stdout.includes('CBGPU'));
 const manifestPath=path.join(temp,'dist/native/manifest.json'),tampered=JSON.parse(await readFile(manifestPath,'utf8'));tampered.sha256[inner.platform]='0'.repeat(64);await writeFile(manifestPath,JSON.stringify(tampered));
 const rejected=spawnSync(process.execPath,[path.join(temp,'dist/bin/native.js'),'--help'],{cwd:temp,encoding:'utf8',shell:false,env:{...process.env,CBGPU_AGENT_NATIVE_BINARY:''}});assert.equal(rejected.status,1);assert(rejected.stderr.includes('checksum mismatch'));
 console.log('Candidate archive checksum, source metadata, notices and extracted executable startup passed for '+inner.platform+'. No network requests or installations.');
}finally{await rm(temp,{recursive:true,force:true});}
