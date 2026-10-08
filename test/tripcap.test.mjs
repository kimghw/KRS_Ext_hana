// 출장 카드의 웹페이지 캡처 — 증빙 넣는 곳(사후정산 칸·여비증빙 송부 칸) 아래에 공문 탭과 같은 "웹페이지 골라 통째로 캡처해 읽기"가
// 선다(webpick.js, 2026-10-08 사용자 지정: "여기도 웹페이지 카피 공문처럼 하게해줘.. 2개 동일한 기능으로"). 고른 페이지 하나가 PDF 하나
// (증빙 한 장)가 되어 그 칸에 파일을 넣은 것과 같은 길로 간다 — 사후정산 칸이면 읽어서 올리고, 송부 칸이면 그 칸의 증빙 넣기와 같다.
// 패널을 진짜 화면(sidepanel.html)에 붙여 누른다. 크롬(탭·찍기)·eclass 여비계산서·Claude API 는 흉내 낸다 — **실제로는 아무것도 나가지 않는다.**
// 탭 고르기 칸 자체(전체·반쯤 표시·권한·보던 탭으로 돌아오기)는 test/wiring.test.mjs 의 공문 탭 캡처가 본다 — 같은 칸이다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, what, ms = 15000) => {
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
globalThis.File = window.File;   // 캡처가 만드는 File 을 이 창의 FileReader 가 읽을 수 있어야 한다

/* ------------------------------------------------------------ 가짜 크롬 — 탭·권한·찍기 */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
// 이 창(7)에서 보고 있는 탭(32)은 Outlook 받은 편지함이고, 대한항공 전자항공권 화면(31)은 뒤에 있다. 확장 화면 탭(33)은 목록에서 빠진다.
const tabs = [
  { id: 31, url: 'https://www.koreanair.com/booking/eticket', title: '전자항공권 확인증 - 대한항공', status: 'complete' },
  { id: 32, url: 'https://outlook.office.com/mail/', title: '메일 - 받은 편지함 - Outlook', status: 'complete' },
  { id: 33, url: 'chrome://extensions/', title: '확장 프로그램', status: 'complete' },
];
const cap = { front: 32, fronted: [], shots: 0, perms: 0, has: false };
const store = {};
globalThis.chrome = {
  storage: { local: { get: async () => store, set: async (obj) => { Object.assign(store, obj); } } },
  runtime: { sendNativeMessage: async () => { throw new Error('no host'); } },
  windows: { getCurrent: async () => ({ id: 7 }) },
  permissions: { contains: async () => cap.has, request: async () => { cap.perms++; cap.has = true; return true; } },
  tabs: {
    query: async (q) => (q.windowId !== 7 ? [] : tabs.filter((x) => !q.active || x.id === cap.front).map((x) => ({ ...x, active: x.id === cap.front }))),
    update: async (id, props) => { if (props.active) { cap.front = id; cap.fronted.push(id); } return { id }; },
    get: async (id) => ({ ...tabs.find((x) => x.id === id), active: id === cap.front }),
    create: async () => {},
    captureVisibleTab: async () => {
      assert.equal(cap.front, 31, '찍을 때는 고른 탭이 앞에 있어야 한다');
      cap.shots++;
      return `data:image/png;base64,${PNG.toString('base64')}`;
    },
  },
  // 전자항공권 화면 — 높이 1500, 뷰포트 800×1000: 두 화면을 찍어 A4 한 장(800×1131)과 나머지 한 장으로 자른다.
  scripting: {
    executeScript: async ({ target, func, args }) => {
      assert.equal(target.tabId, 31);
      if (func.name === 'pageInfo') {
        return [{ result: { url: tabs[0].url, title: tabs[0].title, scrollHeight: 1500, viewportHeight: 1000, viewportWidth: 800, dpr: 1, scrollY: 0,
          text: '전자항공권 확인증\n\n승객  김거화\nKE1415  김포 → 김해  2026-09-10 19:00\n총액  98,000원' } }];
      }
      if (func.name === 'pageStep') return [{ result: Math.min(args[0], 500) }];
      if (func.name === 'pageDone') return [{ result: null }];
      throw new Error(`모르는 함수 ${func.name}`);
    },
  },
};
// 가짜 캔버스 — 장마다 1×1 PNG 를 낸다(PDF 로 묶을 수 있는 진짜 그림). 그림은 뷰포트와 같은 폭(배율 1).
globalThis.OffscreenCanvas = class {
  constructor(w, h) { this.width = w; this.height = h; }
  getContext() { return { fillRect() {}, drawImage() {} }; }
  async convertToBlob({ type }) { return new window.Blob([PNG], { type }); }
};
globalThis.createImageBitmap = async () => ({ width: 800, height: 1000, close() {} });

/* ------------------------------------------------------------ 가짜 eclass 여비계산서와 Claude */

const page = (body) => new Response(`<html><body>${body}${' '.repeat(1600)}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const site = { post: '대기', posts: [], asks: [], record: null };
const LIST = () => `<div class="bt-topmenu"><span class="bt-user"> 김거화 (kimghw) / KOR | ENG </span></div><table id="mainList"><tbody><tr>
<td data-href="/BusinessTrip/Write?seq=145580&amp;mode=E">145580</td><td>김거화</td><td data-href="/BusinessTrip/CalPrint?seq=145580&amp;trseq=157777"> </td>
<td><span>완료</span></td><td><span>${site.post}</span></td><td>2026-09-09~2026-09-10</td><td>경기도 고양시 킨텍스</td><td>김거화</td><td>2026-09-01</td></tr></tbody></table>
<div class="bt-pager"><div>전체 1건 · 1/1 페이지</div></div>`;
const AFTER = () => `<form method="post" id="frm" enctype="multipart/form-data" action="/BusinessTrip/AfterTrip/Save">
<input type="hidden" name="seq" value="145580"><input type="hidden" name="trseq" value="157777"><input type="hidden" name="air_seq" value="">
<select name="air_abroad"><option value="N" selected="selected">N</option><option value="Y">Y</option></select>
<select name="air_bizmile"><option value="Y" selected="selected">Y</option></select><input type="text" name="air_bizairline" value=""><input type="text" name="air_mileage" value="">
<select name="air_deduction"><option value="Y" selected="selected">Y</option></select><input type="hidden" name="air_miles" value=""><input type="text" name="air_comment" value="">
<select name="air_mileusage"><option value="N" selected="selected">N</option></select><input type="text" name="air_usemileage" value="">
<table><tbody id="trBody"></tbody></table><input name="__RequestVerificationToken" type="hidden" value="tok"></form>`;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('api.anthropic.com')) {
    site.asks.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(site.record) }] }) };
  }
  if (init.method === 'POST') {
    if (!u.endsWith('/BusinessTrip/AfterTrip/Save')) throw new Error('모르는 저장 주소 ' + u);
    site.posts.push(init.body);
    site.post = '작성';
    return page('ok');
  }
  if (u.includes('/Home/List')) return page(LIST());
  if (u.includes('/BusinessTrip/AfterTrip?')) return page(AFTER());
  throw new Error('모르는 주소 ' + u);
};

/* ------------------------------------------------------------ 패널 */

const { createAttendPanel } = await import('../attendpanel.js');
const { createEvidenceStore } = await import('../src/evidence.js');
const { createWebPick, pagePdfs, pageName, NO_TABS } = await import('../webpick.js');
const shelf = new Map();
const evidence = createEvidenceStore({ set: async (k, v) => { shelf.set(k, v); }, delete: async (k) => { shelf.delete(k); }, all: async () => [...shelf.values()] });
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logs = [];
const keys = { api: 'sk-x' };
const panel = createAttendPanel({
  $: (id) => doc.getElementById(id), escapeHtml,
  logEvent: (kind, ok, text) => logs.push({ kind, ok, text }), ai: () => ({ apiKey: keys.api, cli: false }), evidence,
});
panel.wire();

const KTX = (seq, dep, arr) => ({ seq, trseq: '7380', revno: '', date: '2026-09-09', dep, arr, transport: 'Train', grade: '일반석', total: 53700, currency: 'KRW' });
const IT = { docNo: 'TR-1', formId: 'TR', status: '5', statusName: '결재완료', kindName: '국내출장', summary: '국내출장 9/9~9/10 07:00~20:00',
  reason: 'K-Battery Show 참석', from: '2026-09-09', to: '2026-09-10', start: '07:00', end: '20:00', actions: [], web: false };
const st = panel.state;
Object.assign(st, {
  view: 'all', items: [IT], all: [IT], loadedOnce: true, openDoc: 'TR-1', workplace: '부산',
  trips: { rows: [{ seq: '145580', href: '/BusinessTrip/Write?seq=145580&mode=E', pre: '완료', from: '2026-09-09', to: '2026-09-10', location: '경기도 고양시 킨텍스',
    writer: '김거화', written: '2026-09-01', travelers: [{ name: '김거화', post: '대기', trseq: '157777' }] }], me: '김거화' },
});
st.after['145580'] = { detail: { rows: [KTX('153340', '부산', '서울'), KTX('153341', '서울', '부산')], transports: ['Train', 'Train'] } };
await panel.reload();   // HR 에는 닿지 못한다 — 앉혀 둔 신청 내역이 그대로 그려진다

const q = (sel) => doc.querySelector(`#atList ${sel}`);
const pickBox = (id) => q(`.wp-tabs input[data-tab="${id}"]`);
const goBtn = () => q('.wp-tabs button[data-pick="go"]');
const DAY = /\d{4}-\d{2}-\d{2}/.source;

console.log('탭 고르기 칸(webpick.js) — 공문 탭과 출장 카드가 같이 쓴다');
await ta('탭이 하나뿐이면 그것이 골라져 펴지고, 찍을 탭이 없으면 까닭을 던진다. 같은 곳을 다시 누르면 접힌다', async () => {
  const one = createWebPick({ escapeHtml, listTabs: async () => [{ id: 5, url: 'https://a.com/', title: 'A', host: 'a.com', active: true }] });
  assert.equal(await one.toggle('x'), true);
  assert.deepEqual([...one.state.pick], [5]);
  assert.match(one.html('x'), /data-pick="go">고른 1개 캡처해 읽기</);
  assert.equal(one.html('y'), '', '다른 곳에는 펴지 않는다');
  assert.equal(await one.toggle('x'), false);
  assert.equal(one.html('x'), '');
  const none = createWebPick({ escapeHtml, listTabs: async () => [] });
  await assert.rejects(() => none.toggle('x'), { message: NO_TABS });
});
await ta('페이지 하나가 PDF 하나 — 이름은 화면캡처_사이트_날짜.pdf, 보관함에 이미 있는 이름은 _2 로 비킨다', async () => {
  const tile = new window.File([PNG], 't.png', { type: 'image/png' });
  const pages = [{ host: 'agoda.com', title: '예약 확인', text: '글', files: [tile, tile] }, { host: 'agoda.com', title: '영수증', text: '', files: [tile] }, { host: 'x.com', files: [] }];
  const got = await pagePdfs(pages, { today: '2026-10-08', taken: ['화면캡처_agoda.com_2026-10-08.pdf'], shrink: async (f) => f });
  assert.deepEqual(got.map((d) => [d.file.name, d.file.type, d.pages, d.text]),
    [['화면캡처_agoda.com_2026-10-08_2.pdf', 'application/pdf', 2, '글'], ['화면캡처_agoda.com_2026-10-08_3.pdf', 'application/pdf', 1, '']]);
  assert.equal(pageName('a b/c.com', ''), '화면캡처_abc.com.pdf');
});

console.log('사후정산 칸 — 증빙 넣는 곳 아래의 웹페이지 캡처: 고른 전자항공권 화면이 PDF 한 장이 되어 읽히고 사후정산에 올라간다');
t('증빙 넣는 곳 바로 아래에 공문 탭과 같은 "웹페이지 골라 통째로 캡처해 읽기" 단추가 있고, 목록은 접혀 있다', () => {
  const btn = q('.at-after .at-cap button[data-pick="open"]');
  assert.ok(btn, '사후정산 칸 안에 있어야 한다');
  assert.equal(btn.textContent, '웹페이지 골라 통째로 캡처해 읽기');
  assert.equal(btn.previousElementSibling, null);
  assert.ok(btn.closest('.at-cap').previousElementSibling.classList.contains('at-after-drop'), '증빙 넣는 곳 바로 아래');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.match(btn.title, /페이지 하나가 PDF 하나\(증빙 한 장\)가 됩니다/);
  assert.equal(q('.wp-tabs'), null);
});
q('.at-after button[data-pick="open"]').click();
await until(() => q('.wp-tabs'), '탭 목록 펴기');
t('누르면 이 창의 웹페이지 탭을 늘어놓는다 — 확장 화면은 빼고, 보고 있는 탭을 적고, 아무것도 미리 고르지 않는다', () => {
  assert.ok(q('.at-after .wp-tabs'), '누른 칸(사후정산 칸)에 편다');
  assert.equal(q('.at-after button[data-pick="open"]').getAttribute('aria-expanded'), 'true');
  assert.deepEqual([...doc.querySelectorAll('#atList .wp-tab')].map((r) => r.textContent),
    ['전자항공권 확인증 - 대한항공koreanair.com', '메일 - 받은 편지함 - Outlookoutlook.office.com · 보고 있는 탭']);
  assert.ok(!pickBox(31).checked && !pickBox(32).checked);
  assert.deepEqual([goBtn().disabled, goBtn().textContent], [true, '캡처할 웹페이지를 고르세요']);
  assert.equal(cap.perms, 0, '권한은 찍을 때 묻는다');
});
pickBox(31).click();
t('하나를 고르면 전체는 반쯤 표시되고 캡처 단추가 열린다', () => {
  const all = q('.wp-tabs input[data-pick="all"]');
  assert.ok(pickBox(31).checked && all.indeterminate && !all.checked);
  assert.deepEqual([goBtn().disabled, goBtn().textContent], [false, '고른 1개 캡처해 읽기']);
});
await panel.reload();
t('카드를 다시 그려도(innerHTML 을 통째로 바꾼다) 펴 둔 목록과 고른 것, 반쯤 표시가 남는다', () => {
  assert.ok(pickBox(31).checked && !pickBox(32).checked && q('.wp-tabs input[data-pick="all"]').indeterminate);
  assert.equal(goBtn().textContent, '고른 1개 캡처해 읽기');
});
site.record = {
  docType: 'flight_receipt', vendor: '대한항공', bizNo: null, payDate: '2026-09-08', checkIn: null, checkOut: null, nights: null, total: 98000, supply: null, vat: null,
  currency: 'KRW', corporateCard: null, airline: '대한항공', flightNo: 'KE1415', flightDate: '2026-09-10', depPlace: '김포', arrPlace: '김해', depTime: '19:00', arrTime: '20:05',
  seatClass: '일반석', retDate: null, retDepPlace: null, retArrPlace: null, retDepTime: null, retFlightNo: null, mileage: 210, passenger: '김거화', extra: null,
  summary: '대한항공 KE1415 김포→김해 전자항공권 98,000원',
};
goBtn().click();
await wait(20);
t('캡처를 누르면 목록이 접히고, 사이트 접근 권한을 묻고, 고른 탭을 앞에 두며, 찍는 동안 증빙 넣는 곳과 단추가 잠긴다', () => {
  assert.equal(q('.wp-tabs'), null);
  assert.equal(cap.perms, 1);
  assert.deepEqual(cap.fronted, [31]);
  assert.ok(q('.at-after button[data-pick="open"]').disabled);
  assert.ok(q('.at-after-drop input[type="file"]').disabled);
  assert.match(doc.getElementById('atStatus').textContent, /웹페이지를 캡처하는 중입니다/);
});
await until(() => site.posts.length === 1 && !st.after['145580'].busy, '캡처한 항공권을 읽고 올리기');
await ta('두 화면을 찍은 뒤 보던 탭(Outlook)으로 돌아오고, 그 페이지가 PDF 한 장(두 쪽)으로 한 번 읽힌다 — 화면 글자도 함께', async () => {
  assert.equal(cap.shots, 2);
  assert.deepEqual(cap.fronted, [31, 32]);
  assert.equal(site.asks.length, 1, '페이지 하나는 증빙 하나 — 장마다 읽지 않는다');
  const content = site.asks[0].messages[0].content;
  const docs = content.filter((c) => c.type === 'document');
  assert.equal(docs.length, 1);
  assert.equal(docs[0].source.media_type, 'application/pdf');
  const { PDFDocument } = await import('../vendor/pdf-lib.esm.min.js');
  assert.equal((await PDFDocument.load(Buffer.from(docs[0].source.data, 'base64'))).getPageCount(), 2, 'A4 두 쪽');
  const input = JSON.stringify(content);
  assert.match(input, new RegExp(`첨부한 문서\\(파일 이름: 화면캡처_koreanair\\.com_${DAY}\\.pdf\\)`));
  assert.match(input, /이 문서는 웹페이지를 통째로 캡처한 것입니다/);
  assert.match(input, /\[웹페이지 글자 — 전자항공권 확인증 - 대한항공\] https:\/\/www\.koreanair\.com\/booking\/eticket\\n전자항공권 확인증\\n\\n승객 김거화\\nKE1415 김포 → 김해/);
});
await ta('읽은 항공권은 파일을 넣은 것과 똑같이 오는 편에 앉아 사후정산에 올라가고, PDF 는 "항공기 증명"으로 보관된다', async () => {
  const body = site.posts[0];
  assert.deepEqual([body.getAll('tr_transport'), body.getAll('tr_total')], [['기차(KTX등)', '비행기'], ['53700', '98000']]);
  const kept = await evidence.list('TR-1');
  assert.deepEqual(kept.map((k) => [k.label, k.type]), [['항공기 증명', 'application/pdf']]);
  assert.match(kept[0].name, new RegExp(`^화면캡처_koreanair\\.com_${DAY}\\.pdf$`));
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && /웹페이지 캡처\(증빙\): 145580 · koreanair\.com 화면 2개 → 2장/.test(l.text)));
  assert.match(doc.getElementById('atStatus').textContent, /^사후정산을 올렸습니다 — /);
});

console.log('여비증빙 송부 칸 — 사후정산을 완료한 출장: 증빙 넣기 아래의 같은 단추, 캡처한 페이지는 그 칸의 증빙 넣기와 같은 길로 간다');
site.post = '완료';
st.trips.rows[0].travelers[0].post = '완료';
keys.api = '';   // Claude 가 닿지 않으면 송부 칸의 증빙 넣기는 읽지 않고 그대로 담는다
await panel.reload();
await wait(30);
t('송부 칸의 증빙 넣기 바로 아래에 같은 단추가 선다 — 사후정산 칸은 접혀 있어(완료) 단추는 하나다', () => {
  const add = q('.at-send .at-send-add');
  assert.ok(add, '증빙 넣기가 있다');
  assert.equal(add.querySelector('span').textContent, '증빙 더 넣기 · 읽지 않고 그대로 묶습니다');
  const btn = q('.at-send .at-cap button[data-pick="open"]');
  assert.ok(btn.closest('.at-cap').previousElementSibling === add, '증빙 넣기 바로 아래');
  assert.equal(btn.textContent, '웹페이지 골라 통째로 캡처해 읽기');
  assert.equal(doc.querySelectorAll('#atList button[data-pick="open"]').length, 1);
});
q('.at-send button[data-pick="open"]').click();
await until(() => q('.at-send .wp-tabs'), '송부 칸에 탭 목록 펴기');
pickBox(31).click();
goBtn().click();
await until(() => cap.shots === 4 && !st.after['145580'].busy && shelf.size === 2, '캡처한 페이지를 보관함에 담기');
await ta('찍은 페이지는 읽지 않고 보관함에 담긴다 — 같은 날 같은 사이트라 이름이 _2 로 비켜 앞의 증빙을 덮지 않는다', async () => {
  const kept = await evidence.list('TR-1');
  assert.deepEqual(kept.map((k) => k.label), ['항공기 증명', '증빙']);
  assert.match(kept[1].name, new RegExp(`^화면캡처_koreanair\\.com_${DAY}_2\\.pdf$`));
  assert.equal(site.asks.length, 1, '읽지 않았다');
  assert.equal(site.posts.length, 1, '사후정산은 그대로다');
  assert.deepEqual(cap.fronted, [31, 32, 31, 32]);
});

console.log(`\n통과 ${pass}건`);
