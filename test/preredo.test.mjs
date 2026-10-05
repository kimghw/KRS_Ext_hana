// 사전정산 다시하기 — 출장 카드의 여비증빙 송부 칸 아래 `사전정산 다시하기`(2026-10-05 사용자 지정: "여기에서 사후정산 다시하기,
// 사전정산 다시하기 기능이 있으면 좋겠어. 맨 아래 다시 보내기 했으면 좋겠고").
//
// 못 박는 것: 누르면 사전정산을 다시 작성하는 칸(가는 편·오는 편의 교통편 아이콘)이 서고, `사전정산 다시 저장`의 두 번째 누름에
// 사전정산 입력 화면(고치기)의 폼이 그대로 나간다 — 바꾼 편의 줄만 지움 표시되고 새 줄이 얹힌다. 저장한 뒤의 단계는 사이트가
// 정한 대로 따른다(사전정산 "작성"으로 돌아가든, 완료로 남든). 사이트가 받지 않으면(줄이 그대로면) 저장했다고 하지 않는다.
// 셈은 src/travel.js 의 prePlan·preEditBody, 보내는 것은 src/trip.js 의 tripPreSave 다.
// eclass 는 흉내 낸다 — **실제 사이트에는 아무것도 보내지 않는다.** 화면의 칸 차례는 2026-10-05 실제 화면(145580)의 것이다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok, what) => {
  for (let i = 0; i < 400 && !ok(); i++) await wait(25);
  assert.ok(ok(), `기다렸지만 되지 않았다: ${what}`);
};

const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const { window } = new JSDOM(html, { url: 'https://example.org/' });
const doc = window.document;
for (const g of ['document', 'DOMParser', 'FileReader', 'Element', 'HTMLElement', 'HTMLInputElement']) globalThis[g] = window[g];
globalThis.window = window;

const store = {};
const opened = [];
globalThis.chrome = {
  storage: { local: { get: async () => store, set: async (obj) => { Object.assign(store, obj); } } },
  runtime: { sendNativeMessage: async () => { throw new Error('no host'); } },
  tabs: { query: async () => [], create: async (o) => { opened.push(o.url); } },
  scripting: { executeScript: async () => [{ result: null }] },
};

/* ------------------------------------------------------------ 가짜 eclass 여비계산서 */

const page = (body) => new Response(`<html><body>${body}${' '.repeat(1600)}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
// 계산서 145580 — 사전·사후정산 모두 완료, 사전정산의 교통편은 KTX 부산↔서울 일반석 두 줄(실제 화면처럼 두 줄 모두 출발일이 적혀 있다).
// flip 이면 저장을 받은 사이트가 단계를 사전정산 "작성"으로 되돌리고, ignore 면 저장을 받지 않는다(줄이 그대로다).
const KTX = (seq, dep, arr) => ({ seq, trseq: '7380', revno: '', date: '2026-09-09', dep, shr: '0', arr, ehr: '0', transport: 'Train', grade: '일반석', total: '53700' });
const site = { pre: '완료', post: '완료', rows: [KTX('153340', '부산', '서울'), KTX('153341', '서울', '부산')], next: 153400, flip: false, ignore: false, posts: [], fees: [] };
const LIST = () => `<div class="bt-topmenu"><span class="bt-user"> 김거화 (kimghw) / KOR | ENG </span></div><table id="mainList"><tbody><tr>
<td data-href="/BusinessTrip/CalPrint?seq=145580">145580</td><td>김거화</td><td data-href="/BusinessTrip/CalPrint?seq=145580&amp;trseq=157777"> </td>
<td><span>${site.pre}</span></td><td><span>${site.post}</span></td><td>2026-09-09~2026-09-10</td><td>경기도 고양시 킨텍스</td><td>김거화</td><td>2026-09-01</td></tr></tbody></table>
<div class="bt-pager"><div>전체 1건 · 1/1 페이지</div></div>`;
const pick = (name, value, all = [value]) => `<select name="${name}">${all.map((v) => `<option value="${v}"${v === value ? ' selected="selected"' : ''}>${v}</option>`).join('')}</select>`;
const TR = (r) => `<tr><td><input type="hidden" name="tr_seq" value="${r.seq}"/><input type="hidden" name="tr_del" value="0"/>
<input type="hidden" name="tr_trseq" value="${r.trseq}"/><input type="hidden" name="tr_revno" value="${r.revno}"/><input type="hidden" name="tr_smn" value="0"/><input type="hidden" name="tr_emn" value="0"/>
<input type="date" name="tr_date" value="${r.date}"/></td><td><input type="text" name="tr_dep" value="${r.dep}"/>${pick('tr_shr', r.shr)}</td>
<td><input type="text" name="tr_arr" value="${r.arr}"/>${pick('tr_ehr', r.ehr)}</td><td>${pick('tr_transport', r.transport, ['Train', 'Subway', 'Ship', 'Bus', 'Airplane'])}</td>
<td><input type="text" name="tr_grade" value="${r.grade}"></td><td><input type="text" name="tr_total" value="${r.total}" readonly /></td>
<td>${pick('tr_currency', 'KRW')}</td><td><button type="button" onclick="delRow(this)">×</button></td></tr>`;
const WRITE = (seq) => `<form id="frm" method="post" action="/BusinessTrip/Write/Save" onsubmit="return checkSubmit();">
<input type="hidden" name="seq" value="${seq}"><input type="hidden" name="travelerForeign" value="K"><input type="hidden" id="travelerSabuns" name="travelerSabuns" value="11115">
${pick('period', '0', ['0', '1'])}<input type="date" id="sDate" name="sDate" value="2026-09-09">${pick('sHour', '7')}<input type="date" name="eDate" value="2026-09-10">${pick('eHour', '20')}
<input type="text" name="location" value="고양"><textarea name="purpose">K-Battery Show 참석</textarea>${pick('nationCD', 'KR||')}
<table><tbody id="stayBody"><tr><td><input type="hidden" name="stay_seq" value="124928"/><input type="hidden" name="stay_del" value="0"/><input type="text" name="stay_day" value="2"/>
<input type="text" name="stay_daily" value="2"/><input type="text" name="stay_meal" value="6"/></td></tr></tbody></table>
<input type="hidden" name="etc_exists" value="1">${pick('etc_cate', 'E')}<table><tbody id="transBody">${site.rows.map(TR).join('')}</tbody></table>
<input type="text" name="etc_distance" value="0"><button type="submit">저장</button><input name="__RequestVerificationToken" type="hidden" value="tok-write"></form>
<form id="delForm" method="post" action="/BusinessTrip/Write/Delete"><input type="hidden" name="seq" value="${seq}"><input name="__RequestVerificationToken" type="hidden" value="tok-delete"></form>`;
const AFTER = `<form method="post" id="frm" enctype="multipart/form-data" action="/BusinessTrip/AfterTrip/Save">
<input type="hidden" name="seq" value="145580"><input type="hidden" name="trseq" value="157777"><input name="__RequestVerificationToken" type="hidden" value="tok-after"></form>`;
const COLS = ['tr_seq', 'tr_del', 'tr_trseq', 'tr_revno', 'tr_date', 'tr_dep', 'tr_shr', 'tr_arr', 'tr_ehr', 'tr_transport', 'tr_grade', 'tr_total'];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (init.method === 'POST') {
    if (!u.endsWith('/BusinessTrip/Write/Save')) throw new Error('이 테스트에서 나가면 안 되는 쓰기 요청: ' + u);
    const body = new URLSearchParams(init.body);
    site.posts.push(body);
    if (!site.ignore) {
      // 사이트가 하듯 — 지움 표시된 줄은 없애고, 번호 없는 줄에는 새 번호를 준다.
      const col = Object.fromEntries(COLS.map((n) => [n, body.getAll(n)]));
      site.rows = col.tr_seq.map((_, i) => Object.fromEntries(COLS.map((n) => [n.slice(3), col[n][i]]))).filter((r) => r.del !== '1')
        .map((r) => ({ ...r, seq: r.seq || String(site.next++) }));
      if (site.flip) Object.assign(site, { pre: '작성', post: '대기' });
    }
    return page('ok');
  }
  if (u.includes('/Home/List')) return page(LIST());
  if (u.includes('/BusinessTrip/Write?')) return page(WRITE(new URL(u).searchParams.get('seq')));
  if (u.includes('/BusinessTrip/AfterTrip?')) return page(AFTER);
  if (u.includes('/TrafficFee/Select')) {
    // 사내 요금표 — 부산→서울 특실 78,900원이 등록돼 있다(번호 9001, 개정 3).
    const q = new URL(u).searchParams;
    site.fees.push(`${q.get('departure')}→${q.get('arrival')}`);
    return page(q.get('departure') === '부산' ? `<a onclick="uf_rtnFee('9001','3','부산','서울','Train','특실','78,900','')">고르기</a>` : '');
  }
  throw new Error('모르는 주소 ' + u);
};

/* ------------------------------------------------------------ 셈 (src/travel.js) */

const { prePlan, preEditBody, formFields, parseTransRows, parseTripList } = await import('../src/travel.js');
const TRIP = { seq: '145580', from: '2026-09-09', to: '2026-09-10', location: '경기도 고양시 킨텍스' };
const writeDoc = () => new JSDOM(WRITE('145580')).window.document;
const rowsNow = () => parseTransRows(writeDoc());
const plan = (picks) => prePlan({ trip: TRIP, picks, rows: rowsNow(), workplace: '부산', sHour: 7, eHour: 20 });

console.log('사전정산을 다시 작성할 때 무엇을 지우고 무엇을 넣는가 (prePlan)');
t('손대지 않았으면 바꿀 것이 없다 — 두 편 모두 사전정산의 줄 그대로다', () => {
  const p = plan({});
  assert.deepEqual([p.changed, p.drop, p.add, p.problems], [false, [], [], []]);
  assert.deepEqual(p.legs.map((l) => [l.key, l.source, l.row.total]), [['go', 'site', 53700], ['back', 'site', 53700]]);
});
t('사전정산의 줄과 같은 것(기차 일반석)을 골라도 바꿀 것이 없다', () => {
  assert.equal(plan({ go: { t: 'train', g: 'standard' } }).changed, false);
});
// 한 편만 바꿔도 줄은 모두 지우고 차례대로 다시 넣는다 — 가는 편의 줄만 새로 넣으면 번호가 커져 오는 편의 줄 뒤에 서고, 다음에 읽을 때
// 첫 줄을 가는 편으로 보는 규칙에서 두 편이 뒤바뀐다.
t('가는 편을 KTX 특실로 — 운임표의 특실 정가로 새 줄이 서고(출발 시는 출장의 출발 시, 도착 시는 그 구간의 소요 시간 뒤), 오는 편의 줄은 값 그대로 그 뒤에 다시 들어간다', () => {
  const p = plan({ go: { t: 'train', g: 'first' } });
  assert.deepEqual([p.changed, p.drop, p.problems], [true, ['153340', '153341'], []]);
  assert.deepEqual(p.add.map((r) => [r.date, r.dep, r.arr, r.transport, r.grade, r.total, r.shr, r.ehr, r.trseq]),
    [['2026-09-09', '부산', '서울', 'Train', '특실', 78900, 7, 11, ''], ['2026-09-09', '서울', '부산', 'Train', '일반석', 53700, 0, 0, '7380']]);
});
t('오는 편을 비행기로 — 사전정산에는 교통편 줄을 넣지 않는다(신청할 때와 같다). 오는 편의 줄은 없어지고 가는 편의 줄만 값 그대로 남는다', () => {
  const p = plan({ back: { t: 'plane', g: 'standard' } });
  assert.deepEqual([p.changed, p.drop, p.problems], [true, ['153340', '153341'], []]);
  assert.deepEqual(p.add.map((r) => [r.dep, r.arr, r.grade, r.total, r.trseq]), [['부산', '서울', '일반석', 53700, '7380']]);
  assert.deepEqual([p.legs[1].row, p.legs[1].blank], [null, '비행기 — 사전정산에는 교통편 줄을 넣지 않습니다']);
});
t('가는 편·오는 편 뒤의 줄(셋째 줄부터)도 값 그대로 맨 뒤에 다시 들어간다 — 사라지지 않는다', () => {
  const extra = { seq: '153342', trseq: '', revno: '', date: '2026-09-10', dep: '부산', arr: '김해공항', transport: 'Bus', grade: '', total: 7000, currency: 'KRW', shr: 0, ehr: 0 };
  const p = prePlan({ trip: TRIP, picks: { go: { t: 'train', g: 'first' } }, rows: [...rowsNow(), extra], workplace: '부산', sHour: 7, eHour: 20 });
  assert.deepEqual([p.drop, p.add.map((r) => `${r.dep}→${r.arr} ${r.transport} ${r.total}`)],
    [['153340', '153341', '153342'], ['부산→서울 Train 78900', '서울→부산 Train 53700', '부산→김해공항 Bus 7000']]);
});
t('운임표에 없는 길이면 그 편은 건드리지 않고 까닭을 말한다 — 다시 저장을 잠근다', () => {
  const p = prePlan({ trip: { ...TRIP, location: '울릉도' }, picks: { go: { t: 'train', g: 'first' } }, rows: [], workplace: '부산' });
  assert.deepEqual([p.changed, p.drop, p.add], [false, [], []]);
  assert.match(p.problems[0], /^가는 편: 출장지 "울릉도" 에서 내릴 KTX 역을 찾지 못했습니다/);
});

console.log('다시 저장할 본문 (preEditBody) — 사전정산 입력 화면의 폼 그대로에 교통편 줄만 바꾼다');
{
  const fields = formFields(writeDoc());
  t('바꿀 것이 없으면 화면의 칸 그대로다 — 화면의 저장만 누른 것과 같다. 삭제 폼의 칸은 섞이지 않는다', () => {
    const body = new URLSearchParams(preEditBody(fields, '145580'));
    assert.deepEqual([...body], fields);
    assert.deepEqual([body.get('seq'), body.getAll('tr_del'), body.getAll('__RequestVerificationToken')], ['145580', ['0', '0'], ['tok-write']]);
  });
  t('지울 줄은 그 줄의 tr_del 만 1 이 되고(화면의 × 처럼), 새 줄은 번호 없이 토큰 앞에 차례대로 얹힌다 — 다른 칸은 그대로다', () => {
    const p = plan({ go: { t: 'train', g: 'first' } });
    const body = new URLSearchParams(preEditBody(fields, '145580', p));
    assert.deepEqual([body.getAll('tr_seq'), body.getAll('tr_del'), body.getAll('tr_dep'), body.getAll('tr_grade'), body.getAll('tr_total'), body.getAll('tr_shr'), body.getAll('tr_ehr'), body.getAll('tr_trseq')],
      [['153340', '153341', '', ''], ['1', '1', '0', '0'], ['부산', '서울', '부산', '서울'], ['일반석', '일반석', '특실', '일반석'], ['53700', '53700', '78900', '53700'],
        ['0', '0', '7', '0'], ['0', '0', '11', '0'], ['7380', '7380', '', '7380']]);
    assert.deepEqual([body.getAll('stay_seq'), body.get('location'), body.get('purpose'), [...body.keys()].at(-1)], [['124928'], '고양', 'K-Battery Show 참석', '__RequestVerificationToken']);
  });
  t('다른 계산서의 화면이거나, 토큰이 없거나, 지울 줄이 화면에 없으면 본문을 짓지 않고 던진다', () => {
    assert.throws(() => preEditBody(fields, '999999'), /이 여비계산서의 사전정산 입력 화면이 아닙니다/);
    assert.throws(() => preEditBody(fields.filter(([n]) => n !== '__RequestVerificationToken'), '145580'), /요청 확인 토큰/);
    assert.throws(() => preEditBody(fields, '145580', { drop: ['111'], add: [] }), /지울 교통편 줄이 사전정산 화면에 없습니다/);
  });
}

/* ------------------------------------------------------------ 패널 */

const { createAttendPanel } = await import('../attendpanel.js');
const { createEvidenceStore } = await import('../src/evidence.js');
const { ROUTES_KEY } = await import('../src/routes.js');
const shelf = new Map();
const evidence = createEvidenceStore({ set: async (k, v) => { shelf.set(k, v); }, delete: async (k) => { shelf.delete(k); }, all: async () => [...shelf.values()] });
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logs = [];
const panel = createAttendPanel({ $: (id) => doc.getElementById(id), escapeHtml, logEvent: (kind, ok, text) => logs.push({ kind, ok, text }), ai: () => ({ apiKey: '', cli: false }), evidence });
panel.wire();
const st = panel.state;
const IT = { docNo: 'TR-1', formId: 'TR', status: '5', statusName: '결재완료', kindName: '국내출장', summary: '국내출장 9/9~9/10 07:00~20:00',
  reason: 'K-Battery Show 참석', from: '2026-09-09', to: '2026-09-10', start: '07:00', end: '20:00', actions: [], web: false };
Object.assign(st, { view: 'all', items: [IT], all: [IT], loadedOnce: true, openDoc: 'TR-1', workplace: '부산',
  trips: { rows: parseTripList(new JSDOM(LIST()).window.document), me: '김거화' } });
await panel.reload();
await until(() => st.after['145580']?.detail, '사전정산의 교통편 읽기');

const card = () => doc.querySelector('#atList li.open');
const head = () => [...card().querySelectorAll('.at-after-head > strong, .at-after-head > .at-after-why')].map((n) => n.textContent);
const redo = () => [...card().querySelectorAll('.at-send-redo button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')]);
const preBtn = () => card().querySelector('.at-send-redo button[data-act="pre-redo"]');
const legs = (act) => [...card().querySelectorAll('.at-legs .at-leg')].map((row) => ({
  icons: [...row.querySelectorAll(`button[data-act="${act}"]`)],
  on: [...row.querySelectorAll(`button[data-act="${act}"]`)].filter((b) => b.classList.contains('active')).map((b) => `${b.dataset.t}${b.classList.contains('first') ? '+' : ''}`),
  what: row.querySelector('.at-leg-what').textContent,
}));
const press = (leg, kind) => legs('pre-leg')[leg === 'go' ? 0 : 1].icons.find((b) => b.dataset.t === kind).click();
const saveBtn = () => card().querySelector('button[data-act="pre-save"]');
const notes = () => [...card().querySelectorAll('.at-after > .at-after-note')].map((n) => n.textContent);
const status = () => doc.getElementById('atStatus').textContent;
const tripline = () => card().querySelector('.at-tripline').textContent;

console.log('정산을 마친 출장 카드 — 여비증빙 송부 칸 아래의 `사전정산 다시하기`');
t('사전·사후정산을 모두 완료한 카드: 맨 아래 보내기 위에 `사전정산 다시하기`·`사후정산 다시하기`가 선다', () => {
  assert.match(tripline(), /여비계산서 145580 · 사후정산 완료/);
  assert.deepEqual([head(), redo()], [['정산 내역', '1박 · 완료'], [['사전정산 다시하기', 'false'], ['사후정산 다시하기', 'false']]]);
  assert.equal(preBtn().title, '사전정산의 교통편(가는 편·오는 편)을 다시 골라 사전정산을 다시 저장합니다');
});
preBtn().click();
t('누르면 사전정산을 다시 작성하는 칸이 선다 — 가는 편·오는 편이 사전정산대로 골라져 있고 아이콘을 누를 수 있다. 누르는 것만으로는 사이트에 아무것도 가지 않는다', () => {
  assert.deepEqual([head(), redo()], [['사전정산', '다시 작성 중'], [['사전정산 다시하기', 'true'], ['사후정산 다시하기', 'false']]]);
  assert.deepEqual(legs('pre-leg').map((l) => [l.on, l.what, l.icons.every((b) => !b.disabled)]),
    [[['train'], 'KTX 부산→서울 일반석 53,700원', true], [['train'], 'KTX 서울→부산 일반석 53,700원', true]]);
  assert.deepEqual([saveBtn().textContent, saveBtn().disabled], ['사전정산 다시 저장', false]);
  assert.deepEqual(notes(), ['교통편을 바꾸지 않으면 사전정산 입력 화면에 있는 그대로 다시 저장합니다']);
  assert.deepEqual([card().querySelector('.at-after-head button[data-act="pre-redo"]').textContent, site.posts.length], ['그만두기', 0]);
});
card().querySelector('button[data-act="pre-open"]').click();
t('머리의 ↗ 는 사전정산 입력 화면을 새 탭으로 연다 — 교통편 말고 다른 칸은 거기서 고친다', () => {
  assert.equal(opened.at(-1), 'https://eclass.krs.co.kr/BusinessTrip/Write?seq=145580&mode=E&returnUrl=%2FBusinessTrip%2FHome%2FList');
});
press('go', 'train');
press('back', 'plane');
t('기차를 한 번 더 누르면 특실(운임표의 정가), 비행기를 고르면 그 편은 사전정산에 줄을 넣지 않는다 — 아직 패널만 아는 값이다', () => {
  assert.deepEqual(legs('pre-leg').map((l) => [l.on, l.what]),
    [[['train+'], 'KTX 부산→서울 특실 78,900원 · 바꿈'], [['plane'], '비행기 — 사전정산에는 교통편 줄을 넣지 않습니다']]);
  assert.deepEqual([notes(), site.posts.length, store.attendLegs], [[], 0, undefined], '사후정산용으로 골라 두는 편(attendLegs)은 건드리지 않는다');
});
card().querySelector('.at-after-head button[data-act="pre-redo"]').click();
t('`그만두기`를 누르면 정산 내역으로 돌아가고 고른 것은 버린다', () => {
  assert.deepEqual([head(), redo()[0], site.posts.length], [['정산 내역', '1박 · 완료'], ['사전정산 다시하기', 'false'], 0]);
  preBtn().click();
  assert.deepEqual(legs('pre-leg').map((l) => l.on), [['train'], ['train']]);
});

console.log('바꾼 것 없이 다시 저장 — 화면에 있는 그대로 (저장해도 단계가 그대로인 사이트)');
saveBtn().click();
t('첫 번째 누름은 무엇을 다시 저장하는지 적어 보여주기만 한다', () => {
  assert.deepEqual([saveBtn().textContent, site.posts.length], ['한 번 더 → 다시 저장', 0]);
  assert.equal(status(), '다시 저장할 사전정산 — 여비계산서 145580 · 화면에 있는 그대로');
});
saveBtn().click();
await until(() => site.posts.length === 1 && !st.after['145580'].busy, '그대로 다시 저장');
t('두 번째 누름에 사전정산 입력 화면의 폼이 그대로 나간다 — 줄은 하나도 바뀌지 않는다', () => {
  const body = site.posts[0];
  assert.deepEqual([body.get('seq'), body.getAll('tr_seq'), body.getAll('tr_del'), body.get('__RequestVerificationToken')], ['145580', ['153340', '153341'], ['0', '0'], 'tok-write']);
  assert.deepEqual([...body], formFields(new JSDOM(WRITE('145580')).window.document));
});
t('사이트가 단계를 그대로 두었으면 카드는 정산 내역으로 돌아가고, 다시 저장했다는 말과 지금 단계가 적힌다', () => {
  assert.deepEqual([head(), redo()[0]], [['정산 내역', '1박 · 완료'], ['사전정산 다시하기', 'false']]);
  assert.deepEqual(notes(), ['사전정산을 다시 저장했습니다 — 화면에 있는 그대로 · 지금 단계: 사후정산 완료']);
  assert.equal(status(), '사전정산을 다시 저장했습니다 — 여비계산서 145580 · 화면에 있는 그대로 · 사후정산 완료');
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && l.text === '여비계산서(사전정산) 다시 저장: 145580 · 화면에 있는 그대로 · 사후정산 완료'));
});

console.log('사이트가 저장을 받지 않으면 — 저장했다고 하지 않는다');
site.ignore = true;
preBtn().click();
press('go', 'train');
press('back', 'plane');
saveBtn().click();
t('첫 번째 누름에 무엇이 바뀌는지 적힌다', () => {
  assert.equal(status(), '다시 저장할 사전정산 — 여비계산서 145580 · 가는 편 KTX 부산→서울 특실 78,900원 · 오는 편 비행기 — 사전정산에는 교통편 줄을 넣지 않습니다');
});
saveBtn().click();
await until(() => site.posts.length === 2 && !st.after['145580'].busy, '받지 않는 저장');
t('보낸 뒤 화면을 다시 읽어 교통편이 그대로면 까닭을 적고 멈춘다 — 다시 작성하는 칸과 고른 것은 그대로 남는다', () => {
  assert.deepEqual(head(), ['사전정산', '다시 작성 중']);
  assert.equal(card().querySelector('.at-after-note.error').textContent, '사전정산 다시 저장 실패: 저장을 보냈지만 사전정산의 교통편이 바뀌지 않았습니다. eclass 의 사전정산 입력 화면에서 확인해 주세요.');
  assert.match(status(), /^사전정산 다시 저장 실패: /);
  assert.deepEqual(legs('pre-leg').map((l) => l.on), [['train+'], ['plane']]);
  assert.ok(logs.some((l) => l.kind === 'trip' && !l.ok && /^여비계산서\(사전정산\) 다시 저장 실패: 145580 — /.test(l.text)));
});

console.log('바꾼 편을 다시 저장 — 사이트가 단계를 사전정산 "작성"으로 되돌린다');
Object.assign(site, { ignore: false, flip: true });
site.fees.length = 0;
saveBtn().click();
saveBtn().click();
await until(() => site.posts.length === 3 && !st.after['145580'].busy, '바꾼 편을 다시 저장');
t('바꾼 편의 줄은 지움 표시되고(tr_del = 1), 가는 편의 새 줄(KTX 특실 정가 · 출발 7시 → 도착 11시)이 사내 요금표의 같은 항목과 이어져 얹힌다 — 비행기로 고른 오는 편은 줄이 없다', () => {
  const body = site.posts[2];
  assert.deepEqual([body.getAll('tr_seq'), body.getAll('tr_del')], [['153340', '153341', ''], ['1', '1', '0']]);
  assert.deepEqual(['tr_date', 'tr_dep', 'tr_arr', 'tr_transport', 'tr_grade', 'tr_total', 'tr_shr', 'tr_ehr', 'tr_trseq', 'tr_revno', 'tr_currency'].map((n) => body.getAll(n).at(-1)),
    ['2026-09-09', '부산', '서울', 'Train', '특실', '78900', '7', '11', '9001', '3', 'KRW']);
  assert.deepEqual(site.fees, ['부산→서울']);
  assert.deepEqual([body.get('seq'), body.getAll('stay_seq'), body.get('travelerSabuns')], ['145580', ['124928'], '11115'], '나머지 칸은 화면에 있던 그대로다');
});
t('목록을 다시 읽어 지금 단계(사전정산 작성)대로 카드를 그린다 — `사전정산 완료`가 서고, 다시 읽은 교통편이 가는 편·오는 편의 새 바탕이다', () => {
  assert.match(tripline(), /여비계산서 145580 · 사전정산 작성/);
  assert.deepEqual(head(), ['사전정산', '작성 중 · 1박']);
  assert.equal(card().querySelector('button[data-act="pre-done"]').textContent, '사전정산 완료');
  assert.deepEqual(legs('leg').map((l) => [l.on, l.what]), [[['train+'], 'KTX 부산→서울 특실 78,900원'], [[], '고르지 않음']]);
  assert.match(notes().join('\n'), /사전정산을 다시 저장했습니다 — 가는 편 KTX 부산→서울 특실 78,900원 · 오는 편 비행기 — 사전정산에는 교통편 줄을 넣지 않습니다 · 지금 단계: 사전정산 작성 — `사전정산 완료`를 누르거나 증빙을 넣으면 다시 확정합니다/);
  assert.deepEqual(st.after['145580'].detail.rows.map((r) => [r.seq, r.grade, r.total]), [['153400', '특실', 78900]]);
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && /^여비계산서\(사전정산\) 다시 저장: 145580 · 가는 편 KTX 부산→서울 특실 78,900원 · .* · 사전정산 작성$/.test(l.text)));
});
t('사전정산을 쓰는 중에도 `사전정산 다시하기`는 남는다(또 고칠 수 있다) — `사후정산 다시하기`는 없다. 그 출장지의 교통편으로도 기억한다', () => {
  assert.deepEqual(redo(), [['사전정산 다시하기', 'false']]);
  assert.equal(card().querySelector('.at-send-btns'), null, '아직 보낼 때가 아니다 — 보내기는 없다');
  assert.deepEqual([store[ROUTES_KEY]['경기도 고양시 킨텍스'].path, store[ROUTES_KEY]['경기도 고양시 킨텍스'].trainGrade], [['부산', '서울'], 'first']);
});

console.log(`\n통과 ${pass}건`);
process.exit(0);   // 패널이 걸어 둔 타이머(두 번 누르기)가 남아 있어도 끝낸다
