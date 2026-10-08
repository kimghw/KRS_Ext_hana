// 근태 폼의 차량 조회(attendpanel.js) — 출장·외근 폼에서 '차량 조회'를 켜면 그 날짜·시간에 빈 차량이 폼 아래에 서고,
// 빈 차량을 누르면 **그 자리에서** 그 시간으로 신청한다(2026-10-03 사용자 지정: 차량 탭으로 넘어가지 않는다).
//
// 패널을 진짜 화면(sidepanel.html)에 붙여 눌러 본다. HR 은 닿지 않는 환경이고, 차량 현황을 읽는 길(cars.scan)과
// 신청하는 길(onCar)은 흉내 낸다 — **실제 사이트에는 아무것도 보내지 않는다.** 실제 신청 요청까지 가는 길은 wiring.test.mjs 가 본다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok) => { for (let i = 0; i < 80 && !ok(); i++) await wait(25); };

const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../sidepanel.css', import.meta.url), 'utf8');
const { window } = new JSDOM(html, { url: 'https://example.org/' });
const doc = window.document;
for (const g of ['document', 'DOMParser', 'FileReader', 'Element', 'HTMLElement', 'HTMLInputElement']) globalThis[g] = window[g];
globalThis.window = window;

// 근무지는 부산으로 적어 둔 사람이다 — 차량은 근무지(서울·부산)의 것만 고를 수 있다.
const store = { attendKind: 'trip', attendWorkplace: '부산' };
globalThis.chrome = {
  storage: { local: { get: async () => store, set: async (obj) => { Object.assign(store, obj); } } },
  runtime: { sendNativeMessage: async () => { throw new Error('no host'); } },
  tabs: { query: async () => [], create: async () => {} },
  scripting: { executeScript: async () => [{ result: null }] },
};
globalThis.fetch = async () => { throw new Error('offline'); };

/* ------------------------------------------------------------ 가짜 차량 현황과 신청 */

const CARS = [{ value: '70', name: '아반테 (181허4360)', label: '아반테 (181허4360)' }, { value: '31', name: '쏘나타 (203도7306)', label: '쏘나타 (203도7306)' },
  { value: '75', name: '스타리아 (308소4997)', label: '스타리아 (308소4997)' }];
const res = (room, date, start, end, more = {}) => ({ room, date, start, end, owner: '홍길동', title: '방문', mine: false,
  spanStart: { date, minutes: start }, spanEnd: { date, minutes: end }, ...more });
// site.days 는 날짜 → 그날의 신청. site.unsure 에 든 날은 확신할 수 없다고 답한다. site.fail 이면 조회가 통째로 실패한다.
// site.reject 가 있으면 신청이 그 말로 실패한다. 신청이 되면 사이트가 그 건을 내 신청으로 적는다.
const site = { scans: [], days: {}, unsure: new Set(), fail: '', picked: [], reject: null, hold: null, cars: CARS };
const cars = {
  scan: async (dates) => {
    site.scans.push(dates);
    if (site.fail) throw new Error(site.fail);
    return dates.map((date) => ({ kind: 'car', date, rooms: site.cars, reservations: site.days[date] || [],
      confident: !site.unsure.has(date), reason: site.unsure.has(date) ? '날짜를 옮기지 못했습니다.' : '' }));
  },
};
const onCar = async (pick) => {
  site.picked.push(pick);
  if (site.hold) await site.hold;
  if (site.reject) return site.reject;
  const span = { spanStart: { date: pick.date, minutes: pick.start }, spanEnd: { date: pick.endDate, minutes: pick.end }, mine: true, owner: '김거화' };
  for (let d = pick.date; d <= pick.endDate; d = d.replace(/\d+$/, (n) => String(+n + 1).padStart(2, '0'))) {
    (site.days[d] ||= []).push(res(pick.car.name, d, d === pick.date ? pick.start : 0, d === pick.endDate ? pick.end : 1440, span));
  }
  return { ok: true, submitted: true, message: '예약이 완료 되었습니다' };
};

const { createAttendPanel } = await import('../attendpanel.js');
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logs = [];
const panel = createAttendPanel({
  $: (id) => doc.getElementById(id), escapeHtml,
  logEvent: (kind, ok, text) => logs.push({ kind, ok, text }), ai: () => ({ apiKey: '', cli: false }),
  cars, onCar,
});
panel.wire();
await panel.show();   // HR 에는 닿지 못한다 — 신청 내역은 비고, 폼은 마지막에 쓰던 종류(출장)로 선다

const type = (id, value) => {
  const input = doc.getElementById(id);
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const tick = (id, on) => {
  const box = doc.getElementById(id);
  box.checked = on;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const box = () => doc.getElementById('atCars');
const keys = () => [...doc.querySelectorAll('#atFields .at-field')].map((n) => n.dataset.key);
const rows = () => [...box().querySelectorAll('.at-cars-list .at-car')].map((n) => [n.tagName, n.querySelector('.at-car-name').textContent, n.querySelector('.at-car-state').textContent]);
const notes = () => [...box().querySelectorAll('.at-cars-note')].map((n) => n.textContent);
const when = () => box().querySelector('.at-cars-when')?.textContent;
const status = () => doc.getElementById('atStatus').textContent;
const loaded = () => until(() => box() && !/읽는 중|신청하는 중/.test(box().textContent));
const car = (name) => [...box().querySelectorAll('button.at-car')].find((b) => b.textContent.includes(name));

console.log('출장 폼 — 사전정산 옆의 차량 조회');
type('at_dateFrom', '2026-10-20');
t('차량 조회 체크박스는 사전정산 옆에 서고 꺼져 있다 — 꺼 두면 차량을 읽지 않고 행선지도 묻지 않는다', () => {
  assert.deepEqual([...doc.querySelector('#atFields .at-group.at-opts').children].map((n) => [n.dataset.key, n.querySelector('.at-label').textContent]),
    [['settle', '여비계산서 사전정산'], ['car', '차량 조회']]);
  assert.deepEqual([doc.getElementById('at_car').checked, box(), site.scans.length, doc.getElementById('at_carPlace')], [false, null, 0, null]);
  assert.match(doc.querySelector('.at-field[data-key="car"]').title, /빈 차량을 누르면 그 시간으로 신청합니다/);
});

site.days['2026-10-20'] = [res(CARS[0].name, '2026-10-20', 600, 720), res(CARS[1].name, '2026-10-20', 1200, 1320)];
tick('at_car', true);
t('켜면 근무지 칸이 나오고(근무지는 적어 둔 것이 깔려 있다 — 행선지는 출장지다), 곧바로 폼의 날짜·시간(10/20 07:00~20:00)으로 차량 현황을 읽는다', () => {
  assert.ok(doc.getElementById('at_car').checked, '폼을 다시 그려도 켠 것이 남는다');
  assert.deepEqual(keys(), ['dateFrom', 'start', 'dateTo', 'end', 'days', 'place', 'venue', 'purpose', 'settle', 'car', 'workplace']);
  assert.deepEqual([...doc.querySelector('#atFields .at-group.at-carwhere').children].map((n) => n.dataset.key), ['workplace']);
  assert.equal(doc.getElementById('at_carPlace'), null, '출장에는 행선지 칸이 따로 없다');
  assert.equal(doc.getElementById('at_workplace').value, '부산');
  assert.equal(when(), '10/20 07:00~20:00');
  assert.deepEqual(notes(), ['차량 현황을 읽는 중...']);
});
await loaded();
t('빈 차량이 앞에 서고 누를 수 있다. 사용 중인 차는 언제·누가 쓰는지 적히고 눌리지 않는다', () => {
  assert.deepEqual(site.scans, [['2026-10-20']]);
  assert.deepEqual(rows(), [
    ['BUTTON', '쏘나타 (203도7306)', '비어 있음'], ['BUTTON', '스타리아 (308소4997)', '비어 있음'], ['DIV', '아반테 (181허4360)', '10:00~12:00 홍길동'],
  ]);
  assert.match(box().querySelector('button.at-car').title, /누르면 이 시간으로 바로 신청합니다/);
});
t('차량은 네 줄쯤만 보이고 나머지는 스크롤한다 (목록의 높이를 막아 둔다)', () => {
  const rule = css.match(/\.attend \.at-cars-list \{[^}]*\}/)[0];
  assert.match(rule, /max-height: 156px/);
  assert.match(rule, /overflow-y: auto/);
});
t('차량 조회는 화면만의 값이다 — 필수 칸이 늘지 않는다(근무지는 필수가 아니다)', () => {
  type('at_purpose', '착수회의 참석');
  assert.equal(doc.querySelector('.at-field[data-key="workplace"]').classList.contains('need'), false);
  assert.equal(doc.querySelector('.at-field[data-key="place"]').classList.contains('need'), true, '출장지는 근태의 필수 칸이다');
  assert.deepEqual(site.scans.length, 1, '목적을 적는 것으로는 다시 읽지 않는다');
});

console.log('빈 차량을 누르면 그 자리에서 신청한다');
car('스타리아').click();
await wait(30);
t('행선지(출장지)가 비어 있으면 보내지 않는다 — 적으라고 말하고 그 칸에 손을 놓는다', () => {
  assert.deepEqual(site.picked, []);
  assert.match(notes().join(' '), /먼저 출장지를 적어 주세요\(차량 신청에 필요합니다\)/);
  assert.equal(status(), '차량을 신청하려면 출장지가 필요합니다 — 적은 뒤 다시 눌러 주세요.');
  assert.equal(doc.activeElement, doc.getElementById('at_place'));
});
type('at_place', '대전');
t('출장지를 적으면 무엇이 나가는지 상자에 적히고, 근태도 올릴 수 있다 — 차량 조회는 올릴 내용에 끼지 않는다', () => {
  assert.ok(notes().includes('빈 차량을 누르면 이 시간으로 바로 신청합니다 · 근무지 부산 · 행선지 대전'));
  assert.equal(doc.getElementById('atNeed').textContent, '올릴 내용 — 출장 10/20 07:00~20:00 · 착수회의 참석 (출장지: 대전)');
  assert.equal(doc.getElementById('atSubmit').disabled, false);
});
type('at_venue', '한국기계연구원');
t('장소를 적으면 행선지가 출장지(장소)가 된다 — 여비계산서의 출장지와 같은 글', () =>
  assert.ok(notes().includes('빈 차량을 누르면 이 시간으로 바로 신청합니다 · 근무지 부산 · 행선지 대전(한국기계연구원)')));
{
  let release;
  site.hold = new Promise((r) => { release = r; });
  car('스타리아').click();
  await wait(30);
  t('한 번 누르면 그 차량·기간·사용목적·행선지로 신청이 나간다 — 보내는 동안에는 다른 차량을 누를 수 없다', () => {
    assert.deepEqual(site.picked, [{ date: '2026-10-20', endDate: '2026-10-20', start: 420, end: 1200,
      car: { name: '스타리아 (308소4997)', value: '75' }, title: '착수회의 참석', place: '대전(한국기계연구원)' }]);
    assert.deepEqual(rows().slice(0, 2), [['BUTTON', '쏘나타 (203도7306)', '비어 있음'], ['BUTTON', '스타리아 (308소4997)', '신청하는 중...']]);
    assert.ok([...box().querySelectorAll('button.at-car')].every((b) => b.disabled));
    assert.equal(status(), '차량을 신청하는 중 — 스타리아 (308소4997) 10/20 07:00~20:00 · 행선지 대전(한국기계연구원)');
    car('쏘나타').click();
    assert.equal(site.picked.length, 1, '잠긴 줄은 눌러도 나가지 않는다');
  });
  release();
  site.hold = null;
  await until(() => /신청했습니다/.test(status()));
  await loaded();
}
t('신청이 되면 근태 탭에 그대로 있고(차량 탭으로 넘어가지 않는다), 현황을 다시 읽어 그 차량이 "내 신청"으로 바뀐다', () => {
  assert.equal(doc.getElementById('attend').classList.contains('hidden'), false);
  assert.equal(status(), '차량을 신청했습니다 — 스타리아 (308소4997) 10/20 07:00~20:00 · 행선지 대전(한국기계연구원)');
  assert.equal(box().querySelector('.at-cars-note.ok').textContent, '신청했습니다 — 스타리아 (308소4997) 10/20 07:00~20:00 · 행선지 대전(한국기계연구원)');
  assert.deepEqual(site.scans.at(-1), ['2026-10-20']);
  assert.deepEqual(rows(), [
    ['DIV', '스타리아 (308소4997)', '07:00~20:00 내 신청'], ['BUTTON', '쏘나타 (203도7306)', '비어 있음'], ['DIV', '아반테 (181허4360)', '10:00~12:00 홍길동'],
  ], '내 신청이 맨 앞에 선다');
  assert.ok(box().querySelector('.at-car.busy.mine'));
  assert.deepEqual([doc.getElementById('at_purpose').value, doc.getElementById('at_place').value, doc.getElementById('at_venue').value],
    ['착수회의 참석', '대전', '한국기계연구원'], '폼은 그대로다');
});

console.log('신청이 안 됐을 때');
site.reject = { ok: false, submitted: false, message: '사이트 응답: "이미 예약된 차량입니다"' };
car('쏘나타').click();
await until(() => /신청하지 못했습니다/.test(status()));
await loaded();
t('사이트가 받지 않으면 까닭을 적고 현황을 다시 읽는다 — 된 것처럼 보이지 않는다', () => {
  assert.equal(site.picked.length, 2);
  assert.equal(box().querySelector('.at-cars-note.error').textContent, '신청하지 못했습니다 — 쏘나타 (203도7306): 사이트 응답: "이미 예약된 차량입니다"');
  assert.equal(doc.getElementById('atStatus').className, 'status error');
  assert.deepEqual(rows()[1], ['BUTTON', '쏘나타 (203도7306)', '비어 있음'], '그 차는 여전히 비어 있다');
});
site.reject = { ok: false, submitted: true, message: '다시 조회했지만 그 차량 그 시간에 신청이 보이지 않습니다.' };
car('쏘나타').click();
await until(() => /확인하지 못했습니다/.test(status()));
await loaded();
t('보냈지만 확인하지 못했으면 그렇게 말한다(됐을 수도 있다)', () =>
  assert.match(box().querySelector('.at-cars-note.error').textContent, /^신청을 보냈지만 확인하지 못했습니다 — 쏘나타 \(203도7306\): 다시 조회했지만/));
site.reject = null;

console.log('날짜·시간을 바꾸면 다시 찾는다');
type('at_end', '21:00');
t('도착을 21시로 늦추면 기간이 바뀌고 다시 읽는다 — 앞의 목록과 결과 글은 보이지 않는다', () => {
  assert.equal(when(), '10/20 07:00~21:00');
  assert.deepEqual([rows(), notes()], [[], ['차량 현황을 읽는 중...']]);
});
await loaded();
t('이제 20~22시에 쓰는 쏘나타도 겹친다 — 빈 차량이 없다고 적는다', () => {
  assert.deepEqual(rows().map((r) => r[0]), ['DIV', 'DIV', 'DIV']);
  assert.deepEqual(notes(), ['이 시간에 빈 차량이 없습니다.']);
});

console.log('여러 날 출장');
site.days = { '2026-10-20': [res(CARS[0].name, '2026-10-20', 600, 720)] };
site.unsure.add('2026-10-21');
doc.querySelector('.at-field[data-key="days"] .at-chip[data-days="2"]').click();
await loaded();
t('2D 로 늘리면 걸친 날을 모두 읽는다 — 하루라도 확신할 수 없으면 비어 있다고 하지 않고 누를 수도 없다', () => {
  assert.equal(when(), '10/20 07:00 ~ 10/21 21:00');
  assert.deepEqual(site.scans.at(-1), ['2026-10-20', '2026-10-21']);
  assert.deepEqual(rows(), [
    ['DIV', '쏘나타 (203도7306)', '확인 불가'], ['DIV', '스타리아 (308소4997)', '확인 불가'], ['DIV', '아반테 (181허4360)', '10/20 10:00~12:00 홍길동'],
  ]);
  assert.equal(box().querySelector('button.at-car'), null);
  assert.match(notes().join(' '), /10\/21 의 현황을 확신할 수 없어 비어 있다고 하지 않습니다.*날짜를 옮기지 못했습니다/);
});
site.unsure.clear();
box().querySelector('button[data-car-act="again"]').click();
await loaded();
t('다시 조회를 누르면 기다리지 않고 다시 읽는다', () => {
  assert.deepEqual(site.scans.at(-1), ['2026-10-20', '2026-10-21']);
  assert.deepEqual(rows().map((r) => r[2]), ['비어 있음', '비어 있음', '10/20 10:00~12:00 홍길동']);
});
tick('at_settle', true);
type('at_place', '세종');
type('at_venue', '');
type('at_workplace', '부산');
await loaded();
t('사전정산을 켜도 출장지가 행선지다 — 근무지는 사전정산 줄의 것을 쓰고, 차량 목록은 사전정산 칸들 아래에 선다', () => {
  assert.deepEqual(keys(), ['dateFrom', 'start', 'dateTo', 'end', 'days', 'place', 'venue', 'purpose', 'settle', 'car', 'workplace', 'transport']);
  assert.equal(doc.querySelector('#atFields .at-group.at-carwhere'), null);
  assert.ok(notes().includes('빈 차량을 누르면 이 시간으로 바로 신청합니다 · 근무지 부산 · 행선지 세종'));
  assert.deepEqual([...doc.querySelectorAll('#atFields > *')].map((n) => n.id || n.className.split(' ').slice(0, 2).join('.')).slice(-3),
    ['at-group.at-opts', 'at-group.at-where', 'atCars']);
});
car('스타리아').click();
await until(() => /신청했습니다/.test(status()));
await loaded();
t('여러 날 출장의 차량은 마지막 날의 도착 시각까지 한 건으로 신청된다', () => {
  assert.deepEqual(site.picked.at(-1), { date: '2026-10-20', endDate: '2026-10-21', start: 420, end: 1260,
    car: { name: '스타리아 (308소4997)', value: '75' }, title: '착수회의 참석', place: '세종' });
  assert.deepEqual(rows()[0], ['DIV', '스타리아 (308소4997)', '10/20 07:00~10/21 21:00 내 신청']);
});

console.log('못 읽었을 때 · 껐을 때');
site.fail = '로그인이 필요합니다. eclass 로그인이 만료됐습니다.';
type('at_end', '20:00');
await until(() => /읽지 못했습니다/.test(box().textContent));
t('현황을 못 읽으면 까닭을 적고 차량을 늘어놓지 않는다 — 빈 것처럼 보이지 않게', () => {
  assert.deepEqual([rows(), notes()], [[], ['차량 현황을 읽지 못했습니다: 로그인이 필요합니다. eclass 로그인이 만료됐습니다.']]);
  assert.ok(box().querySelector('.at-cars-note.error'));
  assert.deepEqual([logs.at(-1).kind, logs.at(-1).ok], ['car-find', false]);
});
site.fail = '';
const before = site.scans.length;
tick('at_car', false);
await wait(60);
t('끄면 차량 목록이 사라지고 더 읽지 않는다', () => assert.deepEqual([box(), site.scans.length], [null, before]));

console.log('외근 폼');
doc.querySelector('#atKinds .at-kind[data-kind="out"]').click();
type('at_dateFrom', '2026-10-22');
tick('at_car', true);
t('외근에도 목적 아래에 차량 조회와 근무지·행선지 칸이 있다. 몇 시간을 고르기 전에는 찾지 않고 그렇게 말한다', () => {
  assert.deepEqual(keys(), ['sub', 'dateFrom', 'start', 'span', 'purpose', 'car', 'workplace', 'carPlace']);
  assert.deepEqual([notes(), site.scans.length], [['날짜와 시간을 넣으면 그 시간에 빈 차량을 찾습니다.'], before]);
});
type('at_start', '14:30');
doc.querySelector('.at-field[data-key="span"] .at-chip[data-span="2"]').click();
await loaded();
t('14:30 부터 2시간이면 정시에 맞춰 14:00~17:00 으로 찾고, 넓혀 봤다고 적는다', () => {
  assert.equal(when(), '10/22 14:00~17:00');
  assert.deepEqual(site.scans.at(-1), ['2026-10-22']);
  assert.deepEqual(rows().map((r) => r[2]), ['비어 있음', '비어 있음', '비어 있음']);
  assert.match(notes().join(' '), /한 시간 단위로 잡습니다/);
});
type('at_purpose', '과제 협의');
type('at_carPlace', '부산시청');
car('아반테').click();
await until(() => /신청했습니다/.test(status()));
await loaded();
t('외근은 행선지 칸에 적은 곳으로, 정시에 맞춘 시간으로 신청된다', () => {
  assert.deepEqual(site.picked.at(-1), { date: '2026-10-22', endDate: '2026-10-22', start: 840, end: 1020,
    car: { name: '아반테 (181허4360)', value: '70' }, title: '과제 협의', place: '부산시청' });
  assert.deepEqual(rows()[0], ['DIV', '아반테 (181허4360)', '14:00~17:00 내 신청']);
});

console.log('다른 탭에 다녀오면');
site.days['2026-10-22'].push(res(CARS[1].name, '2026-10-22', 900, 960));
panel.hide();
await panel.show();
await loaded();
t('근태 탭으로 돌아오면 다시 읽는다 — 폼과 켜 둔 것은 그대로고, 그 사이 남이 잡은 차가 사용 중으로 바뀌어 있다', () => {
  assert.deepEqual([doc.getElementById('at_car').checked, doc.getElementById('at_carPlace').value], [true, '부산시청']);
  assert.deepEqual(rows(), [
    ['DIV', '아반테 (181허4360)', '14:00~17:00 내 신청'], ['BUTTON', '스타리아 (308소4997)', '비어 있음'], ['DIV', '쏘나타 (203도7306)', '15:00~16:00 홍길동'],
  ]);
  assert.equal(box().querySelector('.at-cars-note.ok'), null, '앞서의 결과 글은 남지 않는다');
});

console.log('근무지(서울·부산)에 맞는 차량만 고를 수 있다');
// 서울본부 전용 차량, 사이트가 막는 임원용 차량, 다른 본부 전용 차량이 섞인 목록. 셋 다 그 시간에 비어 있다.
site.cars = [...CARS,
  { value: '63', name: '소나타 (223어7393)', label: '소나타 (223어7393)', note: '[서울본부 전용 차량]', blocked: '' },
  { value: '38', name: '그랜저 (62가1698)', label: '그랜저 (62가1698)', note: '[임원용 차량]', blocked: '차량 이용 시 지원팀에 문의 바랍니다.' },
  { value: '62', name: '소나타 (192호7954)', label: '소나타 (192호7954)', note: '[협약본부 전용 차량]', blocked: '' }];
box().querySelector('button[data-car-act="again"]').click();
await loaded();
t('근무지가 부산이면 안내가 붙지 않은 부산 차량만 눌린다 — 서울본부 전용·임원용·다른 본부 전용 차량은 비어 있어도 까닭과 함께 잠겨 있다', () => {
  assert.deepEqual(rows(), [
    ['DIV', '아반테 (181허4360)', '14:00~17:00 내 신청'], ['BUTTON', '스타리아 (308소4997)', '비어 있음'],
    ['DIV', '소나타 (223어7393)', '[서울본부 전용 차량]'], ['DIV', '그랜저 (62가1698)', '[임원용 차량]'], ['DIV', '소나타 (192호7954)', '[협약본부 전용 차량]'],
    ['DIV', '쏘나타 (203도7306)', '15:00~16:00 홍길동'],
  ]);
  assert.equal(box().querySelectorAll('.at-car.locked').length, 3);
  assert.match(box().querySelector('.at-car.locked[title*="문의"]').textContent, /그랜저/, '사이트가 막는 차량은 사이트의 문구가 풍선말로 달린다');
});
{
  const scans = site.scans.length;
  type('at_workplace', '서울');
  t('근무지를 서울로 바꾸면 서울본부 전용 차량만 눌린다 — 부산 본사 차량은 잠긴다. 사이트를 다시 읽지 않고 가르기만 다시 한다', () => {
    assert.deepEqual(rows(), [
      ['DIV', '아반테 (181허4360)', '14:00~17:00 내 신청'], ['BUTTON', '소나타 (223어7393)', '비어 있음'],
      ['DIV', '스타리아 (308소4997)', '부산 본사 차량'], ['DIV', '그랜저 (62가1698)', '[임원용 차량]'], ['DIV', '소나타 (192호7954)', '부산 본사 차량'],
      ['DIV', '쏘나타 (203도7306)', '15:00~16:00 홍길동'],
    ]);
    assert.ok(notes().includes('빈 차량을 누르면 이 시간으로 바로 신청합니다 · 근무지 서울 · 행선지 부산시청'));
    assert.deepEqual([site.scans.length, store.attendWorkplace], [scans, '서울'], '근무지는 적는 대로 저장된다');
  });
  type('at_workplace', '');
  t('근무지를 모르면 어느 차량도 눌리지 않는다 — 서울인지 부산인지 적으라고 말한다', () => {
    assert.equal(box().querySelector('button.at-car'), null);
    assert.deepEqual(rows().filter((r) => r[2] === '근무지를 적어 주세요').map((r) => r[1]), ['스타리아 (308소4997)', '소나타 (223어7393)', '소나타 (192호7954)']);
    assert.equal(box().querySelector('.at-cars-note.need').textContent, '근무지(서울 또는 부산)를 적으면 그 근무지의 차량을 고를 수 있습니다.');
    assert.equal(site.scans.length, scans);
  });
  type('at_workplace', '서울본부');
  const sent = site.picked.length;
  car('소나타 (223어7393)').click();
  await until(() => /신청했습니다/.test(status()) && site.picked.length > sent);
  await loaded();
  t('서울 근무자가 서울본부 전용 차량을 누르면 그 차량으로 신청된다', () => {
    assert.deepEqual([site.picked.at(-1).car, site.picked.at(-1).place], [{ name: '소나타 (223어7393)', value: '63' }, '부산시청']);
    assert.equal(rows().filter((r) => /내 신청/.test(r[2])).length, 2);
  });
}

console.log(`\n통과 ${pass}건`);
process.exit(0);
