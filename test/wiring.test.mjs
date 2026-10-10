// sidepanel 의 init() 이 정말 모든 리스너를 붙이는지 확인한다.
// 저장된 상태(특히 mode:'car')에 따라 조기 return 으로 배선을 건너뛴 적이 있다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('sidepanel.html', root), 'utf8');
const js = fs.readFileSync(new URL('sidepanel.js', root), 'utf8');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

/**
 * 저장된 설정을 주고 init 을 돌린 뒤, 어떤 요소에 리스너가 붙었는지 본다.
 * fetchImpl 을 주면 네트워크를 그것으로 흉내 낸다(기본은 막힌 네트워크). (url, init, calls) 로 부른다.
 */
/** search 는 페이지 주소의 물음표 뒤 — 비교작성 탭은 sidepanel.html?compare=갈래 로 열린다. */
async function boot(saved, { fetchImpl = null, search = '' } = {}) {
  const dom = new JSDOM(html, { url: `https://example.org/sidepanel.html${search}`, runScripts: 'outside-only' });
  const { window } = dom;
  const wired = new Map();

  // addEventListener 호출을 기록한다
  const orig = window.Element.prototype.addEventListener;
  window.Element.prototype.addEventListener = function (type, fn, opts) {
    const id = this.id || this.tagName;
    if (!wired.has(id)) wired.set(id, new Set());
    wired.get(id).add(type);
    return orig.call(this, type, fn, opts);
  };

  const calls = { load: 0, urls: [], downloads: [], clipboard: [], intervals: [], tabs: [], tabUpdates: [], tabListeners: [], storageListeners: [] };
  // 세션 저장소(chrome.storage.session) — 사이드패널이 비교작성 탭에 오린 견적서를 건네는 곳. 창을 다 닫으면 사라지는 것이라 따로 둔다.
  const session = {};
  // 자동 갱신은 스위치 없이 늘 돈다. 어떤 간격으로 타이머를 거는지만 적어 둔다.
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, ms, ...rest) => { calls.intervals.push(ms); return realSetInterval(fn, ms, ...rest); };
  // 쓴 것은 기억한다 — 활동 기록이 저장소를 거쳐 다시 읽히는지 여기서 본다.
  const store = { ...saved };
  window.chrome = {
    storage: {
      local: {
        get: async () => store,
        set: async (obj) => { Object.assign(store, obj); },
        remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
      },
      session: {
        get: async () => session,
        set: async (obj) => { Object.assign(session, obj); },
      },
      // 저장소 변화 — 검사가 리스너를 직접 불러 다른 창(사이드패널·비교작성 탭)이 쓴 것을 흉내 낸다.
      onChanged: { addListener: (fn) => { calls.storageListeners.push(fn); } },
    },
    runtime: {
      sendNativeMessage: async () => { throw new Error('no host'); },
      getManifest: () => ({ version: '9.9.9' }),
      getURL: (path) => `chrome-extension://test/${path}`,
    },
    windows: { update: async () => {} },
    tabs: {
      query: async () => [],
      create: async (opts) => { calls.tabs.push(opts); },
      update: async (id, opts) => { calls.tabUpdates.push([id, opts]); },
      // 로그인 복귀 신호. 테스트가 리스너를 직접 불러 "eclass 탭이 다 읽혔다" 를 흉내 낸다.
      onUpdated: { addListener: (fn) => { calls.tabListeners.push(fn); } },
    },
    downloads: { download: async (opts) => { calls.downloads.push(opts); } },
    scripting: { executeScript: async () => [{ result: null }] },
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'wiring-test', clipboard: { writeText: async (text) => { calls.clipboard.push(text); } } },
  });
  // 네트워크는 막는다. load() 가 실패해도 배선은 이미 끝나 있어야 한다.
  // 어느 화면을 두드렸는지는 남긴다 — 시작하자마자 한 달을 훑는지 여기서 본다.
  window.fetch = fetchImpl
    ? (url, init) => { calls.load++; calls.urls.push(String(url)); return fetchImpl(url, init, calls); }
    : async (url) => { calls.load++; calls.urls.push(String(url)); throw new Error('offline'); };

  // 타이머는 Node 것을 그대로 쓴다. jsdom 의 setTimeout 을 전역에 덮으면 서로를 불러 무한 재귀가 된다.
  const globals = ['document', 'chrome', 'fetch', 'DOMParser', 'Option', 'Blob', 'URL', 'Element', 'HTMLElement', 'FileReader'];
  for (const g of globals) globalThis[g] = window[g] ?? globalThis[g];
  globalThis.window = window;
  globalThis.document = window.document;

  await import(`../sidepanel.js?bust=${Math.random()}`);
  await new Promise((r) => setTimeout(r, 60));   // init 의 await 가 풀릴 시간
  globalThis.setInterval = realSetInterval;
  return { wired, window, calls, store, session };
}

console.log('회의실 모드로 시작');
{
  const { wired, window, calls } = await boot({ mode: 'room' });
  const doc = window.document;
  t('날짜 입력에 change', () => assert.ok(wired.get('date')?.has('change')));
  t('날짜 입력에 input', () => assert.ok(wired.get('date')?.has('input')));
  t('자동 갱신은 스위치 없이 늘 돈다 (60초)', () => {
    assert.equal(doc.getElementById('auto'), null, '자동 갱신 스위치가 남아 있다');
    assert.ok(calls.intervals.includes(60_000), '걸린 타이머: ' + calls.intervals.join(', '));
  });
  t('설정의 로컬 CLI·API 키는 접혀 있다', () => {
    const subs = [...doc.querySelectorAll('.settings details.sub')];
    assert.equal(subs.length, 2);
    assert.ok(subs.every((d) => !d.open));
    assert.match(subs[0].querySelector('summary').textContent, /로컬 Claude CLI/);
    assert.match(subs[1].querySelector('summary').textContent, /Anthropic API 키/);
  });
  t('설정 및 연결·활동 로그·페이지 구조 캡처는 `설정` 한 줄로 접혀 있다', () => {
    const box = doc.getElementById('settingsBox');
    assert.ok(box, '#settingsBox 가 없다');
    assert.equal(box.tagName, 'DETAILS');
    assert.ok(!box.open, '처음부터 펼쳐져 있다');
    assert.ok(box.closest('footer.settings'), '패널 맨 아래 footer 안이 아니다');
    assert.match(box.firstElementChild.textContent, /^설정연결 · 활동 로그 · 진단$/);
    const rows = [...box.querySelector('.settings-body').children].map((d) => d.matches('details.diag') && d.querySelector('summary').textContent);
    assert.equal(rows.length, 3);
    assert.match(rows[0] || '', /^설정 및 연결/);
    assert.match(rows[1] || '', /^활동 로그/);
    assert.match(rows[2] || '', /^페이지 구조 캡처/);
  });
  t('접힌 요약 줄에 CLI 배지와 키 유무가 보인다', () => {
    assert.ok(doc.querySelector('details.sub > summary #cliState'));
    assert.equal(doc.getElementById('apiKeyState').textContent, 'CLI 가 없을 때만');
  });
  t('CLI 다시 확인 버튼', () => assert.ok(wired.get('cliCheck')?.has('click')));
  t('API 키 입력', () => assert.ok(wired.get('apiKey')?.has('change') || wired.get('apiKey')?.has('input')));
  t('회의실 탭 클릭', () => assert.ok(wired.get('tabRoom')?.has('click')));
  t('차량 탭 클릭', () => assert.ok(wired.get('tabCar')?.has('click')));
  t('내 예약 탭 클릭', () => assert.ok(wired.get('tabMine')?.has('click')));
  t('내 예약 목록 클릭', () => assert.ok(wired.get('mineList')?.has('click')));
  t('기간 선택', () => assert.ok(wired.get('spanDays')?.has('change')));
  t('내 이름 입력', () => assert.ok(wired.get('myName')?.has('change')));
  t('새로고침 클릭', () => assert.ok(wired.get('refresh')?.has('click')));
  t('이전/다음 날', () => {
    assert.ok(wired.get('prevDay')?.has('click'));
    assert.ok(wired.get('nextDay')?.has('click'));
  });
  t('오늘 버튼', () => assert.ok(wired.get('today')?.has('click')));
  t('현황 옆 페이지 열기 아이콘', () => assert.ok(wired.get('openPageInline')?.has('click')));
  t('예약/연장/취소/수정 버튼', () => {
    assert.ok(wired.get('submit')?.has('click'));
    assert.ok(wired.get('extend')?.has('click'));
    assert.ok(wired.get('cancelBooking')?.has('click'));
    assert.ok(wired.get('modify')?.has('click'), '수정 버튼에 리스너가 없다');
  });
}

console.log('홈의 내 예약 카드에서 누른 날짜로 연다');
// 패널은 부탁이 없으면 오늘을 연다. 부탁 날짜가 오늘과 겹치면 따랐는지 무시했는지 가릴 수 없어 한 주 뒤로 잡는다.
const JUMP_DATE = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
{
  const { window, store } = await boot({ mode: 'mine', homeJump: { date: JUMP_DATE, mode: 'car', at: Date.now() } });
  const doc = window.document;
  t('부탁받은 날짜가 잡힌다', () => assert.equal(doc.getElementById('date').value, JUMP_DATE));
  t('저장된 모드 대신 차량 탭으로 열린다', () =>
    assert.ok(doc.getElementById('tabCar').classList.contains('active')));
  t('부탁은 읽고 지운다', () => assert.equal(store.homeJump, undefined));
}
{
  const { window, store } = await boot({ mode: 'room', homeJump: { date: JUMP_DATE, mode: 'car', at: Date.now() - 10 * 60_000 } });
  const doc = window.document;
  t('묵은 부탁은 무시한다', () => assert.notEqual(doc.getElementById('date').value, JUMP_DATE));
  t('묵은 부탁도 지운다', () => assert.equal(store.homeJump, undefined));
  t('회의실 탭 그대로', () => assert.ok(doc.getElementById('tabRoom').classList.contains('active')));
}
{
  // 홈 카드의 근태 건(출장·외근·휴가)을 누른 것이다. 날짜를 옮기지 않고 근태 탭으로 간다.
  const { window, store } = await boot({ mode: 'room', homeJump: { date: JUMP_DATE, mode: 'attend', at: Date.now() } });
  const doc = window.document;
  t('근태 건의 부탁이면 근태 탭으로 열린다', () => {
    assert.ok(doc.getElementById('tabAttend').classList.contains('active'));
    assert.ok(!doc.getElementById('attend').classList.contains('hidden'));
  });
  t('근태 건의 부탁은 회의실 날짜를 옮기지 않는다', () => assert.notEqual(doc.getElementById('date').value, JUMP_DATE));
  t('근태 건의 부탁도 읽고 지운다', () => assert.equal(store.homeJump, undefined));
}

console.log('패널 머리의 홈 카드 체크박스');
{
  const { wired, window, store } = await boot({ mode: 'room' });
  const doc = window.document;
  const box = doc.getElementById('homeCard');
  t('머리(새로고침 옆)에 있다', () => {
    assert.ok(box, '체크박스가 없다');
    assert.equal(box.type, 'checkbox');
    assert.ok(box.closest('header.app-header'));
  });
  t('설정이 없으면 켜진 채로 뜬다', () => assert.equal(box.checked, true));
  t('change 리스너', () => assert.ok(wired.get('homeCard')?.has('change')));
  t('무엇을 켜고 끄는지 적혀 있다', () => assert.match(box.closest('label').textContent, /홈에 WORKSPACE/));

  box.checked = false;
  box.dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 40));
  t('끄면 저장된다', () => assert.equal(store.homeCard, false));
  t('끈 것이 활동 기록에 남는다', () =>
    assert.ok((store.activityLog || []).some((e) => e.kind === 'setting' && /끔/.test(e.text))));

  box.checked = true;
  box.dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 40));
  t('다시 켜면 저장된다', () => assert.equal(store.homeCard, true));
}
{
  const { window } = await boot({ mode: 'room', homeCard: false });
  t('꺼 둔 설정이면 꺼진 채로 뜬다', () =>
    assert.equal(window.document.getElementById('homeCard').checked, false));
}

console.log('설정 및 연결의 Teams 버튼 체크박스');
{
  const { wired, window, store } = await boot({ mode: 'room' });
  const doc = window.document;
  const box = doc.getElementById('teamsButton');
  t('설정 및 연결 안에 있다', () => {
    assert.ok(box, '체크박스가 없다');
    assert.equal(box.type, 'checkbox');
    assert.match(box.closest('details.diag')?.querySelector('summary')?.textContent || '', /설정 및 연결/);
  });
  t('설정이 없으면 켜진 채로 뜬다', () => assert.equal(box.checked, true));
  t('change 리스너', () => assert.ok(wired.get('teamsButton')?.has('change')));
  t('무엇을 켜고 끄는지 적혀 있다', () => assert.match(box.closest('label').textContent, /Teams/));

  box.checked = false;
  box.dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 40));
  t('끄면 저장된다', () => assert.equal(store.teamsButton, false));
  t('끈 것이 활동 기록에 남는다', () =>
    assert.ok((store.activityLog || []).some((e) => e.kind === 'setting' && /Teams.*끔/.test(e.text))));

  box.checked = true;
  box.dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 40));
  t('다시 켜면 저장된다', () => assert.equal(store.teamsButton, true));
}
{
  const { window } = await boot({ mode: 'room', teamsButton: false });
  t('꺼 둔 설정이면 꺼진 채로 뜬다', () =>
    assert.equal(window.document.getElementById('teamsButton').checked, false));
}

console.log('설정 및 연결의 접수 미확인 공문 카드 체크박스');
{
  const { wired, window, store } = await boot({ mode: 'room' });
  const doc = window.document;
  const box = doc.getElementById('homeUncfm');
  t('설정 및 연결 안에 있다', () => {
    assert.ok(box, '체크박스가 없다');
    assert.equal(box.type, 'checkbox');
    assert.match(box.closest('details.diag')?.querySelector('summary')?.textContent || '', /설정 및 연결/);
  });
  t('설정이 없으면 켜진 채로 뜬다', () => assert.equal(box.checked, true));
  t('change 리스너', () => assert.ok(wired.get('homeUncfm')?.has('change')));
  t('무엇을 켜고 끄는지 적혀 있다', () => assert.match(box.closest('label').textContent, /접수 미확인 공문/));

  box.checked = false;
  box.dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 40));
  t('끄면 저장된다', () => assert.equal(store.homeUncfm, false));
  t('끈 것이 활동 기록에 남는다', () =>
    assert.ok((store.activityLog || []).some((e) => e.kind === 'setting' && /접수 미확인.*끔/.test(e.text))));

  box.checked = true;
  box.dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 40));
  t('다시 켜면 저장된다', () => assert.equal(store.homeUncfm, true));
}
{
  const { window } = await boot({ mode: 'room', homeUncfm: false });
  t('꺼 둔 설정이면 꺼진 채로 뜬다', () =>
    assert.equal(window.document.getElementById('homeUncfm').checked, false));
}

console.log('설정 및 연결의 미회람 문서 자동 열람 체크박스');
{
  const { wired, window, store } = await boot({ mode: 'room' });
  const doc = window.document;
  const box = doc.getElementById('docCirculate');
  const line = doc.getElementById('docCirculateState');
  t('설정 및 연결 안에 있다', () => {
    assert.ok(box, '체크박스가 없다');
    assert.equal(box.type, 'checkbox');
    assert.match(box.closest('details.diag')?.querySelector('summary')?.textContent || '', /설정 및 연결/);
  });
  // 읽음 처리는 되돌릴 수 없다. 켠 적이 없는 브라우저에서 켜진 채로 뜨면 안 된다.
  t('설정이 없으면 꺼진 채로 뜬다', () => assert.equal(box.checked, false));
  t('change 리스너', () => assert.ok(wired.get('docCirculate')?.has('change')));
  t('무엇을 켜고 끄는지 적혀 있다', () => assert.match(box.closest('label').textContent, /미회람 문서/));
  t('한 번도 돌지 않았으면 결과 줄은 감춘다', () => assert.equal(line.hidden, true));

  box.checked = true;
  box.dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 40));
  t('켜면 저장된다', () => assert.equal(store.docCirculate, true));
  t('켠 것이 활동 기록에 남는다', () =>
    assert.ok((store.activityLog || []).some((e) => e.kind === 'setting' && /미회람.*켬/.test(e.text))));

  box.checked = false;
  box.dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 40));
  t('끄면 저장된다', () => assert.equal(store.docCirculate, false));
}
{
  const at = new Date('2026-10-01T09:00:00').getTime();
  const { window } = await boot({
    mode: 'room', docCirculate: true,
    docCirculateState: { date: '2026-10-01', state: 'done', at, ok: true, text: '미회람 문서 5건을 모두 열어 회람 처리했습니다' },
  });
  const doc = window.document;
  t('켜 둔 설정이면 켜진 채로 뜬다', () => assert.equal(doc.getElementById('docCirculate').checked, true));
  t('홈에서 돈 마지막 결과를 언제 한 것인지와 함께 보여준다', () => {
    const line = doc.getElementById('docCirculateState');
    assert.equal(line.hidden, false);
    assert.equal(line.textContent, '2026-10-01 09:00:00 · 미회람 문서 5건을 모두 열어 회람 처리했습니다');
  });
}

console.log('차량 모드로 시작 (조기 return 회귀 방지)');
{
  const { wired, window, calls } = await boot({ mode: 'car' });
  const doc = window.document;
  t('날짜 입력에 change', () => assert.ok(wired.get('date')?.has('change')));
  t('회의실 탭 클릭', () => assert.ok(wired.get('tabRoom')?.has('click')));
  t('차량 탭 클릭', () => assert.ok(wired.get('tabCar')?.has('click')));
  t('새로고침 클릭', () => assert.ok(wired.get('refresh')?.has('click')));
  t('시간 선택', () => assert.ok(wired.get('hourStart')?.has('change')));
  t('현황 옆 페이지 열기 아이콘', () => assert.ok(wired.get('openPageInline')?.has('click')));
  t('자동 갱신 타이머가 걸린다', () => assert.ok(calls.intervals.includes(60_000)));

  // 차량은 오래 "조회 전용"이었다. 신청 칸이 뜨는지 여기서 붙잡아 둔다.
  t('차량 탭에서 신청 칸(행선지·동승자)이 보인다', () => {
    assert.ok(!doc.getElementById('carFields').classList.contains('hidden'));
    assert.ok(doc.getElementById('fPlace'));
    assert.ok(doc.getElementById('fPassenger'));
  });
  t('차량 탭에서는 회의주제가 아니라 사용목적', () =>
    assert.equal(doc.getElementById('lblTitle').textContent, '사용목적'));
  t('더 이상 조회 전용이라고 하지 않는다', () =>
    assert.doesNotMatch(doc.querySelector('.selection-hint').textContent, /조회 전용/));
  t('수정 버튼이 DOM 에 있다', () => assert.ok(doc.getElementById('modify')));
}

console.log('회의실 탭에서는 차량 신청 칸이 숨는다');
{
  const { window } = await boot({ mode: 'room' });
  const doc = window.document;
  t('행선지 칸이 숨어 있다', () =>
    assert.ok(doc.getElementById('carFields').classList.contains('hidden')));
  t('회의 주제 라벨', () => assert.equal(doc.getElementById('lblTitle').textContent, '회의 주제'));
  t('수정 중 안내는 처음엔 숨어 있다', () =>
    assert.ok(doc.getElementById('editNote').classList.contains('hidden')));
}

console.log('Claude 가 안 붙어 있으면 말로 찾기 칸이 잠긴다');
{
  // 이 harness 의 sendNativeMessage 는 늘 던진다 = 로컬 CLI 없음.
  const { window, calls } = await boot({ mode: 'room' });
  const doc = window.document;
  t('입력칸과 버튼이 잠겨 있다', () => {
    assert.ok(doc.getElementById('askInput').disabled, '입력칸이 열려 있다');
    assert.ok(doc.getElementById('askGo').disabled, '찾기 버튼이 눌린다');
  });
  t('왜 잠겼는지 플레이스홀더에 적혀 있다', () =>
    assert.equal(doc.getElementById('askInput').placeholder, 'claude가 연결되지 않았습니다'));
  const helps = [...doc.querySelectorAll('.cli-help')];
  t('두 말 칸(말로 찾기·말로 채우기)과 공문의 문서 넣는 곳 아래, 설정에 연결 지침 복사 버튼이 나온다', () => {
    assert.deepEqual(helps.map((p) => p.parentElement.className), ['at-chat card off', 'gm-intake off', 'ask card off']);
    assert.ok(helps.every((p) => !p.hidden && p.querySelector('button.cli-guide-copy')));
    assert.equal(doc.getElementById('cliGuide').hidden, false);
  });
  t('근태의 말로 채우기 칸은 규칙으로 읽히니 열려 있되, 연결된 것으로 오인하지 않게 회색(off)이고 플레이스홀더에 까닭이 적힌다', () => {
    const input = doc.getElementById('atChatInput');
    assert.ok(!input.disabled, '말로 채우기 칸이 잠겼다');
    assert.ok(doc.querySelector('.at-chat').classList.contains('off'));
    assert.equal(input.placeholder, 'claude 미연결 — 규칙으로만 읽습니다');
    assert.match(input.title, /규칙으로 읽고 목적은 채우지 못합니다/);
  });
  doc.querySelector('section.ask .cli-guide-copy').click();
  await new Promise((r) => setTimeout(r, 30));
  t('누르면 다른 에이전트에 붙여 넣을 지침이 클립보드에 담긴다 — 브라우저가 댄 까닭과 등록 명령이 들어 있다', () => {
    const text = calls.clipboard.at(-1) || '';
    assert.match(text, /Claude Code CLI 를 연결해 주세요/);
    assert.match(text, /"no host"/);
    assert.match(text, /bridge_ops\.ps1" install/);
    assert.match(doc.querySelector('section.ask .cli-guide-copy').textContent, /복사됨/);
  });
}

console.log('API 키가 있으면 말로 찾기 칸이 열린다');
{
  const { window } = await boot({ mode: 'room', apiKey: 'sk-ant-test' });
  const doc = window.document;
  t('입력칸이 열려 있다', () => assert.ok(!doc.getElementById('askInput').disabled));
  t('제목 몫을 하던 플레이스홀더로 돌아온다', () =>
    assert.equal(doc.getElementById('askInput').placeholder, '말로 찾는 회의실/차량'));
  t('접힌 요약 줄에 키가 저장됐다고 적힌다', () =>
    assert.equal(doc.getElementById('apiKeyState').textContent, '저장됨'));
  t('말 칸의 연결 지침 줄은 숨고, 설정의 버튼은 CLI 가 없으니 남는다', () => {
    assert.ok([...doc.querySelectorAll('.cli-help')].every((p) => p.hidden));
    assert.equal(doc.getElementById('cliGuide').hidden, false);
  });
  t('근태의 말로 채우기 칸도 제 낯으로 돌아온다 — 회색이 걷히고 예시 플레이스홀더', () => {
    assert.ok(!doc.querySelector('.at-chat').classList.contains('off'));
    assert.equal(doc.getElementById('atChatInput').placeholder, '예) 내일 오후 2~4시 부산시청 외근');
  });
}

console.log('내 예약 모드로 시작 (조기 return 회귀 방지)');
{
  const { wired, window, store } = await boot({ mode: 'mine' });
  const doc = window.document;
  t('회의실 탭 클릭', () => assert.ok(wired.get('tabRoom')?.has('click')));
  t('내 예약 탭 클릭', () => assert.ok(wired.get('tabMine')?.has('click')));
  t('내 예약 목록 클릭', () => assert.ok(wired.get('mineList')?.has('click')));
  t('기간 선택', () => assert.ok(wired.get('spanDays')?.has('change')));
  t('새로고침 클릭', () => assert.ok(wired.get('refresh')?.has('click')));
  t('내 예약 탭이 켜져 있다', () =>
    assert.ok(doc.getElementById('tabMine').classList.contains('active')));
  t('탭과 화면 제목은 현황이고(머리의 KRS WORKSPACE 아래), 목록 제목이 WORKSPACE 현황이다', () => {
    assert.equal(doc.getElementById('tabMine').textContent, '현황');
    assert.match(doc.getElementById('appTitle').textContent, /^현황/);
    assert.match(doc.getElementById('scheduleTitle').textContent, /^WORKSPACE 현황/);
  });
  t('근태 화면의 안내 글은 건드리지 않는다 (예약 현황 쪽 안내만 바꾼다)', () => {
    assert.equal(doc.getElementById('atRangeHint').textContent, '오늘부터 전부 · 정산 중인 출장은 다녀온 뒤 4주까지');
    assert.equal(doc.querySelector('.schedule .selection-hint').textContent, '누르면 그 날짜·근태로 갑니다');
  });
  {
    // 신청 내역의 조회 기간 — 한 줄이다: 시작일 ~ 종료일 · 조회. 지난 내역(히스토리) 버튼은 뺐다(2026-10-04 사용자 지정).
    // 4주·8주 버튼은 제목 줄의 달력 버튼 왼쪽에 4W·8W 로 선다(2026-10-05 사용자 지정 — 그 전에는 이 줄의 날짜 칸 왼쪽이었다).
    // 4주·8주는 기본 보기(오늘부터 전부 + 여비 정산이 덜 끝난 다녀온 출장)에서 지난 출장을 언제까지 보일지다.
    const now = new Date();
    const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
    const two = (n) => String(n).padStart(2, '0');
    const ymdOf = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
    const mdOf = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
    const one = (d, bare) => (bare ? mdOf(d) : `${String(d.getFullYear()).slice(2)}/${mdOf(d)}`);
    // 머리 줄의 기간 글 — 올해 안이면 "9/6 ~ 10/4", 올해 밖에 걸치면 해를 붙인다.
    const span = (a, b) => { const bare = a.getFullYear() === now.getFullYear() && b.getFullYear() === now.getFullYear(); return `${one(a, bare)} ~ ${one(b, bare)}`; };
    const back = (n) => doc.querySelector(`.at-list-head button[data-back="${n}"]`);
    const pressed = () => [4, 8].map((n) => [back(n).getAttribute('aria-pressed'), back(n).classList.contains('active')].join());
    const head = () => [doc.getElementById('atRange').textContent, doc.getElementById('atRangeHint').textContent];
    const query = (from, to) => {
      doc.getElementById('atRangeFrom').value = from;
      doc.getElementById('atRangeTo').value = to;
      doc.getElementById('atRangeGo').click();
    };
    t('히스토리 버튼은 없다 — 머리 줄에는 4W · 8W · 달력 · HR 열기가 차례로 선다', () => {
      assert.equal(doc.getElementById('atHistoryBtn'), null);
      assert.equal(doc.getElementById('atRangeBtn').nextElementSibling.id, 'atOpenHr');
      assert.deepEqual([...doc.querySelectorAll('.at-list-head > button')].map((b) => b.id || b.textContent), ['atBack4', 'atBack8', 'atRangeBtn', 'atOpenHr']);
      assert.deepEqual([4, 8].map((n) => back(n).getAttribute('aria-label')), ['4주 전부터 조회', '8주 전부터 조회']);
    });
    t('조회 기간은 한 줄이다 — 시작일 ~ 종료일 · 조회. 4W·8W 는 처음엔 둘 다 꺼져 있다(안 봄·2주·지난 1·3·6개월·1년 버튼은 없다)', () => {
      const box = doc.getElementById('atRangeBox');
      assert.equal(box.children.length, 1);
      assert.deepEqual([...box.firstElementChild.children].map((n) => n.id || n.dataset.back || n.textContent), ['atRangeFrom', '~', 'atRangeTo', 'atRangeGo']);
      assert.deepEqual([...box.querySelectorAll('button[data-back]')], [], '4주·8주는 이 칸에 없다 — 제목 줄의 4W·8W 다');
      assert.deepEqual(pressed(), ['false,false', 'false,false']);
      assert.equal(box.querySelector('button[data-months]'), null);
    });
    doc.getElementById('atRangeBtn').click();
    t('기본 보기의 기간: 4주 전부터 근태를 올려 둔 가장 늦은 날까지 — 올려 둔 것이 없으면 오늘에서 끝난다', () => {
      assert.deepEqual(head(), [span(ago(28), now), '오늘부터 전부 · 정산 중인 출장은 다녀온 뒤 4주까지']);
      assert.deepEqual([doc.getElementById('atRangeFrom').value, doc.getElementById('atRangeTo').value], [ymdOf(ago(28)), ymdOf(now)]);
      assert.equal(doc.getElementById('atRangeBtn').classList.contains('active'), false);
    });
    query('2026-07-01', '2026-08-31');
    t('날짜 칸에 기간을 적어 조회하면 달력 버튼이 켜지고 4주·8주는 둘 다 꺼진다', () => {
      assert.deepEqual(head(), [span(new Date(2026, 6, 1), new Date(2026, 7, 31)), '근태 날짜 기준 · 기간 지정']);
      assert.equal(doc.getElementById('atRangeBtn').classList.contains('active'), true);
      assert.deepEqual(pressed(), ['false,false', 'false,false']);
    });
    query('2025-10-04', '2026-10-04');
    t('한 해를 조회하면 머리 줄에 해를 붙인다 — "10/4 ~ 10/4" 로 보이지 않게', () =>
      assert.equal(doc.getElementById('atRange').textContent, '25/10/4 ~ 26/10/4'));
    back(8).click();
    t('8주를 누르면 8주 전부터 오늘까지를 곧바로 조회한다(조회를 따로 누르지 않는다) — 8주가 켜지고, 고른 값을 저장한다(홈의 WORKSPACE 카드도 이 값을 따른다)', () => {
      assert.deepEqual(head(), [span(ago(56), now), '근태 날짜 기준 · 8주 전부터 전부']);
      assert.deepEqual([doc.getElementById('atRangeFrom').value, doc.getElementById('atRangeTo').value], [ymdOf(ago(56)), ymdOf(now)]);
      assert.deepEqual([store.tripBackWeeks, pressed()], [8, ['false,false', 'true,true']]);
      assert.equal(doc.getElementById('atRangeBtn').classList.contains('active'), false, '켜진 것은 바로 옆의 8W 다 — 달력 버튼은 날짜를 직접 정해 조회할 때만 켜진다');
    });
    back(8).click();
    t('켜져 있는 것을 다시 누르면 기본 보기로 돌아온다 — 정산 중인 출장은 마지막에 누른 8주까지', () => {
      assert.deepEqual(head(), [span(ago(56), now), '오늘부터 전부 · 정산 중인 출장은 다녀온 뒤 8주까지']);
      assert.deepEqual([store.tripBackWeeks, pressed()], [8, ['false,false', 'false,false']]);
      assert.equal(doc.getElementById('atRangeBtn').classList.contains('active'), false);
    });
    back(4).click();
    t('4주를 누르면 4주 전부터를 조회한다', () => {
      assert.deepEqual(head(), [span(ago(28), now), '근태 날짜 기준 · 4주 전부터 전부']);
      assert.deepEqual([store.tripBackWeeks, pressed()], [4, ['true,true', 'false,false']]);
    });
  }
  t('목록이 보이고 격자는 숨는다', () => {
    assert.ok(!doc.getElementById('mineWrap').classList.contains('hidden'));
    assert.ok(doc.getElementById('grid').classList.contains('hidden'));
  });
  t('제목 옆에 훑는 기간이 찍힌다', () =>
    assert.match(doc.getElementById('scheduleDate').textContent, /^\d+\/\d+ ~ \d+\/\d+$/));
}

console.log('현황 제목은 보고 있는 날짜를 말해야 한다');
{
  const { window } = await boot({ mode: 'room' });
  const doc = window.document;
  doc.getElementById('date').value = '2026-09-19';
  doc.getElementById('date').dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 30));
  t('9월 19일 (토)', () =>
    assert.equal(doc.getElementById('scheduleDate').textContent, '9월 19일 (토)'));
}

console.log('활동 로그 — 남기고, 보여주고, 복사한다');
{
  const SECRET = 'sk-ant-wiring-secret';
  const { window, wired, calls, store } = await boot({ mode: 'room', apiKey: SECRET });
  const doc = window.document;
  const settle = () => new Promise((r) => setTimeout(r, 40));
  await new Promise((r) => setTimeout(r, 150));   // 미리 훑기까지 끝나 기록이 더 늘지 않을 때까지
  // jsdom 에는 Blob URL 이 없다. 파일 저장은 주소만 있으면 된다.
  globalThis.URL.createObjectURL = () => 'blob:wiring-test';
  globalThis.URL.revokeObjectURL = () => {};

  t('로그 버튼과 칸에 리스너', () => {
    assert.ok(wired.get('logBox')?.has('toggle'));
    assert.ok(wired.get('settingsBox')?.has('toggle'), '바깥 설정을 펼칠 때도 그려야 한다');
    for (const id of ['logCopy', 'logSave', 'logClear']) assert.ok(wired.get(id)?.has('click'), id);
  });

  const log = () => store.activityLog || [];
  t('패널을 연 것이 남는다 (버전 포함)', () =>
    assert.ok(log().some((e) => e.kind === 'open' && /v9\.9\.9/.test(e.text))));
  // 여기서는 네트워크가 막혀 있다. 그것은 로그인 문제가 아니므로 auth 로 적히면 안 된다
  // — 예전에는 "열려 있는 eclass 탭이 없습니다" 라는 로그인 안내로 둔갑했다.
  t('조회 실패가 남고, 막힌 네트워크를 로그인 문제로 적지 않는다', () =>
    assert.ok(log().some((e) => e.kind === 'load' && !e.ok && /조회 실패/.test(e.text) && !e.data?.auth)));
  t('한 달 훑기 실패도 한 번 남는다', () =>
    assert.equal(log().filter((e) => e.kind === 'scan').length, 1));
  t('다리가 없다는 것도 남는다', () =>
    assert.ok(log().some((e) => e.kind === 'cli' && !e.ok)));
  t('API 키 같은 비밀은 남지 않는다', () => assert.ok(!JSON.stringify(log()).includes(SECRET)));
  t('요약에 건수와 실패 수', () =>
    assert.match(doc.getElementById('logCount').textContent, /^\d+건 · 실패 \d+$/));

  const box = doc.getElementById('logBox');
  const out = doc.getElementById('logOut');
  t('닫혀 있을 때는 목록을 그리지 않는다', () => assert.equal(out.textContent, ''));
  box.open = true;
  box.dispatchEvent(new window.Event('toggle'));
  await settle();
  t('바깥 설정이 접혀 있으면 활동 로그를 열어도 그리지 않는다', () => assert.equal(out.textContent, ''));
  const settings = doc.getElementById('settingsBox');
  settings.open = true;
  settings.dispatchEvent(new window.Event('toggle'));
  await settle();
  t('열면 최신 것이 위로 온다', () => {
    const lines = out.textContent.split('\n');
    assert.ok(lines.length >= 2);
    assert.ok(lines[0] >= lines[lines.length - 1], '시각이 내림차순이 아니다');
  });

  doc.getElementById('logCopy').click();
  await settle();
  const copied = calls.clipboard.at(-1) || '';
  t('복사하면 보고서가 클립보드로', () => {
    assert.match(copied, /^KRS WORKSPACE — 활동 로그/);
    assert.match(copied, /== 확장 기록/);
    assert.match(copied, /\[조회\]/);
  });
  t('보고서에 환경이 적힌다', () => assert.match(copied, /확장=9\.9\.9 · 탭=room/));
  t('보고서에도 키는 없다 (있다는 사실만)', () => {
    assert.ok(!copied.includes(SECRET));
    assert.match(copied, /API키=있음/);
  });
  t('다리가 없으면 그 이유를 적는다', () => assert.match(copied, /가져오지 못했습니다: no host/));
  t('버튼이 결과를 말해 준다', () => assert.equal(doc.getElementById('logCopy').textContent, '복사됨 ✓'));

  doc.getElementById('logSave').click();
  await settle();
  t('파일로 저장하면 다운로드로 간다', () =>
    assert.match(calls.downloads.at(-1)?.filename || '', /^krs-log-\d{8}-\d{6}\.txt$/));

  const clear = doc.getElementById('logClear');
  clear.click();
  await settle();
  t('비우기는 한 번 눌러서는 안 지운다', () => {
    assert.ok(log().length > 0);
    assert.match(clear.textContent, /한 번 더/);
  });
  clear.click();
  await settle();
  t('두 번 누르면 지운다', () => {
    assert.equal(log().length, 0);
    assert.equal(doc.getElementById('logCount').textContent, '기록 없음');
  });
}

console.log('오늘 버튼은 오늘을 볼 때만 켜진다');
{
  const { window } = await boot({ mode: 'room' });
  const doc = window.document;
  const today = doc.getElementById('today');
  t('시작하면 오늘이라 켜져 있다', () => assert.ok(today.classList.contains('on')));

  const date = doc.getElementById('date');
  date.value = '2000-01-01';
  date.dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 30));
  t('다른 날로 옮기면 꺼진다', () => {
    assert.ok(!today.classList.contains('on'));
    assert.equal(today.getAttribute('aria-current'), null);
  });

  today.click();
  await new Promise((r) => setTimeout(r, 30));
  t('오늘을 누르면 다시 켜진다', () => assert.ok(today.classList.contains('on')));
}

console.log('시작하면 세 탭 몫을 한 번에 — 오늘부터 한 달을 미리 훑는다');
{
  const { window, calls } = await boot({ mode: 'room' });
  await new Promise((r) => setTimeout(r, 150));   // 미리 훑기가 두 화면을 두드릴 시간
  const doc = window.document;

  t('회의실 화면을 두드린다', () =>
    assert.ok(calls.urls.some((u) => /MeetingRoom\/List\.aspx/.test(u))));
  t('차량 화면도 두드린다 (보고 있지 않아도)', () =>
    assert.ok(calls.urls.some((u) => /RentCar\/New_List\.aspx/.test(u)),
      '두드린 곳: ' + calls.urls.join(', ')));
  t('기간 기본값은 한 달', () => assert.equal(doc.getElementById('spanDays').value, '30'));
  t('한 달 훑기 막대가 붙어 있다', () => assert.ok(doc.getElementById('scanBar')));
}

console.log('내 예약 탭으로 열려도 미리 훑기와 겹치지 않는다');
{
  const { window, calls } = await boot({ mode: 'mine' });
  await new Promise((r) => setTimeout(r, 150));
  const doc = window.document;

  // 훑기는 한 번에 하나만 돈다. 내 예약이 먼저 돌면 미리 훑기는 그것을 기다렸다 빈 날만 채운다.
  // 로그인이 막힌 이 환경에서는 화면당 한 번씩만 두드려야 한다 — 겹쳐 돌면 두 배로 두드린다.
  t('회의실 화면을 두 번 넘게 두드리지 않는다', () =>
    assert.ok(calls.urls.filter((u) => /MeetingRoom\/List\.aspx/.test(u)).length <= 2,
      '두드린 곳: ' + calls.urls.join(', ')));
  t('차량 화면도 마찬가지', () =>
    assert.ok(calls.urls.filter((u) => /RentCar\/New_List\.aspx/.test(u)).length <= 2,
      '두드린 곳: ' + calls.urls.join(', ')));
  t('훑는 기간이 한 달로 찍힌다', () =>
    assert.match(doc.getElementById('scheduleDate').textContent, /^\d+\/\d+ ~ \d+\/\d+$/));
}

/** 오늘 새벽에 한 달을 훑어 둔 저장소. 하루치가 `day|종류|날짜` 한 칸씩이다. */
function scannedToday(extra = {}) {
  const at = new Date().setHours(0, 0, 1, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const out = {};
  const d = new Date();
  for (let i = 0; i < 30; i++) {
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    out[`day|room|${date}`] = {
      kind: 'room', date, reservations: [], rooms: [{ name: '제1회의실', value: '1' }], roomSource: 'select',
      region: '부산', regions: ['부산'], confident: true, reason: '', at,
    };
    out[`day|car|${date}`] = {
      kind: 'car', date, reservations: [], rooms: [{ name: '스타리아', value: '32' }], roomSource: 'table',
      confident: true, reason: '', at,
    };
    if (i === 0) out.firstDate = date;
    d.setDate(d.getDate() + 1);
  }
  const { firstDate, ...days } = out;
  Object.assign(days, extra.patch?.(firstDate) || {});
  return days;
}

console.log('오늘 훑어 둔 것이 있으면 패널을 다시 열어도 한 달을 또 훑지 않는다');
{
  const { window, calls } = await boot({ mode: 'room', ...scannedToday() });
  await new Promise((r) => setTimeout(r, 150));
  const doc = window.document;

  // 보고 있는 날(회의실)은 늘 살아 있는 조회로 확인한다. 미리 훑기만 두드리는 차량 화면으로 가른다.
  t('차량 화면을 두드리지 않는다', () =>
    assert.equal(calls.urls.filter((u) => /RentCar\/New_List\.aspx/.test(u)).length, 0,
      '두드린 곳: ' + calls.urls.join(', ')));
  t('막대가 한 달이 준비됐다고, 언제 읽은 것인지와 함께 말한다', () =>
    assert.match(doc.getElementById('scanNote').textContent, /^한 달 준비됨 · \d+\/\d+~\d+\/\d+ · 동기화 00:00$/));
}

console.log('내 예약은 하루에 한 번만 훑는다 — 담아 둔 것을 보여주고, ↻ 를 눌러야 다시 훑는다');
{
  const mineRow = (date) => ({
    [`day|room|${date}`]: {
      kind: 'room', date, rooms: [{ name: '제1회의실', value: '1' }], roomSource: 'select',
      region: '부산', regions: ['부산'], confident: true, reason: '', at: new Date().setHours(0, 0, 1, 0),
      reservations: [{
        region: '부산', room: '제1회의실', start: 600, end: 660, status: '승인', mine: true,
        del: { idx: '1', group: '1' }, title: '주간회의', owner: '홍길동', dept: '', date,
      }],
    },
  });
  const { window, calls } = await boot({ mode: 'mine', ...scannedToday({ patch: mineRow }) });
  await new Promise((r) => setTimeout(r, 150));
  const doc = window.document;

  t('사이트를 한 번도 두드리지 않는다', () =>
    assert.equal(calls.urls.filter((u) => /List\.aspx/.test(u)).length, 0, '두드린 곳: ' + calls.urls.join(', ')));
  t('담아 둔 내 예약이 그대로 보인다', () => {
    assert.equal(doc.querySelectorAll('#mineList li').length, 1);
    assert.match(doc.getElementById('mineList').textContent, /제1회의실/);
  });
  t('언제 동기화한 것인지 적는다', () =>
    assert.equal(doc.getElementById('stamp').textContent, '동기화 00:00'));
  t('시각에 마우스를 올리면 ↻ 로 다시 훑는다고 알려 준다', () =>
    assert.match(doc.getElementById('stamp').title, /↻ 를 누르면 다시 훑습니다/));

  doc.getElementById('refresh').click();
  await new Promise((r) => setTimeout(r, 150));
  t('↻ 를 누르면 그때 다시 훑는다', () => {
    assert.ok(calls.urls.some((u) => /MeetingRoom\/List\.aspx/.test(u)), '두드린 곳: ' + calls.urls.join(', '));
    assert.ok(calls.urls.some((u) => /RentCar\/New_List\.aspx/.test(u)), '두드린 곳: ' + calls.urls.join(', '));
  });
}

console.log('WORKSPACE 현황 — 내 출장·휴가도 회의실·차량 예약과 한 목록에 카드로 보인다');
{
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
  const today = plus(0);
  const doc0 = { formId: 'TR', status: '5', statusName: '결재완료', gubun: '시간' };
  // 오늘 읽어 둔 근태. 현황은 이것을 그대로 쓰고 HR 을 열지 않는다.
  const hrPlans = { day: today, since: plus(-200), items: [
    { ...doc0, docNo: 'T-1', kindName: '국내출장', from: plus(2), to: plus(3), start: '07:00', end: '20:00', reason: '착수회의 참석 - 대전' },
    { ...doc0, docNo: 'L-1', formId: 'LV', kindName: '연차', status: '3', statusName: '결재요청', from: plus(1), to: plus(1), start: '', end: '', gubun: '전일', reason: '' },
    { ...doc0, docNo: 'T-9', kindName: '국내출장', from: plus(-40), to: plus(-39), start: '07:00', end: '20:00', reason: '지난 출장' },
    { ...doc0, docNo: 'T-2', kindName: '국내출장', status: '1', statusName: '임시저장', from: plus(4), to: plus(4), start: '07:00', end: '20:00', reason: '임시저장' },
    { ...doc0, docNo: 'C-1', formId: 'TRC', kindName: '국내출장', from: plus(2), to: plus(3), start: '07:00', end: '20:00', reason: '취소신청서' },
  ] };
  const mineRow = (date) => ({
    [`day|room|${date}`]: {
      kind: 'room', date, rooms: [{ name: '제1회의실', value: '1' }], roomSource: 'select',
      region: '부산', regions: ['부산'], confident: true, reason: '', at: new Date().setHours(0, 0, 1, 0),
      reservations: [{
        region: '부산', room: '제1회의실', start: 600, end: 660, status: '승인', mine: true,
        del: { idx: '1', group: '1' }, title: '주간회의', owner: '홍길동', dept: '', date,
      }],
    },
  });
  const { window, calls } = await boot({ mode: 'mine', hrPlans, ...scannedToday({ patch: mineRow }) });
  await new Promise((r) => setTimeout(r, 150));
  const doc = window.document;
  const rows = () => [...doc.querySelectorAll('#mineList li')];

  t('예약 한 건과 근태 두 건이 날짜순으로 섞여 있다 (지난 것·임시저장·취소신청서는 뺀다)', () => {
    assert.deepEqual(rows().map((li) => li.querySelector('.mi-kind').textContent), ['회의실', '연차', '출장']);
    assert.equal(doc.getElementById('roomCount').textContent, '3');
  });
  t('근태 카드: 종류 딱지 · 날짜와 시각(전일이면 구분) · 결재 상태 · 내용', () => {
    const [, leave, trip] = rows();
    assert.match(leave.querySelector('.mi-when').textContent, / 전일$/);
    assert.equal(leave.querySelector('.mi-status').textContent, '결재요청');
    assert.match(trip.querySelector('.mi-when').textContent, /07:00 ~ .* 20:00$/);
    assert.equal(trip.querySelector('.mi-status').textContent, '결재완료');
    assert.equal(trip.querySelector('.mi-title').textContent, '착수회의 참석 - 대전');
    assert.equal(trip.querySelector('[data-cancel]'), null, '근태 카드에는 취소·수정 버튼이 없다');
  });
  t('오늘 읽어 둔 근태가 있으면 HR 을 열지 않는다', () =>
    assert.ok(!calls.tabs.some((x) => /SSOMessage/.test(x.url || '')), JSON.stringify(calls.tabs)));
  t('한 줄 요약에 예약과 근태 건수를 같이 적는다', () =>
    assert.match(doc.getElementById('status').textContent, /내 예약 1건 · 근태 2건/));

  rows()[2].click();
  await new Promise((r) => setTimeout(r, 60));
  t('근태 카드를 누르면 근태 탭으로 간다', () => {
    assert.ok(doc.getElementById('tabAttend').classList.contains('active'));
    assert.ok(!doc.getElementById('attend').classList.contains('hidden'));
  });
}
{
  // 근태를 읽지 못해도(HR 탭을 못 엶) 예약 목록은 보이고, 못 읽었다고 말한다.
  const { window } = await boot({ mode: 'mine', ...scannedToday() });
  await new Promise((r) => setTimeout(r, 150));
  t('근태를 못 읽으면 예약만 보여주고 그 사실을 적는다', () =>
    assert.match(window.document.getElementById('status').textContent, /근태는 읽지 못했습니다/));
}

console.log('로그인이 풀렸을 때 — 만료라고 말하고, 홈 링크를 달고, 로그인이 돌아오면 스스로 다시 조회한다');
{
  const SIGN_IN = '<script>alert("You must sign in.");</script>';
  const page = (html) => ({
    ok: true, status: 200, type: 'basic', url: 'https://eclass.krs.co.kr/x',
    headers: { get: () => 'text/html; charset=utf-8' },
    arrayBuffer: async () => new TextEncoder().encode(html).buffer,
  });
  const redirect = () => ({
    ok: false, status: 0, type: 'opaqueredirect', headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0),
  });
  const isHome = (u) => /eClassVer4\/Home\/Index/.test(String(u));
  const homeCalls = [];
  const { window, calls, store } = await boot({ mode: 'room' }, {
    fetchImpl: async (url, init = {}) => {
      if (isHome(url)) { homeCalls.push(init.redirect); return redirect(); }
      return page(SIGN_IN);
    },
  });
  await new Promise((r) => setTimeout(r, 200));
  const doc = window.document;
  const status = doc.getElementById('status');

  t('안내가 만료라고 말한다', () => assert.match(status.textContent, /만료/));
  t('다시 로그인 링크가 붙는다', () =>
    assert.match(doc.getElementById('openLogin')?.textContent || '', /다시 로그인/));
  t('포털 홈은 manual 로만 확인했다 (따라가면 남은 쿠키가 지워진다)', () => {
    assert.ok(homeCalls.length >= 1);
    assert.ok(homeCalls.every((r) => r === 'manual'), JSON.stringify(homeCalls));
  });
  t('기록에 로그인 문제와 포털 상태가 남는다', () =>
    assert.ok((store.activityLog || []).some((e) => e.kind === 'load' && e.data?.auth && e.data?.portal === 'expired')));

  doc.getElementById('openLogin').click();
  t('링크는 껍데기가 아니라 포털 홈을 연다', () => {
    assert.equal(calls.tabs.length, 1);
    assert.match(calls.tabs[0].url, /eClassVer4\/Home\/Index/);
    assert.doesNotMatch(calls.tabs[0].url, /GAPSU/);
  });

  t('eclass 탭 로딩을 듣고 있다', () => assert.equal(calls.tabListeners.length, 1));
  const before = calls.urls.filter((u) => /MeetingRoom\/List\.aspx/.test(u)).length;
  // 다른 사이트 탭이 다 읽힌 것은 신호가 아니다.
  calls.tabListeners[0](1, { status: 'complete' }, { url: 'https://www.example.com/' });
  await new Promise((r) => setTimeout(r, 1100));
  t('eclass 가 아닌 탭에는 반응하지 않는다', () =>
    assert.equal(calls.urls.filter((u) => /MeetingRoom\/List\.aspx/.test(u)).length, before));
  // 로그인 폼을 거쳐 홈으로 돌아왔다.
  calls.tabListeners[0](2, { status: 'complete' }, { url: 'https://eclass.krs.co.kr/eClassVer4/Home/Index' });
  calls.tabListeners[0](2, { status: 'complete' }, { url: 'https://eclass.krs.co.kr/eClassVer4/Home/Index' });
  await new Promise((r) => setTimeout(r, 1100));
  t('eclass 탭이 다 읽히면 ↻ 없이 다시 조회한다 (몰려온 신호는 한 번으로)', () => {
    const after = calls.urls.filter((u) => /MeetingRoom\/List\.aspx/.test(u)).length;
    // 다시 조회 한 번 = 직접 요청 + (sign in 이라) 없는 탭 확인 뒤 포털 확인. 목록 주소는 한 번 늘어야 한다.
    assert.equal(after, before + 1, `목록 요청 ${before} → ${after}`);
  });
  t('복귀 신호가 기록에 남는다', () =>
    assert.ok((store.activityLog || []).some((e) => e.kind === 'auth' && /다시 조회/.test(e.text))));
}

console.log('공문 탭');
{
  const { wired, window } = await boot({ mode: 'room' });
  const doc = window.document;
  t('공문 탭 클릭과 공문 화면의 리스너', () => {
    assert.ok(wired.get('tabGongmun')?.has('click'));
    const want = [['gmKinds', 'click'], ['gmFile', 'change'], ['gmCapture', 'click'], ['gmManual', 'click'],
      ['gmReset', 'click'], ['gmCut', 'click'], ['gmAgentGo', 'click'], ['gmAgentInput', 'keydown'], ['gmMoreFields', 'input'], ['gmPick', 'click'], ['gmProjects', 'click'], ['gmFields', 'input'], ['gmTitle', 'input'], ['gmBody', 'input'], ['gmRegen', 'click'],
      ['gmWrite', 'click'], ['gmRank', 'change'], ['gmRetention', 'change'], ['gmDocNoOne', 'input'], ['gmSetReset', 'click'], ['gmSavePdf', 'click'], ['gmTplForm', 'change'], ['gmTplTitle', 'input'],
      ['gmTplBody', 'input'], ['gmTplReset', 'click'], ['gmDept', 'input'], ['gmHead', 'input'], ['gmRefs', 'input'], ['gmDirector', 'input'], ['gmChief', 'input'], ['gmDocNo', 'input'], ['gmDocNoHint', 'change'], ['gmProjAdd', 'click'],
      ['gmProjList', 'input'], ['gmEvidenceToggle', 'click'], ['gmWorkspaceToggle', 'click'], ['gmViewTabs', 'click'], ['gmViewTabs', 'keydown'], ['gmCompare', 'click'], ['gongmun', 'dragover'], ['gongmun', 'drop']];
    for (const [id, type] of want) assert.ok(wired.get(id)?.has(type), `${id} 에 ${type}`);
  });
  t('회의실 탭에서는 공문 화면이 숨어 있다', () => assert.ok(doc.getElementById('gongmun').classList.contains('hidden')));
}
{
  const { window, calls, store } = await boot({ mode: 'gongmun', myName: '김거화' });
  const doc = window.document;
  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const type = (node, value) => { node.value = value; node.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const field = (key) => doc.querySelector(`#gongmun [data-key="${key}"]`);
  await settle();
  t('저장된 모드가 공문이면 공문 탭으로 열리고 날짜 격자·예약 현황·말로 찾기·근태는 숨는다', () => {
    assert.ok(doc.getElementById('tabGongmun').classList.contains('active'));
    assert.match(doc.getElementById('appTitle').textContent, /공문 작성/);
    assert.ok(!doc.getElementById('gongmun').classList.contains('hidden'));
    assert.ok(doc.getElementById('attend').classList.contains('hidden'));
    for (const sel of ['.controls', '.schedule', '.ask']) assert.ok(doc.querySelector(sel).hasAttribute('hidden'), sel);
  });
  t('갈래는 구매·교육·출장이고 처음에는 구매다 — 셋 다 같은 문서 넣는 곳이고, 상자의 안내는 한 줄뿐이다(2026-10-08 사용자 지정)', () => {
    const kinds = [...doc.querySelectorAll('#gmKinds .gm-kind')].map((b) => b.dataset.kind);
    assert.deepEqual(kinds, ['purchase', 'edu', 'trip', 'outside']);
    assert.equal(doc.querySelector('#gmKinds [data-kind="outside"]').textContent, '외부활동');
    assert.equal(doc.querySelector('#gmKinds [data-kind="outside"]').title, '외부활동 허가 신청서');
    assert.ok(!doc.querySelector('#gmKinds [data-kind="trip"]').textContent.includes('준비 중'));
    assert.equal(doc.querySelector('#gmKinds .gm-kind.active').dataset.kind, 'purchase');
    assert.equal(doc.getElementById('gmSoon'), null, '준비 중 안내는 없다');
    assert.deepEqual([...doc.querySelectorAll('#gmIntake .gm-drop > span')].map((s) => s.textContent.trim()), ['견적서를 넣으세요', '드래그 · 붙여넣기 · 캡처 가능']);
  });
  t('자료 넣기·한도 알림은 참고 문서 카드에, 읽은 내용은 작업 카드의 세 번째 탭에 있고(2026-10-09 사용자 지정), 처음에는 자료 넣기만 보인다', () => {
    const evidence = doc.getElementById('gmEvidence');
    const intake = doc.getElementById('gmIntake');
    const read = doc.getElementById('gmReadView');
    assert.equal(intake.closest('#gmEvidence'), evidence);
    assert.equal(doc.getElementById('gmLimit').closest('#gmEvidence'), evidence, '한도 알림은 문서를 읽은 결과라 참고 문서에 남는다');
    assert.equal(doc.getElementById('gmStatus').closest('#gmEvidence'), evidence);
    assert.equal(doc.getElementById('gmReset').closest('#gmEvidence'), evidence);
    assert.equal(doc.getElementById('gmMore'), null, '접는 읽은 내용 확인 칸은 없다');
    assert.equal(read.closest('#gmWorkspaceBody'), doc.getElementById('gmWorkspaceBody'), '읽은 내용은 작성 내용·공문과 한 카드의 탭이다');
    for (const id of ['gmSource', 'gmMoreFields', 'gmItems', 'gmCut']) assert.equal(doc.getElementById(id).closest('#gmReadView'), read, id);
    assert.deepEqual([...doc.querySelectorAll('#gmViewTabs [data-gm-view]')].map((b) => b.textContent), ['작성 내용', '공문', '읽은 내용']);
    assert.ok(doc.getElementById('gmDoc').compareDocumentPosition(read) & window.Node.DOCUMENT_POSITION_FOLLOWING, '읽은 내용 칸은 맨 뒤 — 비교작성의 오른쪽');
    assert.equal(doc.getElementById('gmCompare').closest('.gm-workspace-head'), doc.getElementById('gmViewTabs').parentElement, '비교작성 단추는 탭 옆');
    assert.ok(!doc.body.classList.contains('compare-tab'), '사이드패널 — 비교작성 탭이 아니다');
    assert.ok(!intake.classList.contains('compact'));
    assert.ok(read.classList.contains('hidden'));
    assert.ok(doc.getElementById('gmReset').hidden);
    assert.equal(doc.getElementById('gmEvidenceCount').textContent, '');
    assert.ok(doc.getElementById('gmDraft').classList.contains('hidden'));
  });
  t('참고 문서는 접고 펼 수 있으며 머리와 상태 메시지는 접힘 밖에 남는다', () => {
    const toggle = doc.getElementById('gmEvidenceToggle');
    const body = doc.getElementById('gmEvidenceBody');
    assert.equal(toggle.getAttribute('aria-controls'), body.id);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.ok(!body.hidden);
    assert.ok(doc.getElementById('gmWorkspace').classList.contains('hidden'), '초안 없는 작업 탭은 숨는다');
    toggle.click();
    assert.ok(body.hidden);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    for (const id of ['gmEvidenceCount', 'gmReset', 'gmStatus']) assert.equal(doc.getElementById(id).closest('#gmEvidenceBody'), null, id);
  });
  t('공문 설정 — 말로 채우기(채팅) 칸은 없고, 부서·문서번호 코드가 한 줄, 부서장·소장·본부장이 한 줄이다(2026-10-09 사용자 지정)', () => {
    const preset = doc.getElementById('gmPresetBox');
    assert.equal(doc.getElementById('gmChat'), null, '채팅 칸은 뺐다');
    assert.match(preset.querySelector('summary').textContent, /공문 설정/);
    assert.equal(doc.getElementById('gmDocNo').closest('.gm-preset-grid'), doc.getElementById('gmDept').closest('.gm-preset-grid'), '문서번호 코드는 부서 옆');
    const people = doc.getElementById('gmHead').closest('.gm-preset-grid');
    assert.ok(people && people.contains(doc.getElementById('gmDirector')) && people.contains(doc.getElementById('gmChief')), '부서장·소장·본부장은 한 줄');
    assert.ok(!preset.open);
    assert.equal(doc.getElementById('gmDocNoHint').textContent, '', '부서도 코드도 비면 안내가 없다');
  });
  // 문서번호 코드 — 부서로 찾는다. 하나면 그대로, 영문 조각이 여럿에 맞으면 고르는 칸, 적은 코드가 목록에 없으면 붉게.
  type(doc.getElementById('gmDept'), '연구본부 수소전기추진연구팀');
  t('부서에 맞는 팀이 하나면 그 코드를 찾았다고 적는다', () => assert.match(doc.getElementById('gmDocNoHint').textContent, /^부서로 찾음: \(8100\) Hydrogen & Electric Propulsion Research Team/));
  type(doc.getElementById('gmDept'), 'Research Team');
  t('부서 글이 여러 팀에 맞으면 문서설정 창 목록에서 고르는 칸이 서고, 고르면 코드 칸에 들어간다', () => {
    const sel = doc.querySelector('#gmDocNoHint select');
    assert.ok(sel, '고르는 칸');
    assert.match(doc.getElementById('gmDocNoHint').textContent, /코드가 4개입니다/);
    assert.deepEqual([...sel.options].map((o) => o.value), ['', '7600', '7700', '8100', '8200']);
    assert.match([...sel.options][3].textContent, /수소전기추진연구팀 — Hydrogen/);
    sel.value = '7700';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(doc.getElementById('gmDocNo').value, '7700');
    assert.match(doc.getElementById('gmDocNoHint').textContent, /^\(7700\) System Safety Research Team$/);
  });
  type(doc.getElementById('gmDocNo'), '9999');
  t('목록에 없는 코드는 붉게 알린다', () => {
    assert.ok(doc.getElementById('gmDocNoHint').classList.contains('bad'));
    assert.match(doc.getElementById('gmDocNoHint').textContent, /9999 은\(는\) 문서설정 창의 목록에 없습니다/);
  });
  type(doc.getElementById('gmDocNo'), '');
  type(doc.getElementById('gmDept'), '');

  // 공문 설정에 부서장·참조자와 과제 한 줄을 적는다(과제책임자가 합의자).
  type(doc.getElementById('gmHead'), '노길태');
  type(doc.getElementById('gmRefs'), '홍길동, 이몽룡');
  doc.getElementById('gmProjAdd').click();
  const PROJECT = 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발';
  type(doc.querySelector('#gmProjList [data-k="name"]'), PROJECT);
  type(doc.querySelector('#gmProjList [data-k="code"]'), 'RND-20-2026');
  type(doc.querySelector('#gmProjList [data-k="lead"]'), '박기도');
  await settle(480);
  t('적은 과제·과제책임자(합의자)·부서장·참조자가 공문 설정에 저장된다', () => {
    assert.deepEqual(store.gongmunProjects, [{ name: PROJECT, alias: '', code: 'RND-20-2026', lead: '박기도', period: '', about: '', content: '', account: '' }]);
    assert.deepEqual(store.gongmunPreset, { dept: '', head: '노길태', refs: ['홍길동', '이몽룡'], director: '', chief: '', docNo: '' });
    assert.equal(doc.getElementById('gmHead').value, '노길태');
    assert.equal(doc.querySelector('#gmProjList [data-k="lead"]').value, '박기도');
  });

  doc.getElementById('gmManual').click();
  await settle();
  t('문서 없이 쓰면 초안이 열리고, 과제가 하나뿐이면 바로 골라진다 — 과제는 갈래 아래의 과제 줄에 있고 카드 안 목록은 숨는다', () => {
    assert.ok(!doc.getElementById('gmDraft').classList.contains('hidden'));
    assert.ok(!doc.getElementById('gmReadView').classList.contains('hidden'));
    assert.ok(doc.getElementById('gmIntake').classList.contains('compact'));
    assert.ok(!doc.getElementById('gmReset').hidden);
    assert.equal(doc.getElementById('gmEvidenceCount').textContent, '직접 입력');
    assert.equal(doc.querySelector('#gmPick .gm-pick.active').textContent, PROJECT, '별칭이 없으면 과제명');
    assert.ok(doc.getElementById('gmProjects').classList.contains('hidden'));
    assert.ok(doc.getElementById('gmProjLabel').classList.contains('hidden'));
    assert.ok(!doc.getElementById('gmEvidenceBody').hidden, '수동 입력은 접힌 참고 문서를 편다');
    assert.ok(!doc.getElementById('gmWorkspace').classList.contains('hidden'));
    assert.ok(!doc.getElementById('gmWorkspaceBody').hidden);
    assert.equal(doc.getElementById('gmViewRead').getAttribute('aria-selected'), 'true', '빈 읽은 칸은 채울 수 있게 읽은 내용 탭이 열린다');
    assert.ok(!doc.getElementById('gmReadView').hidden);
    assert.ok(doc.getElementById('gmDraft').hidden);
    assert.ok(doc.getElementById('gmViewDoc').disabled, '합계를 모르면 공문 탭도 차단된다');
    assert.equal(doc.getElementById('gmViewRead').title, '직접 입력');
    assert.equal(doc.activeElement, field('gist'), '열린 읽은 칸에 포커스가 간다');
  });
  t('결재선 — 기안자 → 합의자(과제책임자) → 결재자(부서장) · 참조자', () => {
    const line = doc.getElementById('gmLine').textContent;
    assert.match(line, /기안자김거화→합의자박기도과제책임자→결재자노길태부서장/);
    assert.match(line, /참조자홍길동, 이몽룡/);
  });

  type(field('gist'), '34인치 모니터');
  type(field('total'), '1,239,000');
  t('합계가 100만원을 넘으면 공문을 만들지 않는다', () => {
    assert.ok(!doc.getElementById('gmLimit').classList.contains('hidden'));
    assert.match(doc.getElementById('gmLimit').textContent, /1,239,000원.*100만원 이하/);
    assert.ok(doc.getElementById('gmDoc').classList.contains('hidden'));
  });
  type(field('total'), '989000');
  type(field('use'), '연구 회의 자료 검토용');
  type(field('reason'), '과제 회의에서 회로도·시험 데이터를 함께 검토할 대화면이 필요함');
  t('100만원 이하면 양식대로 제목·본문이 만들어진다 — 요약은 품목 요지를 따라간다', () => {
    assert.ok(!doc.getElementById('gmDoc').classList.contains('hidden'));
    assert.equal(doc.getElementById('gmTitle').value, '34인치 모니터 구매 품의');
    const body = doc.getElementById('gmBody').value;
    assert.match(body, new RegExp(`「${PROJECT}」 과제를 수행하고 있습니다`));
    assert.match(body, /34인치 모니터를 구매하고자 아래와 같이 품의하오니/);
    assert.match(body, /나\. 구매금액 : 989,000원 \(VAT 포함\)/);
    assert.match(body, /라\. 구매계정 : 연구활동비\(연구실운용비\)/);
    assert.match(doc.getElementById('gmNeed').textContent, /부서\(공문 설정\)/, '부서는 아직 비어 있다');
  });
  t('작성 내용·공문·읽은 내용은 접근성 탭이며 키보드 이동과 선택 클릭은 작업 영역을 펼친다', () => {
    const draft = doc.getElementById('gmViewDraft');
    const documentTab = doc.getElementById('gmViewDoc');
    const readTab = doc.getElementById('gmViewRead');
    const body = doc.getElementById('gmWorkspaceBody');
    assert.equal(doc.getElementById('gmViewTabs').getAttribute('role'), 'tablist');
    for (const [tab, panel] of [[draft, doc.getElementById('gmDraft')], [documentTab, doc.getElementById('gmDoc')], [readTab, doc.getElementById('gmReadView')]]) {
      assert.equal(tab.getAttribute('role'), 'tab');
      assert.equal(tab.getAttribute('aria-controls'), panel.id);
      assert.equal(panel.getAttribute('role'), 'tabpanel');
      assert.equal(panel.getAttribute('aria-labelledby'), tab.id);
    }
    const key = (tab, value) => tab.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
    draft.click();
    key(draft, 'ArrowRight');
    assert.equal(documentTab.getAttribute('aria-selected'), 'true');
    assert.equal(documentTab.tabIndex, 0);
    assert.equal(draft.tabIndex, -1);
    assert.equal(doc.activeElement, documentTab);
    assert.ok(doc.getElementById('gmDraft').hidden);
    assert.ok(!doc.getElementById('gmDoc').hidden);
    assert.ok(doc.getElementById('gmReadView').hidden);
    key(documentTab, 'ArrowRight');
    assert.equal(readTab.getAttribute('aria-selected'), 'true');
    assert.ok(!doc.getElementById('gmReadView').hidden);
    assert.ok(doc.getElementById('gmDoc').hidden);
    key(readTab, 'ArrowRight');
    assert.equal(draft.getAttribute('aria-selected'), 'true', '맨 뒤에서 오른쪽은 처음으로');
    key(draft, 'End');
    assert.equal(readTab.getAttribute('aria-selected'), 'true');
    key(readTab, 'Home');
    assert.equal(draft.getAttribute('aria-selected'), 'true');
    key(draft, 'ArrowLeft');
    assert.equal(readTab.getAttribute('aria-selected'), 'true');
    key(readTab, 'ArrowLeft');
    assert.equal(documentTab.getAttribute('aria-selected'), 'true');
    documentTab.click();
    const toggle = doc.getElementById('gmWorkspaceToggle');
    assert.equal(toggle.getAttribute('aria-controls'), body.id);
    toggle.click();
    assert.ok(body.hidden);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    documentTab.click();
    assert.ok(!body.hidden);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    documentTab.click();
    assert.ok(!body.hidden, '선택된 탭을 다시 눌러도 접히지 않는다');
  });
  await ta('비교작성 단추는 사이드패널을 나누지 않고 크롬 탭(sidepanel.html?compare=갈래)을 연다(2026-10-09 사용자 지정: "비교작성은 사이드패널이 아니라 크롬 탭에")', async () => {
    const compare = doc.getElementById('gmCompare');
    const body = doc.getElementById('gmWorkspaceBody');
    assert.equal(compare.textContent.trim(), '비교작성');
    assert.ok(!compare.hidden);
    const before = calls.tabs.length;
    compare.click();
    await settle();
    assert.equal(calls.tabs.length, before + 1);
    assert.deepEqual(calls.tabs.at(-1), { url: 'chrome-extension://test/sidepanel.html?compare=purchase' });
    assert.ok(!body.classList.contains('compare'), '사이드패널 안에서는 두 칸으로 나누지 않는다');
    assert.equal(doc.getElementById('gmViewDoc').getAttribute('aria-selected'), 'true', '고른 탭도 그대로');
    assert.ok(doc.getElementById('gmReadView').hidden);
    assert.ok(!doc.getElementById('gmViewRead').disabled);
    // 이미 열려 있으면 새로 열지 않고 그 탭을 앞에 둔다 — 갈래가 다르면 주소를 바꾼다.
    window.chrome.tabs.query = async () => [{ id: 9, windowId: 3, url: 'chrome-extension://test/sidepanel.html?compare=edu' }];
    compare.click();
    await settle();
    assert.equal(calls.tabs.length, before + 1, '새 탭을 열지 않는다');
    assert.deepEqual(calls.tabUpdates.at(-1), [9, { active: true, url: 'chrome-extension://test/sidepanel.html?compare=purchase' }]);
    window.chrome.tabs.query = async () => [];
  });
  doc.getElementById('gmEvidenceToggle').click();
  type(field('total'), '1,200,000');
  t('공문 선택 중 한도에 걸리면 읽은 내용 탭으로 가고 접힌 참고 문서를 열어 금액을 고치게 한다', () => {
    assert.ok(doc.getElementById('gmDoc').classList.contains('hidden'), '기존 한도 차단은 유지된다');
    assert.ok(doc.getElementById('gmViewDoc').disabled);
    assert.equal(doc.getElementById('gmViewRead').getAttribute('aria-selected'), 'true');
    assert.ok(!doc.getElementById('gmReadView').hidden);
    assert.ok(doc.getElementById('gmDraft').hidden);
    assert.ok(!doc.getElementById('gmEvidenceBody').hidden);
    assert.ok(!doc.getElementById('gmLimit').classList.contains('hidden'));
    doc.getElementById('gmViewDraft').click();
    type(field('total'), '1,300,000');
    assert.equal(doc.getElementById('gmViewDraft').getAttribute('aria-selected'), 'true', '이미 걸려 있을 때 칸을 고치면 탭을 옮기지 않는다');
    doc.getElementById('gmViewDraft').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(doc.getElementById('gmViewRead').getAttribute('aria-selected'), 'true', '키보드도 차단된 공문 탭을 건너뛴다');
  });
  type(field('total'), '989000');
  doc.getElementById('gmViewDoc').click();
  t('복사 단추는 없다 — 공문 창에 바로 넣는다(2026-10-08 사용자 지정)', () => {
    assert.equal(doc.getElementById('gmCopyTitle'), null);
    assert.equal(doc.getElementById('gmCopyBody'), null);
    assert.equal(doc.getElementById('gmWrite').textContent, 'eclass 에 공문 작성');
  });
  t('문서설정·위임전결 — 레시피 기본값(보존 10년 · 내부결재 · 결재선 공개)과 규정대로의 전결권자(연구비 집행 2천만원 이하 → 팀장)', () => {
    assert.match(doc.getElementById('gmSetState').textContent, /^전결 팀장 · 보존 10년 · Doc No\. 없음 · 수신 내부결재 · 공개 결재선$/);
    assert.equal(doc.getElementById('gmRank').value, '');
    assert.match(doc.getElementById('gmRankWhy').textContent, /국가R&D 연구비 집행 · 989,000원 → 팀장 전결 — QI-01K/);
    assert.match(doc.getElementById('gmLine').textContent, /결재자노길태부서장 · 전결/);
  });
  type(doc.getElementById('gmDocNo'), '8100');
  doc.getElementById('gmRank').value = '소장';
  doc.getElementById('gmRank').dispatchEvent(new window.Event('change', { bubbles: true }));
  t('전결권자를 소장으로 고르면 결재선에 소장 자리가 서고, 공문 설정에 이름이 없으면 채우라고 한다', () => {
    assert.match(doc.getElementById('gmLine').textContent, /소장을 정하세요/);
    assert.match(doc.getElementById('gmNeed').textContent, /소장\(공문 설정 — 위임전결\)/);
    assert.match(doc.getElementById('gmSetState').textContent, /^전결 소장 · 보존 10년 · Doc No\. 8100/);
  });
  t('탭 전환과 접기는 문서설정·위임전결을 보존하고 값 갱신으로 자동 펼쳐지지 않는다', () => {
    doc.getElementById('gmViewDraft').click();
    doc.getElementById('gmWorkspaceToggle').click();
    assert.ok(doc.getElementById('gmWorkspaceBody').hidden);
    type(doc.getElementById('gmDirector'), '송강현');
    assert.ok(doc.getElementById('gmWorkspaceBody').hidden, '결재선 갱신도 접힘을 유지한다');
    doc.getElementById('gmViewDoc').click();
    assert.ok(!doc.getElementById('gmWorkspaceBody').hidden);
    assert.equal(doc.getElementById('gmRank').value, '소장');
    assert.equal(doc.getElementById('gmDocNoOne').value, '8100');
  });
  type(doc.getElementById('gmDirector'), '송강현');
  t('소장 이름을 적으면 부서장 → 소장(전결) 차례로 선다', () => {
    assert.match(doc.getElementById('gmLine').textContent, /결재자노길태부서장→결재자송강현소장 · 전결/);
    assert.match(doc.getElementById('gmPresetState').textContent, /소장 송강현/);
  });
  doc.getElementById('gmSetReset').click();
  t('기본값으로 — 규정대로(팀장 전결)로 돌아간다', () => assert.match(doc.getElementById('gmSetState').textContent, /^전결 팀장 · /));

  // 공문 작성(src/gmwrite.js) — 새 공문 창의 프레임을 흉내 낸다: 툴바(0)와 본문 틀(3). 단계마다 무엇을 넘겼는지 본다.
  const ran = [];
  const keep = { create: window.chrome.tabs.create, update: window.chrome.tabs.update, exec: window.chrome.scripting.executeScript };
  let finishOpen;
  const pendingOpen = new Promise((resolve) => { finishOpen = resolve; });
  const shownTabs = [];
  const dialogTree = { line: [{ name: '김거화', role: '결재' }], refs: [] };
  let pickedPerson = '';
  window.chrome.tabs.create = async (opts) => { calls.tabs.push(opts); await pendingOpen; return { id: 77 }; };
  window.chrome.tabs.update = async (tabId, opts) => { shownTabs.push([tabId, opts]); return { id: tabId }; };
  window.chrome.scripting.executeScript = async ({ target, func, args = [] }) => {
    ran.push({ name: func.name, frame: target.frameIds?.[0] ?? 'all', args });
    if (func.name === 'pageProbe') return [{ frameId: 0, result: { toolbar: true, ready: true } }, { frameId: 3, result: { form: true, ready: true, docId: 'HER-2026-000700' } }];
    const answer = {
      pageJob: () => ({ ok: true, id: 'RND00202026', dash: 'RND-20-2026', name: PROJECT, turn: '1 / 0' }),
      pageFill: () => args[0].map((f) => ({ key: f.key, ok: true, value: f.value })),
      pageBody: () => ({ ready: true, ok: true, length: 420 }),
      pageDialog: () => {
        const [op, value] = args;
        if (op === 'setting:ready' || op === 'line:ready') return { ready: true, drafter: '김거화[수소전기추진연구팀]' };
        if (op === 'setting:done' || op === 'line:done') return { done: true };
        if (op === 'setting:fill') return { ok: true, picked: { receiver: value.receiver, retention: value.retention, docNo: value.docNo } };
        if (op === 'line:pick') pickedPerson = value;
        if (op === 'line:press') {
          const person = { name: pickedPerson, role: value === 'btnAPP' ? '결재' : value === 'btnAGR' ? '합의' : '참조' };
          if (value === 'btnREF') dialogTree.refs.push(person);
          else if (value === 'btnAGR') dialogTree.line.splice(1, 0, person);
          else dialogTree.line.push(person);
        }
        if (op === 'line:pup') return { pup: false };
        if (op === 'line:tree') return dialogTree;
        return { ok: true };
      },
    }[func.name];
    return [{ result: answer ? answer() : null }];
  };
  doc.getElementById('gmWrite').click();
  await settle(50);
  t('뒤 탭 작성 중에도 화면 탭과 접힘을 바꿀 수 있고 작성 잠금·진행 기록은 유지된다', () => {
    const write = doc.getElementById('gmWrite');
    assert.ok(write.disabled);
    assert.equal(write.textContent, '공문 작성 중…');
    const progress = doc.getElementById('gmWriteLog').textContent;
    assert.match(progress, /뒤에서 여는 중/);
    doc.getElementById('gmViewDraft').click();
    doc.getElementById('gmWorkspaceToggle').click();
    assert.ok(doc.getElementById('gmWorkspaceBody').hidden);
    doc.getElementById('gmViewDoc').click();
    assert.ok(!doc.getElementById('gmWorkspaceBody').hidden);
    assert.ok(write.disabled);
    assert.equal(doc.getElementById('gmWriteLog').textContent, progress);
  });
  finishOpen();
  for (let i = 0; i < 60 && doc.getElementById('gmWrite').disabled; i++) await settle(100);
  const arg = (name) => ran.find((r) => r.name === name)?.args[0];
  t('공문 작성 — loginbyname 을 거쳐 연구업무추진품의 새 문서를 열고, 본문 틀이 뜨면 차례로 넣는다', () => {
    const url = calls.tabs.at(-1)?.url || '';
    assert.equal(calls.tabs.at(-1)?.active, false, '작성 창은 뒤 탭으로 열린다');
    assert.match(url, /^https:\/\/eclass\.krs\.co\.kr\/RealEANET\/loginbyname\.aspx\?ReturnUrl=/);
    assert.match(decodeURIComponent(url), /DocumentView\.aspx\?FORMID=KR_EA_Research_Task&DOCID=&/);
    const writing = ran.filter((r) => r.name !== 'pageProbe');
    assert.deepEqual(writing.slice(0, 3).map((r) => `${r.name}@${r.frame}`), ['pageJob@3', 'pageFill@3', 'pageBody@3']);
    assert.ok(writing.filter((r) => r.name === 'pageDialog').every((r) => r.frame === 0), '문서설정·결재선은 툴바의 숨은 틀에서 처리한다');
    assert.equal(writing.at(-1).name, 'pageBody');
    assert.equal(writing.at(-1).args[0].check, true, '설정·결재선 입력 뒤 본문이 남았는지 확인한다');
    assert.deepEqual(ran.filter((r) => r.name === 'pageDialog' && r.args[0].startsWith('setting:')).map((r) => r.args[0]),
      ['setting:open', 'setting:ready', 'setting:fill', 'setting:confirm', 'setting:done']);
  });
  t('공문 작성 — 과제는 과제명으로 고르고(팝업 대신 목록), 차수는 목록의 차수, 본문은 편집기 HTML, 문서설정은 Doc No. 8100', () => {
    assert.deepEqual([arg('pageJob').mode, arg('pageJob').name, arg('pageJob').callback], ['picker', PROJECT, 'callBackReturnFromDialog']);
    const fill = Object.fromEntries(arg('pageFill').map((f) => [f.key, f.value]));
    assert.equal(fill.title, doc.getElementById('gmTitle').value);
    assert.equal(fill.degree, '1');
    assert.ok(!('recipient' in fill) && !('reference' in fill), '빈 수신·참조는 건드리지 않는다');
    assert.equal(arg('pageBody').control, 'ctl00_ContentPlaceHolder_Content_EditorControl1');
    assert.match(arg('pageBody').html, /<div style="text-align:center;">------------ 아 {3}래 ------------<\/div>/);
    const setting = ran.find((r) => r.name === 'pageDialog' && r.args[0] === 'setting:fill').args[1];
    assert.deepEqual([setting.docNo, setting.retention, setting.receiver, setting.scopeCode], ['8100', '120', '내부결재', 'YNN']);
    const pressed = ran.filter((r) => r.name === 'pageDialog' && r.args[0] === 'line:press').map((r) => r.args[1]);
    assert.deepEqual(pressed, ['btnAPP', 'btnAGR', 'btnREF', 'btnREF']);
    assert.deepEqual(dialogTree, {
      line: [{ name: '김거화', role: '결재' }, { name: '박기도', role: '합의' }, { name: '노길태', role: '결재' }],
      refs: [{ name: '홍길동', role: '참조' }, { name: '이몽룡', role: '참조' }],
    });
    assert.ok(ran.some((r) => r.name === 'pageDialog' && r.args[0] === 'line:save'), '검증된 결재선은 저장한다');
  });
  t('공문 작성 — 단계마다 기록이 남고, 상태 줄은 첨부·임시저장·상신이 사람 몫이라고 말한다', () => {
    assert.deepEqual([...doc.querySelectorAll('#gmWriteLog li')].map((li) => li.className), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'gm-write-show']);
    assert.match(doc.getElementById('gmWriteLog').textContent, /과제\(Job Id\) RND-20-2026/);
    assert.match(doc.getElementById('gmWriteLog').textContent, /결재선\(위임전결\) 전결 팀장/);
    assert.match(doc.getElementById('gmStatus').textContent, /뒤 탭에 공문을 썼습니다 — 창 보기로 열어 확인하고 첨부·임시저장 뒤 상신하세요/);
    assert.match(doc.getElementById('gmSteps').textContent, /공문 작성 연구업무추진품의/);
    assert.ok(!doc.getElementById('gmWrite').disabled);
  });
  doc.getElementById('gmViewDraft').click();
  doc.getElementById('gmWorkspaceToggle').click();
  doc.getElementById('gmViewDoc').click();
  doc.querySelector('#gmWriteLog [data-act="show-tab"]').click();
  await settle();
  assert.deepEqual(shownTabs, [[77, { active: true }]], 'UI 탭 이동은 작성 결과 tabId를 덮지 않는다');
  window.chrome.tabs.create = keep.create;
  window.chrome.tabs.update = keep.update;
  window.chrome.scripting.executeScript = keep.exec;

  type(doc.getElementById('gmTplTitle'), '[부서구매] {품목요지} 구매 품의');
  t('양식(제목 틀)을 고치면 공문이 곧바로 따라 바뀌고, 고친 양식이라고 적힌다', () => {
    assert.equal(doc.getElementById('gmTitle').value, '[부서구매] 34인치 모니터 구매 품의');
    assert.match(doc.getElementById('gmTplState').textContent, /고친 양식/);
  });
  type(doc.getElementById('gmBody'), '직접 고친 본문');
  doc.getElementById('gmViewDraft').click();
  doc.getElementById('gmWorkspaceToggle').click();
  type(field('use'), '다른 용도');
  t('본문을 직접 고치면 위 칸을 바꿔도 그대로 두고, 양식으로 다시 만들기로 되돌린다', () => {
    assert.ok(doc.getElementById('gmWorkspaceBody').hidden, '입력 갱신은 접힘을 유지한다');
    doc.getElementById('gmViewDoc').click();
    assert.equal(doc.getElementById('gmBody').value, '직접 고친 본문');
    assert.ok(!doc.getElementById('gmEdited').classList.contains('hidden'));
    doc.getElementById('gmRegen').click();
    assert.match(doc.getElementById('gmBody').value, /마\. 용도 : 다른 용도/);
  });

  t('공문 설정의 과제 줄에 과제 내용 칸이 있다 — 사유를 쓰는 근거', () => {
    assert.equal(doc.querySelector('#gmProjList textarea[data-k="content"]')?.getAttribute('aria-label'), '과제 내용');
  });
  doc.querySelector('#gmFields [data-act="reason"]').click();
  await settle();
  t('Claude 가 없으면 "과제 내용으로 쓰기" 는 까닭을 말하고 사유 칸은 그대로다', () => {
    assert.match(doc.getElementById('gmStatus').textContent, /사유를 쓰지 못했습니다/);
    assert.match(field('reason').value, /대화면이 필요함/);
  });

  doc.querySelector('#gmKinds [data-kind="trip"]').click();
  t('출장도 같은 문서 넣는 곳 — 머리말만 다르고, 전체·부분 캡처 단추·문서 없이 쓰기가 선다', () => {
    assert.ok(!doc.getElementById('gmIntake').classList.contains('hidden'));
    assert.ok(!doc.getElementById('gmIntake').classList.contains('compact'));
    assert.ok(doc.getElementById('gmReadView').classList.contains('hidden'));
    assert.ok(doc.getElementById('gmReset').hidden);
    assert.equal(doc.getElementById('gmDropLead').textContent, '행사·회의 안내문이나 초청장을 넣으세요');
    assert.ok(doc.querySelector('#gmCapture .wp-open'), '웹페이지 캡처 단추');
    assert.ok(!doc.getElementById('gmManual').hidden);
    assert.ok(doc.getElementById('gmDraft').classList.contains('hidden'));
    assert.match(doc.getElementById('gmTplTitle').value, /출장 품의/);
  });
  doc.getElementById('gmManual').click();
  await settle();
  t('출장 — 문서 없이 쓰면 출장 칸(읽은 칸은 접힘, 출장목적·출장사유는 펼침)이 서고 과제·결재선은 다른 갈래와 같다', () => {
    assert.ok(!doc.getElementById('gmDraft').classList.contains('hidden'));
    assert.deepEqual([...doc.querySelectorAll('#gmMoreFields [data-key]')].map((n) => n.dataset.key), ['place', 'from', 'to', 'who', 'cost', 'division', 'account']);
    assert.deepEqual([...doc.querySelectorAll('#gmFields [data-key]')].map((n) => n.dataset.key), ['purpose', 'reason']);
    assert.equal(field('who').value, '김거화');
    assert.equal(doc.querySelector('#gmPick .gm-pick.active').textContent, PROJECT);
    assert.match(doc.getElementById('gmLine').textContent, /기안자김거화→합의자박기도과제책임자→결재자노길태부서장/);
    assert.match(doc.getElementById('gmNeed').textContent, /출장지 · 출장기간 · 예상경비 · 출장목적 · 출장사유/);
  });
  type(field('place'), '대전(한국기계연구원)');
  type(field('from'), '2026-10-20');
  type(field('to'), '2026-10-21');
  type(field('cost'), '300,000');
  type(field('purpose'), '실증 시험 참관');
  type(field('reason'), '과제 실증 시험 결과 확인에 필요함');
  t('출장 — 양식대로 제목·본문(출장 내용 · 출장사유 · ※ 첨부 행사 안내문)이 만들어진다', () => {
    assert.ok(!doc.getElementById('gmDoc').classList.contains('hidden'));
    assert.equal(doc.getElementById('gmTitle').value, `${PROJECT} 수행을 위한 출장 품의`);
    const body = doc.getElementById('gmBody').value;
    assert.match(body, /나\. 출장 내용\n {4}\(1\) 출 장 지 : 대전\(한국기계연구원\)\n {4}\(2\) 출장기간 : 2026\. 10\. 20\. ~ 2026\. 10\. 21\. \(2일\)\n {4}\(3\) 출 장 자 : 김거화\n {4}\(4\) 출장목적 : 실증 시험 참관\n {4}\(5\) 출장사유 : 과제 실증 시험 결과 확인에 필요함\n {4}\(6\) 예상경비 : 300,000원\n {4}\(7\) 예산계정 : 연구활동비\(국내여비\)/);
    assert.match(body, /※ 첨 부\n {4}1\. 행사 안내문 1부\.  끝\.$/);
    assert.match(doc.getElementById('gmSteps').textContent, /첨부 행사 안내문/);
  });

  // 외부활동 허가 신청서(2026-10-08 사용자 지정: "출장 옆에 외부활동 허가 신청서") — 같은 문서 넣는 곳, 요청 공문을 읽는다.
  doc.querySelector('#gmKinds [data-kind="outside"]').click();
  t('외부활동도 같은 문서 넣는 곳 — 요청 공문을 넣으라고 하고, 양식의 제목은 "[요청 기관] [구분] 외부활동 허가 신청"', () => {
    assert.ok(!doc.getElementById('gmIntake').classList.contains('hidden'));
    assert.equal(doc.getElementById('gmDropLead').textContent, '외부활동 요청 공문·메일(강의·자문·심사·발표 의뢰)을 넣으세요');
    assert.ok(doc.getElementById('gmDraft').classList.contains('hidden'));
    assert.equal(doc.getElementById('gmTplTitle').value, '{요청기관} {활동구분} 외부활동 허가 신청');
    assert.match(doc.getElementById('gmTplBody').value, /외부활동 내용/);
  });
  doc.getElementById('gmManual').click();
  await settle();
  t('외부활동 — 문서 없이 쓰면 외부활동 칸(읽은 칸은 접힘, 활동목적·신청사유는 펼침)이 서고, 구분은 강의가 기본', () => {
    assert.ok(!doc.getElementById('gmDraft').classList.contains('hidden'));
    assert.deepEqual([...doc.querySelectorAll('#gmMoreFields [data-key]')].map((n) => n.dataset.key), ['type', 'org', 'subject', 'from', 'to', 'hours', 'place', 'fee', 'topics', 'who']);
    assert.deepEqual([...doc.querySelectorAll('#gmFields [data-key]')].map((n) => n.dataset.key), ['purpose', 'reason']);
    assert.equal(field('type').value, '강의');
    assert.equal(field('who').value, '김거화');
    assert.match(doc.getElementById('gmNeed').textContent, /요청 기관 · 활동명 · 활동기간 · 활동장소 · 활동목적 · 신청사유/);
  });
  t('외부활동 — 과제는 갈래 아래가 아니라 작성 내용 카드 안에서 고른다', () => {
    assert.ok(doc.getElementById('gmProjBar').classList.contains('hidden'));
    assert.ok(!doc.getElementById('gmProjects').classList.contains('hidden'));
    assert.equal(doc.querySelector('#gmProjects .gm-proj.active .gm-proj-name').textContent, PROJECT);
  });
  type(field('org'), '부산대학교');
  type(field('subject'), 'MVDC 차단기 기술 특강');
  type(field('from'), '2026-11-05');
  type(field('place'), '부산대학교 공학관');
  type(field('purpose'), '연구 성과 확산');
  type(field('reason'), '과제 연구 성과의 확산에 필요함');
  t('외부활동 — 양식대로 제목·본문(외부활동 내용 · 신청사유 · ※ 첨부 요청 공문)이 만들어진다', () => {
    assert.ok(!doc.getElementById('gmDoc').classList.contains('hidden'));
    assert.equal(doc.getElementById('gmTitle').value, '부산대학교 강의 외부활동 허가 신청');
    const body = doc.getElementById('gmBody').value;
    assert.match(body, /나\. 외부활동 내용\n {4}\(1\) 활동구분 : 강의\n {4}\(2\) 요청기관 : 부산대학교\n {4}\(3\) 활 동 명 : MVDC 차단기 기술 특강\n {4}\(4\) 활동기간 : 2026\. 11\. 5\. \(1일\)\n {4}\(5\) 활동장소 : 부산대학교 공학관\n {4}\(6\) 활 동 자 : 김거화\n {4}\(7\) 활동목적 : 연구 성과 확산\n {4}\(8\) 신청사유 : 과제 연구 성과의 확산에 필요함/);
    assert.match(body, /※ 첨 부\n {4}1\. 요청 공문 1부\.  끝\.$/);
    assert.ok(!body.includes('예산계정'));
    assert.match(doc.getElementById('gmSteps').textContent, /첨부 요청 공문/);
  });
  await settle(500);   // 저장 타이머가 다음 boot 의 전역 chrome 으로 넘어가지 않게 한다.
}

console.log('공문 탭 — 화면 탭·접힘 저장 복원');
{
  const { blankDraft } = await import('../src/gongmun.js');
  const saved = {
    mode: 'gongmun', gongmunKind: 'edu', myName: '김거화',
    gongmunView: { tab: 'doc', evidenceOpen: false, workspaceOpen: false },
    gongmunDraft: { edu: {
      draft: { ...blankDraft('edu', { me: '김거화' }), course: '저장한 교육', from: '2026-10-20', to: '2026-10-21', fee: 37120 },
      source: { label: '직접 입력' }, title: '직접 고친 제목', body: '직접 고친 공문', rank: '소장', setting: { docNo: '8100' },
    } },
  };
  const { window, store } = await boot(saved);
  const doc = window.document;
  t('저장 초안을 열면 공문 선택과 두 접힘을 복원하고 직접 고친 내용·문서설정을 유지한다', () => {
    assert.ok(!doc.getElementById('gmWorkspace').classList.contains('hidden'));
    assert.ok(doc.getElementById('gmEvidenceBody').hidden);
    assert.ok(doc.getElementById('gmWorkspaceBody').hidden);
    assert.equal(doc.getElementById('gmViewDoc').getAttribute('aria-selected'), 'true');
    assert.ok(doc.getElementById('gmDraft').hidden);
    assert.ok(!doc.getElementById('gmDoc').hidden);
    assert.ok(doc.getElementById('gmReadView').hidden);
    assert.ok(!doc.getElementById('gmWorkspaceBody').classList.contains('compare'), '사이드패널은 두 칸으로 나누지 않는다');
    assert.equal(doc.getElementById('gmTitle').value, '직접 고친 제목');
    assert.equal(doc.getElementById('gmBody').value, '직접 고친 공문');
    assert.equal(doc.getElementById('gmRank').value, '소장');
    assert.equal(doc.getElementById('gmDocNoOne').value, '8100');
  });
  doc.getElementById('gmViewDraft').click();
  doc.getElementById('gmEvidenceToggle').click();
  doc.getElementById('gmWorkspaceToggle').click();
  await ta('화면 변경은 초안을 바꾸지 않고 별도의 UI 키에 저장된다', async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(store.gongmunView, { tab: 'draft', evidenceOpen: true, workspaceOpen: false });
    assert.equal(store.gongmunDraft.edu.body, '직접 고친 공문');
  });
}

console.log('공문 탭 — 비교작성 탭(2026-10-09 사용자 지정: "비교작성은 사이드패널이 아니라 크롬 탭에", "사이드 패널에서 비교하지 말라고")');
{
  const { blankDraft } = await import('../src/gongmun.js');
  const { window, store, calls } = await boot({
    mode: 'room', gongmunKind: 'purchase', myName: '김거화',
    gongmunView: { tab: 'doc', evidenceOpen: false, workspaceOpen: false },
    gongmunDraft: { edu: {
      draft: { ...blankDraft('edu', { me: '김거화' }), course: '저장한 교육', from: '2026-10-20', to: '2026-10-21', fee: 37120, purpose: '설계 역량', reason: '과제에 필요함' },
      source: { label: '직접 입력' },
    } },
  }, { search: '?compare=edu' });
  const doc = window.document;
  const field = (key) => doc.querySelector(`#gongmun [data-key="${key}"]`);
  const type = (node, value) => { node.value = value; node.dispatchEvent(new window.Event('input', { bubbles: true })); };
  /** 다른 창(사이드패널)이 저장소에 쓴 것을 흉내 낸다 — 리스너를 직접 부른다. */
  const remote = (changes, area = 'local') => { for (const fn of calls.storageListeners) fn(changes, area); };
  const panelDraft = (patch) => ({ ...store.gongmunDraft, by: 'panel', edu: { ...store.gongmunDraft.edu, draft: { ...store.gongmunDraft.edu.draft, ...patch } } });
  t('?compare=갈래 로 열리면 공문 탭 하나만 — 머리의 도구·탭 줄·말로 찾기·날짜 격자·현황·설정은 숨고, 사이트는 두드리지 않고, 저장된 모드도 안 바꾼다', () => {
    assert.ok(doc.body.classList.contains('compare-tab'));
    assert.match(doc.getElementById('appTitle').textContent, /공문 비교작성/);
    assert.match(doc.title, /공문 비교작성 — 교육/);
    for (const sel of ['.head-tools', '.tabs', '.ask', '.controls', '.schedule', '.settings', '.footer-note']) assert.ok(doc.querySelector(sel).hasAttribute('hidden'), sel);
    assert.ok(!doc.getElementById('gongmun').classList.contains('hidden'));
    assert.equal(calls.load, 0, '사이트 조회 없음');
    assert.equal(store.mode, 'room');
  });
  t('연 갈래(교육)의 초안을 두 칸으로 — 작성 내용이 왼쪽, 읽은 내용이 오른쪽. 읽은 내용 탭은 고를 수 없고 비교작성 단추는 없다', () => {
    assert.equal(doc.querySelector('#gmKinds .gm-kind.active').dataset.kind, 'edu', '저장된 갈래(구매)가 아니라 연 갈래');
    assert.ok(doc.getElementById('gmWorkspaceBody').classList.contains('compare'));
    assert.equal(doc.getElementById('gmViewDraft').getAttribute('aria-selected'), 'true', '사이드패널의 공문 선택은 따르지 않는다');
    assert.ok(!doc.getElementById('gmWorkspaceBody').hidden, '사이드패널에서 접어 두었어도 여기서는 펼쳐 있다');
    assert.ok(!doc.getElementById('gmDraft').hidden && !doc.getElementById('gmReadView').hidden);
    assert.ok(doc.getElementById('gmViewRead').disabled);
    assert.ok(doc.getElementById('gmViewRead').classList.contains('beside'));
    assert.ok(doc.getElementById('gmCompare').hidden);
    assert.equal(field('course').value, '저장한 교육');
    assert.equal(field('reason').value, '과제에 필요함');
    assert.match(doc.getElementById('gmWorkspaceToggle').title, /^작성 내용·읽은 내용 접기$/);
    doc.getElementById('gmViewRead').click();
    assert.equal(doc.getElementById('gmViewDraft').getAttribute('aria-selected'), 'true');
    doc.getElementById('gmViewDoc').click();
    assert.ok(!doc.getElementById('gmDoc').hidden && !doc.getElementById('gmReadView').hidden, '공문을 골라도 읽은 내용은 오른쪽에 남는다');
    doc.getElementById('gmViewDraft').click();
  });
  type(field('reason'), '탭에서 고친 사유');
  await ta('여기서 고친 칸은 저장소로 나가고 이 창의 표(by)가 붙는다 — 화면 상태·갈래는 저장하지 않는다', async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(store.gongmunDraft.edu.draft.reason, '탭에서 고친 사유');
    assert.equal(typeof store.gongmunDraft.by, 'string');
    assert.deepEqual(store.gongmunView, { tab: 'doc', evidenceOpen: false, workspaceOpen: false }, '사이드패널의 탭·접힘 그대로');
    assert.equal(store.gongmunKind, 'purchase');
  });
  t('사이드패널이 쓴 초안(다른 표)이 오면 칸이 따라간다 — 제 것(같은 표)은 건너뛴다', () => {
    remote({ gongmunDraft: { newValue: panelDraft({ reason: '패널에서 고친 사유', fee: 50000 }) } });
    assert.equal(field('reason').value, '패널에서 고친 사유');
    assert.equal(field('fee').value, '50,000');
    remote({ gongmunDraft: { newValue: { ...panelDraft({ reason: '내가 쓴 것' }), by: store.gongmunDraft.by } } });
    assert.equal(field('reason').value, '패널에서 고친 사유');
  });
  t('쓰고 있는 칸이 있으면 칸을 다시 그리지 않고 값만 맞춘다 — 쓰고 있는 칸은 두고', () => {
    const node = field('reason');
    node.focus();
    assert.equal(doc.activeElement, node);
    remote({ gongmunDraft: { newValue: panelDraft({ reason: '또 고친 사유', purpose: '패널의 용도' }) } });
    assert.equal(field('reason'), node, '쓰고 있는 칸은 그대로');
    assert.equal(node.value, '패널에서 고친 사유');
    assert.equal(field('purpose').value, '패널의 용도');
    node.blur();
  });
  type(field('reason'), '막 고치는 중');
  await ta('아직 저장 전인 갈래는 다른 창 것을 받지 않는다 — 곧 나갈 내 저장이 이긴다', async () => {
    remote({ gongmunDraft: { newValue: panelDraft({ reason: '패널이 끼어듦' }) } });
    assert.equal(field('reason').value, '막 고치는 중');
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(store.gongmunDraft.edu.draft.reason, '막 고치는 중');
    remote({ gongmunDraft: { newValue: panelDraft({ reason: '저장 뒤의 패널' }) } });
    assert.equal(field('reason').value, '저장 뒤의 패널', '저장이 끝나면 다시 따라간다');
  });
  t('사이드패널이 세션 저장소로 건넨 오린 견적서가 오른쪽에 보인다 — 다시 오리는 단추는 눌러도 아무 일 없다(읽은 장이 여기 없다)', () => {
    remote({ gongmunCut: { newValue: { edu: { name: '견적서.png', file: { name: '견적서.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }, boxes: [{ file: '인프런_1.png' }], drop: [], pad: 0.03, on: true } } } }, 'session');
    assert.ok(doc.querySelector('#gmReadView #gmCut img'));
    assert.match(doc.getElementById('gmCut').textContent, /인프런_1\.png/);
    doc.querySelector('#gmCut [data-cut="wide"]').click();
    assert.ok(doc.querySelector('#gmReadView #gmCut img'));
    assert.ok(!doc.querySelector('#gmCut [data-cut="wide"]').disabled);
  });
  t('붙여 넣기는 받지 않는다 — 읽은 파일은 사이드패널에만 있다', () => {
    const ev = new window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: { files: [new window.File(['x'], 'a.png', { type: 'image/png' })], getData: () => '' } });
    doc.dispatchEvent(ev);
    assert.ok(!ev.defaultPrevented);
    assert.doesNotMatch(doc.getElementById('gmStatus').textContent, /읽는 중/);
  });
  t('사이드패널에서 비우면 여기도 비고 어디서 넣는지 적힌다 — 다시 넣으면 따라 선다', () => {
    remote({ gongmunDraft: { newValue: { lastProject: '', by: 'panel' } } });
    assert.ok(doc.getElementById('gmWorkspace').classList.contains('hidden'));
    assert.match(doc.getElementById('gmStatus').textContent, /사이드패널의 공문 탭에서 문서를 넣거나 문서 없이 쓰기/);
    remote({ gongmunDraft: { newValue: { by: 'panel', edu: { draft: { ...blankDraft('edu', { me: '김거화' }), course: '다시 넣은 교육' }, source: { label: '교육 안내문' } } } } });
    assert.ok(!doc.getElementById('gmWorkspace').classList.contains('hidden'));
    assert.equal(field('course').value, '다시 넣은 교육');
    assert.equal(doc.getElementById('gmStatus').textContent, '');
    assert.ok(doc.getElementById('gmWorkspaceBody').classList.contains('compare'));
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
}
{
  const { blankDraft } = await import('../src/gongmun.js');
  const { window } = await boot({
    mode: 'gongmun', gongmunKind: 'purchase',
    gongmunView: { tab: 'doc', evidenceOpen: false, workspaceOpen: false },
    gongmunDraft: { purchase: { draft: { ...blankDraft('purchase'), gist: '한도 초과 품목', total: 1200000 }, source: { label: '직접 입력' } } },
  });
  const doc = window.document;
  t('저장한 공문 선택이 한도로 차단되면 읽은 내용 탭(합계 칸)으로 복원하고 참고 문서를 펼쳐 오류를 보여준다', () => {
    assert.equal(doc.getElementById('gmViewRead').getAttribute('aria-selected'), 'true');
    assert.ok(!doc.getElementById('gmReadView').hidden);
    assert.ok(doc.getElementById('gmViewDoc').disabled);
    assert.ok(doc.getElementById('gmDoc').classList.contains('hidden'));
    assert.ok(!doc.getElementById('gmEvidenceBody').hidden);
    assert.ok(!doc.getElementById('gmLimit').classList.contains('hidden'));
    assert.ok(doc.querySelector('#gmReadView [data-key="total"]'), '합계 칸은 읽은 내용 탭에 있다');
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
}

console.log('공문 탭 — 구매·교육·출장은 갈래 아래의 과제 줄(별칭 칩)에서 과제를 먼저 고른다(2026-10-08 사용자 지정)');
{
  const A = 'MW급 10kV 반도체 차단기 개발';
  const B = '선박용 수소 연료전지 추진 시스템 실증';
  const { window, store } = await boot({
    mode: 'gongmun', gongmunKind: 'purchase', myName: '김거화',
    gongmunPreset: { dept: '연구본부 수소전기추진연구팀', head: '노길태', refs: [] },
    rndBook: { projects: [
      { id: 'p1', name: A, alias: 'SSCB', code: 'RS-2026-0001', lead: '박기도' },
      { id: 'p2', name: B, alias: '수소추진', code: 'RS-2026-0002', lead: '홍길동' },
    ] },
  });
  const doc = window.document;
  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const chips = () => [...doc.querySelectorAll('#gmPick .gm-pick')].map((b) => [b.textContent, b.classList.contains('active')]);
  const chip = (label) => [...doc.querySelectorAll('#gmPick .gm-pick')].find((b) => b.textContent === label);
  await settle();
  t('문서를 넣기 전에도 갈래 바로 아래에 과제 줄이 서고, 칩은 별칭이다 — 과제가 둘이라 고르라고 한다', () => {
    const bar = doc.getElementById('gmProjBar');
    assert.ok(!bar.classList.contains('hidden'));
    assert.equal(doc.getElementById('gmKinds').nextElementSibling, bar, '채팅 칸·문서 넣는 곳보다 위');
    assert.ok(doc.getElementById('gmDraft').classList.contains('hidden'), '초안은 아직 없다');
    assert.deepEqual(chips(), [['SSCB', false], ['수소추진', false]]);
    assert.ok(bar.classList.contains('need'));
    assert.equal(bar.querySelector('.gm-projbar-label').textContent, '과제 선택');
    assert.equal(chip('수소추진').title, `${B} · RS-2026-0002 · 책임자 홍길동`);
  });
  chip('수소추진').click();
  await ta('고르면 켜지고 남는다 — 켜진 칩을 다시 눌러도 풀리지 않는다', async () => {
    assert.deepEqual(chips(), [['SSCB', false], ['수소추진', true]]);
    assert.equal(doc.querySelector('#gmProjBar .gm-projbar-label').textContent, '연결 과제');
    chip('수소추진').click();
    assert.deepEqual(chips(), [['SSCB', false], ['수소추진', true]]);
    await settle(500);
    assert.equal(store.gongmunDraft?.lastProject, B);
  });
  doc.getElementById('gmManual').click();
  await settle();
  t('문서 없이 쓰면 먼저 고른 과제로 초안이 시작한다 — 과제 기본 내용·합의자가 그 과제의 것', () => {
    assert.ok(!doc.getElementById('gmDraft').classList.contains('hidden'));
    assert.match(doc.getElementById('gmProjInfo').textContent, /별명 수소추진.*번호 RS-2026-0002/);
    assert.match(doc.getElementById('gmLine').textContent, /합의자홍길동/);
  });
  chip('SSCB').click();
  await settle();
  t('초안이 있을 때 과제 줄에서 바꾸면 초안의 과제가 바뀐다', () => {
    assert.deepEqual(chips(), [['SSCB', true], ['수소추진', false]]);
    assert.match(doc.getElementById('gmProjInfo').textContent, /별명 SSCB/);
    assert.match(doc.getElementById('gmLine').textContent, /합의자박기도/);
  });
  doc.querySelector('#gmKinds [data-kind="edu"]').click();
  t('초안이 없는 다른 갈래로 가도 마지막에 고른 과제가 켜져 있다', () => {
    assert.ok(doc.getElementById('gmDraft').classList.contains('hidden'));
    assert.deepEqual(chips(), [['SSCB', true], ['수소추진', false]]);
  });
  doc.querySelector('#gmKinds [data-kind="outside"]').click();
  t('외부활동에서는 과제 줄이 숨는다(작성 내용 카드 안에서 고른다)', () => assert.ok(doc.getElementById('gmProjBar').classList.contains('hidden')));
}

console.log('R&D 탭');
{
  const { wired, window } = await boot({ mode: 'room' });
  const doc = window.document;
  t('R&D 탭 클릭과 R&D 화면의 리스너', () => {
    assert.ok(wired.get('tabRnd')?.has('click'));
    const want = [['rdProjects', 'click'], ['rdEmptyAdd', 'click'], ['rdEmptyImport', 'click'], ['rdEdit', 'click'], ['rdYears', 'click'],
      ['rdAliasSet', 'click'], ['rdAliasIn', 'keydown'], ['rdRosterCopy', 'click'], ['rdPlanCopy', 'click'],
      ['rdNoteOn', 'change'], ['rdNoteSection', 'change'], ['rdNoteSections', 'click'], ['rdNoteSync', 'click'],
      ['rdFSave', 'click'], ['rdFCancel', 'click'], ['rdFDel', 'click'], ['rdForm', 'keydown'],
      ['rdBudget', 'input'], ['rdBudget', 'change'], ['rdBudget', 'click'], ['rdBudgetAdd', 'click'],
      ['rdLogAdd', 'click'], ['rdLogCancel', 'click'], ['rdLogTitle', 'keydown'], ['rdLogs', 'click'],
      ['rdChAdd', 'click'], ['rdChCancel', 'click'], ['rdChanges', 'click'], ['rdChanges', 'change'],
      ['rdCopy', 'click'], ['rdBudgetCopy', 'click'], ['rdLogsCopy', 'click'], ['rdChangesCopy', 'click'], ['rdExport', 'click'], ['rdImport', 'change'], ['rdImportGm', 'click'],
      ['rdYaml', 'change'], ['rnd', 'dragover'], ['rnd', 'drop'], ['rdSkillBox', 'toggle'], ['rdSkillZip', 'click'], ['rdSkillGuide', 'click']];
    for (const [id, type] of want) assert.ok(wired.get(id)?.has(type), `${id} 에 ${type}`);
  });
  t('회의실 탭에서는 R&D 화면이 숨어 있다', () => assert.ok(doc.getElementById('rnd').classList.contains('hidden')));
}
{
  const { window, store } = await boot({
    mode: 'rnd',
    gongmunProjects: [{ name: 'MVDC 차단기 개발', alias: '차단기 과제', code: 'RND-20-2026', lead: '박기도', period: '2026.04.01 ~ 2029.12.31', about: '', content: '', account: '' }],
  });
  const doc = window.document;
  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  await settle();
  t('저장된 모드가 R&D 면 R&D 탭으로 열리고 날짜 격자·예약 현황·말로 찾기·근태·공문은 숨는다', () => {
    assert.ok(doc.getElementById('tabRnd').classList.contains('active'));
    assert.match(doc.getElementById('appTitle').textContent, /R&D 과제/);
    assert.ok(!doc.getElementById('rnd').classList.contains('hidden'));
    for (const id of ['attend', 'gongmun']) assert.ok(doc.getElementById(id).classList.contains('hidden'), id);
    for (const sel of ['.controls', '.schedule', '.ask']) assert.ok(doc.querySelector(sel).hasAttribute('hidden'), sel);
  });
  t('처음 열면 공문 탭의 과제를 가져와 칩이 서고, 오늘이 든 차년도가 켜져 있다', () => {
    assert.deepEqual([...doc.querySelectorAll('#rdProjects [data-proj]')].map((b) => b.textContent), ['차단기 과제']);
    assert.ok(doc.querySelector('#rdYears .rd-year.active.now'));
    assert.deepEqual([...doc.querySelectorAll('#rdBudget .rd-brow [data-k="item"]')].map((i) => i.value), ['인건비', '연구시설·장비비', '연구재료비', '연구활동비', '연구수당', '간접비']);
  });
  await ta('장부가 저장소(rndBook)에 남고 모드도 남는다', async () => {
    await settle(500);
    assert.equal(store.mode, 'rnd');
    assert.equal(store.rndBook.projects[0].code, 'RND-20-2026');
    assert.equal(store.rndBook.projects[0].start, '2026-04-01');
  });
  t('공문 탭으로 가면 R&D 화면이 숨고, 돌아오면 다시 보인다', () => {
    doc.getElementById('tabGongmun').click();
    assert.ok(doc.getElementById('rnd').classList.contains('hidden'));
    assert.ok(!doc.getElementById('gongmun').classList.contains('hidden'));
    doc.getElementById('tabRnd').click();
    assert.ok(!doc.getElementById('rnd').classList.contains('hidden'));
    assert.ok(doc.getElementById('gongmun').classList.contains('hidden'));
    assert.ok(doc.querySelector('.schedule').hasAttribute('hidden'));
  });
}

console.log('공문 탭 — 교육: 견적서에 교육 내용 캡처를 더 넣으면 함께 읽고 둘 다 첨부, 과제 내용으로 교육사유');
{
  // 1×1 PNG — PDF 로 묶을 수 있는 진짜 그림이어야 한다.
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  // 읽기의 키는 교육 초안 칸의 key 다(레시피 edu/purpose.yaml).
  const QUOTE = { docType: 'quote', provider: '한국전력기술교육원', course: '전력변환 설계 실무', from: '2026-10-12', to: '2026-10-14', fee: 450000, summary: '교육 견적서 450,000원', purpose: '설계 역량 강화' };
  const asked = [];
  const fetchImpl = async (url, init) => {
    if (!String(url).includes('api.anthropic.com')) throw new Error('offline');
    const body = JSON.parse(init.body);
    const props = Object.keys(body.output_config.format.schema.properties);
    const input = JSON.stringify(body.messages[0].content);
    asked.push({ props, input });
    let record;
    if (props.includes('parts')) {
      const two = input.includes('첨부한 문서 2장');
      record = two
        ? { ...QUOTE, topics: 'DC-DC 컨버터 · 제어 루프 설계', parts: [{ file: '교육견적.png', kind: 'quote' }, { file: '커리큘럼.png', kind: 'content' }] }
        : { ...QUOTE, from: '', to: '', parts: [{ file: '교육견적.png', kind: 'quote' }] };
    } else if (props.includes('reason')) {
      // 사유 쓰기의 답 키는 교육 초안 칸의 key 다 — 교육목적은 purpose(레시피 edu/purpose.yaml 의 write 가 있는 칸).
      record = { reason: '과제의 MVDC 전력변환 설계 역량 확보에 필요함', purpose: '전력변환 회로 설계 역량 강화' };
    } else {
      throw new Error(`모르는 작업: ${props}`);
    }
    return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(record) }] }) };
  };
  const saved = {
    mode: 'gongmun', gongmunKind: 'edu', apiKey: 'sk-ant-test', myName: '김거화',
    gongmunPreset: { dept: '연구본부 수소전기추진연구팀', head: '노길태', refs: [] },
    gongmunProjects: [{ name: 'MVDC 차단기 개발', code: 'RND-20-2026', lead: '박기도', about: '', content: 'MVDC 선내 전력망용 전력변환기 설계·시험', account: '' }],
  };
  const { window, calls, store } = await boot(saved, { fetchImpl });
  const doc = window.document;
  globalThis.URL.createObjectURL = () => 'blob:gongmun-test';
  globalThis.URL.revokeObjectURL = () => {};
  const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  const drop = (names) => {
    const ev = new window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: names.map((n) => new window.File([PNG], n, { type: 'image/png' })) } });
    doc.getElementById('gmIntake').dispatchEvent(ev);
  };
  const field = (key) => doc.querySelector(`#gongmun [data-key="${key}"]`);
  const type = (node, value) => { node.value = value; node.dispatchEvent(new window.Event('input', { bubbles: true })); };
  await settle();
  t('교육은 견적서와 교육 내용을 함께 넣으라고 안내한다', () => assert.equal(doc.getElementById('gmDropLead').textContent, '교육 견적서·교육 내용을 넣으세요'));
  t('교육 자료를 읽기 전에는 큰 자료 넣기 영역과 빈 참고 문서 상태다', () => {
    assert.ok(!doc.getElementById('gmIntake').classList.contains('compact'));
    assert.ok(doc.getElementById('gmReadView').classList.contains('hidden'));
    assert.ok(doc.getElementById('gmReset').hidden);
    assert.equal(doc.getElementById('gmEvidenceCount').textContent, '');
  });

  doc.getElementById('gmEvidenceToggle').click();
  drop(['교육견적.png']);
  await settle(200);
  t('견적서를 읽고, 과제가 골라져 있으니 과제 내용으로 교육사유를 저절로 쓴다', () => {
    assert.equal(field('course').value, '전력변환 설계 실무');
    assert.equal(field('reason').value, '과제의 MVDC 전력변환 설계 역량 확보에 필요함');
    assert.equal(field('purpose').value, '전력변환 회로 설계 역량 강화');
    const reasonAsk = asked.find((a) => a.props.includes('reason'));
    assert.match(reasonAsk.input, /MVDC 선내 전력망용 전력변환기 설계·시험/, '과제 내용이 근거로 간다');
    assert.match(doc.getElementById('gmSource').textContent, /첨부 · 교육 견적서/);
    assert.equal(doc.getElementById('gmDropLead').textContent, '교육 내용(커리큘럼) 캡처 더 넣기');
  });
  t('교육 견적서를 읽으면 자료 넣는 곳은 더 넣기 행으로 줄고, 읽은 것은 작업 카드의 읽은 내용 탭에 선다', () => {
    const read = doc.getElementById('gmReadView');
    assert.ok(doc.getElementById('gmIntake').classList.contains('compact'));
    assert.ok(!read.classList.contains('hidden'));
    assert.ok(!doc.getElementById('gmReset').hidden);
    assert.equal(doc.getElementById('gmEvidenceCount').textContent, '첨부 1종');
    assert.equal(doc.getElementById('gmSource').closest('#gmReadView'), read);
    assert.equal(field('course').closest('#gmReadView'), read);
    assert.equal(field('reason').closest('#gmDraft'), doc.getElementById('gmDraft'));
    assert.match(doc.getElementById('gmViewRead').title, /^견적서 · 한국전력기술교육원 · 첨부 교육 견적서$/, '읽은 내용 탭의 툴팁은 무엇을 읽었는지·첨부');
  });
  t('새로 읽은 교육기간이 비었으면 읽은 내용 탭을 열어 빠진 입력을 보여준다', () => {
    assert.equal(field('from').value, '');
    assert.equal(doc.getElementById('gmViewRead').getAttribute('aria-selected'), 'true');
    assert.ok(!doc.getElementById('gmWorkspaceBody').hidden);
    assert.ok(!doc.getElementById('gmReadView').hidden);
    assert.match(doc.getElementById('gmNeed').textContent, /교육기간/);
  });

  // 사용자가 참석자를 고친 뒤 교육 내용 캡처를 더 넣는다.
  field('attendees').value = '김거화, 홍길동';
  field('attendees').dispatchEvent(new window.Event('input', { bubbles: true }));
  drop(['커리큘럼.png']);
  await settle(200);
  t('더 넣으면 앞서 넣은 것과 함께(2장) 다시 읽고, 고친 칸은 그대로 둔다', () => {
    const reads = asked.filter((a) => a.props.includes('parts'));
    assert.equal(reads.length, 2);
    assert.match(reads[1].input, /첨부한 문서 2장\(파일 이름: 교육견적\.png, 커리큘럼\.png\)/);
    assert.equal(field('attendees').value, '김거화, 홍길동');
    assert.equal(field('topics').value, 'DC-DC 컨버터 · 제어 루프 설계');
    assert.equal(asked.filter((a) => a.props.includes('reason')).length, 1, '사유가 이미 있으면 다시 쓰지 않는다');
    assert.ok(doc.getElementById('gmIntake').classList.contains('compact'));
    assert.ok(!doc.getElementById('gmReadView').classList.contains('hidden'));
    assert.equal(doc.getElementById('gmEvidenceCount').textContent, '첨부 2종');
  });
  t('본문 — 교육내용 줄과, 교육 견적서·교육 내용 두 줄의 첨부', () => {
    const body = doc.getElementById('gmBody').value;
    assert.match(body, /교육내용 : DC-DC 컨버터 · 제어 루프 설계/);
    assert.match(body, /교육사유 : 과제의 MVDC 전력변환 설계 역량 확보에 필요함/);
    assert.match(body, /※ 첨 부\n {4}1\. 교육 견적서 1부\.\n {4}2\. 교육 내용 1부\.  끝\.$/);
    assert.match(doc.getElementById('gmSource').textContent, /첨부 · 교육 견적서 · 교육 내용/);
  });
  t('제목은 "[과제 별명] 수행을 위한 교육 품의" — 별명이 없으면 과제명, 본문에 가. 과제 개요', () => {
    assert.equal(doc.getElementById('gmTitle').value, 'MVDC 차단기 개발 수행을 위한 교육 품의');
    assert.equal(field('mode').value, '교육', '교육장소가 온라인이 아니면 교육');
    const body = doc.getElementById('gmBody').value;
    assert.match(body, /가\. 과제 개요\n {4}\(1\) 과 제 명 : MVDC 차단기 개발\n {4}\(2\) 과제번호 : RND-20-2026\n {4}\(3\) 과제책임자 : 박기도\n나\. 교육 내용/);
    const info = doc.getElementById('gmProjInfo');
    assert.ok(!info.classList.contains('hidden'));
    assert.match(info.textContent, /과제 기본 내용.*별명 없음.*번호 RND-20-2026.*연구기간 없음.*내용 \d+자/);
    assert.match(doc.getElementById('gmNeed').textContent, /과제 별명\(공문 설정 — 제목\)/);
    assert.match(doc.getElementById('gmSteps').textContent, /첨부 교육 견적서 · 교육 내용 — 아래 PDF/, '창에서 할 일의 첨부도 본문 ※ 첨부와 같은 문서들');
  });
  // 과제 기본 내용의 "고치기" — 공문 설정의 그 과제 줄이 펴지고 빈 별명 칸에 커서가 간다.
  doc.querySelector('#gmProjInfo [data-act="preset"]').click();
  t('고치기는 공문 설정을 펴고 그 과제의 빈 별명 칸으로 간다', () => {
    assert.ok(doc.getElementById('gmPresetBox').open);
    assert.equal(doc.activeElement?.dataset.k, 'alias');
    assert.equal(doc.activeElement.getAttribute('aria-label'), '과제 별명');
  });
  type(doc.activeElement, '차단기 과제');
  type(doc.querySelector('#gmProjList [data-k="period"]'), '2026.04.01 ~ 2029.12.31');
  await settle(500);
  t('별명·연구기간을 넣으면 제목·과제 개요가 곧바로 바뀌고 저장된다', () => {
    assert.equal(doc.getElementById('gmTitle').value, '차단기 과제 수행을 위한 교육 품의');
    assert.match(doc.getElementById('gmBody').value, /\(3\) 연구기간 : 2026\.04\.01 ~ 2029\.12\.31\n {4}\(4\) 과제책임자 : 박기도/);
    assert.match(doc.getElementById('gmProjInfo').textContent, /별명 차단기 과제/);
    assert.equal(doc.querySelector('#gmPick .gm-pick.active').textContent, '차단기 과제', '과제 줄의 칩이 별명으로 바뀐다');
    assert.equal(doc.querySelector('#gmPick .gm-pick.active').title, 'MVDC 차단기 개발 · RND-20-2026 · 책임자 박기도');
    assert.ok(!/과제 별명/.test(doc.getElementById('gmNeed').textContent));
    assert.equal(store.gongmunProjects[0].alias, '차단기 과제');
    assert.equal(store.gongmunProjects[0].period, '2026.04.01 ~ 2029.12.31');
  });
  type(field('place'), '온라인(실시간)');
  t('교육장소가 온라인이면 교육 구분이 따라가 "… 온라인교육 품의" 가 된다', () => {
    assert.equal(field('mode').value, '온라인교육');
    assert.equal(doc.getElementById('gmTitle').value, '차단기 과제 수행을 위한 온라인교육 품의');
    assert.match(doc.getElementById('gmBody').value, /아래와 같이 온라인교육에 참가하고자/);
  });
  field('mode').value = '교육';
  field('mode').dispatchEvent(new window.Event('change', { bubbles: true }));
  type(field('place'), '온라인 Zoom');
  t('교육 구분을 직접 고르면 그것이 이기고, 교육장소를 고쳐도 따라가지 않는다', () => {
    assert.equal(field('mode').value, '교육');
    assert.equal(doc.getElementById('gmTitle').value, '차단기 과제 수행을 위한 교육 품의');
  });
  doc.getElementById('gmSavePdf').click();
  await settle(400);
  t('첨부 PDF 는 문서마다 하나씩 — 교육 견적서·교육 내용', () => {
    assert.match(doc.getElementById('gmSavePdf').textContent, /2개/);
    assert.deepEqual(calls.downloads.map((d) => d.filename.replace(/_\d{4}-\d{2}-\d{2}/, '')), ['교육견적서_한국전력기술교육원.pdf', '교육내용_한국전력기술교육원.pdf']);
  });

  doc.querySelector('#gmKinds [data-kind="trip"]').click();
  t('다른 종류로 바꾸면 교육 OCR 결과를 숨기고 새 자료를 넣는 상태로 돌아간다', () => {
    assert.ok(doc.getElementById('gmReadView').classList.contains('hidden'));
    assert.ok(doc.getElementById('gmDraft').classList.contains('hidden'));
    assert.ok(!doc.getElementById('gmIntake').classList.contains('compact'));
    assert.ok(doc.getElementById('gmReset').hidden);
    assert.equal(doc.getElementById('gmEvidenceCount').textContent, '');
    assert.equal(field('course'), null);
  });
  doc.querySelector('#gmKinds [data-kind="edu"]').click();
  t('교육으로 돌아오면 기존 자료와 고친 작성 내용을 이어 쓴다', () => {
    assert.ok(!doc.getElementById('gmReadView').classList.contains('hidden'));
    assert.ok(!doc.getElementById('gmDraft').classList.contains('hidden'));
    assert.ok(doc.getElementById('gmIntake').classList.contains('compact'));
    assert.ok(!doc.getElementById('gmReset').hidden);
    assert.equal(doc.getElementById('gmEvidenceCount').textContent, '첨부 2종');
    assert.equal(field('course').value, '전력변환 설계 실무');
    assert.equal(field('attendees').value, '김거화, 홍길동');
  });
  doc.getElementById('gmViewDoc').click();
  doc.getElementById('gmWorkspaceToggle').click();
  if (!doc.getElementById('gmEvidenceBody').hidden) doc.getElementById('gmEvidenceToggle').click();
  doc.getElementById('gmReset').click();
  await settle();
  t('비우기는 OCR 결과와 작성 내용을 숨기고 처음의 자료 넣기 상태로 돌아간다', () => {
    assert.ok(doc.getElementById('gmReadView').classList.contains('hidden'));
    assert.ok(doc.getElementById('gmDraft').classList.contains('hidden'));
    assert.ok(doc.getElementById('gmDoc').classList.contains('hidden'));
    assert.ok(!doc.getElementById('gmIntake').classList.contains('compact'));
    assert.ok(doc.getElementById('gmReset').hidden);
    assert.equal(doc.getElementById('gmEvidenceCount').textContent, '');
    assert.ok(!doc.getElementById('gmManual').hidden);
    assert.equal(doc.getElementById('gmDropLead').textContent, '교육 견적서·교육 내용을 넣으세요');
    assert.ok(doc.getElementById('gmWorkspace').classList.contains('hidden'));
    assert.ok(!doc.getElementById('gmWorkspaceBody').hidden);
    assert.ok(!doc.getElementById('gmEvidenceBody').hidden);
    assert.equal(doc.getElementById('gmViewDraft').getAttribute('aria-selected'), 'true');
  });
}

console.log('공문 탭 — 구매: 쇼핑몰 화면을 넣으면 가격과 그 둘레를 오려 견적서로 첨부(2026-10-08) → 더 넓게 → 첨부 PDF → 원래 장으로 → 가격 부분만');
{
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const asked = [];
  const fetchImpl = async (url, init) => {
    if (!String(url).includes('api.anthropic.com')) throw new Error('offline');
    const body = JSON.parse(init.body);
    const props = Object.keys(body.output_config.format.schema.properties);
    asked.push({ props, system: JSON.stringify(body.system) });
    let record;
    if (props.includes('parts')) {
      // 쿠팡 상품 화면 — 가격과 그 둘레는 그림의 위쪽 가운데(왼쪽 10~60%, 위 20~50%)에 있다. 사양표는 따로 넣은 그림이다.
      record = {
        docType: 'order', vendor: '쿠팡', gist: '34인치 모니터', total: 489000, summary: '쿠팡 34인치 모니터 상품 화면 489,000원', use: '연구 자료 검토용',
        items: [{ name: 'LG 34WR50QK 34인치 모니터', qty: 1, unit: '대', amount: 489000 }],
        parts: [{ file: '쿠팡_상품.png', kind: 'order' }, { file: '사양표.png', kind: 'other' }],
        quoteArea: [{ file: '쿠팡_상품.png', left: 10, top: 20, right: 60, bottom: 50 }],
      };
    } else if (props.includes('reason')) {
      record = { reason: '과제 회의에서 회로도·시험 데이터를 함께 검토할 대화면이 필요함', use: null };
    } else {
      throw new Error(`모르는 작업: ${props}`);
    }
    return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(record) }] }) };
  };
  const saved = {
    mode: 'gongmun', gongmunKind: 'purchase', apiKey: 'sk-ant-test', myName: '김거화',
    gongmunPreset: { dept: '연구본부 수소전기추진연구팀', head: '노길태', refs: [] },
    gongmunProjects: [{ name: 'MVDC 차단기 개발', code: 'RND-20-2026', lead: '박기도', about: '', content: '', account: '' }],
  };
  const { window, calls, store } = await boot(saved, { fetchImpl });
  const doc = window.document;
  // 가짜 캔버스 — 오린 자리(drawImage 의 앞 네 수)와 캔버스 크기를 적는다. 넣은 그림은 1000×800 이다(짧은 변 800).
  const made = [];
  const kept = { canvas: globalThis.OffscreenCanvas, bitmap: globalThis.createImageBitmap };
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; this.drawn = []; made.push(this); }
    getContext() { const c = this; return { fillRect() {}, drawImage(bm, ...a) { c.drawn.push(a.slice(0, 4)); } }; }
    async convertToBlob({ type }) { return new window.Blob([PNG], { type }); }
  };
  globalThis.createImageBitmap = async () => ({ width: 1000, height: 800, close() {} });
  const blobs = [];
  globalThis.URL.createObjectURL = (b) => { blobs.push(b); return 'blob:gongmun-cut'; };
  globalThis.URL.revokeObjectURL = () => {};
  const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  const drop = (names) => {
    const ev = new window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: names.map((n) => new window.File([PNG], n, { type: 'image/png' })) } });
    doc.getElementById('gmIntake').dispatchEvent(ev);
  };
  const cutBox = () => doc.getElementById('gmCut');
  const cutBtn = (act) => doc.querySelector(`#gmCut [data-cut="${act}"]`);
  const body = () => doc.getElementById('gmBody').value;
  await settle();
  t('구매가 아니거나 읽기 전에는 오린 견적서 칸이 숨어 있다', () => assert.ok(cutBox().classList.contains('hidden')));

  drop(['쿠팡_상품.png', '사양표.png']);
  await settle(250);
  t('읽기 지시문에 오릴 칸(quoteArea)이 들어 있다', () => {
    const read = asked.find((a) => a.props.includes('parts'));
    assert.ok(read?.props.includes('quoteArea'));
    assert.match(read.system, /가격과 그 둘레/);
  });
  t('읽기가 짚은 칸을 둘레(짧은 변의 3% = 24px)까지 넣어 오리고, 오린 그림을 보여 준다', () => {
    assert.ok(!cutBox().classList.contains('hidden'), `칸이 숨었다 — ${doc.getElementById('gmStatus').textContent} / ${doc.getElementById('gmSource').textContent}`);
    assert.deepEqual(made.at(-1).drawn, [[76, 136, 548, 288]]);
    assert.deepEqual([made.at(-1).width, made.at(-1).height], [548, 288]);
    assert.match(cutBox().querySelector('img').getAttribute('src'), /^data:image\/png;base64,/);
    assert.match(cutBox().textContent, /가격과 그 둘레를 오렸습니다 — 쿠팡_상품\.png/);
    assert.ok(cutBtn('wide') && cutBtn('off'));
  });
  t('첨부 — 오린 그림이 견적서이고 상품 화면 장은 빠진다, 따로 넣은 사양표는 남는다', () => {
    assert.match(doc.getElementById('gmSource').textContent, /첨부 · 견적서 · 참고 자료/);
    assert.match(body(), /※ 첨 부\n {4}1\. 견적서 1부\.\n {4}2\. 참고 자료 1부\.  끝\.$/);
    assert.match(doc.getElementById('gmSavePdf').textContent, /첨부 PDF 2개 저장 \(견적서 · 참고 자료\)/);
    assert.equal(doc.getElementById('gmTitle').value, '34인치 모니터 구매 품의');
  });

  cutBtn('wide').click();
  await settle(120);
  t('더 넓게 — 둘레를 더 넣어(3% → 8% = 64px) 다시 오린다', () => {
    assert.deepEqual(made.at(-1).drawn, [[36, 96, 628, 368]]);
    assert.match(body(), /1\. 견적서 1부\./);
  });

  doc.getElementById('gmSavePdf').click();
  await settle(500);
  await ta('첨부 PDF — 견적서는 오린 그림 한 쪽, 사양표는 참고 자료', async () => {
    assert.deepEqual(calls.downloads.map((d) => d.filename.replace(/_\d{4}-\d{2}-\d{2}/, '')), ['견적서_쿠팡.pdf', '참고자료_쿠팡.pdf']);
    const { PDFDocument } = await import('../vendor/pdf-lib.esm.min.js');
    assert.equal((await PDFDocument.load(new Uint8Array(await blobs[0].arrayBuffer()))).getPageCount(), 1);
  });

  cutBtn('off').click();
  await settle();
  t('원래 장으로 — 넣은 장 그대로(주문 내역·참고 자료) 첨부하고, 가격 부분만 첨부로 돌아가는 단추가 선다', () => {
    assert.match(cutBox().textContent, /넣은 장 그대로 첨부합니다/);
    assert.equal(cutBox().querySelector('img'), null);
    assert.match(body(), /※ 첨 부\n {4}1\. 주문 내역 1부\.\n {4}2\. 참고 자료 1부\.  끝\.$/);
    assert.match(doc.getElementById('gmSavePdf').textContent, /\(주문 내역 · 참고 자료\)/);
  });
  cutBtn('on').click();
  await settle();
  t('가격 부분만 첨부 — 다시 오린 견적서가 첫 줄', () => {
    assert.match(body(), /※ 첨 부\n {4}1\. 견적서 1부\.\n {4}2\. 참고 자료 1부\.  끝\./);
    assert.ok(cutBox().querySelector('img'));
  });
  await settle(500);
  t('저장되는 초안에는 오린 그림(data URL)이 들지 않고, 첨부 목록은 남는다', () => {
    const draft = JSON.stringify(store.gongmunDraft ?? {});
    assert.match(draft, /견적서_가격부분_/);
    assert.ok(!draft.includes('data:image'));
  });
  doc.querySelector('#gmKinds [data-kind="edu"]').click();
  t('교육 갈래로 가면 오린 견적서 칸은 숨는다', () => assert.ok(cutBox().classList.contains('hidden')));
  Object.assign(globalThis, { OffscreenCanvas: kept.canvas, createImageBitmap: kept.bitmap });
}

console.log('공문 탭 — 구매: 읽은 문서는 읽은 내용 탭에, 작성 내용 탭에 과제(R&D 탭)·용도·사유·에이전트·결재선, 비교작성은 크롬 탭으로(2026-10-09), 연구 내용으로 사유, 강의를 사면 견적서와 강의 내용 첨부(2026-10-08)');
{
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const asked = [];
  const fetchImpl = async (url, init) => {
    if (!String(url).includes('api.anthropic.com')) throw new Error('offline');
    const body = JSON.parse(init.body);
    const props = Object.keys(body.output_config.format.schema.properties);
    const input = JSON.stringify(body.messages[0].content);
    asked.push({ props, input });
    let record;
    if (props.includes('parts')) {
      // 인프런 강의를 구매로 — 첫 장은 가격 칸(오린다), 둘째 장은 커리큘럼(강의 내용).
      record = {
        docType: 'order', vendor: '(주)인프랩', gist: 'Hermes Bot 강의', total: 84700, summary: '인프런 강의 84,700원',
        parts: [{ file: '인프런_1.png', kind: 'order' }, { file: '인프런_2.png', kind: 'content' }],
        quoteArea: [{ file: '인프런_1.png', left: 60, top: 10, right: 95, bottom: 60 }],
      };
    } else if (props.includes('reason')) {
      record = input.includes('사용자의 말')
        ? { reason: '고전압 시험 장비 검증 역량 확보에 필요함', use: '시험 장비 검증 교육용', reply: '사유를 시험 장비 검증 쪽으로 고쳤습니다' }
        : { reason: '차단기 시제품 설계에 AI 도구 활용 역량이 필요함', use: 'AI 설계 도구 학습용', reply: null };
    } else {
      throw new Error(`모르는 작업: ${props}`);
    }
    return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(record) }] }) };
  };
  // R&D 과제 — 오늘이 1차년도 안에 들게 한 달 전에 시작한다.
  const pad2 = (n) => String(n).padStart(2, '0');
  const ymdOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const now = new Date();
  const start = ymdOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30));
  const end = ymdOf(new Date(now.getFullYear() + 3, now.getMonth(), now.getDate()));
  const NAME = 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발';
  const saved = {
    mode: 'gongmun', gongmunKind: 'purchase', apiKey: 'sk-ant-test', myName: '김거화',
    gongmunPreset: { dept: '연구본부 수소전기추진연구팀', head: '노길태', refs: [] },
    gongmunProjects: [{ name: '공문 설정에만 있는 과제', lead: '홍길동' }],
    rndBook: { projects: [{ id: 'p1', name: NAME, alias: 'SSCB', code: 'RS-2026-0001', lead: '박기도', start, end,
      years: { 1: { logs: [{ date: start, title: '연구개발 계획', key: 'plan', text: '■ 개발목표\n1. 10kV 반도체 차단기 시제품 설계' }] } } }] },
  };
  const { window, calls } = await boot(saved, { fetchImpl });
  const doc = window.document;
  const kept = { canvas: globalThis.OffscreenCanvas, bitmap: globalThis.createImageBitmap };
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() { return { fillRect() {}, drawImage() {} }; }
    async convertToBlob({ type }) { return new window.Blob([PNG], { type }); }
  };
  globalThis.createImageBitmap = async () => ({ width: 1000, height: 800, close() {} });
  const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  const drop = (names) => {
    const ev = new window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: names.map((n) => new window.File([PNG], n, { type: 'image/png' })) } });
    doc.getElementById('gmIntake').dispatchEvent(ev);
  };
  const field = (key) => doc.querySelector(`#gongmun [data-key="${key}"]`);
  const type = (node, value) => { node.value = value; node.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const body = () => doc.getElementById('gmBody').value;
  const reasons = () => asked.filter((a) => a.props.includes('reason'));
  await settle();
  drop(['인프런_1.png', '인프런_2.png']);
  await settle(300);
  t('읽은 칸이 다 찼으니 작성 내용 탭이 열려 용도·구매사유가 보이고, 읽은 문서(읽은 칸·오린 견적서)는 읽은 내용 탭에 있다', () => {
    assert.equal(doc.getElementById('gmViewDraft').getAttribute('aria-selected'), 'true');
    assert.ok(doc.getElementById('gmReadView').hidden, '비교작성이 아니면 읽은 내용은 탭을 골라야 보인다');
    assert.match(doc.getElementById('gmViewRead').title, /^주문 화면 · \(주\)인프랩 · 첨부 견적서 · 강의 내용$/);
    assert.deepEqual([...doc.querySelectorAll('#gmFields [data-key]')].map((n) => n.dataset.key), ['use', 'reason']);
    assert.deepEqual([...doc.querySelectorAll('#gmMoreFields [data-key]')].map((n) => n.dataset.key), ['gist', 'vendor', 'total', 'summary', 'account']);
    assert.ok(doc.querySelector('#gmReadView #gmCut img'));
    assert.equal(doc.getElementById('gmReadView').closest('#gmDraft'), null);
    assert.ok(doc.getElementById('gmIntake').classList.contains('compact'));
    assert.ok(!doc.getElementById('gmReadView').classList.contains('hidden'));
    assert.ok(!doc.getElementById('gmAgent').classList.contains('hidden'));
  });
  await ta('비교작성 단추 — 오린 견적서를 세션 저장소에 건네고 크롬 탭(?compare=purchase)을 연다. 사이드패널은 나누지 않는다', async () => {
    doc.getElementById('gmCompare').click();
    await settle();
    assert.equal(calls.tabs.at(-1)?.url, 'chrome-extension://test/sidepanel.html?compare=purchase');
    const handed = (await window.chrome.storage.session.get(['gongmunCut'])).gongmunCut;
    assert.ok(handed?.purchase?.file?.dataUrl?.startsWith('data:image/png'), '오린 견적서 그림');
    assert.ok(handed.purchase.boxes.length >= 1);
    assert.ok(doc.getElementById('gmReadView').hidden);
    assert.ok(!doc.getElementById('gmWorkspaceBody').classList.contains('compare'));
  });
  t('과제는 R&D 탭의 과제다(공문 설정의 과제가 아니다) — 하나뿐이라 골라지고, 기본 내용에 연구 내용이 보인다', () => {
    assert.deepEqual([...doc.querySelectorAll('#gmPick .gm-pick')].map((n) => n.textContent), ['SSCB'], '칩은 별칭');
    assert.ok(doc.querySelector('#gmPick .gm-pick.active').title.startsWith(NAME), '과제명은 툴팁');
    assert.match(doc.getElementById('gmProjInfo').textContent, /별명 SSCB.*번호 RS-2026-0001.*연구 내용 연구개발 계획 1차년도/);
    assert.match(doc.getElementById('gmLine').textContent, /합의자박기도/);
  });
  // 공문 설정의 과제도 R&D 탭의 과제다(2026-10-10 사용자 지정: "rnd 에 과제 들어가 있는거 추가하면되잖아. 그거랑 연동되어야").
  t('공문 설정의 과제는 R&D 탭의 과제다 — 별칭 머리, R&D 탭에 적힌 과제명·번호·책임자·기간·연구 내용 한 줄, 공문에만 쓰는 개요·계정 칸', () => {
    assert.equal(doc.getElementById('gmProjCount').textContent, '1', 'R&D 탭의 과제 수 — 한도(열 개)는 적지 않는다');
    const row = doc.querySelector('#gmProjList .gm-proj-linked[data-rnd="p1"]');
    assert.equal(row.querySelector('.gm-linked-name').textContent, 'SSCB');
    assert.match(row.querySelector('.gm-linked-meta').textContent, new RegExp(`^${NAME} · RS-2026-0001 · 책임자 박기도 · \\d{4}\\.\\d{2}\\.\\d{2} ~ \\d{4}\\.\\d{2}\\.\\d{2} · 연구개발 계획 1차년도$`));
    assert.deepEqual([...row.querySelectorAll('[data-x]')].map((n) => n.getAttribute('aria-label')), ['과제 개요', '계정']);
    assert.equal(row.querySelector('[data-k]'), null, '과제명·번호·책임자는 여기서 고치지 않는다(R&D 탭)');
    assert.equal(doc.getElementById('gmProjAdd').textContent, 'R&D 탭에서 과제 더하기');
  });
  t('예전에 공문 설정에 적었지만 R&D 탭에 없는 과제는 그 아래에 따로 선다 — 초안에서 고르지 않는다고 알리고, 예전 칸 그대로 고치거나 뺀다', () => {
    assert.match(doc.querySelector('#gmProjList .gm-proj-orphan').textContent, /^R&D 탭에 없는 과제 — 초안에서 고르지 않습니다/);
    assert.equal(doc.querySelector('#gmProjList .gm-proj-row[data-i="0"] [data-k="name"]').value, '공문 설정에만 있는 과제');
    assert.ok(doc.querySelector('#gmProjList [data-act="drop"][data-i="0"]'));
  });
  await ta('R&D 과제 줄에 적은 개요·계정은 그 과제 id 몫으로 저장된다', async () => {
    type(doc.querySelector('#gmProjList [data-rnd="p1"] [data-x="about"]'), '차단기 과제를 수행하고 있습니다.');
    await settle(480);
    const got = (await window.chrome.storage.local.get(['gongmunRndExtra'])).gongmunRndExtra;
    assert.deepEqual(got, { p1: { about: '차단기 과제를 수행하고 있습니다', account: '' } });
  });
  t('고른 과제의 연구 내용(연구개발 계획)을 근거로 용도·구매사유를 저절로 쓴다', () => {
    assert.equal(reasons().length, 1, `사유를 쓰지 않았다 — ${doc.getElementById('gmStatus').textContent}`);
    assert.match(reasons()[0].input, /과제 내용\(R&D 탭의 연구 내용 — 연구개발 계획·진행 기록\):\\n<<<\\n\[연구개발 계획 — 1차년도\]\\n■ 개발목표/);
    assert.equal(field('reason').value, '차단기 시제품 설계에 AI 도구 활용 역량이 필요함');
    assert.equal(field('use').value, 'AI 설계 도구 학습용');
    assert.equal(doc.querySelector('#gmFields [data-act="reason"]').textContent, '연구 내용으로 쓰기');
  });
  t('공문의 첨부는 오린 견적서와 강의 내용 두 줄 — PDF 도 둘', () => {
    assert.match(body(), /※ 첨 부\n {4}1\. 견적서 1부\.\n {4}2\. 강의 내용 1부\.  끝\.$/);
    assert.match(doc.getElementById('gmSavePdf').textContent, /첨부 PDF 2개 저장 \(견적서 · 강의 내용\)/);
  });

  type(field('use'), '내가 쓴 용도');
  type(doc.getElementById('gmAgentInput'), '사유를 시험 장비 검증 쪽으로 다시 써 줘');
  doc.getElementById('gmAgentGo').click();
  await settle(200);
  t('에이전트 칸 — 적은 말과 지금 적힌 사유를 연구 내용과 함께 넘기고, 고쳐 쓴 용도·사유가 칸과 본문에 들어가며 답이 남는다', () => {
    const ask = reasons().at(-1);
    assert.equal(reasons().length, 2);
    assert.match(ask.input, /지금 적힌 구매사유: 차단기 시제품 설계에 AI 도구 활용 역량이 필요함\\n사용자의 말:\\n<<<\\n사유를 시험 장비 검증 쪽으로 다시 써 줘\\n>>>/);
    assert.match(ask.input, /\[연구개발 계획 — 1차년도\]/);
    assert.equal(field('reason').value, '고전압 시험 장비 검증 역량 확보에 필요함');
    assert.equal(field('use').value, '시험 장비 검증 교육용', '고쳐 달라고 했으니 손으로 고친 용도도 바꾼다');
    assert.match(body(), /용도 : 시험 장비 검증 교육용/);
    assert.deepEqual([...doc.querySelectorAll('#gmAgentLog .gm-say')].map((n) => n.textContent),
      ['사유를 시험 장비 검증 쪽으로 다시 써 줘', '사유를 시험 장비 검증 쪽으로 고쳤습니다']);
    assert.equal(doc.getElementById('gmAgentInput').value, '');
  });

  doc.getElementById('gmViewDraft').click();
  type(field('total'), '1,200,000');
  t('합계가 한도를 넘으면 읽은 내용 탭이 열린다 — 합계 칸이 그 안에 있다', () => {
    assert.equal(doc.getElementById('gmViewRead').getAttribute('aria-selected'), 'true');
    assert.ok(!doc.getElementById('gmReadView').hidden);
    assert.match(doc.getElementById('gmLimit').textContent, /읽은 문서의 합계 칸을 고쳐 주세요/);
  });
  doc.querySelector('#gmProjInfo [data-act="rnd"]').click();
  await settle();
  t('과제 기본 내용의 R&D 탭 단추는 R&D 탭으로 간다', () => assert.ok(doc.getElementById('tabRnd').classList.contains('active')));
  Object.assign(globalThis, { OffscreenCanvas: kept.canvas, createImageBitmap: kept.bitmap });
}

console.log('공문 탭 — 보고 있는 탭 통째로 캡처해 읽기(2026-10-08, 아이콘 단추): 권한 → 한 화면씩 찍기 → A4 장 → 다섯 장과 화면 글자 읽기, 나머지는 첨부에만 → 수강료 칸을 오린 교육 견적서 · 교육 내용 PDF');
{
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const asked = [];
  const fetchImpl = async (url, init) => {
    if (!String(url).includes('api.anthropic.com')) throw new Error('offline');
    const body = JSON.parse(init.body);
    const props = Object.keys(body.output_config.format.schema.properties);
    // 첨부가 있으면 content 는 목록(글·그림), 없으면(사유 쓰기) 글 하나다.
    const content = body.messages[0].content;
    const input = JSON.stringify(content);
    asked.push({ props, input, images: Array.isArray(content) ? content.filter((c) => c.type === 'image').length : 0 });
    let record;
    if (props.includes('parts')) {
      // 읽기는 보낸 다섯 장 가운데 첫 장을 교육 안내문, 둘째 장을 교육 내용으로 가리고 나머지는 적지 않았다 — 뒷장이 이어 받는지 본다.
      // 첫 장의 수강료 칸(quoteArea)을 짚었다 — 그 칸을 오려 교육 견적서로 첨부하는지 본다(2026-10-08 사용자 지정).
      const names = [...new Set([...input.matchAll(/화면캡처_inflearn\.com_\d{4}-\d{2}-\d{2}_\d+\.png/g)].map((m) => m[0]))];
      record = {
        docType: 'course', provider: '인프런', course: '[단테랩스] Hermes Bot × OpenAI Dots', fee: 84700, summary: '인프런 온라인 강의 안내 84,700원',
        place: '온라인', hours: '7분(수업 19개)', topics: '두 봇 지도와 하이라이트 릴 · 봇 하나로 놀기', purpose: 'AI 봇 활용 역량 강화',
        parts: [{ file: names[0], kind: 'course' }, { file: names[1], kind: 'content' }],
        quoteArea: [{ file: names[0], left: 5, top: 10, right: 95, bottom: 40 }],
      };
    } else if (props.includes('reason')) {
      record = { reason: '과제의 AI 봇 플랫폼 활용 역량 확보에 필요함', purpose: null };
    } else {
      throw new Error(`모르는 작업: ${props}`);
    }
    return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(record) }] }) };
  };
  const saved = {
    mode: 'gongmun', gongmunKind: 'edu', apiKey: 'sk-ant-test', myName: '김거화',
    gongmunPreset: { dept: '연구본부 수소전기추진연구팀', head: '노길태', refs: [] },
    gongmunProjects: [{ name: 'MVDC 차단기 개발', alias: '차단기 과제', code: 'RND-20-2026', lead: '박기도', about: '', content: 'AI 도구를 설계 검토에 활용', account: '' }],
  };
  const { window, calls } = await boot(saved, { fetchImpl });
  const doc = window.document;
  // 가짜 크롬 — 이 창(7)에서 보고 있는 탭(11)은 인프런 강의 화면이고, Outlook 받은 편지함(12)은 뒤에 있다(찍히면 안 된다):
  // 높이 6000, 뷰포트 600×1000(폭이 좁아 A4 장이 일곱 장 나온다 — 읽기 다섯 장 + 첨부만 두 장).
  const page = { scrollY: 0, steps: [], done: null };
  const perms = { asked: 0, has: false };
  const tabs = [
    { id: 11, url: 'https://www.inflearn.com/course/hermes-bot', title: 'Hermes Bot 강의 - 인프런', status: 'complete' },
    { id: 12, url: 'https://outlook.office.com/mail/', title: '메일 - 받은 편지함 - Outlook', status: 'complete' },
  ];
  const front = { id: 11 };
  const fronted = [];
  Object.assign(window.chrome, {
    windows: { getCurrent: async () => ({ id: 7 }) },
    permissions: { contains: async () => perms.has, request: async (p) => { perms.asked++; calls.permissions = p; perms.has = true; return true; } },
  });
  window.chrome.tabs.query = async (q) => (q.windowId !== 7 ? [] : tabs.filter((t) => !q.active || t.id === front.id).map((t) => ({ ...t, active: t.id === front.id })));
  window.chrome.tabs.update = async (id, props) => { if (props.active) { front.id = id; fronted.push(id); } return { id }; };
  window.chrome.tabs.get = async (id) => ({ ...tabs.find((t) => t.id === id), active: id === front.id });
  window.chrome.tabs.captureVisibleTab = async (windowId, opts) => {
    assert.equal(front.id, 11, '찍을 때는 고른 탭이 앞에 있어야 한다');
    calls.shots = (calls.shots || 0) + 1;
    calls.shotOpts = [windowId, opts];
    return `data:image/png;base64,${PNG.toString('base64')}`;
  };
  window.chrome.scripting.executeScript = async ({ target, func, args }) => {
    assert.equal(target.tabId, 11);
    if (func.name === 'pageInfo') {
      return [{ result: { url: 'https://www.inflearn.com/course/hermes-bot', title: 'Hermes Bot 강의 - 인프런', scrollHeight: 6000, viewportHeight: 1000, viewportWidth: 600, dpr: 1, scrollY: 0,
        text: '강의 소개\n\n\n교육비  84,700원\n커리큘럼\n섹션 1. 두 봇 지도' } }];
    }
    if (func.name === 'pageStep') { page.steps.push(args); page.scrollY = Math.min(args[0], 5000); return [{ result: page.scrollY }]; }
    if (func.name === 'pageDone') { page.done = args[0]; return [{ result: null }]; }
    throw new Error(`모르는 함수 ${func.name}`);
  };
  // 가짜 캔버스 — 장마다 1×1 PNG 를 낸다(PDF 로 묶을 수 있는 진짜 그림). 그림은 뷰포트와 같은 폭(배율 1).
  const canvases = [];
  const kept = { canvas: globalThis.OffscreenCanvas, bitmap: globalThis.createImageBitmap, file: globalThis.File };
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; canvases.push([w, h]); }
    getContext() { return { fillRect() {}, drawImage() {} }; }
    async convertToBlob({ type }) { return new window.Blob([PNG], { type }); }
  };
  globalThis.createImageBitmap = async () => ({ width: 600, height: 1000, close() {} });
  globalThis.File = window.File;   // 캡처가 만드는 File 을 이 창의 FileReader 가 읽을 수 있어야 한다
  const blobs = [];
  globalThis.URL.createObjectURL = (b) => { blobs.push(b); return 'blob:gongmun-cap'; };
  globalThis.URL.revokeObjectURL = () => {};
  const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  const field = (key) => doc.querySelector(`#gongmun [data-key="${key}"]`);
  await settle();
  const tabBtn = () => doc.querySelector('#gmCapture [data-pick="tab"]');
  const partBtn = () => doc.querySelector('#gmCapture [data-pick="part"]');
  t('문서 넣는 곳 아래에 단추 둘 — 전체(보고 있는 탭 통째로)와 부분(골라 캡처). 탭 목록은 없다', () => {
    const box = doc.getElementById('gmCapture');
    assert.ok(box.closest('#gmIntake'), '문서 넣는 곳 안에 있어야 한다');
    assert.equal(tabBtn().textContent, '전체', '전체 · 부분 — 글자가 보인다');
    assert.ok(tabBtn().querySelector('svg'));
    assert.match(tabBtn().title, /보고 있는 웹페이지를 위에서 아래까지 캡처/);
    assert.equal(partBtn().textContent, '부분');
    assert.equal(partBtn().getAttribute('aria-pressed'), 'false');
    assert.ok(!tabBtn().disabled && !partBtn().disabled);
    assert.equal(doc.getElementById('gmTabs'), null);
  });
  tabBtn().click();
  await settle(40);
  t('아이콘을 누르면 먼저 사이트 접근 권한(<all_urls>)을 묻고, 보고 있는 탭을 찍는 동안 단추와 파일 고르기가 잠긴다', () => {
    assert.deepEqual(fronted, [11]);
    assert.equal(perms.asked, 1);
    assert.deepEqual(calls.permissions, { origins: ['<all_urls>'] });
    assert.ok(tabBtn().disabled && partBtn().disabled);
    assert.ok(doc.getElementById('gmFile').disabled);
    assert.equal(doc.getElementById('gmDropLead').textContent, '캡처하는 중…');
    assert.match(doc.getElementById('gmStatus').textContent, /캡처하는 중/);
  });
  // 여섯 화면 × 0.6초 틈 — 실제 시간으로 기다린다.
  await settle(6 * 650 + 900);
  t('한 화면씩 여섯 번 찍고(둘째부터 고정 띠 숨김) 자리를 되돌린 뒤, A4 비율의 일곱 장으로 잘랐다', () => {
    assert.equal(calls.shots, 6);
    assert.deepEqual(calls.shotOpts, [7, { format: 'png' }]);
    assert.deepEqual(page.steps, [[0, false], [1000, true], [2000, true], [3000, true], [4000, true], [5000, true]]);
    assert.equal(page.done, 0);
    assert.equal(canvases.length, 8, 'A4 일곱 장 + 오린 교육 견적서 한 장');
    assert.deepEqual(canvases[0], [600, 849]);
    assert.deepEqual(canvases[7], [576, 336], '첫 장의 수강료 칸(5~95% × 10~40%)을 둘레 18px 더 넣어 오렸다');
    assert.ok(!tabBtn().disabled && !partBtn().disabled);
  });
  t('뒤에 있던 메일함은 앞에 나오지 않는다 — 보던 탭 그대로', () => {
    assert.deepEqual(fronted, [11, 11]);
    assert.equal(front.id, 11);
  });
  t('읽기에는 앞 다섯 장과 화면 글자(머리말 달림)가 가고, 두 장은 첨부에만 들어간다', () => {
    const read = asked.find((a) => a.props.includes('parts'));
    assert.ok(read, `읽기를 부르지 않았다 — ${doc.getElementById('gmStatus').textContent}`);
    assert.equal(read.images, 5);
    assert.match(read.input, /첨부한 문서 5장\(파일 이름: 화면캡처_inflearn\.com_\d{4}-\d{2}-\d{2}_1\.png, [^)]*_5\.png\)/);
    assert.match(read.input, /\[웹페이지 글자 — Hermes Bot 강의 - 인프런\] https:\/\/www\.inflearn\.com\/course\/hermes-bot\\n강의 소개\\n\\n교육비 84,700원/);
    const src = doc.getElementById('gmSource').textContent;
    assert.match(src, /화면캡처_inflearn\.com_\d{4}-\d{2}-\d{2} 7장/, '파일 줄은 묶어 적는다');
    assert.match(src, /캡처 7장 가운데 앞 5장만 읽었습니다 — 나머지 2장은 첨부 PDF 에만 들어갑니다/);
  });
  t('읽은 칸 — 교육명·교육비·교육기관, 온라인이라 제목은 "… 온라인교육 품의", 과제 내용으로 교육사유', () => {
    assert.equal(field('course').value, '[단테랩스] Hermes Bot × OpenAI Dots');
    assert.equal(field('provider').value, '인프런');
    assert.equal(field('fee').value, '84,700');
    assert.equal(field('mode').value, '온라인교육');
    assert.equal(field('reason').value, '과제의 AI 봇 플랫폼 활용 역량 확보에 필요함',
      `사유가 비었다 — 부른 작업: ${asked.map((a) => a.props.slice(0, 2).join('|')).join(', ')} · 상태: ${doc.getElementById('gmStatus').textContent}`);
    assert.equal(doc.getElementById('gmTitle').value, '차단기 과제 수행을 위한 온라인교육 품의');
  });
  t('첨부 — 수강료 칸을 오린 그림이 교육 견적서, 페이지 일곱 장(안내문 장까지)은 교육 내용이고, 본문 ※ 첨부는 그 두 줄', () => {
    assert.match(doc.getElementById('gmSource').textContent, /첨부 · 교육 견적서 · 교육 내용 7장/);
    assert.match(doc.getElementById('gmBody').value, /※ 첨 부\n {4}1\. 교육 견적서 1부\.\n {4}2\. 교육 내용 1부\.  끝\.$/);
    assert.match(doc.getElementById('gmSavePdf').textContent, /첨부 PDF 2개 저장 \(교육 견적서 · 교육 내용\)/);
    const cut = doc.getElementById('gmCut');
    assert.ok(!cut.classList.contains('hidden'), '오린 교육 견적서를 보여 준다');
    assert.match(cut.querySelector('.gm-cut-head').textContent, /^교육 견적서가격과 그 둘레를 오렸습니다 — 화면캡처_inflearn\.com_\d{4}-\d{2}-\d{2}_1\.png$/);
    assert.ok(!/교육 견적서|교육 내용/.test(doc.getElementById('gmNeed').textContent), '두 첨부가 다 있으니 남은 것에 없다');
  });
  doc.getElementById('gmSavePdf').click();
  await settle(800);
  await ta('첨부 PDF 저장 — 교육 견적서 PDF(오린 한 쪽)와 교육 내용 PDF(일곱 쪽)가 내려받아진다', async () => {
    assert.deepEqual(calls.downloads.map((d) => d.filename.replace(/_\d{4}-\d{2}-\d{2}/, '')), ['교육견적서_인프런.pdf', '교육내용_인프런.pdf']);
    const { PDFDocument } = await import('../vendor/pdf-lib.esm.min.js');
    const pages = [];
    for (const b of blobs) pages.push((await PDFDocument.load(new Uint8Array(await b.arrayBuffer()))).getPageCount());
    assert.deepEqual(pages, [1, 7]);
  });
  doc.querySelector('#gmCut [data-cut="off"]').click();
  await settle();
  t('원래 장으로 — 수강료 칸이 없으니 교육 견적서가 남은 것이 되고, 넣는 곳은 교육 견적서를 넣으라고 한다(본문 ※ 첨부는 두 줄 그대로)', () => {
    assert.match(doc.getElementById('gmSource').textContent, /첨부 · 교육 내용 7장/);
    assert.match(doc.getElementById('gmBody').value, /※ 첨 부\n {4}1\. 교육 견적서 1부\.\n {4}2\. 교육 내용 1부\.  끝\.$/);
    assert.match(doc.getElementById('gmNeed').textContent, /교육 견적서\(첨부\)/);
    assert.equal(doc.getElementById('gmDropLead').textContent, '교육 견적서(수강료 화면) 더 넣기');
  });
  Object.assign(globalThis, { OffscreenCanvas: kept.canvas, createImageBitmap: kept.bitmap, File: kept.file });
}

console.log('공문 탭 — 부분 골라 캡처(2026-10-08 "탭이 아니라 프레임으로 선택"): 페이지 위에서 고르기 → 고르기 취소 → 다시 골라 eClass 본문 틀·상자 → 틀 안을 내리며 찍기 → 고른 것만 읽기');
{
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const asked = [];
  const fetchImpl = async (url, init) => {
    if (!String(url).includes('api.anthropic.com')) throw new Error('offline');
    const body = JSON.parse(init.body);
    const props = Object.keys(body.output_config.format.schema.properties);
    const content = body.messages[0].content;
    const input = JSON.stringify(content);
    asked.push({ props, input, images: Array.isArray(content) ? content.filter((c) => c.type === 'image').length : 0 });
    let record;
    if (props.includes('parts')) {
      const names = [...new Set([...input.matchAll(/화면캡처_eclass\.krs\.co\.kr_\d{4}-\d{2}-\d{2}_\d+\.png/g)].map((m) => m[0]))];
      record = {
        docType: 'course', provider: '한국전력기술교육원', course: '전력전자 실무', fee: 330000, summary: '전력전자 실무 교육 안내 330,000원',
        place: '대전', hours: '16시간', topics: '컨버터 설계', purpose: '차단기 설계 역량 강화',
        parts: [{ file: names[0], kind: 'course' }, { file: names[1], kind: 'content' }],
      };
    } else if (props.includes('reason')) {
      record = { reason: '과제의 차단기 설계 역량 확보에 필요함', purpose: null };
    } else {
      throw new Error(`모르는 작업: ${props}`);
    }
    return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(record) }] }) };
  };
  const saved = {
    mode: 'gongmun', gongmunKind: 'edu', apiKey: 'sk-ant-test', myName: '김거화',
    gongmunPreset: { dept: '연구본부 수소전기추진연구팀', head: '노길태', refs: [] },
    gongmunProjects: [{ name: 'MVDC 차단기 개발', alias: '차단기 과제', code: 'RND-20-2026', lead: '박기도', about: '', content: '차단기 설계', account: '' }],
  };
  const { window, calls } = await boot(saved, { fetchImpl });
  const doc = window.document;
  // 가짜 크롬 — 보고 있는 탭(41)은 eClass 포털: 본문은 틀(iframe, frameId 5 — 테두리 1, 안쪽 1200×700, 안이 2000 높이로 따로 내려간다)이고,
  // 그 아래 교육비 상자(800×300)가 있다. 창은 1200×1000. 다른 틀(광고, frameId 6)도 있다.
  const perms = { has: false };
  const front = { id: 41 };
  const ran = [];
  const shots = [];
  const win = { scrollY: 0, inner: 0, hidden: false };
  const frame5 = { scrollY: 0, done: null };
  let pending = null;   // 페이지 위의 고르기 — 테스트가 사용자 대신 풀어 준다
  const PARTS = [
    { n: 1, tag: 'iframe', title: '교육 안내', frame: { href: null, src: 'https://eclass.krs.co.kr/notice/view?id=7', name: 'content-iframe', w: 1200, h: 700 } },
    { n: 2, tag: 'div', title: '교육비', frame: null },
  ];
  const PLACE = { 1: { top: 80, left: 0, width: 1202, height: 702, frame: true, text: '' }, 2: { top: 900, left: 100, width: 800, height: 300, frame: false, text: '교육비 330,000원 (부가세 포함)' } };
  Object.assign(window.chrome, {
    windows: { getCurrent: async () => ({ id: 7 }) },
    permissions: { contains: async () => perms.has, request: async () => { perms.has = true; return true; } },
  });
  window.chrome.tabs.query = async (q) => (q.windowId === 7 && q.active ? [{ id: 41, url: 'https://eclass.krs.co.kr/eClassVer4/Home/Index', title: 'e-Class', active: true, status: 'complete' }] : []);
  window.chrome.tabs.update = async (id) => ({ id });
  window.chrome.tabs.get = async (id) => ({ id, active: id === front.id, status: 'complete' });
  window.chrome.tabs.captureVisibleTab = async () => { shots.push([win.scrollY, frame5.scrollY]); return `data:image/png;base64,${PNG.toString('base64')}`; };
  window.chrome.scripting.executeScript = async ({ target, func, args = [] }) => {
    assert.equal(target.tabId, 41);
    ran.push([target.frameIds?.[0] ?? (target.allFrames ? 'all' : 'top'), func.name, ...args]);
    if (func.name === 'pagePick') return new Promise((resolve) => { pending = (parts) => { pending = null; resolve([{ result: parts }]); }; });
    if (func.name === 'pickCancel') { pending?.(null); return [{ result: true }]; }
    if (target.allFrames) {
      assert.equal(func.name, 'frameProbe');
      return [
        { frameId: 0, result: { href: 'https://eclass.krs.co.kr/eClassVer4/Home/Index', name: '', w: 1200, h: 1000, child: false } },
        { frameId: 5, result: { href: 'https://eclass.krs.co.kr/notice/view?id=7', name: 'content-iframe', w: 1200, h: 700, child: true } },
        { frameId: 6, result: { href: 'https://ads.example/', name: 'ad', w: 300, h: 250, child: true } },
      ];
    }
    if (target.frameIds) {
      assert.deepEqual(target.frameIds, [5], '본문 틀 안에서만');
      if (func.name === 'pageInfo') return [{ result: { url: 'https://eclass.krs.co.kr/notice/view?id=7', title: '교육 안내', scrollHeight: 2000, viewportHeight: 700, viewportWidth: 1200, dpr: 1, scrollY: 0, text: '전력전자 실무 교육 안내\n교육기간 11/3~11/4' } }];
      if (func.name === 'pageStep') { frame5.scrollY = Math.min(args[0], 1300); return [{ result: frame5.scrollY }]; }
      if (func.name === 'pageDone') { frame5.done = args[0]; frame5.scrollY = args[0]; return [{ result: null }]; }
      throw new Error(`틀 안에서 모르는 함수 ${func.name}`);
    }
    const p = PLACE[args[0]];
    if (func.name === 'partInfo') {
      return [{ result: { url: 'https://eclass.krs.co.kr/eClassVer4/Home/Index', title: 'e-Class', vw: 1200, vh: 1000, scrollY: win.scrollY, top: p.top, width: p.width, height: p.height,
        edge: { top: 1, left: 1, w: p.width - 2, h: p.height - 2 }, frame: p.frame, box: null, text: p.text } }];
    }
    if (func.name === 'partStep') {
      win.hidden = true;
      if (args[1] != null) win.scrollY = Math.min(p.top + args[1], 400);   // 부분의 머리 + rel 로 — 페이지 높이 1400
      return [{ result: { top: p.top - win.scrollY, left: p.left, width: p.width, height: p.height, inner: 0, clip: { top: 0, left: 0, bottom: 1000, right: 1200 } } }];
    }
    if (func.name === 'partDone') { win.hidden = false; win.scrollY = 0; return [{ result: null }]; }
    throw new Error(`모르는 함수 ${func.name}`);
  };
  const canvases = [];
  const kept = { canvas: globalThis.OffscreenCanvas, bitmap: globalThis.createImageBitmap, file: globalThis.File };
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; this.drawn = []; canvases.push(this); }
    getContext() { const c = this; return { fillRect() {}, drawImage(bm, ...a) { c.drawn.push(a); } }; }
    async convertToBlob({ type }) { return new window.Blob([PNG], { type }); }
  };
  globalThis.createImageBitmap = async () => ({ width: 1200, height: 1000, close() {} });
  globalThis.File = window.File;
  const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  const tabBtn = () => doc.querySelector('#gmCapture [data-pick="tab"]');
  const partBtn = () => doc.querySelector('#gmCapture [data-pick="part"]');
  await settle();
  partBtn().click();
  await settle(30);
  t('"부분 골라 캡처"를 누르면 권한을 묻고 보고 있는 탭에 고르기 막을 씌운다 — 단추는 "고르기 취소"가 되고, 탭 단추만 잠긴다(파일 넣기는 그대로)', () => {
    assert.ok(perms.has);
    assert.deepEqual(ran.map((r) => r.slice(0, 2)), [['top', 'pagePick']]);
    assert.equal(partBtn().textContent, '고르기 취소');
    assert.equal(partBtn().getAttribute('aria-pressed'), 'true');
    assert.ok(!partBtn().disabled && tabBtn().disabled);
    assert.ok(!doc.getElementById('gmFile').disabled);
    assert.match(doc.getElementById('gmStatus').textContent, /캡처할 부분\(프레임\)을 누르세요 — 여러 개 고를 수 있고/);
  });
  partBtn().click();
  await settle(30);
  t('고르기 취소를 누르면 페이지의 막을 걷고(pickCancel) 단추가 돌아온다 — 아무것도 찍지 않는다', () => {
    assert.deepEqual(ran.map((r) => r[1]), ['pagePick', 'pickCancel']);
    assert.equal(pending, null);
    assert.equal(partBtn().textContent, '부분');
    assert.ok(!tabBtn().disabled);
    assert.equal(doc.getElementById('gmStatus').textContent, '부분 고르기를 그만뒀습니다.');
    assert.equal(shots.length, 0);
  });
  partBtn().click();
  await settle(30);
  ran.length = 0;
  pending(PARTS);   // 사용자가 본문 틀과 교육비 상자를 눌러 고르고 페이지 위쪽 띠의 캡처를 눌렀다
  await settle(30);
  t('고른 뒤 찍는 동안은 단추와 파일 넣기가 잠긴다', () => {
    assert.ok(tabBtn().disabled && partBtn().disabled);
    assert.equal(partBtn().textContent, '부분');
    assert.ok(doc.getElementById('gmFile').disabled);
    assert.match(doc.getElementById('gmStatus').textContent, /캡처하는 중/);
  });
  // 틀 안 세 화면 + 상자 한 화면 × 0.6초
  await settle(4 * 650 + 1200);
  t('본문 틀은 frameProbe 로 frameId 5 를 맞춰 틀 안을 0·700·1300 으로 내리며 찍고, 상자는 창을 내려 한 번 — 끝에 자리를 다 되돌린다', () => {
    const order = ran.filter((r) => r[1] !== 'partInfo').map((r) => r.join(' '));
    assert.deepEqual(order, [
      'all frameProbe', '5 pageInfo', 'top partStep 1 0 ', '5 pageStep 0 false', '5 pageStep 700 true', '5 pageStep 1300 true', '5 pageDone 0', 'top partDone 1',
      'top partStep 2 0 ', 'top partDone 2',
    ]);
    assert.deepEqual(shots, [[80, 0], [80, 700], [80, 1300], [400, 0]]);
    assert.deepEqual([win.scrollY, win.hidden, frame5.done], [0, false, 0]);
  });
  t('장은 고른 칸만 오린다 — 틀은 테두리 안쪽(창 폭 밖은 뺀다) 1199 폭(짧은 꼬리 304 는 앞 장에 붙어 한 장), 상자는 800 폭', () => {
    assert.deepEqual(canvases.map((c) => [c.width, c.height]), [[1199, 2000], [800, 300]]);
    assert.deepEqual(canvases[0].drawn[0], [1, 1, 1199, 700, 0, 0, 1199, 700], '창 안 (1,1) 에서 1199×700 을 오려 장의 맨 위에');
    assert.deepEqual(canvases[1].drawn[0], [100, 500, 800, 300, 0, 0, 800, 300], '창이 400 까지만 내려가 상자는 창 안 500 에 있다');
  });
  t('읽기에는 고른 것만 — 장 둘과 틀 안의 글자·상자의 글자(머리말에 고른 칸 이름)', () => {
    const read = asked.find((a) => a.props.includes('parts'));
    assert.ok(read, `읽기를 부르지 않았다 — ${doc.getElementById('gmStatus').textContent}`);
    assert.equal(read.images, 2);
    assert.match(read.input, /\[웹페이지 글자 — e-Class — 교육 안내\] https:\/\/eclass\.krs\.co\.kr\/notice\/view\?id=7\\n전력전자 실무 교육 안내/);
    assert.match(read.input, /\[웹페이지 글자 — e-Class — 교육비\] https:\/\/eclass\.krs\.co\.kr\/eClassVer4\/Home\/Index\\n교육비 330,000원/);
    assert.match(doc.getElementById('gmSource').textContent, /화면캡처_eclass\.krs\.co\.kr_\d{4}-\d{2}-\d{2}_1\.png, 화면캡처_eclass\.krs\.co\.kr_\d{4}-\d{2}-\d{2}_2\.png/);
    assert.equal(doc.querySelector('#gongmun [data-key="course"]').value, '전력전자 실무');
  });
  t('고른 칸마다 한 묶음 — 틀(교육 안내문)과 상자(교육 내용) 모두 교육 내용이고, 견적서가 없으니 교육 견적서가 남은 것', () => {
    assert.match(doc.getElementById('gmSource').textContent, /첨부 · 교육 내용 2장/);
    assert.match(doc.getElementById('gmNeed').textContent, /교육 견적서\(첨부\)/);
    assert.equal(doc.getElementById('gmDropLead').textContent, '교육 견적서(수강료 화면) 더 넣기');
  });
  Object.assign(globalThis, { OffscreenCanvas: kept.canvas, createImageBitmap: kept.bitmap, File: kept.file });
}

console.log('근태 탭');
{
  const { wired, window } = await boot({ mode: 'room' });
  const doc = window.document;
  t('근태가 탭 가운데 맨 앞에 있고 공문·R&D 가 그 옆이다', () => {
    const tabs = [...doc.querySelectorAll('nav.tabs .tab')].map((b) => b.textContent);
    assert.deepEqual(tabs, ['근태', '공문', 'R&D', '회의실', '차량', '현황']);
  });
  t('근태 탭 클릭', () => assert.ok(wired.get('tabAttend')?.has('click')));
  t('회의실 탭에서는 근태 화면이 숨어 있다', () => {
    assert.ok(doc.getElementById('attend').classList.contains('hidden'));
    assert.ok(!doc.querySelector('.controls').hasAttribute('hidden'));
  });
  t('종류 버튼·폼·말로 채우기·올리기·목록에 리스너', () => {
    assert.ok(wired.get('atKinds')?.has('click'));
    assert.ok(wired.get('atFields')?.has('input') && wired.get('atFields')?.has('change'));
    assert.ok(wired.get('atFields')?.has('click'), '칩(갈래·구분·며칠간)');
    assert.ok(wired.get('atRangeBtn')?.has('click') && wired.get('atRangeGo')?.has('click'), '조회 기간');
    assert.ok(wired.get('atBack4')?.has('click') && wired.get('atBack8')?.has('click'), '제목 줄의 4W · 8W');
    assert.ok(wired.get('atChatGo')?.has('click'));
    assert.ok(wired.get('atChatInput')?.has('keydown'));
    assert.ok(wired.get('atSubmit')?.has('click'));
    assert.ok(wired.get('atSave')?.has('click'));
    assert.ok(wired.get('atReset')?.has('click'));
    assert.ok(wired.get('atList')?.has('click'));
  });
}
{
  // 포털 홈이 살아 있다고 답하는 네트워크. 근태 탭은 회의실 목록을 두드리지 않고 HR 작업 탭을 연다.
  const fetchImpl = async (url) => (String(url).includes('/eClassVer4/Home/Index')
    ? { ok: true, status: 200, type: 'basic', arrayBuffer: async () => new TextEncoder().encode('<html>home</html>').buffer }
    : Promise.reject(new Error('offline')));
  const { window, calls, store } = await boot({ mode: 'attend', attendKind: 'health' }, { fetchImpl });
  const doc = window.document;
  await new Promise((r) => setTimeout(r, 80));
  t('저장된 모드가 근태면 근태 탭으로 열린다', () => {
    assert.ok(doc.getElementById('tabAttend').classList.contains('active'));
    assert.ok(!doc.getElementById('tabRoom').classList.contains('active'));
    assert.match(doc.getElementById('appTitle').textContent, /근태 신청/);
  });
  t('날짜 격자·예약 현황·말로 찾기는 숨는다', () => {
    assert.ok(!doc.getElementById('attend').classList.contains('hidden'));
    assert.ok(doc.querySelector('.controls').hasAttribute('hidden'));
    assert.ok(doc.querySelector('.schedule').hasAttribute('hidden'));
    assert.ok(doc.querySelector('.ask').hasAttribute('hidden'));
  });
  t('여섯 종류가 두 글자 이름으로 한 줄에 다 있고(더 보기 없음), 마지막에 쓰던 종류가 골라져 있다 — 소통은 외근 안에 있다', () => {
    const rows = [...doc.querySelectorAll('#atKinds .at-kind-row')].map((r) => [...r.querySelectorAll('.at-kind')].map((b) => b.textContent));
    assert.deepEqual(rows, [['출장', '외근', '유연', '외출', '휴가', '건강', '내역']]);
    assert.equal(doc.getElementById('atMore'), null, '접을 종류가 없으면 더 보기 버튼도 없어야 한다');
    assert.equal(doc.querySelector('#atKinds .at-kind.active').textContent, '건강');
    assert.equal(doc.querySelector('#atKinds .at-kind.active').getAttribute('aria-label'), '건강검진', '풀 이름은 읽어 주는 이름에 남는다');
    assert.match(doc.getElementById('atFormTitle').textContent, /건강검진 신청/);
  });
  t('말로 채우기는 회의실·차량의 말로 찾기와 같은 모양이다 — 반짝이 아이콘 · 입력 · 파란 버튼', () => {
    const bar = (sel) => [...doc.querySelector(sel).children].map((c) => c.tagName + (c.className ? '.' + c.className : ''));
    assert.deepEqual(bar('#attend .at-chat .ask-bar'), bar('section.ask .ask-bar'));
    assert.ok(doc.querySelector('#atChatGo svg'));
  });
  t('결재요청과 임시저장이 한 줄 두 칸이다', () => {
    const row = doc.querySelector('#atForm .at-actions');
    assert.deepEqual([...row.querySelectorAll('button:not(.hidden)')].map((b) => b.textContent), ['결재요청', '임시저장']);
  });
  const spanChips = () => [...doc.querySelectorAll('.at-field[data-key="span"] .at-chip')];
  const spanOn = () => spanChips().filter((b) => b.classList.contains('active')).map((b) => b.textContent);
  {
    // 건강검진의 첨부 칸에 파일을 끌어다 놓는다. jsdom 에는 DataTransfer 가 없어 모양만 흉내 낸다.
    const field = doc.querySelector('.at-field[data-key="file"]');
    const drag = (type, files) => Object.assign(new window.Event(type, { bubbles: true, cancelable: true }), { dataTransfer: { types: ['Files'], files } });
    const pdf = () => new window.File(['%PDF'], '검진확인서.pdf', { type: 'application/pdf' });
    const before = [field.tagName, field.getAttribute('for'), field.classList.contains('need'), field.querySelector('.at-drop-how').textContent];
    const over = drag('dragover', []);
    field.querySelector('.at-drop').dispatchEvent(over);
    const hover = [over.defaultPrevented, over.dataTransfer.dropEffect, field.classList.contains('over')];
    field.querySelector('.at-drop').dispatchEvent(drag('drop', [pdf()]));
    await new Promise((r) => setTimeout(r, 40));
    t('첨부 칸은 끌어다 놓는 자리다 — 칸 전체가 label 이라 누르면 탐색기가 열리고, 놓은 파일의 이름이 적힌다', () => {
      assert.deepEqual(before.slice(0, 3), ['LABEL', 'at_file', true]);
      assert.match(before[3], /끌어다 놓거나 눌러서/);
      assert.deepEqual(hover, [true, 'copy', true], '파일을 칸 위로 끌고 오면 놓을 수 있다고 표시한다');
      assert.equal(field.classList.contains('over'), false);
      assert.equal(field.querySelector('.at-file').textContent, '검진확인서.pdf');
      assert.ok(field.querySelector('.at-drop').classList.contains('picked'));
      assert.equal(field.classList.contains('need'), false, '붙였으면 빈 칸 표시가 풀린다');
    });
    t('칸을 빗나가 놓은 파일은 패널이 열지 않는다 (열리면 쓰던 폼이 날아간다)', () => {
      const miss = drag('drop', [pdf()]);
      doc.getElementById('atFormTitle').dispatchEvent(miss);
      assert.equal(miss.defaultPrevented, true);
      assert.equal(field.querySelector('.at-file').textContent, '검진확인서.pdf', '붙여 둔 파일은 그대로다');
    });
  }
  t('HR 은 뒷전 탭으로 연다 (SSO 주소, 앞으로 가져오지 않는다)', () => {
    const hr = calls.tabs.find((x) => /External\/SSOMessage/.test(x.url || ''));
    assert.ok(hr, '연 탭: ' + JSON.stringify(calls.tabs));
    assert.equal(hr.active, false);
  });

  // 외근으로 바꾸면 시작은 오전 9시가 깔리고, 몇 시간·목적이 비어 다른 색으로 칠해진다
  doc.querySelector('#atKinds .at-kind[data-kind="out"]').click();
  const timesOf = (id) => [...doc.getElementById(id).options].map((o) => o.value).filter(Boolean);
  t('외근으로 바꾸면 빈 필수칸이 칠해지고 올리기가 잠긴다 — 시작은 09:00 이 깔려 있다', () => {
    const need = [...doc.querySelectorAll('#atFields .at-field.need')].map((n) => n.dataset.key);
    assert.equal(doc.getElementById('at_start').value, '09:00');
    assert.deepEqual(need, ['span', 'purpose']);
    assert.equal(doc.getElementById('atSubmit').disabled, true);
    assert.equal(doc.getElementById('atNeed').textContent, '', '빈 칸 이름을 한 번 더 늘어놓지 않는다 — 칸에 윤곽선을 두르는 것으로 충분하다');
    assert.deepEqual([...doc.querySelectorAll('#atFields .at-field.need .at-msg')].map((n) => n.textContent), ['', ''], '빈 칸 아래에 "입력 필요"를 적지 않는다');
    assert.equal(doc.querySelector('#atForm .at-confirm-note'), null, '두 번 눌러 확인한다는 안내 줄은 없다');
    assert.equal(doc.getElementById('at_place'), null, '장소 칸은 없다 (HR 신청서에 그 줄이 없다)');
    assert.equal(store.attendKind, 'out');
  });
  t('종류를 옮겨도 여섯 칸은 그대로 보이고, 고른 것만 바뀐다', () => {
    assert.equal(doc.querySelectorAll('#atKinds .at-kind[data-kind]').length, 6);
    assert.equal(doc.querySelector('#atKinds .at-kind.active').textContent, '외근');
    assert.equal(doc.getElementById('atKindMore'), null);
  });
  t('외근 안에서 교육을 고를 수 있다 — 고르면 제목과 시각 단위(정시)가 바뀐다', () => {
    const chips = () => [...doc.querySelectorAll('.at-field[data-key="sub"] .at-chip')];
    assert.deepEqual(chips().map((b) => [b.textContent, b.classList.contains('active')]), [['외근', true], ['교육', false], ['소통', false]]);
    assert.equal(doc.getElementById('at_start').tagName, 'SELECT', '시각은 목록에서 고른다');
    assert.deepEqual([timesOf('at_start').length, timesOf('at_start').slice(18, 21)], [48, ['09:00', '09:30', '10:00']], '시작 시각은 30분 간격이다');
    chips()[1].click();
    assert.match(doc.getElementById('atFormTitle').textContent, /교육 신청/);
    assert.deepEqual([timesOf('at_start').length, timesOf('at_start').includes('09:30')], [24, false], '교육은 정시만');
    assert.deepEqual(spanChips().map((b) => b.textContent), ['1H', '2H', '3H', '4H', '5H', '6H', '7H', '8H'], '교육은 정시 단위라 30분 칩이 없다');
    assert.equal(doc.querySelector('#atKinds .at-kind.active').textContent, '외근', '종류 줄은 그대로 외근이다');
    chips()[0].click();
    assert.match(doc.getElementById('atFormTitle').textContent, /외근 신청/);
  });
  t('외근 안의 소통(부서소통회)은 13시부터 1시간·목적이 채워진 채로 뜨고 바로 올릴 수 있다 — 외근으로 돌아가면 걷힌다', () => {
    const chips = () => [...doc.querySelectorAll('.at-field[data-key="sub"] .at-chip')];
    chips()[2].click();
    assert.match(doc.getElementById('atFormTitle').textContent, /부서소통회 신청/);
    assert.equal(doc.querySelector('#atKinds .at-kind.active').textContent, '외근', '종류 줄은 그대로 외근이다');
    assert.equal(doc.getElementById('at_start').value, '13:00');
    assert.equal(doc.getElementById('at_end'), null, '종료 칸은 없다 — 몇 시간으로 받는다');
    assert.deepEqual(spanOn(), ['1H']);
    assert.equal(doc.getElementById('at_span_msg').textContent, '13:00 ~ 14:00', '그래서 몇 시까지인지 칩 아래에 적는다');
    assert.equal(doc.getElementById('at_purpose').value, '부서소통회');
    assert.equal(doc.querySelectorAll('#atFields .at-field.need').length, 0);
    assert.equal(doc.getElementById('atSubmit').disabled, false);
    chips()[0].click();
    assert.deepEqual([doc.getElementById('at_start').value, spanOn(), doc.getElementById('at_purpose').value], ['09:00', [], '']);
    assert.equal(doc.getElementById('atSubmit').disabled, true);
  });
  t('외근은 날짜와 시작이 한 줄에 나란히 서고, 그 아래가 1~8시간 칩과 색이 다른 +30분 칩이다', () => {
    assert.deepEqual([...doc.querySelectorAll('#atFields .at-field')].map((n) => n.dataset.key), ['sub', 'dateFrom', 'start', 'span', 'purpose', 'car']);
    assert.ok(doc.querySelector('.at-field[data-key="dateFrom"]').classList.contains('beside'));
    assert.deepEqual(spanChips().map((b) => b.textContent), ['1H', '2H', '3H', '4H', '5H', '6H', '7H', '8H', '+30분']);
    assert.ok(spanChips().at(-1).classList.contains('at-plus'));
    assert.deepEqual(spanOn(), []);
  });
  const type = (id, value) => {
    const input = doc.getElementById(id);
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  type('at_start', '14:00');
  spanChips()[1].click();
  type('at_purpose', '과제 협의');
  t('시작을 넣고 2시간 칩을 누르면 칠이 풀리고 올리기가 열린다 — 종료는 시작 + 2시간이다', () => {
    assert.equal(doc.querySelectorAll('#atFields .at-field.need').length, 0);
    assert.equal(doc.getElementById('atSubmit').disabled, false);
    assert.deepEqual(spanOn(), ['2H']);
    assert.equal(doc.getElementById('at_span_msg').textContent, '14:00 ~ 16:00');
    assert.match(doc.getElementById('atNeed').textContent, /외근 .* 14:00~16:00 · 과제 협의/);
  });
  spanChips().at(-1).click();
  t('+30분 칩은 시간 칩과 따로 켜진다 — 2시간 30분', () => {
    assert.deepEqual(spanOn(), ['2H', '+30분']);
    assert.match(doc.getElementById('atNeed').textContent, /외근 .* 14:00~16:30 · 과제 협의/);
  });
  spanChips()[3].click();
  t('시간 칩을 바꿔도 켜 둔 30분은 남는다 — 4시간 30분', () => {
    assert.deepEqual(spanOn(), ['4H', '+30분']);
    assert.match(doc.getElementById('atNeed').textContent, /14:00~18:30/);
  });
  type('at_start', '09:30');
  t('시작을 옮기면 고른 시간만큼 종료가 따라간다', () => {
    assert.equal(doc.getElementById('at_span_msg').textContent, '09:30 ~ 14:00');
    assert.match(doc.getElementById('atNeed').textContent, /09:30~14:00/);
  });
  type('at_start', '20:00');
  t('그 날 안에 끝나지 않으면 몇 시간 칸을 붉게 표시하고 잠근다', () => {
    assert.ok(doc.querySelector('.at-field[data-key="span"]').classList.contains('bad'));
    assert.match(doc.getElementById('at_span_msg').textContent, /그 날 안에 끝나야/);
    assert.equal(doc.getElementById('atSubmit').disabled, true);
  });
  type('at_start', '14:00');
  spanChips().at(-1).click();
  spanChips()[1].click();
  t('+30분을 끄고 2시간으로 돌아오면 다시 올릴 수 있다', () => {
    assert.deepEqual(spanOn(), ['2H']);
    assert.equal(doc.getElementById('atSubmit').disabled, false);
    assert.match(doc.getElementById('atNeed').textContent, /외근 .* 14:00~16:00 · 과제 협의/);
  });
  const tabsBefore = calls.tabs.length;
  doc.getElementById('atSubmit').click();
  await new Promise((r) => setTimeout(r, 120));
  t('결재요청은 한 번 누르면 바로 나간다 — 한 번 더 누르라고 하지 않는다 (여기서는 HR 탭이 안 열려 실패로 끝난다)', () => {
    assert.equal(doc.getElementById('atSubmit').textContent, '결재요청');
    assert.equal(doc.getElementById('atSubmit').classList.contains('armed'), false);
    assert.equal(calls.tabs.length, tabsBefore + 1, 'HR 작업 탭을 열려고 했다');
    assert.match(doc.getElementById('atStatus').textContent, /결재요청 실패: HR 작업 탭을 열지 못했습니다/);
    assert.equal(doc.getElementById('atSubmit').disabled, false, '실패하면 폼이 그대로 남아 다시 누를 수 있다');
  });

  // 말로 채우기: Claude 가 없으면 규칙으로 종류·날짜·시각만 읽는다
  doc.getElementById('atChatInput').value = '10월 20일 출장';
  doc.getElementById('atChatGo').click();
  await new Promise((r) => setTimeout(r, 60));
  const dayChips = () => [...doc.querySelectorAll('.at-field[data-key="days"] .at-chip')];
  const activeDays = () => dayChips().filter((b) => b.classList.contains('active')).map((b) => b.textContent);
  t('말로 채우면 종류가 옮겨 가고, 적어 둔 목적이 따라온다 — 출장지·장소 칸이 한 줄로 서고, 출장지가 비어 아직 올릴 수 없다 (여비계산서 사전정산은 꺼져 있다)', () => {
    assert.equal(doc.querySelector('#atKinds .at-kind.active').textContent, '출장');
    assert.equal(doc.getElementById('at_dateFrom').value, '2026-10-20');
    assert.equal(doc.getElementById('at_dateTo').value, '2026-10-20', '도착일 칸은 며칠간에서 나오는 끝나는 날이다(당일이면 출발일과 같다) — 달력으로 고르면 며칠간이 따라 바뀐다');
    assert.deepEqual([doc.getElementById('at_start').value, doc.getElementById('at_end').value], ['07:00', '20:00']);
    assert.deepEqual([...doc.querySelectorAll('#atFields .at-field')].map((n) => n.dataset.key), ['dateFrom', 'start', 'dateTo', 'end', 'days', 'place', 'venue', 'purpose', 'settle', 'car']);
    assert.deepEqual([...doc.querySelector('#atFields .at-group.at-spot').children].map((n) => [n.dataset.key, n.querySelector('.at-label').textContent]),
      [['place', '출장지필수'], ['venue', '장소']]);
    assert.deepEqual([doc.getElementById('at_settle').type, doc.getElementById('at_settle').checked], ['checkbox', false]);
    assert.deepEqual([...doc.querySelector('#atFields .at-group.at-opts').children].map((n) => n.dataset.key), ['settle', 'car'], '차량 조회는 사전정산 옆(같은 줄)에 선다');
    assert.deepEqual([doc.getElementById('at_car').type, doc.getElementById('at_car').checked, doc.getElementById('atCars')], ['checkbox', false, null]);
    assert.deepEqual([...doc.querySelectorAll('#atFields .at-field.need')].map((n) => n.dataset.key), ['place']);
    assert.equal(doc.getElementById('atSubmit').disabled, true);
    assert.ok(doc.querySelector('.at-field[data-key="dateFrom"]').classList.contains('filled'));
    assert.match(doc.querySelector('#atChatLog .at-say.ai').textContent, /규칙 해석/);
    assert.equal(doc.getElementById('at_purpose').value, '과제 협의', '적어 둔 목적은 가져간다');
  });
  t('날짜·시각 칸은 이름이 칸 안에 있고, 그 칸들과 며칠간에는 "필수"를 달지 않는다 (목적에는 단다)', () => {
    const field = (key) => doc.querySelector(`.at-field[data-key="${key}"]`);
    const inside = (key) => [field(key).classList.contains('inl'), field(key).style.getPropertyValue('--lab'), field(key).querySelector('.at-label').textContent];
    assert.deepEqual(inside('dateFrom'), [true, '3', '출발일']);
    assert.deepEqual(inside('start'), [true, '2', '출발']);
    assert.deepEqual(inside('end'), [true, '2', '도착']);
    assert.deepEqual([field('days').classList.contains('inl'), field('days').querySelector('.at-label').textContent], [false, '며칠간']);
    assert.deepEqual([field('purpose').classList.contains('inl'), field('purpose').querySelector('.at-label').textContent], [false, '목적필수']);
  });
  // 여비계산서 사전정산: 체크박스를 켜면 근무지·교통편이 한 줄로 나온다
  const tick = (on) => {
    const box = doc.getElementById('at_settle');
    box.checked = on;
    box.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const icons = () => [...doc.querySelectorAll('.at-field[data-key="transport"] .at-chip')];
  tick(true);
  t('여비계산서 사전정산을 켜면 근무지·교통편이 한 줄(같은 묶음)에 선다 — 교통편은 아이콘 셋이고 기차가 골라져 있다', () => {
    const group = doc.querySelector('#atFields .at-group.at-where');
    assert.deepEqual([...group.children].map((n) => n.dataset.key), ['workplace', 'transport']);
    assert.deepEqual([...doc.querySelector('#atFields .at-group.at-spot').children].map((n) => n.dataset.key), ['place', 'venue'], '출장지·장소 줄은 그대로다');
    assert.equal(doc.querySelector('#atFields .at-field.at-file'), null, '출장 증빙은 신청할 때 묻지 않는다 — 신청 내역의 출장 카드에서 넣는다');
    for (const key of ['place', 'venue', 'workplace']) {
      assert.equal(doc.querySelector(`.at-field[data-key="${key}"]`).classList.contains('wide'), false, '한 줄을 다 쓰지 않는다');
      assert.equal(doc.getElementById(`at_${key}`).type, 'text');
    }
    assert.deepEqual(icons().map((b) => [b.getAttribute('aria-label'), !!b.querySelector('svg'), b.classList.contains('active')]),
      [['기차(KTX)', true, true], ['비행기', true, false], ['버스', true, false]]);
    assert.deepEqual([...doc.querySelectorAll('#atFields .at-field.need')].map((n) => n.dataset.key), ['place', 'workplace']);
    assert.equal(doc.getElementById('atSubmit').disabled, true);
  });
  type('at_place', '대전');
  type('at_workplace', '부산');
  t('출장지·근무지를 적으면 올릴 내용에 여비계산서 초안이 같이 적히고, 근무지는 저장된다', () => {
    const need = doc.getElementById('atNeed').textContent;
    assert.match(need, /출장 10\/20 07:00~20:00 · 과제 협의 \(출장지: 대전, 근무지: 부산\)/);
    assert.match(need, /→ 결재요청 뒤 여비계산서\(사전정산\): 당일출장\(주재국\) · 대전 · KTX 부산↔대전 일반석 33,100원 × 2/);
    assert.equal(store.attendWorkplace, '부산');
    assert.equal(doc.getElementById('atSubmit').disabled, false);
  });
  type('at_venue', '한국기계연구원');
  t('장소를 적으면 신청서 내용에 장소가 붙고, 여비계산서의 출장지는 "출장지(장소)"가 된다 — KTX 역은 출장지에서 찾는다', () => {
    const need = doc.getElementById('atNeed').textContent;
    assert.match(need, /출장 10\/20 07:00~20:00 · 과제 협의 \(출장지: 대전, 장소: 한국기계연구원, 근무지: 부산\)/);
    assert.match(need, /→ 결재요청 뒤 여비계산서\(사전정산\): 당일출장\(주재국\) · 대전\(한국기계연구원\) · KTX 부산↔대전 일반석 33,100원 × 2/);
  });
  type('at_venue', '');
  const paste = (files) => Object.assign(new window.Event('paste', { bubbles: true, cancelable: true }), { clipboardData: { files } });
  const shot = paste([new window.File(['png'], 'image.png', { type: 'image/png' })]);
  doc.dispatchEvent(shot);
  await new Promise((r) => setTimeout(r, 40));
  t('출장 폼에는 증빙 칸이 없어, 파일을 붙여 넣어도(Ctrl+V) 폼이 받지 않는다 — 올릴 내용에도 증빙 말이 없다', () => {
    assert.equal(shot.defaultPrevented, false);
    assert.doesNotMatch(doc.getElementById('atNeed').textContent, /증빙/);
    assert.equal(doc.getElementById('atSubmit').disabled, false);
  });
  const state = () => icons().map((b) => [b.classList.contains('active'), b.classList.contains('first'), b.getAttribute('aria-pressed'), b.getAttribute('aria-label')]);
  const need = () => doc.getElementById('atNeed').textContent;
  icons()[0].click();
  t('기차를 한 번 더 누르면 특실이다 — 아이콘에 first 가 붙고(주황색 +) 이름이 "특실"이 되며, 운임표의 특실 정가가 들어간다', () => {
    assert.deepEqual(state(), [[true, true, 'true', '기차(KTX) 특실'], [false, false, 'false', '비행기'], [false, false, 'false', '버스']]);
    assert.match(need(), /여비계산서\(사전정산\): 당일출장\(주재국\) · 대전 · KTX 부산↔대전 특실 48,000원 × 2/);
    assert.equal(doc.activeElement, icons()[0], '누른 아이콘에 초점이 남는다');
  });
  type('at_place', '서울');
  t('출장지를 바꾸면 그 구간의 특실 값으로 바뀐다(부산↔서울 78,900원)', () =>
    assert.match(need(), /KTX 부산↔서울 특실 78,900원 × 2/));
  type('at_place', '대전');
  icons()[0].click();
  t('기차 하나뿐일 때 또 누르면 꺼지지 않고 일반석으로 돌아간다', () => {
    assert.deepEqual(state()[0], [true, false, 'true', '기차(KTX)']);
    assert.match(need(), /KTX 부산↔대전 일반석 33,100원 × 2/);
  });
  icons()[1].click();
  t('기차와 비행기를 함께 고를 수 있다 — 어느 편이 무엇인지는 다녀와서 신청 내역에서 고른다고 적힌다', () => {
    assert.deepEqual(icons().map((b) => b.classList.contains('active')), [true, true, false]);
    assert.match(need(), /교통편 내역 없음\(가는 편·오는 편은 다녀와서 신청 내역에서 고름\)/);
    assert.equal(doc.getElementById('atSubmit').disabled, false);
  });
  icons()[0].click();
  icons()[0].click();
  t('다른 교통편이 켜져 있으면 기차는 일반석 → 특실 → 꺼짐으로 돈다. 비행기만 남으면 근무지는 필수가 아니다', () => {
    assert.deepEqual(icons().map((b) => b.classList.contains('active')), [false, true, false]);
    assert.match(need(), /대전 · 교통편 내역 없음$/);
    type('at_workplace', '');
    assert.equal(doc.querySelector('.at-field[data-key="workplace"]').classList.contains('need'), false);
    icons()[1].click();
    assert.deepEqual(icons().map((b) => b.classList.contains('active')), [false, true, false], '마지막 하나는 꺼지지 않는다');
    type('at_workplace', '부산');
  });
  icons()[2].click();
  icons()[1].click();
  t('버스만 고르면 교통편 내역을 넣지 않는다고 적힌다 — 다시 기차로 돌아올 수 있다', () => {
    assert.deepEqual(icons().map((b) => b.classList.contains('active')), [false, false, true]);
    assert.match(need(), /여비계산서\(사전정산\): 당일출장\(주재국\) · 대전 · 교통편 내역 없음$/);
    icons()[0].click();
    icons()[2].click();
    assert.match(need(), /KTX 부산↔대전/);
  });
  doc.getElementById('atReset').click();
  t('비우기를 누르면 사전정산이 꺼지고 그 칸들이 사라진다 — 다시 켜면 근무지는 남아 있고 출장지는 비어 있다', () => {
    assert.equal(doc.getElementById('at_settle').checked, false);
    assert.equal(doc.getElementById('at_workplace'), null);
    tick(true);
    assert.deepEqual([doc.getElementById('at_place').value, doc.getElementById('at_workplace').value, doc.getElementById('at_purpose').value], ['', '부산', '']);
  });
  doc.querySelector('#atKinds .at-kind[data-kind="out"]').click();
  doc.querySelector('#atKinds .at-kind[data-kind="trip"]').click();
  tick(true);
  t('다른 종류에 다녀와도 근무지는 남는다', () =>
    assert.equal(doc.getElementById('at_workplace').value, '부산'));
  tick(false);
  type('at_dateFrom', '2026-10-20');
  type('at_place', '대전');
  type('at_purpose', '과제 협의');
  t('출장의 며칠간은 1D~7D 칩 한 줄이고, 끝나는 날은 도착일 칸이다 — 1D 가 골라져 있고 도착일에는 끝나는 날이 적혀 있다', () => {
    assert.deepEqual(dayChips().map((b) => b.textContent), ['1D', '2D', '3D', '4D', '5D', '6D', '7D']);
    assert.deepEqual(activeDays(), ['1D']);
    const end = doc.getElementById('at_dateTo');
    assert.deepEqual([end.type, end.value, end.min], ['date', '2026-10-20', '2026-10-20']);
    assert.equal(doc.querySelector('.at-field[data-key="days"] input[type="date"]'), null, '며칠간 줄에는 달력이 없다');
  });
  t('출발일 오른쪽에 출발 시각, 도착일 오른쪽에 도착 시각이 서고, 그 아래 며칠간은 이름이 칩 왼쪽에 붙은 한 줄이다(2026-10-06 사용자 지정)', () => {
    const go = doc.querySelector('#atFields .at-group.at-go');
    const back = doc.querySelector('#atFields .at-group.at-back');
    assert.deepEqual([...go.children].map((n) => n.dataset.key), ['dateFrom', 'start']);
    assert.deepEqual([...back.children].map((n) => n.dataset.key), ['dateTo', 'end']);
    const days = doc.querySelector('#atFields .at-field[data-key="days"]');
    assert.deepEqual([days.classList.contains('inline'), days.classList.contains('wide'), days.parentElement.id], [true, true, 'atFields']);
    assert.equal(back.nextElementSibling, days, '며칠간 줄은 도착일 줄 바로 아래다');
  });
  t('출장의 출발·도착은 정시 목록에서 고른다 (HR 이 출장의 분 칸을 잠가 둔다)', () => {
    assert.equal(doc.getElementById('at_end').tagName, 'SELECT');
    assert.deepEqual([timesOf('at_start').length, timesOf('at_end').includes('20:30')], [24, false]);
  });
  dayChips()[2].click();
  t('3D 칩을 누르면 올릴 내용의 기간이 사흘로 바뀌고 도착일이 따라간다', () => {
    assert.match(doc.getElementById('atNeed').textContent, /출장 10\/20~10\/22 07:00~20:00/);
    assert.equal(doc.getElementById('at_dateTo').value, '2026-10-22');
    assert.deepEqual(activeDays(), ['3D']);
  });
  const pickEnd = (value) => {
    const input = doc.getElementById('at_dateTo');
    input.value = value;
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  pickEnd('2026-10-23');
  t('도착일 달력에서 끝나는 날을 고르면 나흘이 되고 4D 칩이 켜진다', () => {
    assert.match(doc.getElementById('atNeed').textContent, /출장 10\/20~10\/23 07:00~20:00/);
    assert.deepEqual(activeDays(), ['4D']);
  });
  pickEnd('2026-10-26');
  t('이레까지는 칩이 있다 — 7D 가 켜진다', () => {
    assert.match(doc.getElementById('atNeed').textContent, /출장 10\/20~10\/26 07:00~20:00/);
    assert.deepEqual(activeDays(), ['7D']);
  });
  pickEnd('2026-10-27');
  t('칩에 없는 날 수(여드레)를 도착일에서 고르면 칩은 모두 꺼진다', () => {
    assert.match(doc.getElementById('atNeed').textContent, /출장 10\/20~10\/27 07:00~20:00/);
    assert.deepEqual(activeDays(), []);
  });
  pickEnd('2026-10-19');
  t('시작일보다 이른 날은 받지 않고 되돌린다', () => {
    assert.equal(doc.getElementById('at_dateTo').value, '2026-10-27');
    assert.match(doc.getElementById('atStatus').textContent, /끝나는 날은 시작일부터/);
    assert.match(doc.getElementById('atNeed').textContent, /출장 10\/20~10\/27/);
  });

  // 휴가: 연차·체력단련을 안에서 고르고, 구분은 하루짜리 연차에만 있다
  doc.querySelector('#atKinds .at-kind[data-kind="leave"]').click();
  const chipsOf = (key) => [...doc.querySelectorAll(`.at-field[data-key="${key}"] .at-chip`)];
  const keys = () => [...doc.querySelectorAll('#atFields .at-field')].map((n) => n.dataset.key);
  t('휴가: 연차가 기본이고 시작일·종료일이 한 줄, 그 아래 며칠간 칩 오른쪽에 오전·오후, 그 아래 기념일 지원 체크박스다(2026-10-08 사용자 지정). 그대로 올릴 수 있다', () => {
    assert.deepEqual(keys(), ['sub', 'dateFrom', 'dateTo', 'days', 'half', 'wfa']);
    assert.deepEqual(chipsOf('sub').map((b) => [b.textContent, b.classList.contains('active')]), [['연차', true], ['체력단련', false]], '기념일은 갈래 칩이 아니다');
    assert.equal(doc.getElementById('at_wfa').type, 'checkbox');
    assert.equal(doc.getElementById('at_wfa').checked, false);
    assert.match(doc.querySelector('.at-field[data-key="wfa"] .at-label').textContent, /기념일 지원/);
    assert.match(doc.getElementById('atLeaves').textContent, /연차현황을 읽는 중/, '종류 칩 아래에 연차현황 한 줄');
    assert.deepEqual([...doc.querySelector('.at-group.at-lv').children].map((n) => n.dataset.key), ['dateFrom', 'dateTo'], '시작일·종료일 한 줄');
    assert.deepEqual([doc.getElementById('at_dateFrom').value, doc.getElementById('at_dateTo').value], ['2026-10-20', '2026-10-20']);
    assert.deepEqual([...doc.querySelector('.at-group.at-lvdays').children].map((n) => n.dataset.key), ['days', 'half'], '며칠간 칩과 오전·오후가 한 줄');
    assert.equal(doc.querySelector('.at-field[data-key="days"] input[type="date"]'), null, '며칠간 줄에는 달력이 없다 — 종료일 칸이 받는다');
    assert.deepEqual(chipsOf('half').map((b) => [b.textContent, b.classList.contains('active'), b.disabled]), [['오전', false, false], ['오후', false, false]], '전일 칩은 없다 — 1D 가 전일');
    assert.match(doc.getElementById('atFormTitle').textContent, /연차 신청/);
    assert.equal(doc.getElementById('atSubmit').disabled, false);
    assert.match(doc.getElementById('atNeed').textContent, /연차 10\/20 전일/);
  });
  t('휴가의 며칠간 칩도 1D~5D 다', () =>
    assert.deepEqual(chipsOf('days').map((b) => b.textContent), ['1D', '2D', '3D', '4D', '5D']));
  chipsOf('half')[1].click();
  t('하루짜리 연차에서 오후를 고르면 요약에 오후가 적히고, 그 날 근무시간을 확인한다고 말한다', () => {
    assert.match(doc.getElementById('atNeed').textContent, /연차 10\/20 오후/);
    assert.match(doc.getElementById('at_half_msg').textContent, /근무시간을 확인하는 중/);
  });
  await new Promise((r) => setTimeout(r, 120));
  t('근무시간을 읽지 못하면(HR 에 닿지 못함) 그렇다고 말하고, 반차는 그대로 올릴 수 있게 둔다', () => {
    assert.match(doc.getElementById('at_half_msg').textContent, /근무시간을 확인하지 못했습니다.*09:00 출근으로 먼저/);
    assert.equal(doc.getElementById('atSubmit').disabled, false);
  });
  chipsOf('half')[1].click();
  t('켜진 오후를 다시 누르면 꺼져 전일이다', () => {
    assert.deepEqual(chipsOf('half').map((b) => b.classList.contains('active')), [false, false]);
    assert.match(doc.getElementById('atNeed').textContent, /연차 10\/20 전일/);
  });
  chipsOf('days')[1].click();
  t('이틀로 늘리면 종료일이 따라오고 오전·오후는 잠긴 채 남으며 전일로 올라간다', () => {
    assert.deepEqual(keys(), ['sub', 'dateFrom', 'dateTo', 'days', 'half', 'wfa']);
    assert.equal(doc.getElementById('at_dateTo').value, '2026-10-21');
    assert.ok(chipsOf('half').every((b) => b.disabled));
    assert.match(doc.getElementById('atNeed').textContent, /연차 10\/20~10\/21 2일간/);
  });
  chipsOf('sub')[1].click();
  t('체력단련을 고르면 제목이 바뀌고 기념일 지원 체크박스는 없다', () => {
    assert.match(doc.getElementById('atFormTitle').textContent, /체력단련 신청/);
    assert.match(doc.getElementById('atNeed').textContent, /체력단련 10\/20~10\/21 2일간/);
    assert.deepEqual(keys(), ['sub', 'dateFrom', 'dateTo', 'days', 'half']);
  });
  t('말로 채운 것이 활동 기록에 남는다', () =>
    assert.ok((store.activityLog || []).some((e) => e.kind === 'attend-ask' && /10월 20일 출장/.test(e.text))));
  t('연차현황 — HR 에 닿지 못하면 그렇다고 적는다(연차·체력단련·저축연차는 HR 홈 카드의 값)', () =>
    assert.match(doc.getElementById('atLeaves').textContent, /연차현황을 읽지 못했습니다/));

  // 기념일 지원(2026-10-08 사용자 지정: "연차 내부에 체크박스로 기념을을 넣어서 기념을 내용을 넣을 수 있도록") — 연차 안의 체크박스를 켜면
  // 기념일 칸이 붙는다. 연차는 HR 에 그대로 올라가고, 결재요청 뒤 eclass 복지기금 신청 화면을 채워 연다.
  chipsOf('sub')[0].click();
  chipsOf('days')[0].click();   // 앞에서 이틀로 늘려 두었다 — 연차 하루로
  const check = (id, on) => { const n = doc.getElementById(id); n.checked = on; n.dispatchEvent(new window.Event('change', { bubbles: true })); };
  check('at_wfa', true);
  await new Promise((r) => setTimeout(r, 80));
  t('기념일 지원을 켜면 연차 칸 아래에 기념일 칸(신청사항·기념일·대상자·가족관계·시설 이용일·금액·사용구분)이 붙고, 결재요청·임시저장은 그대로다', () => {
    assert.equal(doc.getElementById('atFormTitle').textContent, '연차 신청 · 기념일 지원');
    assert.deepEqual(keys(), ['sub', 'dateFrom', 'dateTo', 'days', 'half', 'wfa',
      'wfaReason', 'wfaDate', 'wfaName', 'wfaRelation', 'wfaStayFrom', 'wfaStayTo', 'wfaPaid', 'wfaAsk', 'wfaCash']);
    assert.equal(doc.getElementById('at_wfa').checked, true);
    assert.deepEqual(chipsOf('wfaRelation').map((b) => [b.textContent, b.classList.contains('active')]).slice(0, 2), [['본인', true], ['배우자', false]]);
    assert.ok(!doc.getElementById('atSubmit').classList.contains('hidden') && !doc.getElementById('atSave').classList.contains('hidden'));
    assert.equal(doc.getElementById('atSubmit').disabled, true, '기념일의 내용(신청사항·기념일·대상자)이 비어 있다');
    assert.match(doc.getElementById('atWfa').textContent, /가족 기념일 지원/);
    assert.match(doc.getElementById('atWfa').textContent, /신청 현황을 읽지 못했습니다/, '사이트에 닿지 못하는 환경');
    assert.match(doc.getElementById('atWfa').textContent, /결제증빙/);
    assert.equal(doc.querySelector('#atWfa a[href*="WFA_Application_List"]')?.textContent, '신청 현황');
    assert.equal(doc.getElementById('atWfaOpen').disabled, true, '신청 화면만 열기도 빈 칸이 있으면 잠긴다');
  });
  const fill = (id, value) => { const n = doc.getElementById(id); n.value = value; n.dispatchEvent(new window.Event('input', { bubbles: true })); n.dispatchEvent(new window.Event('change', { bubbles: true })); };
  fill('at_wfaReason', '결혼기념일');
  fill('at_wfaDate', '2026-10-20');
  fill('at_wfaName', '본인');
  t('기념일의 내용만 채우면 올릴 수 있다 — 올릴 내용에 연차와, 결재요청 뒤 채울 기념일 지원이 같이 적힌다(금액은 신청 화면에서)', () => {
    assert.equal(doc.getElementById('atNeed').textContent,
      '올릴 내용 — 연차 10/20 전일 → 결재요청 뒤 기념일 지원 신청 화면(채워서): 결혼기념일 10/20 · 본인(본인) · 신청금액은 신청 화면에서');
    assert.equal(doc.getElementById('atSubmit').disabled, false);
    assert.equal(doc.getElementById('atWfaOpen').disabled, false);
  });
  fill('at_wfaPaid', '299,000');
  fill('at_wfaAsk', '200000');
  t('신청금액이 15만원을 넘으면 그 칸이 붉고 결재요청도 신청 화면만 열기도 잠긴다', () => {
    assert.match(doc.getElementById('at_wfaAsk_msg').textContent, /150,000원까지/);
    assert.equal(doc.getElementById('atSubmit').disabled, true);
    assert.equal(doc.getElementById('atWfaOpen').disabled, true);
  });
  fill('at_wfaAsk', '150000');
  chipsOf('wfaCash')[1].click();
  t('금액·사용구분을 적으면 올릴 내용의 기념일 쪽에 신청금액이 적힌다', () =>
    assert.match(doc.getElementById('atNeed').textContent, /→ 결재요청 뒤 기념일 지원 신청 화면\(채워서\): 결혼기념일 10\/20 · 본인\(본인\) · 신청 150,000원$/));
  const wfaTabsBefore = calls.tabs.length;
  doc.getElementById('atSubmit').click();
  await new Promise((r) => setTimeout(r, 150));
  t('결재요청 — 연차가 HR 에 올라가지 않으면(여기서는 HR 에 닿지 못함) 기념일 지원 신청 화면도 열지 않는다', () => {
    assert.match(doc.getElementById('atStatus').textContent, /결재요청 실패/);
    assert.ok(!calls.tabs.slice(wfaTabsBefore).some((t) => /WFA_Application_Save/.test(t.url || '')));
  });
  doc.getElementById('atWfaOpen').click();
  await new Promise((r) => setTimeout(r, 80));
  t('신청 화면만 열기 — HR 에 올리지 않고 신청 화면 탭을 앞에 열어 채운다(여기서는 탭이 안 열려 그렇다고 말한다)', () => {
    assert.match(doc.getElementById('atStatus').textContent, /기념일 지원 신청 화면을 열지 못했습니다: 신청 화면 탭을 열지 못했습니다/);
    assert.ok(calls.tabs.some((t) => /WFA_Application_Save\.aspx\?s_code=0202090300$/.test(t.url) && t.active));
  });
  check('at_wfa', false);
  t('기념일 지원을 끄면 연차 칸만 남고 제목도 돌아온다', () => {
    assert.deepEqual(keys(), ['sub', 'dateFrom', 'dateTo', 'days', 'half', 'wfa']);
    assert.equal(doc.getElementById('atFormTitle').textContent, '연차 신청');
    assert.equal(doc.getElementById('atWfa'), null);
    assert.equal(doc.getElementById('atNeed').textContent, '올릴 내용 — 연차 10/20 전일');
  });
  t('끈 체크박스 오른쪽에도 올해 쓴 횟수가 남는다 — 신청 현황을 못 읽었으면 ? 로 적고 까닭은 풍선말에', () => {
    const used = doc.querySelector('.at-field[data-key="wfa"] #atWfaUsed');
    assert.equal(used?.textContent, '올해 ?/5번 사용');
    assert.ok(used.classList.contains('err'));
    assert.match(used.title, /신청 현황을 읽지 못했습니다/);
  });
}
{
  // 유연근무의 기간: 당일·주간·전체. 근무시간표는 읽히지 않는 환경이라(HR 탭 없음) 주간의 요일 칸은 빈 채로 뜬다.
  const { window } = await boot({ mode: 'attend', attendKind: 'flex' });
  const doc = window.document;
  await new Promise((r) => setTimeout(r, 80));
  const keys = () => [...doc.querySelectorAll('#atFields .at-field')].map((n) => n.dataset.key);
  const modes = () => [...doc.querySelectorAll('.at-field[data-key="flexMode"] .at-chip')];
  const starts = (id) => [...doc.getElementById(id).options].map((o) => o.value).filter(Boolean);
  const lockedIn = (id) => [...doc.getElementById(id).options].filter((o) => o.disabled).map((o) => o.value);
  const pick = (id, value) => {
    const sel = doc.getElementById(id);
    sel.value = value;
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  t('유연근무는 기간을 칩으로 고른다 — 당일이 기본이고 날짜·출근시간·사유를 묻는다', () => {
    assert.deepEqual(modes().map((b) => [b.textContent, b.classList.contains('active')]), [['당일', true], ['주간', false], ['전체', false]]);
    assert.deepEqual(keys(), ['flexMode', 'dateFrom', 'flexStart', 'purpose']);
    assert.equal(starts('at_flexStart').length, 7);
    assert.equal(doc.getElementById('at_flexMode_msg').textContent, '');
  });
  t('당일의 출근시간은 일곱 가지가 다 보이고, 날짜가 화~목이면 07:00·11:00 만 잠긴다 (날짜를 옮기면 따라간다)', () => {
    pick('at_dateFrom', '2026-10-07');   // 수요일
    assert.deepEqual([starts('at_flexStart').length, lockedIn('at_flexStart')], [7, ['07:00', '11:00']]);
    pick('at_dateFrom', '2026-10-09');   // 금요일
    assert.deepEqual([starts('at_flexStart').length, lockedIn('at_flexStart')], [7, []]);
  });
  modes()[1].click();
  await new Promise((r) => setTimeout(r, 80));   // 근무시간표를 읽으려다 실패하고 끝나기를 기다린다
  t('주간은 월~금 다섯 칸이다 — 요일 이름이 칸 안에 있고, 화~목에는 07:00·11:00 이 잠겨 있고, 날짜·사유는 묻지 않는다', () => {
    assert.deepEqual(keys(), ['flexMode', 'flexMon', 'flexTue', 'flexWed', 'flexThu', 'flexFri']);
    const mon = doc.querySelector('.at-field[data-key="flexMon"]');
    assert.ok(mon.classList.contains('inl'));
    assert.equal(mon.querySelector('.at-label').textContent, '월');
    assert.deepEqual([starts('at_flexMon').length, starts('at_flexTue').length, starts('at_flexFri').length], [7, 7, 7]);
    assert.deepEqual([lockedIn('at_flexMon'), lockedIn('at_flexTue'), lockedIn('at_flexThu'), lockedIn('at_flexFri')], [[], ['07:00', '11:00'], ['07:00', '11:00'], []]);
    assert.match(doc.getElementById('at_flexMode_msg').textContent, /다음 주 월요일부터 반영/);
    assert.equal(doc.getElementById('atSubmit').disabled, true);
    pick('at_flexMon', '07:00');
    for (const id of ['at_flexTue', 'at_flexWed', 'at_flexThu']) pick(id, '09:00');
    assert.equal(doc.getElementById('atSubmit').disabled, true, '금요일이 비어 있다');
    pick('at_flexFri', '11:00');
    assert.equal(doc.getElementById('atSubmit').disabled, false);
    assert.equal(doc.getElementById('atNeed').textContent, '올릴 내용 — 유연근무 주간 월 07:00 · 화 09:00 · 수 09:00 · 목 09:00 · 금 11:00');
  });
  t('전체는 출근시간 하나다 — 다섯 요일에 다 있는 시간만 고를 수 있다', () => {
    modes()[2].click();
    assert.deepEqual(keys(), ['flexMode', 'flexStart']);
    assert.deepEqual([starts('at_flexStart').length, lockedIn('at_flexStart')], [7, ['07:00', '11:00']]);
    assert.match(doc.getElementById('at_flexMode_msg').textContent, /월·금요일에만/);
    assert.equal(doc.getElementById('atSubmit').disabled, true);
    pick('at_flexStart', '09:00');
    assert.equal(doc.getElementById('atSubmit').disabled, false);
    assert.equal(doc.getElementById('atNeed').textContent, '올릴 내용 — 유연근무 주간 월~금 09:00 ~ 18:00');
    modes()[0].click();
    assert.deepEqual(keys(), ['flexMode', 'dateFrom', 'flexStart', 'purpose'], '당일로 돌아오면 날짜와 사유를 다시 묻는다');
  });
}
{
  // 근무지는 지난번에 적은 것이 기본값이다 — 패널을 새로 열어도 저장소에서 되읽어 깔아 둔다(2026-10-03 사용자 지정).
  const { window, store } = await boot({ mode: 'attend', attendKind: 'out', attendWorkplace: '부산' });
  const doc = window.document;
  await new Promise((r) => setTimeout(r, 80));
  doc.querySelector('#atKinds .at-kind[data-kind="trip"]').click();
  const box = doc.getElementById('at_settle');
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  t('패널을 새로 열어 출장의 여비계산서 사전정산을 켜면 근무지에 지난번 값이 깔려 있고 출장지는 비어 있다', () => {
    assert.deepEqual([doc.getElementById('at_place').value, doc.getElementById('at_workplace').value], ['', '부산']);
    assert.equal(doc.querySelector('.at-field[data-key="workplace"]').classList.contains('need'), false, '깔린 값이 있으니 빈 칸으로 칠하지 않는다');
    assert.equal(doc.querySelector('.at-field[data-key="place"]').classList.contains('need'), true);
  });
  const input = doc.getElementById('at_workplace');
  input.value = '부산 본사';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  t('고쳐 적으면 그것이 다음 기본값으로 저장된다', () => assert.equal(store.attendWorkplace, '부산 본사'));
  doc.getElementById('atReset').click();
  const again = doc.getElementById('at_settle');   // 비우기가 칸을 다시 그렸다
  again.checked = true;
  again.dispatchEvent(new window.Event('change', { bubbles: true }));
  t('비우고 다시 켜도 고쳐 적은 근무지가 깔린다', () => assert.equal(doc.getElementById('at_workplace').value, '부산 본사'));
}
{
  // 출장지마다 지난번에 쓴 교통편을 기억해 두었다가 같은 출장지를 다시 적으면 먼저 쓴다(2026-10-04 사용자 지정, src/routes.js).
  const { window } = await boot({ mode: 'attend', attendKind: 'trip', attendWorkplace: '부산', tripRoutes: {
    '경기도 용인시': { transport: ['train'], trainGrade: 'first', path: ['부산', '수원'], date: '2026-09-09' },
    제주: { transport: ['plane'], trainGrade: 'standard', path: null, date: '2026-08-01' },
  } });
  const doc = window.document;
  await new Promise((r) => setTimeout(r, 80));
  const fire = (id, value, ...events) => {
    const input = doc.getElementById(id);
    input.value = value;
    for (const name of events) input.dispatchEvent(new window.Event(name, { bubbles: true }));
  };
  const place = (value) => fire('at_place', value, 'input', 'change');
  fire('at_purpose', '과제 협의', 'input');
  const box = doc.getElementById('at_settle');
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  const icons = () => [...doc.querySelectorAll('.at-field[data-key="transport"] .at-chip')].map((b) => [b.classList.contains('active'), b.classList.contains('first')]);
  const need = () => doc.getElementById('atNeed').textContent;
  place('경기도 용인시');
  t('지난번에 간 출장지를 적으면 교통편 아이콘이 그때대로 골라지고(기차 특실), 사전정산의 KTX 는 그때의 길이다 — 요금은 지금 운임표의 값', () => {
    assert.deepEqual(icons(), [[true, true], [false, false], [false, false]]);
    assert.match(need(), /KTX 부산↔수원 특실 64,200원 × 2 · 지난번에 쓴 길$/);
    assert.equal(doc.getElementById('at_place').value, '경기도 용인시', '적은 글은 그대로다');
  });
  place('제주');
  t('다른 출장지로 바꾸면 그 출장지의 것으로 — 비행기로 갔던 곳은 비행기가 골라진다', () => {
    assert.deepEqual(icons(), [[false, false], [true, false], [false, false]]);
    assert.match(need(), /제주 · 교통편 내역 없음$/);
  });
  place('경기도 화성시');
  t('기억이 없는 출장지면 기본(기차 일반석)으로 돌아가고 길은 찾아서 짓는다 — 화성은 동탄', () => {
    assert.deepEqual(icons(), [[true, false], [false, false], [false, false]]);
    assert.match(need(), /KTX 부산↔동탄 일반석 48,300원 × 2$/);
  });
  doc.querySelectorAll('.at-field[data-key="transport"] .at-chip')[2].click();
  place('제주');
  t('이 신청서에서 교통편을 손댔으면 출장지를 바꿔도 기억으로 덮어쓰지 않는다', () =>
    assert.deepEqual(icons(), [[true, false], [false, false], [true, false]]));
  doc.getElementById('atReset').click();
  const again = doc.getElementById('at_settle');
  again.checked = true;
  again.dispatchEvent(new window.Event('change', { bubbles: true }));
  fire('at_purpose', '과제 협의', 'input');
  place('전남 목포시');
  t('비우면 다시 기억을 따른다 — 바로 가는 KTX 가 없는 목포는 오송에서 갈아타는 길이 적힌다', () => {
    assert.deepEqual(icons(), [[true, false], [false, false], [false, false]]);
    assert.match(need(), /KTX 부산↔오송↔목포 일반석 69,500원 × 2$/);
  });
}
{
  // 종류 줄 끝의 "내역" — 모든 종류의 신청 내역을 한 목록으로 보고 폼은 숨긴다. 종류를 고르면 그 종류만 보이고 폼이 돌아온다(2026-10-03 사용자 지정).
  const { window, store } = await boot({ mode: 'attend', attendKind: 'trip' });
  const doc = window.document;
  await new Promise((r) => setTimeout(r, 80));
  const view = doc.querySelector('#atKinds button[data-view="all"]');
  t('"내역" 버튼은 건강 오른쪽에 있고 처음엔 꺼져 있다', () => {
    assert.equal(view.textContent, '내역');
    assert.equal(view.previousElementSibling.textContent, '건강');
    assert.deepEqual([view.classList.contains('active'), doc.getElementById('atForm').classList.contains('hidden')], [false, false]);
  });
  view.click();
  t('누르면 켜지고 폼이 숨으며 기억된다 — 출장 버튼은 꺼진다', () => {
    const v = doc.querySelector('#atKinds button[data-view="all"]');
    assert.deepEqual([v.classList.contains('active'), v.getAttribute('aria-pressed'), doc.getElementById('atForm').classList.contains('hidden'), store.attendView],
      [true, 'true', true, 'all']);
    assert.equal(doc.querySelector('#atKinds .at-kind[data-kind="trip"]').classList.contains('active'), false);
  });
  doc.querySelector('#atKinds .at-kind[data-kind="trip"]').click();
  t('종류를 고르면 "내역"이 꺼지고 폼이 돌아온다', () => {
    assert.deepEqual([doc.querySelector('#atKinds button[data-view="all"]').classList.contains('active'), doc.getElementById('atForm').classList.contains('hidden'), store.attendView], [false, false, '']);
    assert.ok(doc.querySelector('#atKinds .at-kind[data-kind="trip"]').classList.contains('active'));
  });
}
{
  const { window } = await boot({ mode: 'attend', attendKind: 'trip', attendView: 'all' });
  await new Promise((r) => setTimeout(r, 80));
  t('"내역"으로 두고 닫았으면 다시 열 때도 "내역"이다', () => assert.deepEqual(
    [window.document.querySelector('#atKinds button[data-view="all"]').classList.contains('active'), window.document.getElementById('atForm').classList.contains('hidden')], [true, true]));
}
{
  // 신청 폼은 제목을 눌러 접었다 편다(2026-10-03 사용자 지정). 접은 것을 기억하고, 종류를 고르면 펴진다.
  const { window, store } = await boot({ mode: 'attend', attendKind: 'trip' });
  const doc = window.document;
  await new Promise((r) => setTimeout(r, 80));
  const toggle = doc.getElementById('atFormToggle');
  const body = doc.getElementById('atFormBody');
  t('폼 제목이 접기 버튼이다 — 처음엔 펴져 있다', () => {
    assert.ok(toggle.contains(doc.getElementById('atFormTitle')));
    assert.deepEqual([toggle.getAttribute('aria-expanded'), toggle.getAttribute('aria-controls'), body.hidden], ['true', 'atFormBody', false]);
    assert.ok(body.contains(doc.getElementById('atFields')) && body.contains(doc.getElementById('atSubmit')));
  });
  toggle.click();
  t('누르면 칸·버튼이 접히고 제목 줄만 남는다 — 접은 것을 기억한다', () => {
    assert.deepEqual([toggle.getAttribute('aria-expanded'), body.hidden, doc.getElementById('atForm').classList.contains('folded'), store.attendFormOpen],
      ['false', true, true, false]);
    assert.equal(doc.getElementById('atReset').closest('#atFormBody'), null, '비우기는 제목 줄에 남는다');
  });
  toggle.click();
  t('다시 누르면 펴진다', () => assert.deepEqual([body.hidden, store.attendFormOpen], [false, true]));
  toggle.click();
  doc.querySelector('#atKinds .at-kind[data-kind="out"]').click();
  t('접어 두고 종류를 고르면 펴진다', () => assert.deepEqual([body.hidden, store.attendFormOpen], [false, true]));
  // 기간을 정해 조회하는 것은 신청 내역을 보려는 것이다 — 그 동안 신청 폼을 접는다(2026-10-03 사용자 지정). 기본 보기로 돌아오면 접기 전의 모양이다
  // (4주를 눌러 조회하고, 켜진 것을 다시 누르면 기본 보기다).
  const query = () => {
    doc.getElementById('atRangeFrom').value = '2026-07-01';
    doc.getElementById('atRangeTo').value = '2026-08-31';
    doc.getElementById('atRangeGo').click();
  };
  const week4 = () => doc.getElementById("atBack4").click();
  const backToDefault = () => { week4(); week4(); };
  query();
  t('기간을 정해 조회하면 신청 폼이 접힌다 — 접은 것으로 적어 두지는 않는다', () =>
    assert.deepEqual([body.hidden, toggle.getAttribute('aria-expanded'), store.attendFormOpen], [true, 'false', true]));
  week4();
  t('4주를 눌러 조회해도 접힌 그대로다 — 이것도 기간 조회다', () => assert.deepEqual([body.hidden, store.attendFormOpen], [true, true]));
  week4();
  t('켜진 4주를 다시 눌러 기본 보기로 돌아오면 다시 펴진다', () => assert.deepEqual([body.hidden, toggle.getAttribute('aria-expanded')], [false, 'true']));
  query();
  backToDefault();
  t('기본 보기로 돌아오면 다시 펴진다', () => assert.deepEqual([body.hidden, toggle.getAttribute('aria-expanded')], [false, 'true']));
  query();
  toggle.click();
  backToDefault();
  t('조회하는 중에 손수 편 폼은 기본 보기로 돌아와도 펴진 그대로다', () => assert.deepEqual([body.hidden, store.attendFormOpen], [false, true]));
  toggle.click();
  query();
  backToDefault();
  t('손수 접어 둔 폼은 조회했다 돌아와도 접힌 그대로다', () => assert.deepEqual([body.hidden, store.attendFormOpen], [true, false]));
}
{
  const { window } = await boot({ mode: 'attend', attendKind: 'trip', attendFormOpen: false });
  await new Promise((r) => setTimeout(r, 80));
  t('접어 둔 채로 패널을 다시 열면 접혀 있다', () => assert.deepEqual(
    [window.document.getElementById('atFormBody').hidden, window.document.getElementById('atFormToggle').getAttribute('aria-expanded')], [true, 'false']));
}
{
  // eclass 로그인이 풀려 있으면 SSO 를 열지 않는다 — 따라가면 남은 쿠키가 지워진다.
  const fetchImpl = async (url) => (String(url).includes('/eClassVer4/Home/Index')
    ? { ok: false, status: 0, type: 'opaqueredirect' }
    : Promise.reject(new Error('offline')));
  const { window, calls } = await boot({ mode: 'attend' }, { fetchImpl });
  await new Promise((r) => setTimeout(r, 80));
  t('eclass 로그인이 풀렸으면 HR 탭을 열지 않고 만료라고 말한다', () => {
    assert.ok(!calls.tabs.some((x) => /SSOMessage/.test(x.url || '')), JSON.stringify(calls.tabs));
    assert.match(window.document.getElementById('atStatus').textContent, /로그인이 필요합니다.*만료/);
    assert.ok(window.document.getElementById('atOpenLogin'));
  });
}

console.log('실행자 — 차량 탭의 일은 회의실 사이트로 가지 않는다');
{
  // 2026-09-16 실제 차량 화면. 최정호 님이 181허4309 를 09~18시에 쓴다 — 내 이름으로 두면 그 건이 내 예약이 된다.
  const carHtml = fs.readFileSync(new URL('test/fixtures/rentcar-2026-09-16.html', root), 'utf8');
  const page = (html, url) => ({
    ok: true, status: 200, type: 'basic', url,
    headers: { get: () => 'text/html; charset=utf-8' },
    arrayBuffer: async () => new TextEncoder().encode(html).buffer,
  });
  const posts = [];
  const { window, calls } = await boot({ mode: 'car', myName: '최정호' }, {
    fetchImpl: async (url, init = {}) => {
      if (String(init.method || 'GET').toUpperCase() === 'POST') posts.push(String(url));
      return /RentCar/.test(String(url)) ? page(carHtml, String(url)) : Promise.reject(new Error('offline'));
    },
  });
  const doc = window.document;
  const date = doc.getElementById('date');
  date.value = '2026-09-16';
  date.dispatchEvent(new window.Event('change'));
  const until = async (ok) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 50)); };
  const grid = doc.getElementById('grid');
  await until(() => grid.getAttribute('aria-busy') === 'false' && grid.querySelector('td.slot.mine'));

  const row = [...grid.querySelectorAll('tbody tr')].find((tr) => /181허4309/.test(tr.querySelector('th')?.title || ''));
  const mine = row ? [...row.querySelectorAll('td.slot.mine')] : [];
  t('차량 현황이 뜨고 내 이용이 표시된다', () => {
    assert.ok(row, grid.textContent.slice(0, 200));
    assert.equal(mine.length, 9, '09~18시 아홉 칸');
  });

  // 내 이용 바로 뒤의 빈 칸(18시)을 고른다. 회의실이라면 여기서 "이어붙이기"가 뜬다.
  const next = row.querySelector(`td.slot[data-s="${+mine.at(-1).dataset.s + 1}"]`);
  next.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  t('맞닿은 빈 칸을 고르면 신청 칸이 열린다', () => {
    assert.ok(next.classList.contains('free'));
    assert.ok(!doc.getElementById('booking').classList.contains('hidden'));
    assert.ok(!doc.getElementById('submit').classList.contains('hidden'));
  });
  t('차량에는 이어붙이기가 뜨지 않는다 — 그 길은 회의실 사이트로 취소·예약을 보낸다', () =>
    assert.ok(doc.getElementById('extend').classList.contains('hidden')));

  // 숨은 버튼을 억지로 눌러도 아무것도 보내지 않는다.
  const before = { posts: posts.length, room: calls.urls.filter((u) => /MeetingRoom/.test(u)).length };
  doc.getElementById('extend').click();
  await new Promise((r) => setTimeout(r, 100));
  t('억지로 눌러도 취소·예약 요청이 나가지 않는다', () => {
    assert.equal(posts.length, before.posts, posts.slice(before.posts).join(', '));
    assert.equal(calls.urls.filter((u) => /MeetingRoom/.test(u)).length, before.room);
  });

  // 행선지 없이 신청을 누르면 차량의 필수 칸 검사에 걸린다(회의주제 검사가 아니다).
  doc.getElementById('submit').click();
  await new Promise((r) => setTimeout(r, 50));
  t('필수 칸은 종류가 정한다 — 차량은 행선지', () => {
    assert.match(doc.getElementById('status').textContent, /행선지를 입력하세요/);
    assert.equal(posts.length, before.posts);
  });

  // 사이트가 예약 버튼에서 막는 차량(임원용 그랜저 189오9673 — 그날 비어 있다). 사이트에서는 "문의 바랍니다" 가 뜨고 폼이 열리지 않는다.
  // 확장은 폼 주소를 바로 열 수 있지만, 목록에서 읽어 둔 막음을 지켜 보내지 않는다.
  doc.getElementById('clearPick').click();
  const exec = [...grid.querySelectorAll('tbody tr')].find((tr) => /189오9673/.test(tr.querySelector('th')?.title || ''));
  exec.querySelector('td.slot.free').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  doc.getElementById('fPlace').value = '부산시청';
  const gets = calls.urls.filter((u) => /Admin_View_New/.test(u)).length;
  doc.getElementById('submit').click();
  await until(() => /막고 있습니다/.test(doc.getElementById('status').textContent));
  t('사이트가 막는 차량(임원용)은 차량 탭에서 골라도 신청을 보내지 않는다 — 신청 폼을 열지도 않고 사이트의 문구로 말한다', () => {
    assert.match(doc.getElementById('status').textContent, /1건 실패\. 사이트가 이 차량의 신청을 막고 있습니다 — 차량 이용 시 지원팀/);
    assert.equal(posts.length, before.posts);
    assert.equal(calls.urls.filter((u) => /Admin_View_New/.test(u)).length, gets);
  });
}

console.log('근태 폼의 차량 조회 — 빈 차량을 누르면 차량 탭으로 넘어가지 않고 그 자리에서 신청한다');
{
  // 흉내 낸 차량 사이트. 목록은 날짜를 옮기는 포스트백(__EVENTARGUMENT = 2026_10_20)을 받아 그 날짜의 화면을 돌려주고,
  // 신청 폼(실제 2026-09-16 캡처)에 저장이 오면 그 신청을 목록에 적는다. 달력이 없는 화면이라 건수 대조는 하지 않는다.
  const pad = (n) => String(n).padStart(2, '0');
  const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const [TODAY, D1, D2] = [plus(0), plus(10), plus(11)];
  const short = (s) => `${+s.slice(5, 7)}/${+s.slice(8)}`;
  const moment = (s, hm) => `${s.slice(2).replace(/-/g, '.')} (수) ${hm}`;   // "26.10.20 (수) 07:00" — 요일은 읽지 않는다
  const CARS = [['70', '아반테CN74 (181허4360)'], ['75', '스타리아 (308소4997)']];
  const used = { [D1]: [['70', `${moment(D1, '10:00')} ~ ${moment(D1, '12:00')}`, '홍길동 (기술팀)']] };
  const carPage = (date) => `<html><body><form method="post" action="New_List.aspx?s_code=0102010300"><input type="hidden" name="__VIEWSTATE" value="v" />
<span id="LB_DATE_M">${date} ( Wednesday )</span><table id="RG_MAIN_ctl00" class="rgMasterTable"><tbody>${CARS.map(([idx, name]) => `
<tr><td></td><td>${name}</td><td></td><td>가능 예약</td><td><input type="button" value="예약" onclick="fnPop('Admin_View_New.aspx?CARIDX=${idx}&amp;SDATE=${date}')" /></td></tr>
<tr><td colspan="5"><table class="rgDetailTable"><tbody>${(used[date] || []).filter((u) => u[0] === idx).map(([, time, who, mine], n) =>
    `<tr><td>ㄴ 운행정보 : 방문</td><td>${time}</td><td>${who}${mine ? ` <input type="submit" name="RG_MAIN$ctl00$ctl0${n}$BTN_DEL" value="취소" />` : ''}</td></tr>`).join('')}</tbody></table></td></tr>`).join('')}
</tbody></table></form>${' '.repeat(1600)}</body></html>`;
  const formHtml = fs.readFileSync(new URL('test/fixtures/rentcar-form-2026-09-16.html', root), 'utf8');
  const page = (text, url) => ({
    ok: true, status: 200, type: 'basic', url,
    headers: { get: () => 'text/html; charset=utf-8' },
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  });
  const saves = [];
  const field = (body, name) => new URLSearchParams(body).get(name)
    ?? (body.match(new RegExp(`name="${name.replace(/\$/g, '\\$')}"\\r\\n\\r\\n([^\\r]*)`)) || [])[1];
  const { window, store } = await boot({ mode: 'attend', attendKind: 'trip', attendWorkplace: '부산' }, {
    fetchImpl: async (url, init = {}) => {
      const u = String(url);
      if (!/RentCar/.test(u)) throw new Error('offline');
      const post = String(init.method || 'GET').toUpperCase() === 'POST';
      if (/Admin_View_New/.test(u)) {
        if (post) {
          saves.push(String(init.body));
          // 사이트가 신청을 받아 적는다. 본인 건에는 취소 버튼이 붙는다.
          const row = ['75', `${moment(D1, '07:00')} ~ ${moment(D2, '20:00')}`, '고민수 (연구3팀)', true];
          for (const d of [D1, D2]) (used[d] ||= []).push(row);
        }
        return page(formHtml, u);
      }
      const m = post ? (new URLSearchParams(String(init.body)).get('__EVENTARGUMENT') || '').match(/^(\d+)_(\d+)_(\d+)$/) : null;
      return page(carPage(m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : TODAY), u);
    },
  });
  const doc = window.document;
  const until = async (ok) => { for (let i = 0; i < 120 && !ok(); i++) await new Promise((r) => setTimeout(r, 50)); };
  const type = (id, value) => {
    const input = doc.getElementById(id);
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const tick = (id) => {
    const box = doc.getElementById(id);
    box.checked = true;
    box.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const carRows = () => [...doc.querySelectorAll('#atCars .at-cars-list .at-car')].map((n) =>
    [n.tagName, n.querySelector('.at-car-name').textContent, n.querySelector('.at-car-state').textContent]);

  // 1박 2일 출장(첫날 07시 ~ 둘째 날 20시), 사전정산을 켜고 출장지를 적은 뒤 그 옆의 차량 조회를 켠다.
  type('at_dateFrom', D1);
  doc.querySelector('.at-field[data-key="days"] .at-chip[data-days="2"]').click();
  type('at_purpose', '착수회의 참석');
  tick('at_settle');
  type('at_place', '대전');
  tick('at_car');
  await until(() => doc.querySelector('#atCars .at-cars-list'));
  t('차량 조회를 켜면 출장 기간(이틀)의 차량 현황을 사이트에서 읽어 빈 차량을 폼 아래에 보인다', () => {
    assert.equal(doc.querySelector('#atCars .at-cars-when').textContent, `${short(D1)} 07:00 ~ ${short(D2)} 20:00`);
    assert.deepEqual(carRows(), [
      ['BUTTON', '스타리아 (308소4997)', '비어 있음'], ['DIV', '아반테CN74 (181허4360)', `${short(D1)} 10:00~12:00 홍길동`],
    ]);
    assert.equal(saves.length, 0, '조회만 했다 — 신청은 나가지 않았다');
  });

  const what = `스타리아 (308소4997) ${short(D1)} 07:00 ~ ${short(D2)} 20:00 · 행선지 대전`;
  doc.querySelector('#atCars button.at-car').click();
  await until(() => /차량을 신청했습니다|신청하지 못했습니다|확인하지 못했습니다/.test(doc.getElementById('atStatus').textContent));
  t('빈 차량을 누르면 끝이 다음 날인 신청 한 건이 사이트로 나가고(목적·출장지가 사용목적·행선지로), 다시 조회해 확인한다', () => {
    assert.equal(saves.length, 1);
    const b = saves[0];
    assert.deepEqual([field(b, 'txtSdate'), field(b, 'txtEdate'), field(b, 'ddlStimeH'), field(b, 'ddlEtimeH'), field(b, 'txtPlace'), field(b, 'txtTitle')],
      [D1, D2, '7', '20', '대전', '착수회의 참석']);
    assert.equal(doc.getElementById('atStatus').textContent, `차량을 신청했습니다 — ${what}`);
  });
  t('차량 탭으로 넘어가지 않는다 — 근태 탭을 그대로 보고 있고 폼도 그대로다', () => {
    assert.ok(doc.getElementById('tabAttend').classList.contains('active'));
    assert.ok(!doc.getElementById('tabCar').classList.contains('active'));
    assert.ok(!doc.getElementById('attend').classList.contains('hidden'));
    assert.ok(doc.getElementById('booking').classList.contains('hidden'), '차량 탭의 신청 칸은 열리지 않았다');
    assert.deepEqual([doc.getElementById('at_purpose').value, doc.getElementById('at_place').value, doc.getElementById('at_car').checked], ['착수회의 참석', '대전', true]);
  });
  t('차량 탭에서 예약한 것과 같은 것이 남는다 — 활동 기록, 내가 넣은 예약, 신청 폼이 알려 준 내 이름', () => {
    assert.ok(store.justBooked.some((b) => b.mode === 'car' && b.date === D1 && b.room === '스타리아 (308소4997)' && b.start === 420 && b.end === 1440), JSON.stringify(store.justBooked));
    assert.equal(store.myName, '고민수');
    assert.ok(Object.values(store).some((v) => Array.isArray(v) && v.some((e) => e?.kind === 'reserve' && e.ok && /스타리아.*근태 폼의 차량 조회/.test(e.text || ''))), '활동 기록에 예약이 남는다');
  });

  await until(() => /내 신청/.test(doc.getElementById('atCars')?.textContent || ''));
  t('신청한 뒤 차량을 다시 읽는다 — 방금 신청한 차는 "내 신청"으로 바뀌어 있고 결과가 상자에 적힌다', () => {
    assert.equal(doc.querySelector('#atCars .at-cars-note.ok').textContent, `신청했습니다 — ${what}`);
    assert.deepEqual(carRows(), [
      ['DIV', '스타리아 (308소4997)', `${short(D1)} 07:00~${short(D2)} 20:00 내 신청`], ['DIV', '아반테CN74 (181허4360)', `${short(D1)} 10:00~12:00 홍길동`],
    ]);
    assert.ok([...doc.querySelectorAll('#atCars .at-cars-note')].some((n) => /이 시간에 빈 차량이 없습니다/.test(n.textContent)));
  });
}

console.log(`\n통과 ${pass}건`);

// sidepanel 이 자동 갱신 타이머를 붙여 두어 jsdom 에서는 이벤트 루프가 비지 않는다.
// 명시적으로 끝낸다 — 안 그러면 테스트가 통과하고도 프로세스가 매달려 있다.
process.exit(0);
