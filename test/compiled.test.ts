import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {accessSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// Invoked after building, including in CI. Discovery never calls the AI API.
const root=new URL('../',import.meta.url);
test('compiled distribution discovers its read-only MCP without source TypeScript',()=>{
 const configResult=spawnSync(process.execPath,['--input-type=module','-e',"import {agentConfig} from './dist/lib/config.js';console.log(JSON.stringify(agentConfig()))"],{cwd:root,encoding:'utf8'});
 assert.equal(configResult.status,0,configResult.stderr);
 const config=JSON.parse(configResult.stdout),command=config.mcp['cbgpu-web'].command as string[];
 assert(command[1].endsWith(path.join('dist','bin','web.js')));accessSync(command[1]);
 const messages=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}},{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'ping'}];
 const result=spawnSync(command[0],command.slice(1),{cwd:fileURLToPath(root),input:'null\n'+messages.map(m=>JSON.stringify(m)).join('\n')+'\n',encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr);
 const replies=result.stdout.trim().split('\n').map(line=>JSON.parse(line));assert.equal(replies.length,3);assert.equal(replies[1].result.tools.length,2);assert.equal(replies[0].result.serverInfo.name,'cbgpu-web');
});
