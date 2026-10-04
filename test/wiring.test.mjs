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

/**
 * 저장된 설정을 주고 init 을 돌린 뒤, 어떤 요소에 리스너가 붙었는지 본다.
 * fetchImpl 을 주면 네트워크를 그것으로 흉내 낸다(기본은 막힌 네트워크). (url, init, calls) 로 부른다.
 */
async function boot(saved, { fetchImpl = null } = {}) {
  const dom = new JSDOM(html, { url: 'https://example.org/', runScripts: 'outside-only' });
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

  const calls = { load: 0, urls: [], downloads: [], clipboard: [], intervals: [], tabs: [], tabListeners: [] };
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
      onChanged: { addListener: () => {} },
    },
    runtime: {
      sendNativeMessage: async () => { throw new Error('no host'); },
      getManifest: () => ({ version: '9.9.9' }),
    },
    tabs: {
      query: async () => [],
      create: async (opts) => { calls.tabs.push(opts); },
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
  return { wired, window, calls, store };
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
  t('두 말 칸(말로 찾기·말로 채우기) 아래와 설정에 연결 지침 복사 버튼이 나온다', () => {
    assert.deepEqual(helps.map((p) => p.parentElement.className), ['at-chat card', 'ask card off']);
    assert.ok(helps.every((p) => !p.hidden && p.querySelector('button.cli-guide-copy')));
    assert.equal(doc.getElementById('cliGuide').hidden, false);
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
    // 신청 내역의 조회 기간 — 한 줄이다(2026-10-04 사용자 지정): 4주 · 8주 · 시작일 ~ 종료일 · 조회. 지난 내역(히스토리) 버튼은 뺐다.
    // 4주·8주는 기본 보기(오늘부터 전부 + 여비 정산이 덜 끝난 다녀온 출장)에서 지난 출장을 언제까지 보일지다.
    const now = new Date();
    const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
    const two = (n) => String(n).padStart(2, '0');
    const ymdOf = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
    const mdOf = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
    const one = (d, bare) => (bare ? mdOf(d) : `${String(d.getFullYear()).slice(2)}/${mdOf(d)}`);
    // 머리 줄의 기간 글 — 올해 안이면 "9/6 ~ 10/4", 올해 밖에 걸치면 해를 붙인다.
    const span = (a, b) => { const bare = a.getFullYear() === now.getFullYear() && b.getFullYear() === now.getFullYear(); return `${one(a, bare)} ~ ${one(b, bare)}`; };
    const back = (n) => doc.querySelector(`#atRangeBox button[data-back="${n}"]`);
    const pressed = () => [4, 8].map((n) => [back(n).getAttribute('aria-pressed'), back(n).classList.contains('active')].join());
    const head = () => [doc.getElementById('atRange').textContent, doc.getElementById('atRangeHint').textContent];
    const query = (from, to) => {
      doc.getElementById('atRangeFrom').value = from;
      doc.getElementById('atRangeTo').value = to;
      doc.getElementById('atRangeGo').click();
    };
    t('히스토리 버튼은 없다 — 머리 줄의 아이콘은 달력과 HR 열기 둘이다', () => {
      assert.equal(doc.getElementById('atHistoryBtn'), null);
      assert.equal(doc.getElementById('atRangeBtn').nextElementSibling.id, 'atOpenHr');
    });
    t('조회 기간은 한 줄이다 — 4주 · 8주 · 시작일 ~ 종료일 · 조회. 처음엔 4주가 켜져 있다(안 봄·2주·지난 1·3·6개월·1년 버튼은 없다)', () => {
      const box = doc.getElementById('atRangeBox');
      assert.equal(box.children.length, 1);
      assert.deepEqual([...box.firstElementChild.children].map((n) => n.id || n.dataset.back || n.textContent), ['4', '8', 'atRangeFrom', '~', 'atRangeTo', 'atRangeGo']);
      assert.deepEqual([...box.querySelectorAll('button[data-back]')].map((b) => b.textContent), ['4주', '8주']);
      assert.deepEqual(pressed(), ['true,true', 'false,false']);
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
    t('8주를 누르면 기본 보기로 돌아와 8주까지 보고, 고른 값을 저장한다 — 홈의 WORKSPACE 카드도 이 값을 따른다', () => {
      assert.deepEqual(head(), [span(ago(56), now), '오늘부터 전부 · 정산 중인 출장은 다녀온 뒤 8주까지']);
      assert.deepEqual([store.tripBackWeeks, pressed()], [8, ['false,false', 'true,true']]);
      assert.equal(doc.getElementById('atRangeBtn').classList.contains('active'), false);
    });
    back(8).click();
    t('켜져 있는 것을 다시 누르면 꺼진다 — 지난 출장을 보지 않고 오늘부터의 것만', () => {
      assert.deepEqual(head(), [span(now, now), '오늘부터 전부']);
      assert.deepEqual([store.tripBackWeeks, pressed()], [0, ['false,false', 'false,false']]);
    });
    back(4).click();
    t('4주를 누르면 다시 4주다', () => assert.deepEqual([store.tripBackWeeks, pressed()], [4, ['true,true', 'false,false']]));
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

console.log('근태 탭');
{
  const { wired, window } = await boot({ mode: 'room' });
  const doc = window.document;
  t('근태가 탭 가운데 맨 앞에 있다', () => {
    const tabs = [...doc.querySelectorAll('nav.tabs .tab')].map((b) => b.textContent);
    assert.deepEqual(tabs, ['근태', '회의실', '차량', '현황']);
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
    assert.ok(wired.get('atRangeBtn')?.has('click') && wired.get('atRangeBox')?.has('click') && wired.get('atRangeGo')?.has('click'), '조회 기간');
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
  t('말로 채우면 종류가 옮겨 가고, 적어 둔 목적이 따라와 바로 올릴 수 있다 (여비계산서 사전정산은 꺼져 있다)', () => {
    assert.equal(doc.querySelector('#atKinds .at-kind.active').textContent, '출장');
    assert.equal(doc.getElementById('at_dateFrom').value, '2026-10-20');
    assert.equal(doc.getElementById('at_dateTo'), null, '종료일 칸은 따로 없다 — 며칠간으로 받는다');
    assert.deepEqual([doc.getElementById('at_start').value, doc.getElementById('at_end').value], ['07:00', '20:00']);
    assert.deepEqual([...doc.querySelectorAll('#atFields .at-field')].map((n) => n.dataset.key), ['dateFrom', 'days', 'start', 'end', 'purpose', 'settle', 'car']);
    assert.deepEqual([doc.getElementById('at_settle').type, doc.getElementById('at_settle').checked], ['checkbox', false]);
    assert.deepEqual([...doc.querySelector('#atFields .at-group.at-opts').children].map((n) => n.dataset.key), ['settle', 'car'], '차량 조회는 사전정산 옆(같은 줄)에 선다');
    assert.deepEqual([doc.getElementById('at_car').type, doc.getElementById('at_car').checked, doc.getElementById('atCars')], ['checkbox', false, null]);
    assert.deepEqual([...doc.querySelectorAll('#atFields .at-field.need')].map((n) => n.dataset.key), []);
    assert.equal(doc.getElementById('atSubmit').disabled, false);
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
  // 여비계산서 사전정산: 체크박스를 켜면 출장지·근무지·교통편이 한 줄로 나온다
  const tick = (on) => {
    const box = doc.getElementById('at_settle');
    box.checked = on;
    box.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const icons = () => [...doc.querySelectorAll('.at-field[data-key="transport"] .at-chip')];
  tick(true);
  t('여비계산서 사전정산을 켜면 출장지·근무지·교통편이 한 줄(같은 묶음)에 선다 — 교통편은 아이콘 셋이고 기차가 골라져 있다', () => {
    const group = doc.querySelector('#atFields .at-group.at-where');
    assert.deepEqual([...group.children].map((n) => n.dataset.key), ['place', 'workplace', 'transport']);
    assert.equal(doc.querySelector('#atFields .at-field.at-file'), null, '출장 증빙은 신청할 때 묻지 않는다 — 신청 내역의 출장 카드에서 넣는다');
    for (const key of ['place', 'workplace']) {
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
  type('at_purpose', '과제 협의');
  t('출장의 며칠간은 1D~5D 칩과 그 오른쪽 달력이다 — 1D 가 골라져 있고 달력에는 끝나는 날이 적혀 있다', () => {
    assert.deepEqual(dayChips().map((b) => b.textContent), ['1D', '2D', '3D', '4D', '5D']);
    assert.deepEqual(activeDays(), ['1D']);
    const end = doc.getElementById('at_days');
    assert.deepEqual([end.type, end.value, end.min], ['date', '2026-10-20', '2026-10-20']);
    assert.equal(end.parentElement, dayChips()[0].parentElement, '달력은 칩과 같은 줄에 있다');
  });
  t('출장의 출발·도착은 정시 목록에서 고른다 (HR 이 출장의 분 칸을 잠가 둔다)', () => {
    assert.equal(doc.getElementById('at_end').tagName, 'SELECT');
    assert.deepEqual([timesOf('at_start').length, timesOf('at_end').includes('20:30')], [24, false]);
  });
  dayChips()[2].click();
  t('3D 칩을 누르면 올릴 내용의 기간이 사흘로 바뀌고 달력의 끝나는 날이 따라간다', () => {
    assert.match(doc.getElementById('atNeed').textContent, /출장 10\/20~10\/22 07:00~20:00/);
    assert.equal(doc.getElementById('at_days').value, '2026-10-22');
    assert.deepEqual(activeDays(), ['3D']);
  });
  const pickEnd = (value) => {
    const input = doc.getElementById('at_days');
    input.value = value;
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  pickEnd('2026-10-24');
  t('달력에서 끝나는 날을 고르면 닷새가 되고 5D 칩이 켜진다', () => {
    assert.match(doc.getElementById('atNeed').textContent, /출장 10\/20~10\/24 07:00~20:00/);
    assert.deepEqual(activeDays(), ['5D']);
  });
  pickEnd('2026-10-26');
  t('칩에 없는 날 수(이레)를 달력에서 고르면 칩은 모두 꺼진다', () => {
    assert.match(doc.getElementById('atNeed').textContent, /출장 10\/20~10\/26 07:00~20:00/);
    assert.deepEqual(activeDays(), []);
  });
  pickEnd('2026-10-19');
  t('시작일보다 이른 날은 받지 않고 되돌린다', () => {
    assert.equal(doc.getElementById('at_days').value, '2026-10-26');
    assert.match(doc.getElementById('atStatus').textContent, /끝나는 날은 시작일부터/);
    assert.match(doc.getElementById('atNeed').textContent, /출장 10\/20~10\/26/);
  });

  // 휴가: 연차·체력단련을 안에서 고르고, 구분은 하루짜리 연차에만 있다
  doc.querySelector('#atKinds .at-kind[data-kind="leave"]').click();
  const chipsOf = (key) => [...doc.querySelectorAll(`.at-field[data-key="${key}"] .at-chip`)];
  const keys = () => [...doc.querySelectorAll('#atFields .at-field')].map((n) => n.dataset.key);
  t('휴가: 연차가 기본이고 며칠간을 묻는다. 그대로 올릴 수 있다 (적어 둔 날짜는 가져가고 날 수는 하루로 돌아간다)', () => {
    assert.deepEqual(keys(), ['sub', 'dateFrom', 'days', 'half']);
    assert.deepEqual(chipsOf('sub').map((b) => [b.textContent, b.classList.contains('active')]), [['연차', true], ['체력단련', false]]);
    assert.deepEqual(chipsOf('half').map((b) => [b.textContent, b.classList.contains('active')]), [['전일', true], ['오전', false], ['오후', false]]);
    assert.match(doc.getElementById('atFormTitle').textContent, /연차 신청/);
    assert.equal(doc.getElementById('atSubmit').disabled, false);
    assert.match(doc.getElementById('atNeed').textContent, /연차 10\/20 전일/);
  });
  t('휴가의 며칠간 칩도 1D~5D 다', () =>
    assert.deepEqual(chipsOf('days').map((b) => b.textContent), ['1D', '2D', '3D', '4D', '5D']));
  chipsOf('half')[2].click();
  t('하루짜리 연차에서 오후를 고르면 요약에 오후가 적히고, 그 날 근무시간을 확인한다고 말한다', () => {
    assert.match(doc.getElementById('atNeed').textContent, /연차 10\/20 오후/);
    assert.match(doc.getElementById('at_half_msg').textContent, /근무시간을 확인하는 중/);
  });
  await new Promise((r) => setTimeout(r, 120));
  t('근무시간을 읽지 못하면(HR 에 닿지 못함) 그렇다고 말하고, 반차는 그대로 올릴 수 있게 둔다', () => {
    assert.match(doc.getElementById('at_half_msg').textContent, /근무시간을 확인하지 못했습니다.*09:00 출근으로 먼저/);
    assert.equal(doc.getElementById('atSubmit').disabled, false);
  });
  chipsOf('days')[1].click();
  t('이틀로 늘리면 구분 칸이 없어지고 전일로 올라간다', () => {
    assert.deepEqual(keys(), ['sub', 'dateFrom', 'days']);
    assert.match(doc.getElementById('atNeed').textContent, /연차 10\/20~10\/21 2일간/);
  });
  chipsOf('sub')[1].click();
  t('체력단련을 고르면 제목이 바뀐다', () => {
    assert.match(doc.getElementById('atFormTitle').textContent, /체력단련 신청/);
    assert.match(doc.getElementById('atNeed').textContent, /체력단련 10\/20~10\/21 2일간/);
  });
  t('말로 채운 것이 활동 기록에 남는다', () =>
    assert.ok((store.activityLog || []).some((e) => e.kind === 'attend-ask' && /10월 20일 출장/.test(e.text))));
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
  // 기간을 정해 조회하는 것은 신청 내역을 보려는 것이다 — 그 동안 신청 폼을 접는다(2026-10-03 사용자 지정). 기본 보기로 돌아오면(4주·8주 버튼) 접기 전의 모양이다.
  const query = () => {
    doc.getElementById('atRangeFrom').value = '2026-07-01';
    doc.getElementById('atRangeTo').value = '2026-08-31';
    doc.getElementById('atRangeGo').click();
  };
  const backToDefault = () => doc.querySelector('#atRangeBox button[data-back="4"]').click();
  query();
  t('기간을 정해 조회하면 신청 폼이 접힌다 — 접은 것으로 적어 두지는 않는다', () =>
    assert.deepEqual([body.hidden, toggle.getAttribute('aria-expanded'), store.attendFormOpen], [true, 'false', true]));
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
