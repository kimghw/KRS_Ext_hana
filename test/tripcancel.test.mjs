// 출장 취소 — 결재가 끝난 출장에 취소신청을 올리면 여비계산서를 사전정산까지 지우고, 그 근태는 취소신청서가 결재될 때까지
// "취소 중"이다(2026-10-07 사용자 지정: "출장 취소 하면 여비계산 내용은 사전정산까지 제거 하고 취소 중 이라고 근태 상태를 알리고 조회해야지").
//
// 못 박는 것: 계산서 화면의 삭제 폼(CalPrint/Delete — seq·요청 확인 토큰)만 그대로 보낸다, 보낸 뒤 목록으로 사라졌는지 확인한다,
// 다른 출장자가 있거나 사후정산까지 끝난 계산서는 지우지 않는다, 취소신청을 올린 줄의 상태 딱지가 "취소 중"이 되고 변경·취소신청
// 버튼과 여비계산서 칸이 걷힌다, 홈·현황 카드(plansToShow)도 같은 기록으로 "취소 중"을 적는다, 취소가 결재되면 기록이 걷힌다.
// HR 과 eclass 는 흉내 낸다 — **실제 사이트에는 아무것도 보내지 않는다.**
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok, what) => {
  for (let i = 0; i < 320 && !ok(); i++) await wait(25);
  assert.ok(ok(), `기다렸지만 되지 않았다: ${what}`);
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };

const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const { window } = new JSDOM(html, { url: 'https://example.org/' });
const doc = window.document;
for (const g of ['document', 'DOMParser', 'FileReader', 'Element', 'HTMLElement', 'HTMLInputElement']) globalThis[g] = window[g];
globalThis.window = window;

/* ------------------------------------------------------------ 가짜 HR 문서함과 eclass 여비계산서 */

const HR = 'https://hr.krs.co.kr';
const FROM = plus(7);
const TO = plus(8);
const hrRowsBase = {
  docNo: 'T-1', statusCode: '5', statusName: '결재완료', formId: 'TR', formName: '출장신청서', workCodeKindName: '국내출장',
  startDate: FROM.replace(/-/g, ''), endDate: TO.replace(/-/g, ''), startTime: '0700', endTime: '2000', wrkGubunName: '시간',
  reqRsn: 'sscb 과제 진도점검', reqstDate: `${plus(-3)} 09:00:00`, pgmUrlAd: '/uhr/docappr/apprtrav100/view',
};
const hrRows = [{ ...hrRowsBase }];
// 여비계산서: 번호 → { 출장기간, 사전·사후정산, 출장자 }
const fresh = () => ({ 146546: { pre: '작성', post: '대기', from: FROM, to: TO, travelers: [['', '김거화']] } });
const site = { docs: fresh(), deletes: [], jobs: [], formSeq: null, noCancel: false, refReads: [], refOf: '' };
const LIST = () => `<div class="bt-topmenu"><span class="bt-user"> 김거화 (kimghw) / KOR | ENG </span></div><table id="mainList"><tbody>${
  Object.entries(site.docs).map(([seq, d]) => `<tr><td data-href="/BusinessTrip/Write?seq=${seq}&amp;mode=E">${seq}</td><td>${d.travelers[0][1]}</td>`
    + `<td data-href=""> </td><td><span>${d.pre}</span></td><td><span>${d.post}</span></td><td>${d.from}~${d.to}</td><td>세종</td>`
    + `<td>김거화</td><td>${plus(-3)}</td></tr>`
    // 출장자가 여럿이면 둘째 사람부터는 그 아래 줄(이름·번호·사후정산)이다.
    + d.travelers.slice(1).map(([, name]) => `<tr><td>${name}</td><td> </td><td><span>${d.post}</span></td></tr>`).join('')).join('')}</tbody></table>`;
const CAL = (seq) => `<div class="bt-content"><select id="drtraveler">${site.docs[seq].travelers.map(([id, name], i) =>
  `<option value="${id}"${i ? '' : ' selected="selected"'}>${name}</option>`).join('')}</select>
<form method="post" style="display:inline" onsubmit="return confirm('확정하시겠습니까?');" action="/BusinessTrip/CalPrint/Confirm">
<input type="hidden" name="seq" value="${seq}" /><input type="hidden" name="trseq" value="1" /><input name="__RequestVerificationToken" type="hidden" value="tok-confirm" /></form>
<form method="post" style="display:inline" action="/BusinessTrip/CalPrint/Delete"><input type="hidden" name="seq" value="${site.formSeq || seq}" /><button type="submit" class="bt-btn sub">삭제</button>
<input name="__RequestVerificationToken" type="hidden" value="tok-delete" /></form>
<div class="bt-steps"><div class="bt-step active"><div class="lbl">사전정산&#xA;작성</div></div></div></div>`;
const page = (body) => new Response(`<html><body>${body}${' '.repeat(1600)}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

const store = { attendKind: 'trip', attendView: 'all' };
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
      if (func.name === 'frameProbe') return [{ frameId: 1, result: { ready: true } }];
      if (func.name === 'frameRun') {
        site.jobs.push(args[0]);
        // 이미 취소신청이 걸린 건은 "취소 문서 선택" 목록에 없다 — cancelRow 가 던진 것을 흉내 낸다.
        if (site.noCancel) return [{ result: { ok: false, errors: [`취소할 수 있는 결재완료 문서 목록에 ${args[0].ops[0].docNo} 이(가) 없습니다.`], dialogs: [], read: {}, stage: 'fill' } }];
        return [{ result: { ok: true, errors: [], dialogs: [], read: { cancelRows: 1 }, docNo: 'CN-1', stage: 'done' } }];
      }
      if (func.name !== 'pageFetch') return [{ result: null }];
      // 취소신청서의 내용(문서 조회) — 취소 문서 표의 줄이 원 문서번호(befDocNo)를 든다.
      if (String(args[0]).startsWith('/uhr/docappr/apprcncltrav100?')) {
        site.refReads.push(args[0]);
        return [{ result: { status: 200, url: '', text: JSON.stringify([{ docNo: 'CN-H', befDocNo: site.refOf, cnclRsn: '일정변경' }]) } }];
      }
      if (args[0] === '/api/user') return [{ result: { status: 200, url: '', text: JSON.stringify({ loginUserId: '11115', loginUserNm: '김거화' }) } }];
      return [{ result: { status: 200, url: '', text: JSON.stringify(hrRows) } }];
    },
  },
};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('http://localhost:5003')) throw new TypeError('Failed to fetch');
  if (init.method === 'POST') {
    if (!u.endsWith('/BusinessTrip/CalPrint/Delete')) throw new Error('모르는 쓰기 주소 ' + u);
    const body = new URLSearchParams(init.body);
    site.deletes.push(String(init.body));
    delete site.docs[body.get('seq')];
    return page('ok');
  }
  if (u.includes('/BusinessTrip/Home/List')) return page(LIST());
  if (u.includes('/BusinessTrip/CalPrint?')) return page(CAL(new URL(u).searchParams.get('seq')));
  if (u.includes('/BusinessTrip/')) return page('');
  return page('home');   // 포털 로그인 확인
};

/* ------------------------------------------------------------ 순수 로직 */

const { listItems, listItem, cancellingOf, pruneCancelling, plansIn, isCancelDoc, linkCancel, CANCELLING_KEY, STATUS } = await import('../src/attend.js');
const { cancelRefsOf } = await import('../src/hr.js');
const { plansToShow } = await import('../src/plans.js');
const { tripDelete } = await import('../src/trip.js');
const { parseTripList } = await import('../src/travel.js');
const rowOf = (seq) => parseTripList(new JSDOM(LIST()).window.document).find((r) => r.seq === String(seq));

console.log('취소 중 판정');
const items = listItems(hrRows);
const cancelRow = (over = {}) => ({ docNo: 'CN-1', statusCode: '3', statusName: '결재요청', formId: 'TRC', formName: '출장 취소신청서',
  reqstDate: `${plus(0)} 10:00:00`, pgmUrlAd: '/uhr/docappr/apprcncltrav100/view', ...over });
t('패널이 적어 둔 기록이 있고 아직 결재완료인 건이 취소 중(pending)이다. 기록이 없으면 아니다', () => {
  assert.deepEqual([...cancellingOf(items, { 'T-1': { at: Date.now() } })], [['T-1', 'pending']]);
  assert.deepEqual([...cancellingOf(items, {})], []);
  assert.deepEqual([...cancellingOf(items, null)], []);
});
t('HR 목록의 취소신청서를 알아본다 — 취소신청 화면(apprcncl…)이거나 이름에 "취소"가 든 패널이 모르는 신청서', () => {
  assert.equal(isCancelDoc(listItem(cancelRow())), true);
  assert.equal(isCancelDoc(listItem(cancelRow({ pgmUrlAd: '', formName: '휴가 취소신청서' }))), true);
  assert.equal(isCancelDoc(items[0]), false);
});
t('이은 취소신청서의 결재 상태로 가린다 — 결재요청이면 취소 중, 결재완료면 취소(done), 반려·회수면 아무것도 아니다', () => {
  const kept = { 'T-1': { at: Date.now(), cancelDocNo: 'CN-1' } };
  const with_ = (statusCode) => listItems([...hrRows, cancelRow({ statusCode })]);
  assert.equal(cancellingOf(with_('3'), kept).get('T-1'), 'pending');
  assert.equal(cancellingOf(with_('5'), kept).get('T-1'), 'done');
  assert.equal(cancellingOf(with_('4'), kept).get('T-1'), undefined);
  assert.deepEqual(Object.keys(pruneCancelling(kept, with_('6'))), [], '회수된 취소신청서의 기록은 걷는다');
});
t('목록의 취소신청서가 원 문서번호(befDocNo)를 직접 들고 있으면 기록이 없어도 잇는다', () => {
  assert.deepEqual([...cancellingOf(listItems([...hrRows, cancelRow({ statusCode: '5', befDocNo: 'T-1' })]), {})], [['T-1', 'done']]);
});
t('취소신청서 내용에서 원 문서번호를 모은다 — befDocNo 칸, 없으면 문서번호 모양의 값(자기 번호는 뺀다)', () => {
  assert.deepEqual(cancelRefsOf([{ docNo: 'CN-1', befDocNo: '202610-11115-0002', cnclRsn: '일정변경' }], 'CN-1'), ['202610-11115-0002']);
  assert.deepEqual(cancelRefsOf({ master: { docNo: '202610-11115-0009' }, grid: [{ someNo: '202610-11115-0002' }] }, '202610-11115-0009'), ['202610-11115-0002']);
  assert.deepEqual(cancelRefsOf([], 'CN-1'), []);
  assert.deepEqual(linkCancel({ 'T-1': { at: 5, cancelDocNo: '' } }, 'CN-1', ['T-1', 'T-2'], 9), { 'T-1': { at: 5, cancelDocNo: 'CN-1' }, 'T-2': { at: 9, cancelDocNo: 'CN-1' } });
});
t('원 문서가 결재완료가 아니게 되면 기록을 걷는다. 목록에 없는 것은 남기되 오래된 것은 걷는다', () => {
  const now = Date.now();
  const kept = { 'T-1': { at: now }, 'X-9': { at: now }, 'OLD': { at: now - 400 * 86400000 } };
  assert.deepEqual(Object.keys(pruneCancelling(kept, items, now)), ['T-1', 'X-9']);
  assert.deepEqual(Object.keys(pruneCancelling(kept, listItems([{ ...hrRows[0], statusCode: STATUS.RECALLED }]), now)), ['X-9']);
});
t('현황·홈 카드: 취소 중이면 상태가 "취소 중", 취소가 결재됐으면 일정에서 빠진다 (plansIn · plansToShow)', () => {
  assert.equal(plansIn(items, plus(0), plus(30))[0].state, '승인');
  const p = plansIn(items, plus(0), plus(30), new Map([['T-1', 'pending']]))[0];
  assert.deepEqual([p.state, p.cancelling], ['취소 중', true]);
  assert.deepEqual(plansIn(items, plus(0), plus(30), new Map([['T-1', 'done']])), []);
  assert.equal(plansToShow(items, plus(0), plus(30), { cancelling: { 'T-1': { at: Date.now() } } })[0].state, '취소 중');
  const done = listItems([...hrRows, cancelRow({ statusCode: '5' })]);
  assert.deepEqual(plansToShow(done, plus(0), plus(30), { cancelling: { 'T-1': { at: Date.now(), cancelDocNo: 'CN-1' } } }), []);
});

console.log('여비계산서 삭제');
await ta('다른 출장자가 함께 있는 계산서는 지우지 않는다 (아무것도 보내지 않는다)', async () => {
  site.docs[146546].travelers = [['', '김거화'], ['', '홍길동']];
  await assert.rejects(tripDelete(rowOf(146546), { name: '김거화' }), /다른 출장자\(홍길동\)가 있어 지우지 않았습니다/);
  assert.equal(site.deletes.length, 0);
  site.docs = fresh();
});
await ta('사후정산까지 끝난 계산서는 지우지 않는다', async () => {
  Object.assign(site.docs[146546], { pre: '완료', post: '완료' });
  await assert.rejects(tripDelete(rowOf(146546), { name: '김거화' }), /사후정산까지 끝나 지우지 않았습니다/);
  assert.equal(site.deletes.length, 0);
  site.docs = fresh();
});
await ta('삭제 폼이 다른 계산서의 것이면 보내지 않는다', async () => {
  site.formSeq = '999999';
  await assert.rejects(tripDelete(rowOf(146546), { name: '김거화' }), /삭제 폼이 이 계산서의 것이 아니어서 보내지 않았습니다/);
  assert.equal(site.deletes.length, 0);
  site.formSeq = null;
});

/* ------------------------------------------------------------ 패널 */

const { createAttendPanel } = await import('../attendpanel.js');
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logs = [];
const panel = createAttendPanel({
  $: (id) => doc.getElementById(id), escapeHtml, logEvent: (kind, ok, text) => logs.push({ kind, ok, text }), ai: () => ({ apiKey: '', cli: false }),
  evidence: { list: async () => [], keep: async () => {}, remove: async () => {} },
});
panel.wire();
const st = panel.state;
const li = () => doc.querySelector('#atList > li');
const btn = (act) => li().querySelector(`button[data-act="${act}"]`);

console.log('출장 취소신청');
await panel.show();
await until(() => st.trips?.rows && li(), '근태와 여비계산서 목록');
li().querySelector('.at-head').click();
await until(() => btn('cancel'), '펴진 출장 카드');
await ta('취소 전: 상태 딱지는 승인, 정산 딱지와 여비계산서 줄이 있다', async () => {
  assert.equal(li().querySelector('.at-st').textContent, '승인');
  assert.equal(li().querySelector('.at-trip').textContent, '사전정산 중');
  assert.match(li().querySelector('.at-tripline').textContent, /여비계산서 146546 · 사전정산 작성/);
});
btn('cancel').click();
li().querySelector('#atCancelReason').value = '출장 일정 취소';
btn('cancel-go').click();
assert.equal(site.jobs.length, 0, '한 번 누르면 아직 나가지 않는다');
btn('cancel-go').click();
await until(() => site.deletes.length === 1 && !st.busy, '취소신청과 계산서 삭제');
await ta('취소신청서를 올린 뒤 계산서 화면의 삭제 폼을 그대로 보내고, 목록에서 사라진 것을 확인한다', async () => {
  assert.equal(site.jobs[0].ops[0].op, 'cancelRow');
  assert.equal(site.jobs[0].ops[0].reason, '출장 일정 취소');
  assert.deepEqual(site.deletes, ['seq=146546&__RequestVerificationToken=tok-delete']);
  assert.equal(site.docs[146546], undefined);
  assert.match(doc.getElementById('atStatus').textContent, /취소신청했습니다 — .*여비계산서 146546\(사전정산\)를 지웠습니다/);
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && /여비계산서 삭제\(출장 취소\): 146546/.test(l.text)));
});
await ta('그 줄의 상태가 "취소 중"이 되고, 변경·취소신청 버튼과 정산 딱지·사후정산·송부 칸이 걷힌다', async () => {
  assert.deepEqual(Object.keys(store[CANCELLING_KEY]), ['T-1']);
  assert.equal(store[CANCELLING_KEY]['T-1'].cancelDocNo, 'CN-1');
  if (!li().classList.contains('open')) li().querySelector('.at-head').click();
  await until(() => li().classList.contains('open'), '펴진 카드');
  assert.equal(li().querySelector('.at-st').textContent, '취소 중');
  assert.ok(li().classList.contains('cancelling'));
  assert.equal(li().querySelector('.at-trip'), null);
  assert.equal(btn('cancel'), null);
  assert.equal(btn('change'), null);
  assert.equal(li().querySelector('.at-send'), null);
  assert.match(li().querySelector('.at-tripline').textContent, /^취소신청 결재 대기 — 여비계산서 없음$/);
});
await ta('취소가 결재돼 원 문서가 결재완료가 아니게 되면 다시 읽을 때 기록이 걷힌다', async () => {
  hrRows[0].statusCode = '6';
  hrRows[0].statusName = '회수';
  await panel.reload();
  assert.deepEqual(store[CANCELLING_KEY], {});
});

console.log('HR 에서 직접 취소한 출장 — 목록의 취소신청서를 읽어 원 문서에 잇는다');
await ta('결재완료된 취소신청서가 목록에 있으면 그 내용을 읽어 원 출장을 "취소"로 보이고, 남은 여비계산서를 지우는 버튼이 선다', async () => {
  // 결재완료 출장 T-2 와 그 계산서, HR 에서 올려 결재까지 끝난 취소신청서 CN-H.
  hrRows.length = 0;
  hrRows.push({ ...hrRowsBase, docNo: 'T-2' }, { docNo: 'CN-H', statusCode: '5', statusName: '결재완료', formId: 'TRC', formName: '출장 취소신청서',
    reqstDate: `${plus(0)} 10:00:00`, pgmUrlAd: '/uhr/docappr/apprcncltrav100/view' });
  site.docs = fresh();
  site.refOf = 'T-2';
  st.openDoc = null;
  await panel.reload();
  await until(() => store[CANCELLING_KEY]?.['T-2']?.cancelDocNo === 'CN-H', '취소신청서를 원 출장에 이음');
  assert.equal(site.refReads.length, 1);
  await until(() => st.trips?.rows?.length === 1, '여비계산서 목록');
  li().querySelector('.at-head').click();
  await until(() => li().classList.contains('open'), '펴진 카드');
  assert.equal(li().querySelector('.at-st').textContent, '취소');
  assert.ok(li().classList.contains('cancelled'));
  assert.equal(btn('cancel'), null);
  assert.match(li().querySelector('.at-tripline').textContent, /^취소신청 결재완료 — 여비계산서 146546\(사전정산 작성\)이 남아 있습니다/);
  assert.equal(plansToShow(st.all, plus(0), plus(30), { cancelling: store[CANCELLING_KEY] }).length, 0, '홈·현황에서 빠진다');
});
await ta('`여비계산서 지우기`는 두 번 눌러야 나가고, 지운 뒤 줄이 "여비계산서 없음"이 된다', async () => {
  const n = site.deletes.length;
  btn('trip-drop').click();
  assert.equal(site.deletes.length, n, '한 번 누르면 나가지 않는다');
  btn('trip-drop').click();
  await until(() => site.deletes.length === n + 1 && !st.busy, '계산서 삭제');
  assert.equal(site.deletes.at(-1), 'seq=146546&__RequestVerificationToken=tok-delete');
  await until(() => /여비계산서 없음$/.test(li().querySelector('.at-tripline')?.textContent || ''), '줄이 바뀜');
  await panel.reload();
  assert.equal(site.refReads.length, 1, '이미 이은 취소신청서는 다시 읽지 않는다');
});

console.log('이미 취소신청이 걸린 출장에 취소신청을 누르면');
await ta('"취소할 수 있는 문서 목록에 없다"로 실패해도 실패로 끝내지 않는다 — 취소 중으로 적고 여비계산서를 지운다', async () => {
  hrRows.length = 0;
  hrRows.push({ ...hrRowsBase, docNo: 'T-3' });
  site.docs = fresh();
  site.noCancel = true;
  st.openDoc = null;
  await panel.reload();
  await until(() => st.trips?.rows?.length === 1, '여비계산서 목록');
  li().querySelector('.at-head').click();
  await until(() => btn('cancel'), '펴진 출장 카드');
  btn('cancel').click();
  li().querySelector('#atCancelReason').value = '일정변경';
  const n = site.deletes.length;
  btn('cancel-go').click();
  btn('cancel-go').click();
  await until(() => site.deletes.length === n + 1 && !st.busy, '계산서 삭제');
  assert.ok(store[CANCELLING_KEY]['T-3']);
  assert.match(doc.getElementById('atStatus').textContent, /^이미 취소신청이 올라가 있는 건입니다 — .* · 여비계산서 146546\(사전정산\)를 지웠습니다$/);
  if (!li().classList.contains('open')) li().querySelector('.at-head').click();
  await until(() => li().querySelector('.at-st').textContent === '취소 중', '취소 중 딱지');
  site.noCancel = false;
});

console.log(`\n통과 ${pass}건`);
process.exit(0);
