// HR 폼 프레임 안에서 도는 frameRun 의 관문들. 실제 사이트 대신 아주 작은 가짜 jQuery 와 가짜 사이트 함수를 쓴다.
//
// 여기서 지키려는 것은 하나다: **값이 제대로 안 들어갔거나 사이트가 딴소리를 하면 버튼을 누르지 않고,
// 누른 뒤에는 사이트가 "됐다"고 한 경우만 성공으로 친다.** 빈 신청서가 결재선에 올라가는 것이 가장 나쁜 실패다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { injected, HR_SSO_URL } from '../src/hr.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

/** 폼 화면 하나를 흉내 낸다. site 는 사이트 함수(saveTrav100 등)를 만들어 주는 함수다. */
function page(html, site = () => ({})) {
  const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://hr.krs.co.kr/uhr/docappr/approut100/view' });
  const { window } = dom;
  const handlers = [];
  const wrap = (nodes) => ({
    length: nodes.length,
    first: () => wrap(nodes.slice(0, 1)),
    val(v) {
      if (v === undefined) return nodes[0] ? nodes[0].value : undefined;
      for (const n of nodes) n.value = v;
      return this;
    },
    trigger(ev) {
      for (const n of nodes) handlers.filter((h) => h.ev === ev && n.matches(h.sel)).forEach((h) => h.fn.call(n));
      return this;
    },
    prop(k, v) {
      if (v === undefined) return nodes[0]?.[k];
      for (const n of nodes) n[k] = v;
      return this;
    },
    filter(fn) { return wrap(nodes.filter((n, i) => fn.call(n, i, n))); },
    ajaxError() { return this; },
  });
  const $ = (sel) => (sel === window.document ? wrap([]) : wrap([...window.document.querySelectorAll(sel)]));
  $.active = 0;
  $.on = (sel, ev, fn) => handlers.push({ sel, ev, fn });
  // 사이트의 원래 알림창. frameRun 이 덮어쓰지 않으면 이것이 불린다 — 불리면 가로채기에 실패한 것이다.
  $.alert = () => { throw new Error('사이트 알림창이 그대로 떴다'); };
  $.confirm = () => { throw new Error('사이트 확인창이 그대로 떴다'); };
  window.jQuery = $;
  const calls = [];
  Object.assign(window, site($, calls, window));
  globalThis.window = window;
  for (const g of ['document', 'location', 'getComputedStyle', 'atob', 'File']) globalThis[g] = window[g];
  return { window, calls, $ };
}

const FORM = '<select id="biztripKind"><option value=""></option><option value="OD">외근</option></select>'
  + '<input id="biztripContent"><input id="totalHours"><input name="docNo" id="docNo">';
const JOB = {
  ops: [{ op: 'set', sel: '#biztripKind', value: 'OD', label: '근태종류', events: ['change'] },
    { op: 'set', sel: '#biztripContent', value: '과제 협의', label: '내용', events: ['input', 'change'] }],
  expect: [{ sel: '#biztripKind', value: 'OD', label: '근태종류' }, { sel: '#biztripContent', value: '과제 협의', label: '내용' }],
  read: { totalHours: '#totalHours' }, action: 'save', fn: 'saveTrav100', timeoutMs: 3000,
};
/** 사람이 저장 버튼을 누른 것과 같은 길: 확인 → (확인 누름) → 저장 → 알림. */
const goodSite = ($, calls, window) => ({
  saveTrav100() {
    calls.push('save');
    $.confirm('<span>저장 하시겠습니까?</span>', '알림', () => {
      window.document.querySelector('#docNo').value = '202610-11115-0001';
      $.alert('<span class="icon"></span><span>저장 되었습니다.</span>', '알림', () => calls.push('closed'));
    });
  },
});

console.log('값 넣기와 누르기');
await ta('넣은 값이 맞으면 사이트 함수를 부르고, "저장 되었습니다" 를 봐야 성공이다', async () => {
  const { calls } = page(FORM, goodSite);
  const r = await injected.frameRun(JOB);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(calls, ['save', 'closed']);
  assert.equal(r.docNo, '202610-11115-0001');
  assert.equal(r.message, '저장 되었습니다.');
  assert.deepEqual(r.dialogs.map((d) => d.kind), ['confirm', 'alert']);
});
await ta('사이트가 값을 되돌려 놓았으면(초기화) 누르지 않는다', async () => {
  const { calls, $ } = page(FORM, goodSite);
  // 값을 넣자마자 사이트가 지운다 — 넣는 순서가 뒤집혔을 때 생기는 일을 흉내 낸다.
  $.on('#biztripContent', 'change', function () { this.value = ''; });
  const r = await injected.frameRun(JOB);
  assert.equal(r.ok, false);
  assert.deepEqual(calls, [], '빈 내용으로 저장 함수를 불렀다');
  assert.match(r.errors[0], /내용: 과제 협의 이어야 하는데 빈칸/);
  assert.equal(r.stage, 'check');
});
await ta('목록에 없는 선택지는 들어가지 않은 것으로 잡힌다', async () => {
  const { calls } = page(FORM, goodSite);
  const r = await injected.frameRun({ ...JOB, ops: [{ ...JOB.ops[0], value: 'ZZ' }, JOB.ops[1]], expect: [{ sel: '#biztripKind', value: 'ZZ', label: '근태종류' }] });
  assert.equal(r.ok, false);
  assert.deepEqual(calls, []);
});
await ta('합계시간은 숫자로 견준다 — 사이트가 2.00 이라 적어도 2 와 같고, 비어 있으면 누르지 않는다', async () => {
  const expect = [...JOB.expect, { sel: '#totalHours', num: 2, label: '합계시간' }];
  const a = page(FORM, goodSite);
  a.window.document.querySelector('#totalHours').value = '2.00';
  assert.equal((await injected.frameRun({ ...JOB, expect })).ok, true);
  const b = page(FORM, goodSite);
  const bad = await injected.frameRun({ ...JOB, expect });
  assert.equal(bad.ok, false);
  assert.deepEqual(b.calls, [], '합계시간이 비었는데 저장 함수를 불렀다 — 날짜·시각이 안 들어간 신호다');
});
await ta('유연근무 주간: 기간구분을 바꾸면 사이트가 근무시간표를 읽어 요일 칸을 덮는다 — 그 답이 온 뒤에 넣는다', async () => {
  const week = '<select id="dayGbn"><option value="DA">Daily</option><option value="WE">Weekly</option></select>'
    + '<select id="monTime"><option value=""></option><option value="1">07:00</option><option value="3">08:30</option></select>'
    + '<select id="tueTime"><option value=""></option><option value="3">08:30</option><option value="4">09:00</option></select><input name="docNo">';
  const { window, $ } = page(week, goodSite);
  // Weekly 를 고르면 요청이 나가고(1.2초), 답이 오면 지금 근무시간(08:30)이 칸에 들어간다.
  $.on('#dayGbn', 'change', () => {
    $.active = 1;
    setTimeout(() => {
      for (const id of ['monTime', 'tueTime']) window.document.querySelector(`#${id}`).value = '3';
      $.active = 0;
    }, 1200);
  });
  const set = (sel, value, label) => ({ op: 'set', sel, value, label, events: ['change'] });
  const r = await injected.frameRun({
    ops: [set('#dayGbn', 'WE', '기간구분'), { op: 'idle', ms: 100 }, set('#monTime', '1', '월요일 출근시간'), set('#tueTime', '4', '화요일 출근시간')],
    expect: [{ sel: '#dayGbn', value: 'WE', label: '기간구분' }, { sel: '#monTime', value: '1', label: '월요일 출근시간' }, { sel: '#tueTime', value: '4', label: '화요일 출근시간' }],
    read: { monTime: '#monTime', tueTime: '#tueTime' }, action: 'none', fn: null,
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  await new Promise((done) => setTimeout(done, 1300));
  assert.deepEqual([window.document.querySelector('#monTime').value, window.document.querySelector('#tueTime').value], ['1', '4'], '사이트의 답이 뒤늦게 와서 넣은 값을 덮었다');
});
await ta('화요일 칸에 없는 07:00 은 들어가지 않은 것으로 잡힌다', async () => {
  const { calls } = page('<select id="tueTime"><option value=""></option><option value="4">09:00</option></select><input name="docNo">', goodSite);
  const r = await injected.frameRun({ ...JOB, ops: [{ op: 'set', sel: '#tueTime', value: '1', label: '화요일 출근시간', events: ['change'] }],
    expect: [{ sel: '#tueTime', value: '1', label: '화요일 출근시간' }], read: {} });
  assert.equal(r.ok, false);
  assert.deepEqual(calls, []);
  assert.match(r.errors[0], /화요일 출근시간: 1 이어야 하는데/);
});
await ta('칸을 못 찾으면 누르지 않는다', async () => {
  const { calls } = page('<input name="docNo">', goodSite);
  const r = await injected.frameRun(JOB);
  assert.equal(r.ok, false);
  assert.deepEqual(calls, []);
  assert.match(r.errors.join(' '), /칸을 찾지 못했습니다/);
});

console.log('사이트가 하는 말');
await ta('검증 알림(내용을 입력해주세요)이면 실패이고 그 문구를 돌려준다', async () => {
  page(FORM, ($) => ({ saveTrav100() { $.alert('내용을 입력해주세요.', '알림', null, { buttonText: '확인' }); return false; } }));
  const r = await injected.frameRun(JOB);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'done');
  assert.equal(r.message, '내용을 입력해주세요.');
});
await ta('모르는 확인창(결재선을 확인해주세요)에는 답하지 않고 멈춘다', async () => {
  let opened = false;
  page(FORM, ($) => ({ apprRequest() { $.confirm('결재선을 확인해주세요.', '알림', () => { opened = true; }); } }));
  const r = await injected.frameRun({ ...JOB, action: 'request', fn: 'apprRequest' });
  assert.equal(r.ok, false);
  assert.equal(opened, false, '결재선 설정 창을 열어 버렸다');
  assert.deepEqual(r.dialogs[0], { kind: 'confirm', text: '결재선을 확인해주세요.', accepted: false });
});
await ta('결재요청은 "결재 요청되었습니다" 가 떠야 성공이다', async () => {
  page(FORM, ($) => ({ apprRequest() { $.confirm('결재요청 하시겠습니까?', '알림', () => $.alert('결재요청에 실패했습니다.', '알림', null)); } }));
  const bad = await injected.frameRun({ ...JOB, action: 'request', fn: 'apprRequest' });
  assert.equal(bad.ok, false);
  assert.equal(bad.message, '결재요청에 실패했습니다.');
  page(FORM, ($) => ({ apprRequest() { $.confirm('결재요청 하시겠습니까?', '알림', () => $.alert('결재 요청되었습니다.', '알림', null)); } }));
  assert.equal((await injected.frameRun({ ...JOB, action: 'request', fn: 'apprRequest' })).ok, true);
});
await ta('넣어 보기만 할 때(fn 없음)는 사이트 함수를 부르지 않는다', async () => {
  const { calls } = page(FORM, goodSite);
  const r = await injected.frameRun({ ...JOB, action: 'none', fn: null });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, []);
});
await ta('사이트 함수가 없으면 실패로 끝난다(조용히 넘어가지 않는다)', async () => {
  page(FORM, () => ({}));
  const r = await injected.frameRun(JOB);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /saveTrav100/);
});

console.log('회수');
const RECALL = { ops: [], expect: [], read: {}, action: 'recall', fn: 'apprReqCancel', timeoutMs: 2000 };
await ta('회수 버튼이 안 보이는 문서는 회수하지 않는다', async () => {
  const { calls } = page(`${FORM}<button id="btnApprReqCancel" style="display:none">회수</button>`,
    ($, c) => ({ apprReqCancel() { c.push('recall'); } }));
  const r = await injected.frameRun(RECALL);
  assert.equal(r.ok, false);
  assert.deepEqual(calls, []);
  assert.match(r.errors[0], /회수할 수 없는 상태/);
});
await ta('보이면 회수하고 "회수되었습니다" 를 기다린다', async () => {
  page(`${FORM}<button id="btnApprReqCancel">회수</button>`,
    ($) => ({ apprReqCancel() { $.confirm('회수 하시겠습니까?', '알림', () => $.alert('회수되었습니다.', '알림', null)); } }));
  assert.equal((await injected.frameRun(RECALL)).ok, true);
});

console.log('문서를 HR 웹 화면에서 열기');
{
  const DOC = { pgmId: '1102', pgmUrlAd: '/uhr/docappr/apprholi100/view', param: { docNo: '202610-11115-0001', emplNo: '11115', statusCode: '3' } };
  /** 탭 열기 함수를 가진 안쪽 화면(메인페이지)을 흉내 낸다. */
  const arm = (w, calls, tabData = '({menuId:"22",pgmId:"1102"})') => Object.assign(w, {
    $_key: 'k'.repeat(32),
    CryptoJS: { AES: { encrypt: (text, key) => { calls.push(['encrypt', text, key.length]); return { toString: () => 'CIPHER' }; } } },
    getMdiData: async (pgmId, url) => { calls.push(['tabopen', pgmId, url]); return tabData; },
    pageMdiOnLoad_new: (data, url) => { calls.push(['open', data, url]); },
  });
  await ta('안쪽 화면의 탭 열기 함수를 부른다 — 껍데기의 같은 함수는 탭 줄에 못 붙이므로 쓰지 않는다', async () => {
    const { window } = page('<iframe name="mainframe"></iframe><iframe name="mainframe"></iframe>');
    const calls = [];
    arm(window, calls);   // 껍데기에도 같은 이름의 함수가 있다
    const inner = [];
    arm(window.document.querySelectorAll('iframe')[1].contentWindow, inner);
    const r = await injected.pageOpenDoc(DOC);
    assert.deepEqual(r, { ready: true, opened: true });
    assert.deepEqual(calls, [], '껍데기의 함수를 불렀다');
    assert.deepEqual(inner, [
      ['encrypt', JSON.stringify(DOC.param), 32],
      ['tabopen', '1102', '/uhr/docappr/apprholi100/view'],
      ['open', '({menuId:"22",pgmId:"1102"})', `/uhr/docappr/apprholi100/view?mdiparam=${window.btoa('CIPHER')}`],
    ]);
  });
  await ta('탭 열기 함수를 가진 화면이 아직 없으면 준비되지 않았다고 답한다 (부르는 쪽이 다시 묻는다)', async () => {
    const { window } = page('<iframe name="mainframe"></iframe>');
    arm(window, []);
    assert.deepEqual(await injected.pageOpenDoc(DOC), { ready: false });
  });
  await ta('HR 이 그 화면의 탭 정보를 주지 않으면 열지 않았다고 답한다', async () => {
    const { window } = page('<iframe name="mainframe"></iframe>');
    const inner = [];
    arm(window.document.querySelector('iframe').contentWindow, inner, '');
    assert.deepEqual(await injected.pageOpenDoc(DOC), { ready: true, opened: false });
    assert.equal(inner.some((c) => c[0] === 'open'), false);
  });
}

console.log('껍데기와 숨은 프레임');
await ta('폼 프레임은 화면 밖에 달고, 보이는 mainframe 은 건드리지 않는다', async () => {
  const { window } = page('<iframe name="mainframe" src="about:blank"></iframe>');
  injected.pageMount('krsws-1', 'about:blank');
  const frames = [...window.document.querySelectorAll('iframe')];
  assert.equal(frames.length, 2);
  assert.equal(frames[0].name, 'mainframe');
  assert.equal(frames[1].name, 'krsws-1');
  assert.match(frames[1].style.cssText, /left: -20000px/);
  assert.doesNotMatch(frames[1].style.cssText, /display: none/, 'display:none 이면 사이트의 표가 크기를 못 잡는다');
  injected.pageMount('krsws-2', 'about:blank');
  assert.equal(window.document.querySelectorAll('iframe[data-krsws]').length, 1, '앞의 프레임이 남아 있다');
  injected.pageUnmount();
  assert.equal(window.document.querySelectorAll('iframe').length, 1);
});
await ta('준비 확인은 이름이 맞는 프레임만 답하고, 요청이 도는 중이면 아직이라고 한다', async () => {
  const { window } = page(FORM, goodSite);
  assert.equal(injected.frameProbe('krsws-x', {}), null);
  window.name = 'krsws-x';
  Object.defineProperty(window.document, 'readyState', { value: 'complete', configurable: true });
  assert.equal(injected.frameProbe('krsws-x', { sel: '#biztripKind', fn: 'saveTrav100' }).ready, true);
  assert.equal(injected.frameProbe('krsws-x', { sel: '#biztripKind', fn: 'saveEtc100' }).ready, false);
  window.jQuery.active = 1;
  assert.equal(injected.frameProbe('krsws-x', { sel: '#biztripKind', fn: 'saveTrav100' }).ready, false);
});
await ta('SSO 주소는 eclass 홈의 HR 링크와 같다', async () =>
  assert.equal(HR_SSO_URL, 'https://eclass.krs.co.kr/eClassVer4/External/SSOMessage'));

console.log(`\n통과 ${pass}건`);
