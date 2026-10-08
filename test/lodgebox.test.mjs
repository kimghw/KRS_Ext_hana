// 신청 내역 출장 카드의 숙박비 내역(lodgebox.js) — 사후정산 입력 화면에 지금 있는 숙박 줄을 전부 보이고, 지우고, 다시 읽는다.
//
// 이 패널이 증빙으로 올린 줄과 화면에서 손수 적은 줄을 가려 적는다(2026-10-03 사용자 지정). 패널을 진짜 화면(sidepanel.html)에 붙여
// 눌러 본다. HR 은 닿지 않는 환경이라 신청 내역은 상태에 직접 앉히고, eclass 사후정산 입력 화면은 2026-10-03 실제 화면의 숙박 줄 모양
// (칸 차례·숨은 칸·지움 표시)을 그대로 흉내 낸다 — **실제 사이트에는 아무것도 보내지 않는다.**
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, what, ms = 10000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`기다리다 시간이 다 됐습니다 — ${what}`);
    await wait(10);
  }
};

const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const { window } = new JSDOM(html, { url: 'https://example.org/' });
const doc = window.document;
for (const g of ['document', 'DOMParser', 'FileReader', 'Element', 'HTMLElement', 'HTMLInputElement']) globalThis[g] = window[g];
globalThis.window = window;

const store = { attendLodgeMine: { 143884: { 81560: '호텔영수증.pdf' }, 999: { 1: '남의것.png' } } };
globalThis.chrome = {
  storage: { local: { get: async () => store, set: async (obj) => { Object.assign(store, obj); } } },
  runtime: { sendNativeMessage: async () => { throw new Error('no host'); } },
  tabs: { query: async () => [], create: async () => {} },
  scripting: { executeScript: async () => [{ result: null }] },
};

/* ------------------------------------------------------------ 가짜 eclass 사후정산 입력 화면 */

const page = (body) => new Response(`<html><body>${body}${' '.repeat(1600)}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
// 화면의 차례 그대로(결제일 순 — 줄 번호 순이 아니다). 81559·81560 은 달러, 81558 은 원화다.
const LODGES = () => [
  { seq: '81559', paydate: '2026-08-18', sday: '1', company: 'Toyoko INN Gangnam Seoul', currency: 'USD', total: '88.46' },
  { seq: '81558', paydate: '2026-08-18', sday: '1', company: 'Toyoko INN Gangnam Seoul', currency: 'KRW', total: '125052' },
  { seq: '81560', paydate: '2026-08-19', sday: '1', company: '부산 <해운대> 호텔', currency: 'USD', total: '68.46' },
];
// maxes 는 상한액 조회(CalMaxLodge)를 받은 횟수다 — 화면의 숨은 칸에 상한이 없는 원화 줄이 있을 때만 온다.
const site = { lodges: LODGES(), gets: 0, maxes: 0, posts: [], obey: true, post: '작성' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const lodgeRow = (l) => `<tr><td><select name="lodge_nation"><option value="KR||" selected="selected">대한민국</option><option value="JP||">일본</option></select></td>
<td><input type="hidden" name="lodge_seq" value="${l.seq}" /><input type="hidden" name="lodge_del" value="0" /><input type="hidden" name="lodge_oldfile" value="" />
<input type="hidden" name="lodge_maxtotal" value="${l.maxtotal ?? '120000'}" /><input type="hidden" name="lodge_maxcur" value="KRW" /><input type="hidden" name="lodge_maxrate" value="0" />
<input type="hidden" name="lodge_maxconv" value="${l.maxconv ?? '0'}" /><input type="date" name="lodge_paydate" value="${l.paydate}" /></td>
<td><input type="text" name="lodge_sday" value="${l.sday}" /></td><td><input type="text" name="lodge_company" value="${esc(l.company)}" /></td>
<td><input type="text" name="lodge_companycode" value="" /></td>
<td><select name="lodge_currency"><option value="KRW"${l.currency === 'KRW' ? ' selected="selected"' : ''}>원(KRW)</option><option value="USD"${l.currency === 'USD' ? ' selected="selected"' : ''}>달러(USD)</option></select></td>
<td><input type="hidden" name="lodge_cocard" value="0" /><input type="checkbox" /></td><td><input type="text" name="lodge_total" value="${l.total}" /></td>
<td><input type="text" name="lodge_samount" value="${l.samount ?? '0'}" /></td><td><input type="text" name="lodge_vat" value="${l.vat ?? '0'}" /></td>
<td><textarea name="lodge_comment">${esc(l.comment ?? '')}</textarea></td><td><input type="text" name="lodge_etcname" value="" /></td>
<td><input type="file" name="lodge_file" /></td><td><button type="button" onclick="delRow(this)">×</button></td></tr>`;
const AFTER = () => `<form method="post" id="frm" enctype="multipart/form-data" action="/BusinessTrip/AfterTrip/Save">
<input type="hidden" name="seq" value="143884"><input type="hidden" name="trseq" value="156032">
<select name="air_abroad"><option value="N" selected="selected">N</option><option value="Y">Y</option></select>
<table id="lodgeTbl"><tbody id="lodgeBody">${site.lodges.map(lodgeRow).join('')}</tbody></table>
<table><tbody id="trBody"><tr><td><input type="hidden" name="tr_seq" value="501"/><input type="hidden" name="tr_del" value="0"/><input type="date" name="tr_date" value="2026-08-18"/></td></tr></tbody></table>
<input name="__RequestVerificationToken" type="hidden" value="tok"></form>`;
const LIST = () => `<div class="bt-topmenu"><span class="bt-user"> 김거화 (kimghw) / KOR | ENG </span></div><table id="mainList"><tbody><tr>
<td data-href="/BusinessTrip/Write?seq=143884&amp;mode=E">143884</td><td>김거화</td><td data-href="/BusinessTrip/CalPrint?seq=143884&amp;trseq=156032"> </td>
<td><span>완료</span></td><td><span>${site.post}</span></td><td>2026-08-18~2026-08-20</td><td>서울</td><td>김거화</td><td>2026-08-01</td></tr></tbody></table>
<div class="bt-pager"><div>전체 1건 · 1/1 페이지</div></div>`;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (init.method === 'POST') {
    if (!u.endsWith('/BusinessTrip/AfterTrip/Save')) throw new Error('모르는 저장 주소 ' + u);
    site.posts.push(init.body);
    // 화면의 저장과 같다 — 지움 표시(lodge_del = 1)가 된 줄이 없어지고, 나머지 줄은 보낸 정산금액·공급가액·부가세가 된다.
    // obey 가 아니면 사이트가 지우지도 바꾸지도 않은 것이다.
    const seqs = init.body.getAll('lodge_seq');
    const dels = init.body.getAll('lodge_del');
    const [totals, sams, vats, comments] = ['lodge_total', 'lodge_samount', 'lodge_vat', 'lodge_comment'].map((k) => init.body.getAll(k));
    if (site.obey) {
      site.lodges = site.lodges.filter((l) => dels[seqs.indexOf(l.seq)] !== '1')
        .map((l) => { const i = seqs.indexOf(l.seq); return i < 0 ? l : { ...l, total: totals[i], samount: sams[i], vat: vats[i], comment: comments[i] }; });
    }
    return page('ok');
  }
  if (u.includes('/Api/CalMaxLodge')) {
    site.maxes++;
    return new Response('<?xml version="1.0"?><REQUEST><NODE MAXAMT="120000" CURRENCY="KRW" RATE="1" MAXAMT_CUR="120000"/></REQUEST>', { status: 200 });
  }
  if (u.includes('/Home/List')) return page(LIST());
  if (u.includes('/BusinessTrip/AfterTrip?')) { site.gets++; return page(AFTER()); }
  throw new Error('모르는 주소 ' + u);
};

/* ------------------------------------------------------------ 패널 */

const { createAttendPanel } = await import('../attendpanel.js');
const { createEvidenceStore } = await import('../src/evidence.js');
const { tripAfterLodges } = await import('../src/trip.js');
const { lodgeAmount, lodgeSource, lodgeLogged, lodgeCapDay, lodgeCapState, lodgeCapTitle, lodgeReasonOf } = await import('../lodgebox.js');
const { LODGE_OVER_REASON } = await import('../src/after.js');
const REASON = LODGE_OVER_REASON;
const shelf = new Map();
const evidence = createEvidenceStore({ set: async (k, v) => { shelf.set(k, v); }, delete: async (k) => { shelf.delete(k); }, all: async () => [...shelf.values()] });
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logs = [];
const panel = createAttendPanel({
  $: (id) => doc.getElementById(id), escapeHtml,
  logEvent: (kind, ok, text) => logs.push({ kind, ok, text }), ai: () => ({ apiKey: '', cli: false }), evidence,
});
panel.wire();

const KTX = (seq, dep, arr, date) => ({ seq, trseq: '7380', revno: '', date, dep, arr, transport: 'Train', grade: '일반석', total: 53700, currency: 'KRW' });
const IT = { docNo: 'TR-9', formId: 'TR', status: '5', statusName: '결재완료', kindName: '국내출장', summary: '국내출장 8/18~8/20 07:00~20:00',
  reason: '기술 세미나', from: '2026-08-18', to: '2026-08-20', start: '07:00', end: '20:00', actions: [], web: false };
// 보관함에는 이 패널이 읽은 숙박 증빙(125,052원)이 있다 — 올릴 때 줄 번호를 적어 두기 전에 올린 줄이다.
await evidence.keep('TR-9', [{ name: 'image.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA', label: '숙박 증빙', summary: 'Toyoko INN 1박 125,052원', date: '2026-08-18', total: 125052 }]);
const st = panel.state;
Object.assign(st, {
  view: 'all', items: [IT], all: [IT], loadedOnce: true, openDoc: 'TR-9', workplace: '부산',
  trips: { rows: [{ seq: '143884', href: '/BusinessTrip/Write?seq=143884&mode=E', pre: '완료', from: '2026-08-18', to: '2026-08-20', location: '서울',
    writer: '김거화', written: '2026-08-01', travelers: [{ name: '김거화', post: '작성', trseq: '156032' }] }], me: '김거화' },
});
st.after['143884'] = { detail: { rows: [KTX('1', '부산', '서울', '2026-08-18'), KTX('2', '서울', '부산', '2026-08-20')], transports: ['Train', 'Train'] }, kept: await evidence.list('TR-9') };
await panel.reload();   // HR 에는 닿지 못한다 — 앉혀 둔 신청 내역이 그대로 그려진다

const box = () => doc.querySelector('#atList .at-lodges');
const lines = () => [...doc.querySelectorAll('#atList .at-lodge')].map((n) => ({
  seq: n.dataset.lodge, name: n.querySelector('.at-leg-name').textContent, company: n.querySelector('.at-lodge-company').textContent,
  tip: n.querySelector('.at-lodge-company').title, total: n.querySelector('.at-lodge-total').textContent,
  src: n.querySelector('.at-lodge-src').textContent, hand: n.querySelector('.at-lodge-src').classList.contains('hand'), srcTip: n.querySelector('.at-lodge-src').title,
  del: n.querySelector('button[data-act="lodge-del"]'), cap: n.querySelector('button[data-act="lodge-cap"]'), capNone: !!n.querySelector('.at-lodge-cap-none'),
}));
const status = () => doc.getElementById('atStatus').textContent;
await until(() => lines().length === 3, '숙박 줄 읽기');

console.log('사후정산 화면에 있는 숙박 줄을 전부 보인다');
t('세 줄이 화면의 차례대로 선다 — 숙박·결제일, 업체명, 정산금액(원화는 원, 외화는 화폐 이름)', () => {
  assert.deepEqual(lines().map((l) => [l.seq, l.name, l.company, l.total]), [
    ['81559', '숙박 8/18', 'Toyoko INN Gangnam Seoul', '88.46 USD'], ['81558', '숙박 8/18', 'Toyoko INN Gangnam Seoul', '125,052원'],
    ['81560', '숙박 8/19', '부산 <해운대> 호텔', '68.46 USD'],
  ]);
  assert.equal(lines()[0].tip, 'Toyoko INN Gangnam Seoul · 1박', '좁아서 잘린 업체명은 풍선말에 다 적혀 있다(박 수도)');
  assert.ok(doc.querySelector('#atList .at-legs').compareDocumentPosition(box()) & window.Node.DOCUMENT_POSITION_FOLLOWING, '가는 편·오는 편 아래에 선다');
  assert.ok(box().compareDocumentPosition(doc.querySelector('#atList .at-after-drop')) & window.Node.DOCUMENT_POSITION_FOLLOWING, '증빙 넣는 곳보다 위다');
});
t('이 패널이 증빙으로 올린 줄과 손수 적은 줄을 가려 적는다 — 적어 둔 표시가 먼저, 없으면 보관함의 숙박 증빙 가운데 금액이 같은 것', () => {
  assert.deepEqual(lines().map((l) => [l.seq, l.src, l.hand]), [['81559', '손수 작성', true], ['81558', '증빙', false], ['81560', '증빙', false]]);
  assert.match(lines()[0].srcTip, /이 패널에서 올린 증빙으로 작성한 줄이 아닙니다 — 사후정산 화면에서 손수 작성한 줄입니다/);
  assert.equal(lines()[1].srcTip, '이 패널에서 증빙(image.png)으로 올린 줄입니다 · 누르면 내용이 보입니다', '보관함의 숙박 증빙과 금액이 같다');
  assert.equal(lines()[2].srcTip, '이 패널에서 증빙(호텔영수증.pdf)으로 올린 줄입니다 · 누르면 내용이 보입니다', '올릴 때 적어 둔 표시');
  assert.equal(box().querySelector('.at-lodge-count').textContent, '3줄 · 손수 작성 1줄');
});
t('읽기만 했다 — 아무것도 보내지 않았다', () => assert.deepEqual([site.gets, site.posts.length], [1, 0]));

console.log('다시 읽기');
// 표시를 적기 전에 올린 줄은 활동 기록으로도 알아본다 — 붙여 넣은 그림은 이름이 같아(image.png) 보관함에는 마지막 한 장만 남는다.
store.activityLog = [
  { at: 1, kind: 'trip', ok: true, text: '여비계산서(사후정산) 작성: 143884 · 숙박 Toyoko INN Gangnam Seoul 1박 90 USD', data: { seq: '143884', files: ['image.png'] } },
  { at: 2, kind: 'trip', ok: true, text: '여비계산서(사후정산) 작성: 999 · 숙박 남의 호텔 1박 68.46 USD', data: { seq: '999', files: ['남의것.png'] } },
  { at: 3, kind: 'trip', ok: false, text: '여비계산서(사후정산) 실패: 143884 — 저장을 보냈지만', data: { seq: '143884' } },
];
site.lodges[0].total = '90';
site.lodges.push({ seq: '81570', paydate: '2026-08-19', sday: '1', company: '', currency: 'KRW', total: '' });
box().querySelector('button[data-act="lodge-refresh"]').click();
await until(() => lines().length === 4, '숙박 줄 다시 읽기');
t('새로고침을 누르면 화면에서 고친 것이 온다 — 금액이 바뀌고 손수 더한 줄이 생긴다(빈 칸은 빈 칸이라고 적는다)', () => {
  assert.deepEqual(lines().map((l) => [l.seq, l.company, l.total]), [
    ['81559', 'Toyoko INN Gangnam Seoul', '90 USD'], ['81558', 'Toyoko INN Gangnam Seoul', '125,052원'],
    ['81560', '부산 <해운대> 호텔', '68.46 USD'], ['81570', '업체명 없음', '금액 ?'],
  ]);
  assert.equal(status(), '숙박비 내역을 다시 읽었습니다 — 4줄 · 여비계산서 143884');
  assert.deepEqual([site.gets, site.posts.length], [2, 0]);
});
t('표시도 보관함도 없는 줄은 활동 기록의 "사후정산 작성"으로 알아본다 — 이 계산서의 성공한 기록에서 박 수·정산금액이 같은 것', () => {
  assert.deepEqual(lines().map((l) => [l.seq, l.src]), [['81559', '증빙'], ['81558', '증빙'], ['81560', '증빙'], ['81570', '손수 작성']]);
  assert.equal(lines()[0].srcTip, '이 패널에서 증빙(image.png)으로 올린 줄입니다 · 누르면 내용이 보입니다');
  assert.equal(box().querySelector('.at-lodge-count').textContent, '4줄 · 손수 작성 1줄');
});

console.log('지우기 — 두 번 눌러야 나간다');
lines()[0].del.click();
t('첫 번째 누름은 무엇을 지우는지 적기만 한다 — 보내지 않는다', () => {
  assert.equal(status(), '지울 숙박 줄 — Toyoko INN Gangnam Seoul · 8/18 · 90 USD · 한 번 더 누르면 사후정산에서 지웁니다');
  assert.deepEqual([lines()[0].del.textContent, lines()[0].del.classList.contains('armed')], ['지우기', true]);
  assert.equal(site.posts.length, 0);
});
lines()[0].del.click();
await until(() => site.posts.length === 1 && lines().length === 3, '숙박 줄 지우기');
await ta('두 번째 누름에 그 줄만 지움 표시해 폼을 그대로 보낸다 — 화면에서 × 를 누르고 저장한 것과 같다', async () => {
  const body = site.posts[0];
  assert.deepEqual([body.getAll('lodge_seq'), body.getAll('lodge_del')], [['81559', '81558', '81560', '81570'], ['1', '0', '0', '0']]);
  assert.deepEqual([body.getAll('lodge_total'), body.getAll('lodge_currency'), body.getAll('lodge_maxtotal')],
    [['90', '125052', '68.46', ''], ['USD', 'KRW', 'USD', 'KRW'], ['120000', '120000', '120000', '120000']], '나머지 칸은 화면에 있던 값 그대로다');
  assert.deepEqual([body.get('seq'), body.get('trseq'), body.get('__RequestVerificationToken'), body.getAll('tr_seq'), body.getAll('tr_del'), body.get('air_abroad')],
    ['143884', '156032', 'tok', ['501'], ['0'], 'N'], '다른 내역(교통·항공)과 요청 확인 토큰도 그대로 간다');
  assert.equal(body.getAll('lodge_file').length, 0, '첨부 칸은 보내지 않는다');
});
t('지운 뒤에는 화면을 다시 읽은 줄이 선다 — 무엇을 지웠는지 상태 줄과 활동 기록에 남는다', () => {
  assert.deepEqual(lines().map((l) => l.seq), ['81558', '81560', '81570']);
  assert.equal(status(), '숙박 줄을 지웠습니다 — Toyoko INN Gangnam Seoul · 8/18 · 90 USD · 여비계산서 143884');
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && /숙박 줄 삭제: 143884 · Toyoko INN Gangnam Seoul · 8\/18 · 90 USD/.test(l.text)));
});

lines()[1].del.click();
lines()[1].del.click();
await until(() => site.posts.length === 2 && lines().length === 2, '증빙으로 올린 줄 지우기');
t('증빙으로 올린 줄을 지우면 적어 둔 표시도 지운다 — 다른 계산서의 표시는 그대로다', () => {
  assert.deepEqual(site.posts[1].getAll('lodge_del'), ['0', '1', '0']);
  assert.deepEqual(store.attendLodgeMine, { 999: { 1: '남의것.png' } });
  assert.deepEqual(lines().map((l) => [l.seq, l.src]), [['81558', '증빙'], ['81570', '손수 작성']]);
});

console.log('사이트가 지우지 않았으면 지웠다고 하지 않는다');
site.obey = false;
lines()[1].del.click();
lines()[1].del.click();
await until(() => site.posts.length === 3 && !!box().querySelector('.at-lodge-note.error'), '지우기 실패');
t('삭제를 보냈는데 줄이 그대로면 실패로 적는다 — 줄은 그대로 남아 있다', () => {
  assert.match(box().querySelector('.at-lodge-note.error').textContent, /^숙박 줄을 지우지 못했습니다: 삭제를 보냈지만 그 줄이 사후정산 화면에 그대로 있습니다/);
  assert.deepEqual(lines().map((l) => l.seq), ['81558', '81570']);
  assert.ok(logs.some((l) => l.kind === 'trip' && !l.ok && /숙박 줄 삭제 실패: 143884/.test(l.text)));
});
site.obey = true;

console.log('읽는 길(src/trip.js)과 그리는 낱개');
await ta('지움 표시가 된 줄과 아직 저장하지 않은 줄(번호 없음)은 숙박 줄로 치지 않는다', async () => {
  const saved = site.lodges;
  site.lodges = [...saved, { seq: '', paydate: '2026-08-20', sday: '1', company: '새 줄', currency: 'KRW', total: '1' }];
  assert.deepEqual((await tripAfterLodges('143884', '156032')).map((r) => [r.seq, r.company, r.currency, r.total]), [['81558', 'Toyoko INN Gangnam Seoul', 'KRW', '125052'], ['81570', '', 'KRW', '']]);
  site.lodges = saved;
  await assert.rejects(tripAfterLodges('143884', ''), /출장자 번호/);
});
t('정산금액 — 원화는 쉼표와 "원", 외화는 화폐 이름, 못 읽으면 "금액 ?"', () => {
  assert.deepEqual([{ total: '125052', currency: 'KRW' }, { total: '1,250,000', currency: '' }, { total: '88.46', currency: 'USD' }, { total: '', currency: 'KRW' }, { total: 'abc', currency: 'USD' }].map(lodgeAmount),
    ['125,052원', '1,250,000원', '88.46 USD', '금액 ?', '금액 ?']);
});
t('어디서 온 줄인가 — 금액이 같아도 숙박 증빙이 아닌 보관 증빙으로는 알아보지 않는다', () => {
  const kept = [{ name: '점심.png', label: '출장지 영수증', total: 12000 }, { name: '호텔.png', label: '숙박 증빙', total: 99000 }, { name: '예약서.png', label: '숙박 증빙', total: null }];
  assert.deepEqual([lodgeSource({ seq: '1', total: '12000' }, {}, kept), lodgeSource({ seq: '2', total: '99,000' }, {}, kept), lodgeSource({ seq: '3', total: '' }, {}, kept),
    lodgeSource({ seq: '4', total: '5' }, { 4: '적어둔것.pdf' }, kept)], ['', '호텔.png', '', '적어둔것.pdf']);
});

t('활동 기록으로 알아보기 — 다른 계산서·실패한 기록·박 수나 금액이 다른 줄은 치지 않고, 파일 이름이 없으면 "올린 증빙"이라고만 한다', () => {
  const logged = lodgeLogged(store.activityLog, '143884');
  assert.deepEqual(logged, [{ text: '여비계산서(사후정산) 작성: 143884 · 숙박 Toyoko INN Gangnam Seoul 1박 90 USD', file: 'image.png' }]);
  const row = (over) => ({ seq: '1', sday: '1', total: '90', currency: 'USD', ...over });
  assert.deepEqual([row({}), row({ sday: '2' }), row({ total: '190' }), row({ currency: 'KRW' }), row({ total: '' })].map((r) => lodgeSource(r, {}, [], logged)), ['image.png', '', '', '', '']);
  assert.equal(lodgeSource(row({}), {}, [], [{ text: '… 숙박 A 1박 90 USD', file: '' }]), '올린 증빙');
  assert.deepEqual([lodgeLogged(null, '1'), lodgeLogged([{ kind: 'trip', ok: true, text: '여비계산서(사후정산) 작성: 1 · KTX', data: null }], '1')], [[], [{ text: '여비계산서(사후정산) 작성: 1 · KTX', file: '' }]]);
});

console.log('상한 버튼 — 실제 금액이 상한액을 넘는 원화 줄의 정산금액을 상한액과 실제 금액 사이에서 바꾼다(2026-10-06 사용자 지정: 버튼 하나)');
t('125,052원 줄(상한액 120,000원 × 1박)에만 꺼진 상한 버튼이 선다 — 금액 없는 줄에는 자리만 있다. 상한은 화면의 숨은 칸에서 읽었다(사이트에 묻지 않았다)', () => {
  const [a, b] = lines();
  assert.deepEqual([a.seq, !!a.cap, a.cap.getAttribute('aria-pressed'), a.cap.disabled, a.cap.textContent], ['81558', true, 'false', false, '상한']);
  assert.equal(a.cap.title, '실제 금액 125,052원으로 정산 중(부서장 승인 필요 — 상한액의 1.5배(180,000원) 이내) — 누르면 상한액 120,000원(1일 120,000원 × 1박)으로 바꿉니다');
  assert.deepEqual([b.seq, b.cap, b.capNone], ['81570', null, true]);
  assert.equal(site.maxes, 0);
  assert.ok(a.cap.compareDocumentPosition(doc.querySelector('#atList .at-lodge[data-lodge="81558"] .at-lodge-src')) & window.Node.DOCUMENT_POSITION_FOLLOWING, '정산금액과 증빙 표시 사이에 선다');
});
lines()[0].cap.click();
await until(() => site.posts.length === 4 && lines()[0].total === '120,000원', '상한액으로 바꾸기');
await ta('누르면 그 줄의 정산금액·공급가액·부가세만 바꿔 폼을 그대로 보낸다 — 공급가액·부가세는 정산금액에서 역산(÷ 1.1)', async () => {
  const body = site.posts[3];
  assert.deepEqual([body.getAll('lodge_seq'), body.getAll('lodge_total'), body.getAll('lodge_samount'), body.getAll('lodge_vat'), body.getAll('lodge_del')],
    [['81558', '81570'], ['120000', ''], ['109091', '0'], ['10909', '0'], ['0', '0']]);
  assert.deepEqual([body.get('seq'), body.get('trseq'), body.get('__RequestVerificationToken'), body.getAll('lodge_company'), body.getAll('tr_seq')],
    ['143884', '156032', 'tok', ['Toyoko INN Gangnam Seoul', ''], ['501']], '나머지 칸은 화면에 있던 값 그대로다');
});
t('바꾼 뒤에는 화면을 다시 읽은 줄이 선다 — 버튼이 켜지고, 실제 금액을 적어 두며(되돌리려고), 금액으로 알아본 증빙 표시는 줄 번호에 적어 남긴다', () => {
  const a = lines()[0];
  assert.deepEqual([a.total, a.cap.getAttribute('aria-pressed'), a.cap.disabled, a.src], ['120,000원', 'true', false, '증빙']);
  assert.equal(a.cap.title, '상한액 120,000원(1일 120,000원 × 1박)으로 정산 중 — 누르면 실제 금액 125,052원으로 되돌립니다 · 부서장 승인 필요 — 상한액의 1.5배(180,000원) 이내');
  assert.deepEqual(store.attendLodgeActual, { 143884: { 81558: { actual: 125052, supply: null, vat: null, reason: null } } }, '공급가액·부가세(0·0)는 실제 금액에 맞지 않아 적지 않는다 · 비고에 사유가 없었으니 사유도 없다');
  assert.deepEqual(site.posts[3].getAll('lodge_comment'), ['', ''], '비고에 사유가 없었으니 비고는 그대로 나간다');
  assert.deepEqual(store.attendLodgeMine, { 999: { 1: '남의것.png' }, 143884: { 81558: 'image.png' } });
  assert.equal(status(), '정산금액을 상한액 120,000원으로 바꿨습니다 — Toyoko INN Gangnam Seoul · 8/18 · 125,052원 · 여비계산서 143884');
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && /숙박 줄 정산금액 변경: 143884 · Toyoko INN Gangnam Seoul · 8\/18 · 125,052원 → 120,000원\(상한액\)$/.test(l.text)));
});
lines()[0].cap.click();
await until(() => site.posts.length === 5 && lines()[0].total === '125,052원', '실제 금액으로 되돌리기');
// 2026-10-08 사용자 지정: 정산금액이 상한액을 넘으면 비고에 상한 초과 사유가 필수다 — 실제 금액으로 되돌리면 비고에 기본 문구를 잇는다.
t('켜진 버튼을 누르면 적어 둔 실제 금액으로 되돌린다 — 공급가액·부가세는 되셈하고, 비고에 상한 초과 사유(기본 문구)를 잇고, 승인 규칙을 상태 줄과 기록에 적는다', () => {
  const body = site.posts[4];
  assert.deepEqual([body.getAll('lodge_total'), body.getAll('lodge_samount'), body.getAll('lodge_vat')], [['125052', ''], ['113684', '0'], ['11368', '0']]);
  assert.deepEqual(body.getAll('lodge_comment'), [REASON, ''], '그 줄의 비고에만 사유가 들어간다');
  assert.deepEqual([lines()[0].cap.getAttribute('aria-pressed'), lines()[0].src, store.attendLodgeActual[143884][81558].actual], ['false', '증빙', 125052]);
  assert.equal(status(), `정산금액을 실제 금액 125,052원으로 되돌렸습니다 — Toyoko INN Gangnam Seoul · 8/18 · 120,000원 · 여비계산서 143884 · 부서장 승인 필요 — 상한액의 1.5배(180,000원) 이내 · 비고에 사유를 적었습니다(${REASON})`);
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && /→ 125,052원\(실제 금액\) · 부서장 승인 필요 — 상한액의 1.5배\(180,000원\) 이내 · 비고에 사유를 적었습니다/.test(l.text)));
  assert.equal(site.lodges.find((l) => l.seq === '81558').comment, REASON);
});

console.log('사이트가 바꾸지 않았으면 바꿨다고 하지 않는다');
site.obey = false;
lines()[0].cap.click();
await until(() => site.posts.length === 6 && !!box().querySelector('.at-lodge-note.error'), '바꾸기 실패');
t('저장을 보냈는데 정산금액이 그대로면 실패로 적는다 — 줄도 버튼도 그대로다', () => {
  assert.match(box().querySelector('.at-lodge-note.error').textContent, /^정산금액을 바꾸지 못했습니다: 저장을 보냈지만 정산금액이 바뀌지 않았습니다/);
  assert.deepEqual([lines()[0].total, lines()[0].cap.getAttribute('aria-pressed'), lines()[0].cap.disabled], ['125,052원', 'false', false]);
  assert.ok(logs.some((l) => l.kind === 'trip' && !l.ok && /숙박 줄 정산금액 변경 실패: 143884/.test(l.text)));
});
site.obey = true;

console.log('상한을 화면의 숨은 칸에서 못 읽으면 사이트에 묻는다(나라·화폐마다 한 번)');
site.lodges.find((l) => l.seq === '81558').maxtotal = '';
box().querySelector('button[data-act="lodge-refresh"]').click();
await until(() => site.maxes === 1 && !box().querySelector('.at-lodge-refresh.spin'), '상한액 조회');
t('숨은 칸이 비면 CalMaxLodge 로 읽어 같은 버튼이 선다', () => {
  assert.deepEqual([lines()[0].cap.getAttribute('aria-pressed'), lines()[0].cap.disabled], ['false', false]);
  assert.match(lines()[0].cap.title, /^실제 금액 125,052원으로 정산 중/);
});
box().querySelector('button[data-act="lodge-refresh"]').click();
await until(() => site.gets >= 10 && !box().querySelector('.at-lodge-refresh.spin'), '다시 읽기');
t('한 번 읽은 상한은 다시 묻지 않는다', () => assert.equal(site.maxes, 1));

console.log('상한액으로 돼 있는데 실제 금액을 모르면 켜진 채 잠긴다');
site.lodges.find((l) => l.seq === '81558').total = '120000';
delete store.attendLodgeActual[143884];
box().querySelector('button[data-act="lodge-refresh"]').click();
await until(() => lines()[0].total === '120,000원' && !box().querySelector('.at-lodge-refresh.spin'), '다시 읽기');
t('정산금액이 상한액과 같고 적어 둔 실제 금액이 없으면 — 버튼은 켜져 있지만 누를 수 없고, 풍선말이 까닭을 적는다', () => {
  assert.deepEqual([lines()[0].cap.getAttribute('aria-pressed'), lines()[0].cap.disabled], ['true', true]);
  assert.equal(lines()[0].cap.title, '상한액 120,000원(1일 120,000원 × 1박)으로 정산 중 — 실제 금액을 몰라 되돌릴 수 없습니다(사후정산 화면에서 고쳐 주세요)');
});
site.lodges.find((l) => l.seq === '81558').total = '125052';
box().querySelector('button[data-act="lodge-refresh"]').click();
await until(() => lines()[0].total === '125,052원' && !box().querySelector('.at-lodge-refresh.spin'), '다시 읽기');

t('버튼이 설 자리(lodgeCapState) — 원화 줄이고 상한액을 알고 실제 금액이 상한액을 넘을 때만', () => {
  const row = (o) => ({ seq: '1', nation: 'KR||', sday: '2', currency: 'KRW', maxconv: '120000', maxtotal: '', maxcur: '', total: '300000', ...o });
  const pick = (c) => c && { cap: c.cap, actual: c.actual, on: c.on, can: c.can, other: c.other, within: c.over ? c.over.within : null };
  assert.equal(lodgeCapState(row({ currency: 'USD' })), null, '외화 줄');
  assert.equal(lodgeCapState(row({ maxconv: '0' })), null, '상한액을 모름');
  assert.equal(lodgeCapState(row({ total: '200000' })), null, '상한액 이내');
  assert.equal(lodgeCapState(row({ total: '' })), null, '금액 없음');
  assert.deepEqual(pick(lodgeCapState(row({}))), { cap: 240000, actual: 300000, on: false, can: true, other: false, within: true }, '지금의 정산금액이 실제 금액이다');
  assert.deepEqual(pick(lodgeCapState(row({ total: '240000' }))), { cap: 240000, actual: null, on: true, can: false, other: false, within: null }, '상한액인데 실제 금액을 모르면 켜진 채 잠긴다');
  assert.deepEqual(pick(lodgeCapState(row({ total: '240000' }), { actual: 400000 })), { cap: 240000, actual: 400000, on: true, can: true, other: false, within: false }, '적어 둔 실제 금액이 1.5배(360,000원)를 넘는다');
  assert.deepEqual(pick(lodgeCapState(row({ total: '250000' }), { actual: 300000 })), { cap: 240000, actual: 300000, on: false, can: true, other: true, within: true }, '상한액도 실제 금액도 아닌 금액(손으로 고친 줄)');
  assert.equal(lodgeCapState(row({ total: '240000' }), { actual: 200000 }), null, '적어 둔 실제 금액이 상한액 이내면 버튼이 없다');
  assert.deepEqual(pick(lodgeCapState(row({ maxconv: '' }), null, { 'KR|||KRW': { maxconv: '120000' } })), { cap: 240000, actual: 300000, on: false, can: true, other: false, within: true }, '사이트에서 읽어 둔 상한');
  assert.deepEqual([lodgeCapDay({ maxconv: '', maxtotal: '100', maxcur: 'USD', currency: 'KRW' }), lodgeCapDay({ maxconv: '', maxtotal: '100', maxcur: 'KRW', currency: 'KRW' }), lodgeCapDay({ maxconv: '90', maxtotal: '100', maxcur: 'KRW' })],
    [null, 100, 90], '1일 상한 — 줄의 화폐로 바꾼 값이 먼저, 없으면 상한의 화폐가 줄의 화폐일 때 그 값');
  assert.equal(lodgeCapTitle(lodgeCapState(row({ total: '250000' }), { actual: 300000 })),
    '정산금액이 실제 금액 300,000원과 다릅니다(부서장 승인 필요 — 상한액의 1.5배(360,000원) 이내) — 누르면 상한액 240,000원(1일 120,000원 × 2박)으로 바꿉니다');
  assert.equal(lodgeCapTitle(lodgeCapState(row({ total: '240000' }), { actual: 400000 })),
    '상한액 240,000원(1일 120,000원 × 2박)으로 정산 중 — 누르면 실제 금액 400,000원으로 되돌립니다 · 상한액의 1.5배(360,000원) 초과 — 부서장 승인 범위를 벗어남');
});

console.log('사후정산을 쓰는 단계가 아니면 숙박비 내역이 없다');
st.trips.rows[0].pre = '작성';
st.trips.rows[0].travelers[0].post = '대기';
await panel.reload();
t('사전정산을 쓰는 중에는 숙박비 내역을 보이지 않는다(입력 화면이 아직 없다)', () => {
  assert.ok(doc.querySelector('#atList .at-after'));
  assert.equal(box(), null);
});
st.trips.rows[0].pre = '완료';
st.trips.rows[0].travelers[0].post = '완료';
await panel.reload();
t('사후정산이 완료된 출장에는 보여 주기만 한다 — 숙박 줄과 그 표시는 그대로 서고, 지우는 × 는 없다(다시 읽기는 있다) — 상한 버튼은 여기서도 선다', () => {
  assert.equal(doc.querySelector('#atList .at-after-head strong').textContent, '정산 내역');
  // 상한 버튼은 완료된 카드에도 선다(2026-10-06 사용자가 완료된 카드에서 "아이콘이 안 보인다"고 했다) — 누를 수 있다.
  assert.deepEqual(lines().map((l) => [l.seq, l.src, l.del, !!l.cap, l.cap ? l.cap.disabled : null, l.capNone]),
    [['81558', '증빙', null, true, false, false], ['81570', '손수 작성', null, false, null, true]]);
  assert.match(lines()[0].cap.title, /^실제 금액 125,052원으로 정산 중/);
  assert.equal(box().querySelector('.at-lodge-count').textContent, '2줄 · 손수 작성 1줄');
  assert.ok(box().querySelector('button[data-act="lodge-refresh"]'));
  assert.equal(doc.querySelector('#atList .at-after-drop'), null, '증빙 넣는 곳은 없다');
});
lines()[0].cap.click();
await until(() => site.posts.length === 7 && lines()[0].total === '120,000원', '완료된 카드에서 상한액으로 바꾸기');
t('완료된 카드에서 눌러도 같은 요청이 나간다 — 그 줄의 정산금액만 상한액으로. 비고에 있던 상한 초과 사유는 걷는다(상한액 안이라 사유가 필요 없다)', () => {
  assert.deepEqual([site.posts[6].getAll('lodge_total'), site.posts[6].getAll('lodge_del'), site.posts[6].getAll('lodge_comment')], [['120000', ''], ['0', '0'], ['', '']]);
  assert.deepEqual([lines()[0].cap.getAttribute('aria-pressed'), lines()[0].cap.disabled, lines()[0].del], ['true', false, null]);
  assert.match(status(), / · 비고의 상한 초과 사유를 걷었습니다$/);
  assert.equal(store.attendLodgeActual[143884][81558].reason, REASON, '걷은 사유를 적어 둔다 — 되돌릴 때 다시 잇는다');
});

// 2026-10-08 사용자 지정: "기본적으로 '인근 숙소비 상승으로 인해 숙박비 내에 숙박이 어려움' 라는 내용을 넣어주고, 수정 가능하게 해줘" — 올린 뒤에는
// 숙박비 내역에서 그 줄의 내용을 펴면 사유 칸이 서고, `비고에 저장` 으로 그 줄의 비고만 바꿔 저장한다.
console.log('비고의 상한 초과 사유 고쳐 쓰기 — 정산금액이 상한액을 넘는 줄의 펴진 내용 아래에 칸이 선다');
Object.assign(site.lodges.find((l) => l.seq === '81558'), { total: '125052', comment: '' });   // 사후정산 화면에서 손으로 실제 금액으로 고치고 비고를 지운 것처럼
box().querySelector('button[data-act="lodge-refresh"]').click();
await until(() => lines()[0].total === '125,052원' && !box().querySelector('.at-lodge-refresh.spin'), '다시 읽기');
const chip = () => doc.querySelector('#atList .at-lodge[data-lodge="81558"] button[data-act="lodge-info"]');
const editor = () => doc.querySelector('#atList .at-lodge-info .at-lodge-reason[data-lodge="81558"]');
const reasonInput = () => editor()?.querySelector('input.at-lodge-reason-input');
const saveBtn = () => editor()?.querySelector('button[data-act="lodge-comment"]');
t('사유를 가려내는 낱개(lodgeReasonOf) — 적어 둔 사유, 기본 문구, 없음. 나머지 비고는 base 다', () => {
  assert.deepEqual(lodgeReasonOf({ comment: `Toyoko · ${REASON}` }), { reason: REASON, base: 'Toyoko', known: [REASON] });
  assert.deepEqual(lodgeReasonOf({ comment: 'Toyoko · 행사라 숙소 부족' }, { reason: '행사라 숙소 부족' }), { reason: '행사라 숙소 부족', base: 'Toyoko', known: ['행사라 숙소 부족', REASON] });
  assert.deepEqual(lodgeReasonOf({ comment: 'Toyoko' }, { reason: '행사라 숙소 부족' }), { reason: '', base: 'Toyoko', known: ['행사라 숙소 부족', REASON] });
  assert.deepEqual(lodgeReasonOf({ comment: '' }), { reason: '', base: '', known: [REASON] });
});
t('줄을 펴기 전에는 칸이 없다 — 펴면 상한액을 넘는 줄 아래에 사유 칸이 선다. 비고에 사유가 없으니 그렇다고 적고, 칸에는 적어 둔 사유(기본 문구)가 들어 있다', () => {
  assert.equal(editor(), null);
  chip().click();
  assert.ok(editor(), '펴진 내용 안에 선다');
  assert.equal(editor().querySelector('.at-after-label').textContent, '비고의 상한 초과 사유');
  assert.deepEqual([reasonInput().value, saveBtn().textContent, saveBtn().disabled], [REASON, '비고에 저장', false]);
  assert.equal(editor().querySelector('.at-after-note').textContent, '비고에 상한 초과 사유가 없습니다 · 저장하면 사유를 적습니다');
  assert.ok(editor().querySelector('.at-after-note').classList.contains('missing'));
  assert.equal(doc.querySelector('#atList .at-lodge[data-lodge="81570"] button[data-act="lodge-info"]').getAttribute('aria-expanded'), 'false');
});
t('적는 중인 글은 카드를 다시 그려도 남는다', () => {
  reasonInput().value = '행사 기간이라 인근 숙소가 다 찼음';
  reasonInput().dispatchEvent(new window.Event('input', { bubbles: true }));
  box().querySelector('button[data-act="lodge-refresh"]').click();   // 다시 읽어 그려도
  assert.equal(reasonInput().value, '행사 기간이라 인근 숙소가 다 찼음');
});
await until(() => !box().querySelector('.at-lodge-refresh.spin'), '다시 읽기');
reasonInput().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await until(() => site.posts.length === 8 && !doc.querySelector('#atList .at-lodge.busy'), '비고 저장');
t('Enter(또는 `비고에 저장`)를 누르면 그 줄의 비고만 바꿔 폼을 그대로 보낸다 — 정산금액은 그대로, 다른 줄의 비고도 그대로', () => {
  const body = site.posts[7];
  assert.deepEqual([body.getAll('lodge_comment'), body.getAll('lodge_total'), body.getAll('lodge_del')], [['행사 기간이라 인근 숙소가 다 찼음', ''], ['125052', ''], ['0', '0']]);
  assert.equal(status(), '비고에 상한 초과 사유를 적었습니다 — Toyoko INN Gangnam Seoul · 8/18 · 125,052원 · 여비계산서 143884 · 행사 기간이라 인근 숙소가 다 찼음');
  assert.equal(store.attendLodgeActual[143884][81558].reason, '행사 기간이라 인근 숙소가 다 찼음', '고쳐 쓴 사유를 적어 둔다');
  assert.deepEqual([reasonInput().value, editor().querySelector('.at-after-note').textContent, editor().querySelector('.at-after-note').classList.contains('missing')],
    ['행사 기간이라 인근 숙소가 다 찼음', '지금 비고: 행사 기간이라 인근 숙소가 다 찼음', false]);
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && /숙박 줄 비고 변경: 143884 · Toyoko INN Gangnam Seoul · 8\/18 · 125,052원 → 행사 기간이라 인근 숙소가 다 찼음$/.test(l.text)));
});
reasonInput().value = '';
saveBtn().click();
await until(() => site.posts.length === 9 && !doc.querySelector('#atList .at-lodge.busy'), '빈 사유 저장');
t('빈 글로 저장하면 기본 문구를 적는다(사유는 필수다) — 다른 사유가 있던 자리를 바꾼다', () => {
  assert.deepEqual(site.posts[8].getAll('lodge_comment'), [REASON, '']);
  assert.deepEqual([reasonInput().value, store.attendLodgeActual[143884][81558].reason], [REASON, REASON]);
  assert.equal(status(), `비고에 상한 초과 사유를 고쳐 적었습니다 — Toyoko INN Gangnam Seoul · 8/18 · 125,052원 · 여비계산서 143884 · ${REASON}`);
});
saveBtn().click();
await wait(50);
t('비고가 이미 그 사유면 보내지 않는다', () => {
  assert.equal(site.posts.length, 9);
  assert.equal(status(), '비고가 이미 그 사유입니다 — Toyoko INN Gangnam Seoul · 8/18 · 125,052원 · 여비계산서 143884');
});
reasonInput().value = '행사 기간이라 인근 숙소가 다 찼음';
saveBtn().click();
await until(() => site.posts.length === 10 && !doc.querySelector('#atList .at-lodge.busy'), '사유 다시 고치기');
lines()[0].cap.click();
await until(() => site.posts.length === 11 && lines()[0].total === '120,000원', '상한액으로');
t('상한액으로 낮추면 고쳐 쓴 사유를 걷고(묵은 곳이 없으니 비고가 비고), 칸은 사라진다 — 상한액 안이라 사유가 필요 없다', () => {
  assert.deepEqual([site.posts[10].getAll('lodge_comment'), site.posts[10].getAll('lodge_total')], [['', ''], ['120000', '']]);
  assert.deepEqual([editor(), chip().getAttribute('aria-expanded')], [null, 'true'], '펴져 있어도 상한액 안인 줄에는 사유 칸이 없다');
});
lines()[0].cap.click();
await until(() => site.posts.length === 12 && lines()[0].total === '125,052원', '실제 금액으로');
t('실제 금액으로 되돌리면 고쳐 쓴 사유가 다시 비고에 들어간다(기본 문구가 아니다)', () => {
  assert.deepEqual(site.posts[11].getAll('lodge_comment'), ['행사 기간이라 인근 숙소가 다 찼음', '']);
  assert.ok(editor());
  assert.equal(editor().querySelector('.at-after-note').textContent, '지금 비고: 행사 기간이라 인근 숙소가 다 찼음');
});
Object.assign(site.lodges.find((l) => l.seq === '81558'), { comment: `Toyoko INN · ${REASON}` });   // 묵은 곳이 적힌 비고
box().querySelector('button[data-act="lodge-refresh"]').click();
await until(() => editor()?.querySelector('.at-after-note').textContent === `지금 비고: Toyoko INN · ${REASON}`, '다시 읽기');
reasonInput().value = '성수기라 인근 숙소비가 올랐음';
saveBtn().click();
await until(() => site.posts.length === 13 && !doc.querySelector('#atList .at-lodge.busy'), '묵은 곳 뒤의 사유 바꾸기');
t('비고의 다른 글(묵은 곳)은 그대로 두고 사유만 바꾼다', () => {
  assert.deepEqual(site.posts[12].getAll('lodge_comment'), ['Toyoko INN · 성수기라 인근 숙소비가 올랐음', '']);
});
site.obey = false;
reasonInput().value = '다른 사유';
saveBtn().click();
await until(() => site.posts.length === 14 && !!box().querySelector('.at-lodge-note.error'), '비고 저장 실패');
t('저장을 보냈는데 비고가 그대로면 실패로 적는다', () => {
  assert.match(box().querySelector('.at-lodge-note.error').textContent, /^비고를 바꾸지 못했습니다: 저장을 보냈지만 비고가 바뀌지 않았습니다/);
  assert.ok(logs.some((l) => l.kind === 'trip' && !l.ok && /숙박 줄 비고 변경 실패: 143884/.test(l.text)));
});
site.obey = true;

console.log(`\n통과 ${pass}건`);
process.exit(0);   // 패널이 걸어 둔 타이머(두 번 누르기)가 남아 있어도 끝낸다
