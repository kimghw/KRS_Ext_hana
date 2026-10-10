// 신청 내역의 연차 카드에서 기념일 지원을 더 신청한다(2026-10-09 사용자 지정: "연차사용의 경우 승인 전후 신청 내역에서 추가로 신청할 수
// 있도록") — 올려 둔 연차(결재요청·결재완료)를 펴면 "기념일 지원" 버튼이 있고, 누르면 그 연차의 날짜로 폼이 열려 기념일 칸이 켜진다.
// 연차는 이미 올라가 있어 결재요청·임시저장은 숨고, 기념일 상자의 "신청 화면 열기"만 나가는 길이다. 체크박스 오른쪽에는 올해 쓴 횟수가 선다.
//
// 패널을 진짜 화면(sidepanel.html)에 붙이고 HR 문서함(작업 탭 안의 요청)과 eclass 신청 현황은 흉내 낸다(test/attendlist.test.mjs 와 같은 틀).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok, what) => {
  for (let i = 0; i < 240 && !ok(); i++) await wait(25);
  assert.ok(ok(), `기다렸지만 되지 않았다: ${what}`);
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8)}`;
const YEAR = plus(0).slice(0, 4);

const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const { window } = new JSDOM(html, { url: 'https://example.org/' });
const doc = window.document;
for (const g of ['document', 'DOMParser', 'FileReader', 'Element', 'HTMLElement', 'HTMLInputElement']) globalThis[g] = window[g];
globalThis.window = window;

/* ------------------------------------------------------------ 가짜 HR 문서함과 eclass 신청 현황 */

const HR = 'https://hr.krs.co.kr';
const DAY = plus(5);
const leave = (docNo, statusCode, statusName) => ({
  docNo, statusCode, statusName, formId: 'LV', formName: '휴가/공가 신청', workCodeKindName: '연차',
  startDate: DAY.replace(/-/g, ''), endDate: DAY.replace(/-/g, ''), startTime: '', endTime: '', wrkGubunName: '전일',
  reqRsn: docNo, reqstDate: `${plus(-3)} 09:00:00`, pgmUrlAd: '/uhr/docappr/apprleav100/view',
});
const hrRows = [leave('L-OK', '5', '결재완료'), leave('L-WAIT', '3', '결재요청'), leave('L-BACK', '6', '회수')];
// 신청 현황(WFA_Application_List.aspx) — 올해 두 번 신청했다.
const wfaRow = (seq, applied) => `<tr><td>${seq}</td><td>${applied}</td><td><a onclick="openEditPopup('${seq}')">본인</a></td><td>본인</td>`
  + `<td>생일(양력)</td><td>${applied}</td><td>150,000</td><td>150,000</td><td>지급완료</td></tr>`;
const WFA_LIST = `<table id="MainPlaceHolder_gdvRadList_ctl00"><tbody>${wfaRow(11, `${YEAR}-03-02`)}${wfaRow(12, `${YEAR}-06-01`)}</tbody></table>`;

const store = { attendKind: 'leave', attendView: '' };
globalThis.chrome = {
  storage: { local: {
    get: async () => store,
    set: async (obj) => { Object.assign(store, obj); },
    remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
  } },
  runtime: { sendNativeMessage: async () => { throw new Error('no host'); } },
  tabs: {
    get: async (id) => ({ id, url: `${HR}/`, status: 'complete' }),
    create: async () => ({ id: 7, url: `${HR}/`, status: 'complete' }),
    update: async (id) => ({ id }), remove: async () => {}, query: async () => [],
  },
  scripting: {
    executeScript: async ({ func, args }) => {
      if (func.name === 'pageShell') return [{ result: { href: `${HR}/`, shell: true, login: false } }];
      if (func.name !== 'pageFetch') return [{ result: null }];
      if (args[0] === '/api/user') return [{ result: { status: 200, url: '', text: JSON.stringify({ loginUserId: '11115', loginUserNm: '김거화' }) } }];
      return [{ result: { status: 200, url: '', text: JSON.stringify(hrRows) } }];
    },
  },
};
const page = (body) => new Response(`<html><body>${body}${' '.repeat(1600)}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('http://localhost:5003')) throw new TypeError('Failed to fetch');
  if (u.includes('WFA_Application_List')) return page(WFA_LIST);
  if (u.includes('/BusinessTrip/')) return page('<table id="mainList"><tbody></tbody></table>');
  return page('home');   // 포털 로그인 확인
};

/* ------------------------------------------------------------ 패널 */

const { createAttendPanel } = await import('../attendpanel.js');
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const panel = createAttendPanel({
  $: (id) => doc.getElementById(id), escapeHtml, logEvent: () => {}, ai: () => ({ apiKey: '', cli: false }),
  evidence: { list: async () => [], keep: async () => {}, remove: async () => {} },
});
panel.wire();
const st = panel.state;
const $ = (id) => doc.getElementById(id);
const card = (no) => [...doc.querySelectorAll('#atList > li')].find((li) => li.querySelector('.at-reason')?.textContent === no);
const acts = (no) => [...card(no).querySelectorAll('.at-acts button[data-act]:not([data-act="web"])')].map((b) => b.textContent);
const openCard = (no) => card(no).querySelector('.at-head').click();
const hidden = (id) => $(id).classList.contains('hidden');
const fill = (id, value) => { const n = $(id); n.value = value; n.dispatchEvent(new window.Event('input', { bubbles: true })); n.dispatchEvent(new window.Event('change', { bubbles: true })); };
const check = (id, on) => { const n = $(id); n.checked = on; n.dispatchEvent(new window.Event('change', { bubbles: true })); };

await panel.show();
await until(() => st.loadedOnce && card('L-OK'), '신청 내역 읽기');
await until(() => st.wfa, '기념일 신청 현황 읽기');
await wait(40);

console.log('기념일 지원 체크박스 오른쪽의 올해 쓴 횟수');
t('연차 폼의 체크박스 오른쪽에 올해 쓴 횟수가 선다 — 켜기 전에도 보이고, 신청 현황 화면의 올해 신청 건수로 센다', () => {
  const used = doc.querySelector('.at-field[data-key="wfa"] #atWfaUsed');
  assert.equal(used?.textContent, '올해 2/5번 사용');
  assert.equal($('at_wfa').checked, false);
  assert.match(used.title, new RegExp(`${YEAR}년 2번 신청 — 연 5번까지`));
});

console.log('신청 내역의 연차 카드 — 승인 전후에 기념일 지원');
openCard('L-OK');
t('결재완료 연차를 펴면 근태 변경·취소신청 옆에 기념일 지원이 있다', () => assert.deepEqual(acts('L-OK'), ['근태 변경', '취소신청', '기념일 지원']));
openCard('L-WAIT');
t('결재요청(승인 전) 연차에도 있다', () => assert.deepEqual(acts('L-WAIT'), ['근태 변경', '회수', '기념일 지원']));
openCard('L-BACK');
t('회수한 연차에는 없다', () => assert.deepEqual(acts('L-BACK'), ['삭제']));
openCard('L-OK');
card('L-OK').querySelector('button[data-act="wfa"]').click();
await wait(40);
t('누르면 그 연차의 날짜로 폼이 열리고 기념일 칸이 켜진다 — 결재요청·임시저장은 숨고 "기념일 지원 그만두기"가 선다', () => {
  assert.equal($('atFormTitle').textContent, `기념일 지원 · 연차 ${md(DAY)} 전일`);
  assert.equal($('at_wfa').checked, true);
  assert.deepEqual([$('at_dateFrom').value, $('at_wfaReason') != null], [DAY, true]);
  assert.deepEqual([hidden('atSubmit'), hidden('atSave'), hidden('atEditCancel'), hidden('atEditNote')], [true, true, false, false]);
  assert.equal($('atEditCancel').textContent, '기념일 지원 그만두기');
  assert.match($('atEditNote').textContent, /연차는 HR 에 다시 올리지 않습니다/);
  assert.equal($('atWfaOpen').textContent, '신청 화면 열기');
  assert.equal($('atWfaOpen').disabled, true, '기념일의 내용이 비어 있다');
  assert.ok(card('L-OK').classList.contains('editing'), '어느 연차에 붙이는지 카드가 표시된다');
});
fill('at_wfaReason', '결혼기념일');
fill('at_wfaDate', DAY);
fill('at_wfaName', '본인');
t('기념일의 내용을 채우면 "신청 화면 열기"가 풀린다 — 결재요청은 계속 잠겨 있고, 열 내용에 연차가 이미 올라가 있다고 적힌다', () => {
  assert.equal($('atWfaOpen').disabled, false);
  assert.equal($('atSubmit').disabled, true);
  assert.equal($('atNeed').textContent,
    `열 내용 — 기념일 지원 신청 화면(채워서): 결혼기념일 ${md(DAY)} · 본인(본인) · 신청금액은 신청 화면에서 · 연차 ${md(DAY)} (이미 올림)`);
});
check('at_wfa', false);
t('체크박스를 끄면 보통의 연차 폼으로 돌아온다 — 결재요청·임시저장이 다시 서고 카드의 표시도 걷힌다', () => {
  assert.equal(st.wfaFor, null);
  assert.ok(!card('L-OK').classList.contains('editing'));
  assert.equal($('atFormTitle').textContent, '연차 신청');
  assert.deepEqual([hidden('atSubmit'), hidden('atSave'), hidden('atEditCancel')], [false, false, true]);
});
openCard('L-WAIT');
card('L-WAIT').querySelector('button[data-act="wfa"]').click();
await wait(40);
$('atEditCancel').click();
await wait(20);
t('"기념일 지원 그만두기"를 누르면 빈 폼으로 돌아온다', () => {
  assert.equal(st.wfaFor, null);
  assert.equal($('at_wfa').checked, false);
  assert.deepEqual([hidden('atSubmit'), hidden('atSave'), hidden('atEditCancel')], [false, false, true]);
});

console.log(`\n${pass} passed`);
