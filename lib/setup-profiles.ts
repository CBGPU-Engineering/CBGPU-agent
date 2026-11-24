import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { endpoint } from './config.ts';

export type Agent = 'openclaw' | 'hermes';
export type Model = { id: string; label: string; context: number; output: number; vision: boolean };
export type Telegram = { token: string; userId: string };
export const capabilityNames = ['read', 'write', 'shell', 'browser', 'screen', 'schedule', 'send', 'outside', 'vault', 'sudo', 'accounts', 'skills', 'awake'] as const;
export type Permissions = Partial<Record<(typeof capabilityNames)[number], boolean>>;
export function parsePermissions(value: unknown): Permissions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  return Object.fromEntries(capabilityNames.map(name => [name, raw[name] === true]));
}
export const preferredModel = 'cbgpu-qwen38';
export const minimumContext: Record<Agent, number> = { openclaw: 16000, hermes: 64000 };
export const validKey = (value: unknown): value is string =>
  typeof value === 'string' && /^cbgpu_ai_[a-zA-Z0-9_-]{12,250}$/.test(value);

export function modelsFromCatalog(raw: unknown): Model[] {
  if (!Array.isArray(raw)) return [];
  const models: Model[] = [];
  for (const row of raw) {
    if (!row || row.ready === false || typeof row.id !== 'string' || !/^cbgpu-[a-z0-9-]{1,60}$/.test(row.id)) continue;
    if (!Array.isArray(row.capabilities) || !row.capabilities.includes('tools')) continue;
    if (!Number.isSafeInteger(row.context_window) || row.context_window < 1024 || row.context_window > 1048576) continue;
    if (!Number.isSafeInteger(row.max_output_tokens) || row.max_output_tokens < 1 || row.max_output_tokens >= row.context_window) continue;
    models.push({
      id: row.id, label: typeof row.name === 'string' ? row.name.slice(0, 80) : row.id,
      context: row.context_window, output: row.max_output_tokens,
      vision: row.capabilities.includes('vision') || row.capabilities.includes('image'),
    });
  }
  return models.sort((a, b) => Number(b.id === preferredModel) - Number(a.id === preferredModel));
}

export function parseTelegram(token: unknown, userId: unknown): Telegram | null {
  if (!token && !userId) return null;
  if (typeof token !== 'string' || !/^[0-9]{5,20}:[A-Za-z0-9_-]{25,100}$/.test(token) ||
      typeof userId !== 'string' || !/^[1-9][0-9]{0,15}$/.test(userId)) {
    throw new Error('Telegram 봇 토큰과 내 숫자 사용자 ID를 모두 입력해 주세요.');
  }
  return { token, userId };
}

export function makeProfile(agent: Agent, model: Model, root: string, telegram: Telegram | null, permissions: Permissions = {}) {
  if (model.context < minimumContext[agent]) throw new Error('이 모델은 에이전트에 필요한 대화 길이를 지원하지 않아요.');
  const workspace = path.join(root, 'workspace');
  const gatewayToken = randomBytes(32).toString('base64url');
  if (permissions.screen && !['darwin', 'linux', 'win32'].includes(process.platform)) throw new Error('이 운영체제에서는 화면 제어를 지원하지 않아요.');
  if (permissions.screen && agent === 'openclaw' && !model.vision) throw new Error('OpenClaw에서 화면을 제어하려면 이미지 입력을 지원하는 모델이 필요해요.');
  if (permissions.sudo && (agent !== 'hermes' || !permissions.shell || !['linux','darwin'].includes(process.platform))) throw new Error('sudo 인증은 Linux·macOS의 Hermes에서 명령 실행을 켠 뒤 사용할 수 있어요.');
  if (permissions.vault && (agent !== 'hermes' || !permissions.browser)) throw new Error('저장된 로그인은 Hermes의 브라우저 조작과 함께 사용할 수 있어요.');
  if (permissions.accounts && !permissions.browser && !permissions.screen) throw new Error('로그인과 가입을 하려면 브라우저 또는 화면 조작 권한을 켜 주세요.');
  if (permissions.skills && !permissions.shell) throw new Error('스킬을 설치하려면 명령 실행 권한도 켜 주세요.');
  if (permissions.browser && agent === 'hermes' && !permissions.shell) throw new Error('Hermes의 브라우저 조작에는 터미널 권한도 필요해요. 두 권한을 함께 선택해 주세요.');
  if (agent === 'openclaw') {
    const allow = ['session_status',
      ...(permissions.read ? ['read'] : []),
      ...(permissions.write ? ['edit', 'write', 'apply_patch'] : []),
      ...(permissions.shell ? ['exec', 'process'] : []),
      ...(permissions.browser ? ['browser', 'web_fetch'] : []),
      ...(permissions.screen ? ['computer'] : []),
      ...(permissions.schedule ? ['automations'] : []),
      ...(permissions.send && telegram ? ['message'] : []),
    ];
    return {
      filename: 'openclaw.json',
      config: {
        gateway: { mode: 'local', bind: 'loopback', port: 19349, auth: { mode: 'token', token: gatewayToken } },
        models: { mode: 'replace', providers: { cbgpu: {
          baseUrl: endpoint, api: 'openai-completions', apiKey: { source: 'env', provider: 'default', id: 'CBGPU_API_KEY' },
          models: [{ id: model.id, name: model.label, input: model.vision ? ['text', 'image'] : ['text'], contextWindow: model.context, maxTokens: model.output }],
        } } },
        tools: { allow, fs: { workspaceOnly: !permissions.outside }, elevated: { enabled: false },
          exec: { security: permissions.shell ? 'allowlist' : 'deny', ask: 'always' } },
        ...(permissions.screen && process.platform !== 'darwin' &&
          { plugins: { entries: { 'cua-computer': { enabled: true } } } }),
        agents: { defaults: { workspace, model: { primary: 'cbgpu/' + model.id } } },
        ...(telegram && { channels: { telegram: {
          enabled: true, dmPolicy: 'allowlist', allowFrom: [telegram.userId], groupPolicy: 'disabled',
        } } }),
      },
    };
  }
  const tools = ['clarify', 'no_mcp',
    ...(permissions.read || permissions.write ? ['file'] : []),
    ...(permissions.shell ? ['terminal'] : []),
    ...(permissions.browser ? ['browser', 'web'] : []),
    ...(permissions.screen ? ['computer_use'] : []),
    ...(permissions.schedule ? ['cronjob'] : []),
    ...(permissions.skills ? ['skills'] : []),
  ];
  const disabled = [
    ...(!permissions.read ? ['read_file', 'search_files'] : []),
    ...(!permissions.write ? ['write_file', 'patch'] : []),
    ...(!permissions.send ? ['send_message'] : []),
    ...(!permissions.vault ? ['browser_vault'] : []),
  ];
  return {
    filename: 'config.yaml',
    config: {
      model: { provider: 'custom', default: model.id, base_url: endpoint, key_env: 'CBGPU_API_KEY', context_length: model.context, max_tokens: model.output },
      toolsets: tools, platform_toolsets: { cli: tools, telegram: tools, cron: tools },
      agent: { disabled_toolsets: disabled },
      approvals: { mode: 'manual', cron_mode: 'deny', unattended_mode: 'deny' },
      computer_use: { permission_mode: 'standard', autostart: false },
      terminal: { cwd: workspace, backend: 'local' },
      vault: { key_storage: 'keychain' },
    },
  };
}
