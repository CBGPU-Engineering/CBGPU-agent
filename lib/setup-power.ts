import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { runtimeEnvironment } from './setup-runtime.ts';

const windowsInhibitor = `
param([int]$AgentProcess)
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class CbgpuPower {
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
}
'@
if ([CbgpuPower]::SetThreadExecutionState(2147483649) -eq 0) { exit 1 }
try { Wait-Process -Id $AgentProcess -ErrorAction SilentlyContinue }
finally { [CbgpuPower]::SetThreadExecutionState(2147483648) | Out-Null }
`;

export function inhibitSleep(agent: ChildProcess) {
  if (!agent.pid) return;
  const pid = String(agent.pid);
  const start: Record<string, () => [string, string[]]> = {
    linux: () => ['/usr/bin/systemd-inhibit', ['--what=idle:handle-lid-switch', '--mode=block',
      '--who=CBGPU Agent', '--why=Remote agent is running', '/bin/sh', '-c',
      'while kill -0 "$1" 2>/dev/null; do sleep 3; done', 'cbgpu', pid]],
    darwin: () => ['/usr/bin/caffeinate', ['-i', '-s', '-w', pid]],
    win32: () => [path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', '& { ' + windowsInhibitor + ' } ' + pid]],
  };
  const entry = start[process.platform]?.();
  if (!entry) return;
  const [binary, args] = entry;
  const inhibitor = spawn(binary, args, { env: runtimeEnvironment(), stdio: 'ignore', windowsHide: true });
  inhibitor.once('error', () => {});
  agent.once('exit', () => inhibitor.kill());
  inhibitor.unref();
}
