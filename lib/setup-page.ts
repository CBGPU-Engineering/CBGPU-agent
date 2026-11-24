export const page = '<!doctype html>' + String.raw`
<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CBGPU 에이전트 설치</title><link rel="stylesheet" href="/setup.css">
<body><main>
<header><strong class="wordmark">CBGPU</strong><h1>내 컴퓨터에<br>에이전트 설치하기</h1>
<p>에이전트는 내 컴퓨터에서 작업하고, 모델은 CBGPU GPU에서 실행돼요.</p></header>
<form id="setup">
<section><h2>어떤 에이전트를 설치할까요?</h2>
<div class="choices">
<label><input type="radio" name="agent" value="openclaw" checked> <span><strong>OpenClaw</strong><small>브라우저와 메신저로 작업하기</small></span></label>
<label><input type="radio" name="agent" value="hermes"> <span><strong>Hermes Agent</strong><small>긴 대화와 반복 작업 이어가기</small></span></label>
</div></section>
<section><h2>CBGPU에 연결하기</h2>
<label for="key">CBGPU API 키</label>
<input id="key" type="password" autocomplete="off" placeholder="cbgpu_ai_…" spellcheck="false" required>
<div class="inline"><a href="https://cbgpu.com/ai?tab=api" target="_blank" rel="noreferrer">API 키 만들기</a><button type="button" id="verify">모델 확인하기</button></div>
<label for="model">모델</label><select id="model" disabled><option value="">CBGPU API 키를 먼저 확인해 주세요</option></select>
<p class="help" id="compatibility">Qwen3.8을 사용할 수 있으면 기본으로 선택해요.</p></section>
<section><h2>Telegram 연결 <span class="optional">선택</span></h2>
<p>Telegram에서 내 에이전트에 작업을 맡기려면 봇을 연결하세요.</p>
<ol><li><a href="https://t.me/BotFather" target="_blank" rel="noreferrer">BotFather</a>에서 <code>/newbot</code>으로 봇을 만들어요.</li><li><a href="https://t.me/userinfobot" target="_blank" rel="noreferrer">UserInfoBot</a>에서 내 숫자 사용자 ID를 확인해요.</li></ol>
<div class="fields"><div><label for="telegram">봇 토큰</label><input id="telegram" type="password" autocomplete="off" spellcheck="false"></div>
<div><label for="user">내 사용자 ID</label><input id="user" inputmode="numeric" pattern="[1-9][0-9]{0,15}"></div></div>
</section>
<section id="permissions"><h2>컴퓨터에서 할 수 있는 일</h2>
<p>설치한 뒤 켜고 끌 수 있어요. 작업에 필요한 항목만 선택해도 됩니다.</p>
<div class="inline"><strong>권한 직접 선택</strong><button id="assistant" type="button">개인 비서 권한 선택</button></div>
<div class="permissions">
<label><input type="checkbox" id="p-read"> <span>파일 읽기<small>문서 내용과 폴더 목록을 확인해요.</small></span></label>
<label><input type="checkbox" id="p-write"> <span>파일 만들기·수정<small>작업 파일을 추가하고 내용을 바꿔요.</small></span></label>
<label><input type="checkbox" id="p-shell"> <span>명령 실행<small>터미널에서 프로그램을 실행해요. 위험 명령에는 승인 설정이 적용돼요.</small></span></label>
<label><input type="checkbox" id="p-browser"> <span>브라우저 조작<small>사이트를 열고 버튼을 누르거나 양식에 입력해요.</small></span></label>
<label><input type="checkbox" id="p-screen"> <span>컴퓨터 화면 조작<small>앱의 화면을 읽고 클릭·입력·스크롤을 해요.</small></span></label>
<label><input type="checkbox" id="p-schedule"> <span>예약 작업<small>내가 정한 시간에 반복 작업을 실행해요.</small></span></label>
<label><input type="checkbox" id="p-send"> <span>메신저 전송<small>연결한 채널에서 에이전트가 메시지를 보낼 수 있어요.</small></span></label>
<label><input type="checkbox" id="p-accounts"> <span>로그인·계정 만들기<small>요청한 앱이나 사이트에서 로그인하고 새 계정도 만들어요.</small></span></label>
<label><input type="checkbox" id="p-outside"> <span>작업 폴더 밖 파일 접근<small>파일 도구에 더 넓은 범위를 허용해요. 터미널은 운영체제 사용자 권한을 따라요.</small></span></label>
</div><p class="help">새로운 서비스도 요청할 수 있어요. 이메일 인증이나 사람 확인이 뜨면 해당 앱이나 사이트에서 이어서 진행해 주세요.</p><p id="screen-note" class="help" hidden></p>
<div id="hermes-options" hidden><h3>로그인과 관리자 작업</h3>
<div class="permissions">
<label><input type="checkbox" id="p-vault"> <span>저장한 사이트 로그인<small>Hermes의 비밀번호 보관함에서 등록한 사이트에 입력해요.</small></span></label>
<label id="sudo-option" hidden><input type="checkbox" id="p-sudo"> <span>이 세션에서 sudo 인증하기<small>시작할 때 이 컴퓨터에 직접 비밀번호를 입력해요. 승인한 관리자 명령에 사용할 수 있어요.</small></span></label>
</div><p class="help">자주 쓰는 사이트는 Hermes 보관함에 로그인 정보를 등록해 주세요. 앱 잠금 해제와 운영체제 승인 화면은 직접 처리해 주세요.</p></div></section>
<section class="risk"><h2>설치 전에 확인해 주세요</h2>
<p>에이전트는 내 컴퓨터의 파일을 읽거나 수정하고 명령을 실행할 수 있어요. 실수로 파일을 바꾸거나 비밀정보를 읽을 수 있으니, 민감한 파일이 없는 작업 폴더에서 시작하세요.</p>
<p>모델이 작업에 사용하는 대화와 파일 내용은 CBGPU에 전달될 수 있어요. Telegram을 연결하면 그곳에서 보낸 메시지도 에이전트에 전달돼요.</p>
<label class="agree"><input id="risk" type="checkbox" required> <span>접근 권한과 위험을 확인했어요.</span></label></section>
<footer><button class="primary" id="apply" type="submit" disabled>설치하고 연결하기</button>
<div id="sudo-auth" hidden><label for="sudo-password">이 세션의 sudo 비밀번호</label><input id="sudo-password" type="password" autocomplete="off" spellcheck="false"><p class="help">이 컴퓨터의 Hermes 프로세스에만 전달해요. 파일로 저장하지 않아요. 원격 작업에서도 관리자 권한이 쓰일 수 있어요.</p></div>
<button id="start" type="button" hidden>에이전트 시작하기</button><button id="stop" type="button" hidden>에이전트 멈추기</button>
<p id="status" role="status" aria-live="polite"></p></footer>
</form></main><script src="/setup.js" defer></script></body></html>`;

export const stylesheet = String.raw`
:root{color-scheme:light dark;--canvas:#edf3fa;--paper:#fff;--ink:#172c45;--soft:#54687e;--border:#ccd8e5;--blue:#0758cb;--white:#fff;--warn:#fff7e3;--warn-ink:#67430a;font-family:system-ui,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
@media(prefers-color-scheme:dark){:root{--canvas:#111d2b;--paper:#192a3c;--ink:#eaf3ff;--soft:#b4c8dd;--border:#42556a;--blue:#9bc6ff;--white:#13263c;--warn:#342b1c;--warn-ink:#f9d894}}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);line-height:1.55}
main{max-width:735px;margin:0 auto;padding:clamp(20px,6vw,64px)}
header{padding:12px 0 30px;border-bottom:1px solid var(--border)}.wordmark{font-size:1.1rem;font-weight:900;color:var(--blue);letter-spacing:-.035em}
h1{margin:13px 0 10px;font-size:clamp(2.15rem,6vw,3.35rem);line-height:1.07;letter-spacing:-.065em}
h2{font-size:1.22rem;margin:0 0 12px;letter-spacing:-.025em}p{margin:8px 0;color:var(--soft)}
section{padding:24px 0;border-bottom:1px solid var(--border)}
.permissions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 14px}.permissions label{display:flex;gap:9px;padding:10px 4px;cursor:pointer}.permissions input{margin:3px 0 0}.permissions small{font-weight:400}.choices,.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.choices>label{display:flex;align-items:center;gap:9px;background:var(--paper);border:1px solid var(--border);border-radius:13px;padding:13px 12px;cursor:pointer}.choices>label:has(:checked){border-color:var(--blue);box-shadow:inset 0 0 0 1px var(--blue)}
input[type=checkbox],input[type=radio]{accent-color:var(--blue);width:18px;height:18px;margin:0;flex:none}
small{display:block;color:var(--soft);font-size:.87rem;margin-top:4px}.optional,.help{font-weight:400;font-size:.9rem;color:var(--soft)}
label:not(.agree){font-weight:650}input:not([type=radio],[type=checkbox]),select{display:block;width:100%;min-height:46px;margin:6px 0 12px;padding:8px 11px;border:1px solid var(--border);border-radius:9px;background:var(--paper);color:var(--ink);font:inherit}
a{color:var(--blue);font-weight:650;text-underline-offset:3px}.inline,footer{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.inline{justify-content:space-between;margin:0 0 14px}
button{background:var(--paper);color:var(--blue);border:1px solid var(--border);border-radius:9px;min-height:44px;padding:8px 13px;font:inherit;font-weight:700;cursor:pointer}[hidden]{display:none!important}button:active{transform:translateY(1px)}button:disabled{cursor:not-allowed;opacity:.62}.primary{background:var(--blue);color:var(--white);border-color:var(--blue)}
ol{padding-left:20px;color:var(--soft)}.risk{padding:17px;margin:23px 0 8px;background:var(--warn);border:0;border-inline-start:3px solid var(--warn-ink);border-radius:6px}.risk p,.risk h2{color:var(--warn-ink)}.agree{display:flex;gap:10px;align-items:center;min-height:44px;font-weight:700;cursor:pointer}
footer{margin-top:23px}#status{min-height:1.5em;flex-basis:100%}#status[data-error=true]{color:var(--warn-ink)}
:focus-visible{outline:2px solid var(--blue);outline-offset:3px}
@media(max-width:450px){.choices,.fields,.permissions{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){button:active{transform:none}}`;

export const client = String.raw`
'use strict';
const ticket = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
const get = id => document.getElementById(id);
const form = get('setup'), select = get('model'), key = get('key');
const status = get('status'), verify = get('verify'), apply = get('apply');
const capabilityNames = ['read','write','shell','browser','screen','schedule','send','outside','accounts'];
let needsSudo = false, platform = '', catalog = [], busy = false, running = false, saved = '';
const selected = () => new FormData(form).get('agent');
const minimum = {openclaw:16000,hermes:64000};
function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
async function request(path, content = {}) {
  const response = await fetch(path, {
    method:'POST', headers:{'content-type':'application/json','x-cbgpu-setup':ticket},
    body:JSON.stringify(content)
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || '설치 화면을 다시 열어 주세요.');
  return result;
}
function renderModels() {
  const permission = get('p-screen');
  const hermes = selected() === 'hermes';
  get('hermes-options').hidden = !hermes;
  get('sudo-option').hidden = !['linux','darwin'].includes(platform);
  get('sudo-auth').hidden = !needsSudo || running;
  if (!hermes) { get('p-vault').checked = false; get('p-sudo').checked = false; }
  get('screen-note').hidden = !permission.checked;
  get('screen-note').textContent = platform === 'darwin' ? 'macOS에서 화면 기록과 손쉬운 사용 권한을 직접 허용해 주세요. OpenClaw는 서명된 Mac 앱을 연결해야 해요.' : platform === 'win32' ? '화면이 켜져 있는 Windows 사용자 세션에서 실행해 주세요.' : 'Linux에서는 프로그램이 열려 있는 그래픽 세션이 필요해요. OpenClaw의 화면 제어는 X11 환경에서 먼저 확인해 주세요.';
  const candidates = catalog.filter(model => model.context >= minimum[selected()] && (!permission.checked || selected() === 'hermes' || model.vision));
  const previous = select.value;
  select.replaceChildren();
  if (!candidates.length) select.add(new Option(catalog.length ? '지원되는 모델이 없어요' : '사용 가능한 모델을 확인해 주세요', ''));
  for (const model of candidates) select.add(new Option(model.label + ' (' + model.context.toLocaleString('ko-KR') + ' 토큰)', model.id));
  if (candidates.some(model => model.id === previous)) select.value = previous;
  select.disabled = !candidates.length || busy;
  apply.disabled = !candidates.length || busy || running;
  if (permission.checked && selected() === 'openclaw' && catalog.some(model => model.context >= minimum.openclaw) && !candidates.length) {
    get('compatibility').textContent = 'OpenClaw의 화면 조작에는 이미지 입력을 지원하는 모델이 필요해요.';
    return;
  }
  get('compatibility').textContent = candidates.length ? '필요한 대화 길이를 지원하는 모델만 보여요.'
    : selected() === 'hermes' ? 'Hermes Agent에는 64,000토큰 이상의 모델이 필요해요.'
    : 'OpenClaw에는 16,000토큰 이상의 모델이 필요해요.';
}
form.querySelectorAll('[name=agent]').forEach(radio => radio.addEventListener('change', renderModels));
get('p-screen').addEventListener('change', renderModels);
get('assistant').addEventListener('click', () => {
  capabilityNames.forEach(name => { get('p-' + name).checked = true; });
  renderModels();
});
key.addEventListener('input', () => { catalog = []; renderModels(); });
verify.addEventListener('click', async () => {
  if (!key.reportValidity()) return;
  verify.disabled = true;
  message('CBGPU에서 사용할 수 있는 모델을 확인하고 있어요.');
  try { catalog = (await request('/models', {key:key.value})).models; message('모델 목록을 불러왔어요.'); }
  catch (error) { catalog = []; message(error.message, true); }
  finally { verify.disabled = false; renderModels(); }
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !form.reportValidity() || !select.value) return;
  const data = { agent:selected(), model:select.value, key:key.value, token:get('telegram').value.trim(),
    user:get('user').value.trim(), accepted:get('risk').checked,
    permissions:Object.fromEntries([...capabilityNames,'vault','sudo'].map(name => [name, get('p-' + name).checked])) };
  busy = true; renderModels();
  message('공식 설치 파일을 내려받고 CBGPU에 연결하고 있어요. 몇 분 걸릴 수 있어요.');
  try {
    await request('/install', data);
    saved = data.agent; needsSudo = data.permissions.sudo;
    key.value = ''; get('telegram').value = ''; catalog = [];
    get('start').hidden = false;
    message('설치와 설정을 마쳤어요. 에이전트를 시작해 주세요.');
  } catch (error) { message(error.message, true); }
  finally { busy = false; renderModels(); }
});
get('start').addEventListener('click', async () => {
  try {
    const field = get('sudo-password');
    const sudoPassword = needsSudo ? field.value : '';
    field.value = '';
    const result = await request('/start', {agent:saved,sudoPassword});
    running = true; get('start').hidden = true; get('stop').hidden = false;
    message(result.message); renderModels();
    if (result.url) {
      const link = document.createElement('a');
      link.href = result.url; link.textContent = '에이전트 창 열기'; link.target = '_blank'; link.rel = 'noreferrer';
      status.append(' ', link);
    }
  } catch (error) { message(error.message, true); }
});
get('stop').addEventListener('click', async () => {
  try { await request('/stop'); running = false; get('start').hidden = false; get('stop').hidden = true; renderModels(); message('에이전트를 멈췄어요.'); }
  catch (error) { message(error.message, true); }
});
request('/status').then(result => {
  saved = result.saved; needsSudo = result.sudo; platform = result.platform;
  get('start').hidden = !saved; renderModels();
}).catch(error => message(error.message, true));
`;
