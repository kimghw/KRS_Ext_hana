// 사전정산 다시하기 — 출장 카드의 여비증빙 송부 칸 아래 `사전정산 다시하기`(2026-10-05 사용자 지정: "여기에서 사후정산 다시하기,
// 사전정산 다시하기 기능이 있으면 좋겠어. 맨 아래 다시 보내기 했으면 좋겠고").
//
// 못 박는 것: 누르면 사전정산을 다시 작성하는 칸(가는 편·오는 편의 교통편 아이콘)이 서고, `사전정산 다시 저장`의 두 번째 누름에
// 사전정산 입력 화면(고치기)의 폼이 그대로 나간다 — 바꾼 편의 줄만 지움 표시되고 새 줄이 얹힌다. 저장한 뒤의 단계는 사이트가
// 정한 대로 따른다(사전정산 "작성"으로 돌아가든, 완료로 남든). 사이트가 받지 않으면(줄이 그대로면) 저장했다고 하지 않는다.
// 셈은 src/travel.js 의 prePlan·preEditBody, 보내는 것은 src/trip.js 의 tripPreSave 다.
//
// 일비·식비 한 줄(같은 날 사용자 지정: "정산내역에서 사전정산에서의 일비랑 식비를 한줄에 표기하고.. 식비는 아이콘으로 줄이거나 늘릴 수 있게
// 해줘. 그리고 이게 갱신되면 사전정산을 다시 진행될 수 있도록") — 정산 내역의 편 아래에 `일비 2일 · 식비 − 6식 +` 가 서고, − + 를 누르면
// 사전정산을 다시 작성하는 칸이 열려 `사전정산 다시 저장`이 그 일비·식비 줄의 식수(stay_meal)만 바꿔 보낸다(stayPlan·preEditBody 의 meals).
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
// 일비·식비 줄은 실제 화면처럼 두 줄이다 — 일수 2·일비 2·식수 6 인 줄과, 값이 모두 0 인 빈 줄.
const STAYS = () => [{ seq: '124928', day: '2', daily: '2', long: '0', meal: '6' }, { seq: '124929', day: '0', daily: '0', long: '0', meal: '0' }];
const site = { pre: '완료', post: '완료', rows: [KTX('153340', '부산', '서울'), KTX('153341', '서울', '부산')], stays: STAYS(), next: 153400, flip: false, ignore: false, posts: [], fees: [] };
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
const STAY = (s) => `<tr><td><input type="hidden" name="stay_seq" value="${s.seq}" /><input type="hidden" name="stay_del" value="0" /><input type="hidden" name="stay_conname" value="" />
${pick('stay_region', 'KR||')}</td><td><input type="text" name="stay_day" value="${s.day}" size="4" /> 일</td><td><input type="text" name="stay_daily" value="${s.daily}" size="4" /> 일
<div class="stayLongWrap">장기:<input type="text" name="stay_long" value="${s.long}" size="4" /> 일</div></td><td><input type="text" name="stay_meal" value="${s.meal}" size="4" /> 식
<input type="hidden" name="stay_dailyamt" value="0" /><input type="hidden" name="stay_mealamt" value="0" /></td><td><button type="button" onclick="delRow(this)">×</button></td></tr>`;
const WRITE = (seq) => `<form id="frm" method="post" action="/BusinessTrip/Write/Save" onsubmit="return checkSubmit();">
<input type="hidden" name="seq" value="${seq}"><input type="hidden" name="travelerForeign" value="K"><input type="hidden" id="travelerSabuns" name="travelerSabuns" value="11115">
${pick('period', '0', ['0', '1'])}<input type="date" id="sDate" name="sDate" value="2026-09-09">${pick('sHour', '7')}<input type="date" name="eDate" value="2026-09-10">${pick('eHour', '20')}
<input type="text" name="location" value="고양"><textarea name="purpose">K-Battery Show 참석</textarea>${pick('nationCD', 'KR||')}
<table><tbody id="stayBody">${site.stays.map(STAY).join('')}</tbody></table>
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
      // 일비·식비 줄은 보낸 칸 그대로 적힌다.
      site.stays = body.getAll('stay_seq').map((seq, i) => Object.fromEntries([['seq', seq], ...['day', 'daily', 'long', 'meal'].map((n) => [n, body.getAll(`stay_${n}`)[i]])]));
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

const { prePlan, preEditBody, formFields, parseTransRows, parseTripList, parseStayRows, stayPlan, legDiffs } = await import('../src/travel.js');
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

// 2026-10-05 사용자 지정: "여비계산서 상의 값을 기본적으로 갖어오도록 해줘, 갖어온 상태에서 수정을 할 수 있게" — 편의 일자·출발 시·도착 시는
// 여비계산서에 저장된 값이 바탕이고, 카드에서 고친 것(edits)을 얹는다.
console.log('편의 일자·시각 — 여비계산서의 값이 바탕이고 카드에서 고친 것을 얹는다 (prePlan 의 edits · set)');
{
  const edit = (edits, picks = {}) => prePlan({ trip: TRIP, picks, rows: rowsNow(), workplace: '부산', sHour: 7, eHour: 20, edits });
  t('손대지 않으면 편마다 여비계산서에 저장된 일자·출발 시·도착 시 그대로다 — 오는 편도 저장된 일자(출발일)이고 시각은 비어 있다', () => {
    const p = edit({});
    assert.deepEqual(p.legs.map((l) => [l.when, l.edited]), [[{ date: '2026-09-09', shr: 0, ehr: 0 }, false], [{ date: '2026-09-09', shr: 0, ehr: 0 }, false]]);
    assert.deepEqual([p.changed, p.set, p.drop, p.add], [false, null, [], []]);
  });
  t('교통편은 그대로 두고 일자·시각만 고치면 줄을 지우고 다시 넣지 않는다 — 그 줄의 달라진 칸만 고친다', () => {
    const p = edit({ go: { shr: 7 }, back: { date: '2026-09-10', shr: 16, ehr: 20 } });
    assert.deepEqual([p.changed, p.drop, p.add, p.set], [true, [], [], { 153340: { shr: 7 }, 153341: { date: '2026-09-10', shr: 16, ehr: 20 } }]);
    assert.deepEqual(p.legs.map((l) => [l.when, l.base, l.edited]), [[{ date: '2026-09-09', shr: 7, ehr: 0 }, { date: '2026-09-09', shr: 0, ehr: 0 }, true],
      [{ date: '2026-09-10', shr: 16, ehr: 20 }, { date: '2026-09-09', shr: 0, ehr: 0 }, true]]);
  });
  t('저장된 값과 같게 적은 것은 고친 것이 아니다 — 못 쓰는 값(날짜가 아닌 글·24시)도 버린다', () => {
    const p = edit({ go: { date: '2026-09-09', shr: 0 }, back: { date: '내일', ehr: 24 } });
    assert.deepEqual([p.changed, p.set, p.legs.map((l) => l.edited)], [false, null, [false, false]]);
  });
  t('교통편을 바꾼 편이 있으면 줄을 모두 다시 넣는다 — 고친 일자·시각은 다시 넣는 줄에 실린다(새 줄에 채워진 시각도 고칠 수 있다)', () => {
    const p = edit({ go: { ehr: 10 }, back: { date: '2026-09-10', shr: 16, ehr: 20 } }, { go: { t: 'train', g: 'first' } });
    assert.deepEqual([p.drop, p.set], [['153340', '153341'], null]);
    assert.deepEqual(p.add.map((r) => [r.date, r.dep, r.grade, r.shr, r.ehr]), [['2026-09-09', '부산', '특실', 7, 10], ['2026-09-10', '서울', '일반석', 16, 20]]);
    assert.deepEqual(p.legs.map((l) => [l.base, l.edited]), [[{ date: '2026-09-09', shr: 7, ehr: 11 }, true], [{ date: '2026-09-09', shr: 0, ehr: 0 }, true]]);
  });
}

// 2026-10-05 사용자 지정: "저장된 값이 다르면 다른 부분을 확인할 수 있도록" — 실제 계산서(145580)의 줄이 이 가짜 사이트의 줄과 같다:
// 두 줄 모두 일자가 출발일이고 출발·도착 시가 0, 요금은 사내 요금표의 53,700원(운임표의 정가는 54,400원).
console.log('저장된 값이 다른 곳 (legDiffs) — 사이트에 저장된 줄을 출장 일정·운임표와 견준다');
{
  const when = { sHour: 7, eHour: 20 };
  t('가는 편은 시각이 비어 있고 요금이 운임표와 다르다 — 오는 편은 일자도 출발일로 적혀 있다', () => {
    const p = plan({});
    assert.deepEqual(legDiffs(p.legs[0], when), [
      { key: 'time', label: '시각', saved: '없음', by: '출장 시각으로', want: '7시 → 11시', fix: { shr: 7, ehr: 11 } },
      { key: 'fare', label: '요금', saved: '53,700원', by: '운임표', want: '54,400원' }]);
    assert.deepEqual(legDiffs(p.legs[1], when).map((d) => [d.key, d.label, d.saved, d.by, d.want, d.fix]),
      [['date', '일자', '9/9', '출장 일정', '9/10', { date: '2026-09-10' }], ['time', '시각', '없음', '출장 시각으로', '16시 → 20시', { shr: 16, ehr: 20 }],
        ['fare', '요금', '53,700원', '운임표', '54,400원', undefined]]);
  });
  t('값이 맞는 줄은 다른 곳이 없다(적혀 있는 시각은 견주지 않는다) — 카드에서 다시 고른 편과 줄이 없는 편도 견주지 않는다', () => {
    const good = prePlan({ trip: TRIP, picks: {}, rows: [{ ...rowsNow()[0], total: 54400, shr: 8, ehr: 11 }], workplace: '부산' });
    assert.deepEqual([legDiffs(good.legs[0], when), legDiffs(good.legs[1], when)], [[], []]);
    assert.deepEqual(legDiffs(plan({ go: { t: 'train', g: 'first' } }).legs[0], when), []);
  });
  // 2026-10-05 실제 계산서: 사용자가 사이트의 요금표에서 정가(54,400원)로 고치니 등급 글이 그 표의 "일반"이 됐다 — 같은 등급이라 다른 곳이 아니다.
  t('출장의 출발·도착 시를 모르면 시각은 견주지 않는다 — 등급 글(사내 요금표의 "일반"·"E")도 견주지 않는다', () => {
    const rows = ['일반', 'E'].map((grade) => prePlan({ trip: TRIP, picks: {}, rows: [{ ...rowsNow()[0], grade, total: 54400 }], workplace: '부산' }));
    assert.deepEqual(rows.map((p) => legDiffs(p.legs[0], {})), [[], []]);
  });
  t('사후정산 화면에서 읽은 줄은 시각이 글이다 — 수로 맞춰 견준다', () => {
    const post = prePlan({ trip: TRIP, picks: {}, rows: rowsNow().map((r) => ({ ...r, shr: '0', ehr: '0' })), workplace: '부산' });
    assert.deepEqual(legDiffs(post.legs[0], when).map((d) => d.key), ['time', 'fare']);
  });
}

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
    assert.deepEqual([body.getAll('stay_seq'), body.getAll('stay_meal'), body.get('location'), body.get('purpose'), [...body.keys()].at(-1)],
      [['124928', '124929'], ['6', '0'], '고양', 'K-Battery Show 참석', '__RequestVerificationToken']);
  });
  t('다른 계산서의 화면이거나, 토큰이 없거나, 지울 줄이 화면에 없으면 본문을 짓지 않고 던진다', () => {
    assert.throws(() => preEditBody(fields, '999999'), /이 여비계산서의 사전정산 입력 화면이 아닙니다/);
    assert.throws(() => preEditBody(fields.filter(([n]) => n !== '__RequestVerificationToken'), '145580'), /요청 확인 토큰/);
    assert.throws(() => preEditBody(fields, '145580', { drop: ['111'], add: [] }), /지울 교통편 줄이 사전정산 화면에 없습니다/);
  });
  t('식수를 고치면 그 일비·식비 줄의 stay_meal 만 바뀐다 — 빈 줄도, 교통편 줄도, 다른 칸도 화면 그대로다', () => {
    const body = new URLSearchParams(preEditBody(fields, '145580', { meals: { 124928: 5 } }));
    assert.deepEqual([body.getAll('stay_seq'), body.getAll('stay_meal'), body.getAll('stay_day'), body.getAll('stay_daily'), body.getAll('tr_del')],
      [['124928', '124929'], ['5', '0'], ['2', '0'], ['2', '0'], ['0', '0']]);
    assert.deepEqual([...body].map(([n, v], i) => (n === 'stay_meal' && v === '5' ? fields[i] : [n, v])), fields);
  });
  t('일자·시각만 고친 줄은 그 줄의 tr_date·tr_shr·tr_ehr 만 바뀐다 — 줄 번호·지움 표시·요금·다른 줄은 화면 그대로다', () => {
    const body = new URLSearchParams(preEditBody(fields, '145580', { set: { 153341: { date: '2026-09-10', shr: 16, ehr: 20 } } }));
    assert.deepEqual([body.getAll('tr_seq'), body.getAll('tr_del'), body.getAll('tr_date'), body.getAll('tr_shr'), body.getAll('tr_ehr'), body.getAll('tr_total')],
      [['153340', '153341'], ['0', '0'], ['2026-09-09', '2026-09-10'], ['0', '16'], ['0', '20'], ['53700', '53700']]);
    assert.equal([...body].filter(([, v], i) => v !== fields[i][1]).length, 3, '달라진 칸은 셋뿐이다');
    assert.throws(() => preEditBody(fields, '145580', { set: { 999: { shr: 7 } } }), /일자·시각을 고칠 교통편 줄이 사전정산 화면에 없습니다/);
  });
  t('식수를 고칠 줄이 화면에 없으면 본문을 짓지 않고 던진다', () => {
    assert.throws(() => preEditBody(fields, '145580', { meals: { 999: 5 } }), /식수를 고칠 일비·식비 줄이 사전정산 화면에 없습니다/);
  });
}

console.log('일비·식비 한 줄 (parseStayRows · stayPlan) — 일수가 적힌 줄만 세고, 식수는 0 부터 일수 × 세 끼까지');
{
  const stays = parseStayRows(writeDoc());
  t('사전정산 입력 화면의 일비·식비 줄을 읽는다 — 값이 모두 0 인 빈 줄까지 그대로', () => {
    assert.deepEqual(stays, [{ seq: '124928', day: 2, daily: 2, long: 0, meal: 6 }, { seq: '124929', day: 0, daily: 0, long: 0, meal: 0 }]);
  });
  t('일수가 적힌 줄만 센다 — 일비 2일 · 식비 6식, 고친 것이 없으면 다시 저장할 것도 없다', () => {
    assert.deepEqual(stayPlan({ stays, period: '0' }), { daily: 2, meal: 6, had: 6, min: 0, max: 6, editable: true, changed: false, set: null });
  });
  t('고쳐 둔 식수는 그 줄의 번호로 다시 저장할 것이 된다 — 0 식 아래로도, 일수 × 세 끼 위로도 가지 않는다', () => {
    assert.deepEqual(stayPlan({ stays, period: '0', want: 4 }), { daily: 2, meal: 4, had: 6, min: 0, max: 6, editable: true, changed: true, set: { 124928: 4 } });
    assert.deepEqual([stayPlan({ stays, period: '0', want: -1 }).meal, stayPlan({ stays, period: '0', want: 9 }).meal, stayPlan({ stays, period: '0', want: 6 }).set], [0, 6, null]);
  });
  t('일수가 적힌 줄이 여럿이면(나라가 여럿) 합만 적는다 — 카드에서는 고치지 않는다', () => {
    const many = [...stays, { seq: '124930', day: 1, daily: 1, long: 0, meal: 2 }];
    assert.deepEqual(stayPlan({ stays: many, period: '0', want: 3 }), { daily: 3, meal: 8, had: 8, min: 0, max: 8, editable: false, changed: false, set: null });
  });
  t('당일출장(주재국)이거나 일수가 적힌 줄이 없으면 적을 줄이 없다', () => {
    assert.deepEqual([stayPlan({ stays, period: '1' }), stayPlan({ stays: stays.slice(1), period: '0' }), stayPlan({ period: '0' })], [null, null, null]);
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
  assert.equal(preBtn().title, '사전정산의 가는 편·오는 편(교통편·일자·시각)과 식비(식수)를 고쳐 사전정산을 다시 저장합니다');
});
preBtn().click();
t('누르면 사전정산을 다시 작성하는 칸이 선다 — 가는 편·오는 편이 사전정산대로 골라져 있고 아이콘을 누를 수 있다. 누르는 것만으로는 사이트에 아무것도 가지 않는다', () => {
  assert.deepEqual([head(), redo()], [['사전정산', '다시 작성 중'], [['사전정산 다시하기', 'true'], ['사후정산 다시하기', 'false']]]);
  assert.deepEqual(legs('pre-leg').map((l) => [l.on, l.what, l.icons.every((b) => !b.disabled)]),
    [[['train'], 'KTX 부산→서울 일반석 53,700원', true], [['train'], 'KTX 서울→부산 일반석 53,700원', true]]);
  assert.deepEqual([saveBtn().textContent, saveBtn().disabled], ['사전정산 다시 저장', false]);
  assert.deepEqual(notes(), ['바꾼 것이 없으면 사전정산 입력 화면에 있는 그대로 다시 저장합니다']);
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
  assert.deepEqual([body.get('seq'), body.getAll('stay_seq'), body.getAll('stay_meal'), body.get('travelerSabuns')], ['145580', ['124928', '124929'], ['6', '0'], '11115'], '나머지 칸은 화면에 있던 그대로다');
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

/* ------------------------------------------------------------ 일비·식비 한 줄 */

// 사이트를 사전·사후정산을 모두 완료한 처음 모양으로 되돌리고 카드를 다시 읽는다.
Object.assign(site, { pre: '완료', post: '완료', flip: false, ignore: false, rows: [KTX('153340', '부산', '서울'), KTX('153341', '서울', '부산')], stays: STAYS() });
st.trips = { rows: parseTripList(new JSDOM(LIST()).window.document), me: '김거화' };
st.after['145580'] = {};
await panel.reload();
await until(() => st.after['145580']?.detail, '사전정산을 다시 읽기');
const posted = site.posts.length;

const stayRow = () => card().querySelector('.at-stay');
const stayText = () => [...stayRow().querySelectorAll('.at-stay-item')].map((n) => n.textContent);
const stayNote = () => stayRow().querySelector('.at-leg-what')?.textContent ?? null;
const step = (d) => stayRow().querySelector(`button[data-act="pre-meal"][data-d="${d}"]`);

const diffBtn = (leg) => card().querySelector(`button[data-act="leg-diff"][data-leg="${leg}"]`);
const diffLines = () => [...card().querySelectorAll('.at-leg-diffs li')].map((li) => [...li.children].map((n) => n.textContent));

console.log('저장된 값이 다른 편 — `다름` 표시를 누르면 어디가 다른지 펴진다');
t('정산 내역의 편마다 저장된 줄이 출장 일정·운임표와 다른 곳의 수가 `다름`으로 선다 — 처음에는 접혀 있다', () => {
  assert.deepEqual([diffBtn('go').textContent, diffBtn('back').textContent, diffBtn('back').getAttribute('aria-expanded'), diffLines()], ['다름 2', '다름 3', 'false', []]);
  assert.equal(diffBtn('back').disabled, false, '보여 주기만 하는 정산 내역에서도 누를 수 있다');
});
diffBtn('back').click();
t('누르면 그 편 아래에 항목마다 저장된 값과 견준 값이 펴진다 — 오는 편은 일자가 출발일이고, 시각이 비어 있고, 요금이 운임표와 다르다', () => {
  assert.deepEqual(diffLines(), [['일자', '저장된 값 9/9', '출장 일정 9/10'], ['시각', '저장된 값 없음', '출장 시각으로 16시 → 20시'], ['요금', '저장된 값 53,700원', '운임표 54,400원']]);
  assert.deepEqual([diffBtn('back').getAttribute('aria-expanded'), site.posts.length], ['true', posted], '보기만 한다 — 사이트에는 아무것도 가지 않는다');
});
diffBtn('go').click();
t('다른 편을 누르면 그 편으로 옮겨 펴진다 — 가는 편은 시각과 요금이 다르다', () => {
  assert.deepEqual(diffLines(), [['시각', '저장된 값 없음', '출장 시각으로 7시 → 11시'], ['요금', '저장된 값 53,700원', '운임표 54,400원']]);
});
diffBtn('go').click();
t('다시 누르면 접힌다', () => {
  assert.deepEqual([diffLines(), diffBtn('go').getAttribute('aria-expanded')], [[], 'false']);
});

console.log('정산 내역의 일비·식비 한 줄 — 식비는 − + 아이콘으로 줄이고 늘린다');
t('정산 내역의 가는 편·오는 편 아래에 사전정산의 일비·식비가 한 줄로 선다 — 일비 2일 · 식비 6식, 식수 양옆에 − + 아이콘', () => {
  assert.deepEqual([head(), stayText(), stayNote()], [['정산 내역', '1박 · 완료'], ['일비2일', '식비6식'], null]);
  assert.ok(card().querySelector('.at-legs').compareDocumentPosition(stayRow()) & window.Node.DOCUMENT_POSITION_FOLLOWING, '가는 편·오는 편 아래에 선다');
  assert.deepEqual([step(-1).getAttribute('aria-label'), step(-1).disabled, step(1).getAttribute('aria-label'), step(1).disabled],
    ['식비 한 끼 줄이기 — 사전정산을 다시 저장할 때 들어갑니다', false, '식비 한 끼 늘리기 — 사전정산을 다시 저장할 때 들어갑니다', true], '이틀이면 여섯 끼가 끝이라 + 는 잠겨 있다');
  assert.ok(step(-1).querySelector('svg') && step(1).querySelector('svg'), '글자가 아니라 아이콘이다');
});
step(-1).click();
t('− 를 누르면 사전정산을 다시 작성하는 칸이 열리고 고친 식수가 적힌다 — 누르는 것만으로는 사이트에 아무것도 가지 않는다', () => {
  assert.deepEqual([head(), redo()[0]], [['사전정산', '다시 작성 중'], ['사전정산 다시하기', 'true']]);
  assert.deepEqual([stayText(), stayNote(), step(1).disabled, notes(), site.posts.length], [['일비2일', '식비5식'], '바꿈 · 사전정산 6식', false, [], posted]);
  assert.deepEqual(legs('pre-leg').map((l) => l.on), [['train'], ['train']], '교통편은 사전정산 그대로다');
});
card().querySelector('.at-after-head button[data-act="pre-redo"]').click();
t('`그만두기`를 누르면 정산 내역으로 돌아가고 고친 식수는 버린다', () => {
  assert.deepEqual([head(), stayText(), stayNote(), site.posts.length], [['정산 내역', '1박 · 완료'], ['일비2일', '식비6식'], null, posted]);
});
step(-1).click();
step(-1).click();
step(-1).click();
step(1).click();
t('여러 번 눌러 고친다(6 → 5 → 4 → 3 → 4 식) — 사전정산의 값과 다르면 `바꿈`이다', () => {
  assert.deepEqual([stayText(), stayNote()], [['일비2일', '식비4식'], '바꿈 · 사전정산 6식']);
});
saveBtn().click();
t('`사전정산 다시 저장`의 첫 번째 누름은 식수가 어떻게 바뀌는지 적어 보여주기만 한다', () => {
  assert.deepEqual([saveBtn().textContent, site.posts.length], ['한 번 더 → 다시 저장', posted]);
  assert.equal(status(), '다시 저장할 사전정산 — 여비계산서 145580 · 식비 6식 → 4식');
});
site.ignore = true;
saveBtn().click();
await until(() => site.posts.length === posted + 1 && !st.after['145580'].busy, '받지 않는 식수 저장');
t('사이트가 받지 않으면(다시 읽은 식수가 그대로면) 저장했다고 하지 않는다 — 고친 식수는 카드에 남는다', () => {
  assert.deepEqual(head(), ['사전정산', '다시 작성 중']);
  assert.equal(card().querySelector('.at-after-note.error').textContent, '사전정산 다시 저장 실패: 저장을 보냈지만 사전정산의 식수가 바뀌지 않았습니다. eclass 의 사전정산 입력 화면에서 확인해 주세요.');
  assert.deepEqual([stayText(), stayNote()], [['일비2일', '식비4식'], '바꿈 · 사전정산 6식']);
});
site.ignore = false;
saveBtn().click();
saveBtn().click();
await until(() => site.posts.length === posted + 2 && !st.after['145580'].busy, '식수를 다시 저장');
t('두 번째 누름에 사전정산 입력 화면의 폼이 나간다 — 그 일비·식비 줄의 식수만 바뀌고, 빈 줄·교통편 줄·다른 칸은 화면 그대로다', () => {
  const body = site.posts.at(-1);
  assert.deepEqual([body.get('seq'), body.getAll('stay_seq'), body.getAll('stay_meal'), body.getAll('stay_daily'), body.getAll('tr_seq'), body.getAll('tr_del'), body.get('__RequestVerificationToken')],
    ['145580', ['124928', '124929'], ['4', '0'], ['2', '0'], ['153340', '153341'], ['0', '0'], 'tok-write']);
});
t('다시 읽은 식수가 카드에 선다 — 사이트가 단계를 그대로 두었으면 정산 내역으로 돌아가고, 다시 저장했다는 말이 적힌다', () => {
  assert.deepEqual([head(), stayText(), stayNote(), step(1).disabled], [['정산 내역', '1박 · 완료'], ['일비2일', '식비4식'], null, false]);
  assert.deepEqual(notes(), ['사전정산을 다시 저장했습니다 — 식비 6식 → 4식 · 지금 단계: 사후정산 완료']);
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && l.text === '여비계산서(사전정산) 다시 저장: 145580 · 식비 6식 → 4식 · 사후정산 완료'));
});

console.log('교통편과 식비를 함께 바꿔 다시 저장 — 사이트가 단계를 사전정산 "작성"으로 되돌린다');
site.flip = true;
step(1).click();
press('go', 'train');
saveBtn().click();
t('첫 번째 누름에 바뀌는 편과 식수가 함께 적힌다', () => {
  assert.equal(status(), '다시 저장할 사전정산 — 여비계산서 145580 · 가는 편 KTX 부산→서울 특실 78,900원 · 식비 4식 → 5식');
});
t('다시 작성하는 칸에서도 저장된 줄 그대로인 편에는 `다름`이 선다 — 다시 고른 편은 새 줄로 바뀔 것이라 견주지 않는다', () => {
  assert.deepEqual([diffBtn('go'), diffBtn('back').textContent], [null, '다름 3']);
});
saveBtn().click();
await until(() => site.posts.length === posted + 3 && !st.after['145580'].busy, '교통편과 식수를 함께 다시 저장');
t('한 번의 저장에 교통편 줄과 식수가 같이 나간다', () => {
  const body = site.posts.at(-1);
  assert.deepEqual([body.getAll('stay_meal'), body.getAll('tr_del'), body.getAll('tr_grade')], [['5', '0'], ['1', '1', '0', '0'], ['일반석', '일반석', '특실', '일반석']]);
});
t('사전정산을 쓰는 중인 카드에도 일비·식비 한 줄이 선다 — `사전정산 완료`를 누르기 전에 식수를 또 고칠 수 있다', () => {
  assert.match(tripline(), /여비계산서 145580 · 사전정산 작성/);
  assert.deepEqual([head(), stayText(), stayNote(), step(-1).disabled, step(1).disabled], [['사전정산', '작성 중 · 1박'], ['일비2일', '식비5식'], null, false, false]);
  assert.equal(card().querySelector('button[data-act="pre-done"]').textContent, '사전정산 완료');
});
t('새로 선 가는 편의 줄(운임표의 정가·출발 7시 → 도착 11시)은 다른 곳이 없다 — 값 그대로 다시 들어간 오는 편은 여전히 `다름`이다', () => {
  assert.deepEqual([diffBtn('go'), diffBtn('back').textContent], [null, '다름 3']);
});

t('사전정산 단계의 출장 줄에는 ↻(다시 읽기)와 1(여비계산서) 둘이다 — 사전정산 아이콘을 따로 세우지 않는다', () => {
  assert.deepEqual([...card().querySelectorAll('.at-tripline button')].map((b) => b.dataset.act), ['trip-refresh', 'trip']);
});

/* ------------------------------------------------------------ 편의 일자·시각 */

// 다시 처음 모양(사전·사후정산 완료, 두 줄 모두 일자가 출발일이고 시각이 0)으로 되돌린다.
Object.assign(site, { pre: '완료', post: '완료', flip: false, ignore: false, rows: [KTX('153340', '부산', '서울'), KTX('153341', '서울', '부산')], stays: STAYS() });
st.trips = { rows: parseTripList(new JSDOM(LIST()).window.document), me: '김거화' };
st.after['145580'] = {};
await panel.reload();
await until(() => st.after['145580']?.detail, '사전정산을 다시 읽기');
const sent = site.posts.length;

const legRow = (leg) => card().querySelectorAll('.at-legs .at-leg')[leg === 'go' ? 0 : 1];
const legName = (leg) => legRow(leg).querySelector('.at-leg-name').textContent;
const legTime = (leg) => legRow(leg).querySelector('.at-leg-time')?.textContent ?? null;
const editOf = (leg, f) => legRow(leg).querySelector(`[data-edit="${f}"]`);
const editVals = (leg) => ['date', 'shr', 'ehr'].map((f) => editOf(leg, f).value);
const setEdit = (leg, f, v) => { const n = editOf(leg, f); n.value = v; n.dispatchEvent(new window.Event('change', { bubbles: true })); };
const fixBtn = (k) => card().querySelector(`button[data-act="leg-fix"][data-k="${k}"]`);

console.log('편의 날짜·시각은 여비계산서에 저장된 값이다 — 사전정산을 다시 작성하는 칸에서 고친다');
t('정산 내역의 편은 저장된 줄의 일자와 출발 시→도착 시를 적는다 — 오는 편도 저장된 일자(9/9)이고, 시각이 비어 있으면 "시각 없음"이다', () => {
  assert.deepEqual([legName('go'), legTime('go'), legName('back'), legTime('back')], ['가는 편 9/9', '시각 없음', '오는 편 9/9', '시각 없음']);
  assert.deepEqual([editOf('back', 'date'), fixBtn('time')], [null, null], '보기만 하는 칸에는 고치는 칸이 없다');
});
preBtn().click();
t('사전정산을 다시 작성하는 칸에는 편마다 일자·출발·도착 칸이 여비계산서의 값을 담고 선다 — 시각은 0시(없음)부터 23시까지 고른다', () => {
  assert.deepEqual([editVals('go'), editVals('back'), legTime('back')], [['2026-09-09', '0', '0'], ['2026-09-09', '0', '0'], null]);
  assert.deepEqual([editOf('back', 'shr').options.length, editOf('back', 'shr').options[0].textContent, editOf('back', 'shr').options[16].textContent], [24, '없음', '16시']);
});
setEdit('back', 'date', '2026-09-10');
setEdit('back', 'ehr', '20');
t('칸을 고치면 그 편의 값으로 적어 둔다 — 고치는 것만으로는 사이트에 아무것도 가지 않는다', () => {
  assert.deepEqual([legName('back'), editVals('back'), notes(), site.posts.length], ['오는 편 9/10', ['2026-09-10', '0', '20'], [], sent]);
  assert.deepEqual(legs('pre-leg').map((l) => [l.on, l.what]), [[['train'], 'KTX 부산→서울 일반석 53,700원'], [['train'], 'KTX 서울→부산 일반석 53,700원']], '교통편은 그대로다');
});
diffBtn('go').click();
t('펴 둔 "다름"의 시각 줄에는 견준 값으로 고치는 "이 값으로"가 붙는다 — 요금 줄에는 없다', () => {
  assert.deepEqual(diffLines().map((l) => l[0]), ['시각', '요금']);
  assert.deepEqual([fixBtn('time').textContent, fixBtn('fare')], ['이 값으로', null]);
});
fixBtn('time').click();
t('누르면 가는 편의 출발·도착 칸이 그 값(7시 · 11시)으로 바뀌고 그 줄에 "고쳐 둠"이 적힌다', () => {
  assert.deepEqual([editVals('go'), fixBtn('time'), card().querySelector('.at-diff-done').textContent, site.posts.length], [['2026-09-09', '7', '11'], null, '고쳐 둠', sent]);
});
saveBtn().click();
t('사전정산 다시 저장의 첫 번째 누름에 고친 일자·시각이 편마다 적힌다', () => {
  assert.equal(status(), '다시 저장할 사전정산 — 여비계산서 145580 · 가는 편 시각 7시→11시 · 오는 편 일자 9/10 시각 ?→20시');
});
saveBtn().click();
await until(() => site.posts.length === sent + 1 && !st.after['145580'].busy, '일자·시각을 다시 저장');
t('두 번째 누름에 그 줄의 일자·출발 시·도착 시만 바뀌어 나간다 — 줄을 지우고 다시 넣지 않는다(번호·요금·요금표 이음 그대로)', () => {
  const body = site.posts.at(-1);
  assert.deepEqual([body.getAll('tr_seq'), body.getAll('tr_del'), body.getAll('tr_date'), body.getAll('tr_shr'), body.getAll('tr_ehr'), body.getAll('tr_total'), body.getAll('tr_trseq')],
    [['153340', '153341'], ['0', '0'], ['2026-09-09', '2026-09-10'], ['7', '0'], ['11', '20'], ['53700', '53700'], ['7380', '7380']]);
  assert.deepEqual(body.getAll('stay_meal'), ['6', '0'], '식수는 건드리지 않았다');
});
t('다시 읽은 값이 카드에 선다 — 고친 일자·시각이 적히고, "다름"은 남은 것(요금 · 오는 편의 출발 시)만 센다', () => {
  assert.deepEqual([head(), legName('go'), legTime('go'), legName('back'), legTime('back')], [['정산 내역', '1박 · 완료'], '가는 편 9/9', '7시→11시', '오는 편 9/10', '?→20시']);
  assert.deepEqual([diffBtn('go').textContent, diffBtn('back').textContent], ['다름 1', '다름 2']);
  assert.deepEqual(notes(), ['사전정산을 다시 저장했습니다 — 가는 편 시각 7시→11시 · 오는 편 일자 9/10 시각 ?→20시 · 지금 단계: 사후정산 완료']);
});
site.ignore = true;
preBtn().click();
setEdit('back', 'shr', '16');
saveBtn().click();
saveBtn().click();
await until(() => site.posts.length === sent + 2 && !st.after['145580'].busy, '받지 않는 시각 저장');
t('사이트가 받지 않으면(다시 읽은 줄의 시각이 그대로면) 저장했다고 하지 않는다 — 고친 값은 칸에 남는다', () => {
  assert.equal(card().querySelector('.at-after-note.error').textContent, '사전정산 다시 저장 실패: 저장을 보냈지만 사전정산의 교통편이 바뀌지 않았습니다. eclass 의 사전정산 입력 화면에서 확인해 주세요.');
  assert.deepEqual([head(), editVals('back')], [['사전정산', '다시 작성 중'], ['2026-09-10', '16', '20']]);
});

/* ------------------------------------------------------------ 여비계산서 줄의 아이콘 */

// 2026-10-05 사용자 지정: "여기 사후정산인 경우 2라고 있는데 사전 정산도 가서 볼 수 있게 사전 정산1도 넣어주라" ·
// "여비계산서 기준으로 관리하도록 했는데... 여기에 계산서 새로고침이 없네".
Object.assign(site, { pre: '완료', post: '완료', flip: false, ignore: false, rows: [KTX('153340', '부산', '서울'), KTX('153341', '서울', '부산')], stays: STAYS() });
st.trips = { rows: parseTripList(new JSDOM(LIST()).window.document), me: '김거화' };
st.after['145580'] = {};
await panel.reload();
await until(() => st.after['145580']?.detail, '사전정산을 다시 읽기');
const lineBtn = (act) => card().querySelector('.at-tripline button[data-act="' + act + '"]');

console.log('여비계산서 줄 — ↻ 다시 읽기 · 1 사전정산 · 2 사후정산');
t('사후정산 단계의 출장 줄에는 ↻ · 1 · 2 가 차례로 선다 — 1 은 사전정산(완료 — 파랑)이다', () => {
  assert.deepEqual([...card().querySelectorAll('.at-tripline button')].map((b) => b.dataset.act), ['trip-refresh', 'trip-pre', 'trip']);
  assert.deepEqual([lineBtn('trip-pre').classList.contains('done'), lineBtn('trip-pre').title], [true, '사전정산을 eclass 에서 열기 — 사전정산 완료']);
  assert.equal(lineBtn('trip-refresh').title, '여비계산서 다시 읽기 — eclass 에서 고친 것(단계·교통편·일비·식비·숙박 줄)을 가져옵니다');
});
lineBtn('trip-pre').click();
t('1 을 누르면 사전정산 입력 화면이 새 탭으로 열린다', () => {
  assert.equal(opened.at(-1), 'https://eclass.krs.co.kr/BusinessTrip/Write?seq=145580&mode=E&returnUrl=%2FBusinessTrip%2FHome%2FList');
});
// 그 사이에 사이트에서 손으로 고쳤다(2026-10-05 실제로 사용자가 그렇게 했다) — 요금표의 정가와 그 표의 등급 글 "일반", 일자·시각, 식수.
site.rows = [{ ...KTX('153340', '부산', '서울'), shr: '9', ehr: '12', total: '54400', grade: '일반' },
  { ...KTX('153341', '서울', '부산'), date: '2026-09-10', shr: '17', ehr: '20', total: '54400', grade: '일반' }];
site.stays[0].meal = '5';
const unsent = site.posts.length;
lineBtn('trip-refresh').click();
await until(() => st.after['145580'].detail.rows[0].total === 54400 && !st.after['145580'].loading, '여비계산서 다시 읽기');
t('↻ 를 누르면 여비계산서를 다시 읽어 사이트에서 고친 값이 카드에 선다 — 읽기만 한다', () => {
  assert.deepEqual([legName('go'), legTime('go'), legName('back'), legTime('back')], ['가는 편 9/9', '9시→12시', '오는 편 9/10', '17시→20시']);
  assert.deepEqual(legs('leg').map((l) => l.what), ['KTX 부산→서울 일반 54,400원', 'KTX 서울→부산 일반 54,400원']);
  assert.deepEqual([stayText(), site.posts.length, head()], [['일비2일', '식비5식'], unsent, ['정산 내역', '1박 · 완료']]);
  assert.equal(status(), '여비계산서 145580 을(를) 다시 읽었습니다 — 사후정산 완료');
});
t('다른 곳이 없으면 "다름" 표시도 없다 — 사내 요금표의 등급 글("일반")은 다른 곳이 아니다', () => {
  assert.deepEqual([diffBtn('go'), diffBtn('back')], [null, null]);
});

console.log(`\n통과 ${pass}건`);
process.exit(0);   // 패널이 걸어 둔 타이머(두 번 누르기)가 남아 있어도 끝낸다
