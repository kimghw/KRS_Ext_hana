// 홈의 WORKSPACE 카드에서 넣은 증빙을 받는 길(src/intake.js) — 읽어서 무엇의 증명인지 가리고, 쓸 수 있는 것만 보관함에 담는다.
// 받는 길은 여비계산서를 바꾸지 않는다: 사후정산에도 올라가야 하는 증빙(숙박·항공권)에는 읽은 기록과 "아직 안 올림" 표시를 붙여 둔다
// — 홈 카드가 이어서 올리고 표시를 걷는다(src/afterup.js, test/afterup.test.mjs).
// Claude 와 보관함(IndexedDB)은 가짜다.
import assert from 'node:assert/strict';
import { intakeEvidence, uniqueName, INTAKE_LIMIT, PLAIN_LABEL } from '../src/intake.js';
import { createEvidenceStore, marksOf, MARKS_KEY } from '../src/evidence.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

function fakeBackend() {
  const data = new Map();
  return { data, set: async (k, v) => { data.set(k, structuredClone(v)); }, delete: async (k) => { data.delete(k); }, all: async () => [...data.values()].map((v) => structuredClone(v)) };
}
/** 보관함과, 그것이 줄여 적는 곳(MARKS_KEY 자리). */
function fakeStore() {
  let tick = 0;
  const mirrored = [];
  const backend = fakeBackend();
  return { store: createEvidenceStore(backend, { now: () => ++tick, mirror: (marks) => { mirrored.push(marks); } }), backend, mirrored };
}
/** Claude 가 읽은 기록 흉내 — 파일 이름으로 답을 고른다. calls 에 읽어 달라고 한 것을 적는다. */
function fakeRead(by) {
  const fn = async (file, ctx) => {
    fn.calls.push({ name: file.name, ctx });
    const record = by[file.name.replace(/ \(\d+\)/, '')];
    if (!record) throw new Error('증빙을 읽지 못했습니다 — Claude 연결(로컬 CLI 또는 API 키)이 필요합니다');
    return { record };
  };
  fn.calls = [];
  return fn;
}

const TRIP = { seq: '145580', from: '2026-09-09', to: '2026-09-10', location: '경기도 고양시' };
const png = (name, body = 'AAAA') => ({ name, type: 'image/png', dataUrl: `data:image/png;base64,${body}` });
const RECORDS = {
  'hotel.png': { docType: 'lodging_receipt', summary: '고양호텔 1박 143,000원', vendor: '고양호텔', payDate: '2026-09-10', total: 143000, currency: 'KRW' },
  'ticket.png': { docType: 'flight_ticket', summary: '김포→김해 KE1101', flightDate: '2026-09-09', total: 89000, airline: '대한항공' },
  'lunch.png': { docType: 'other_receipt', summary: '점심 12,000원', payDate: '2026-09-09', total: 12000, atDestination: true },
  'cafe.png': { docType: 'other_receipt', summary: '카페 5,000원', payDate: '2026-09-09', total: 5000, atDestination: false, payPlace: '부산 해운대' },
  'ktx.png': { docType: 'train_ticket', summary: 'KTX 부산→서울' },
};
const ask = (file, over = {}) => ({ docNo: 'TR-1', trip: TRIP, me: '김거화', file, ...over });

console.log('증빙 받기 — 읽어서 가리고, 쓸 수 있는 것만 담는다');
await ta('숙박 영수증은 숙박 증빙으로 담는다 — 사후정산에도 올라가야 하므로 읽은 기록과 "아직 안 올림"을 붙인다', async () => {
  const { store, mirrored } = fakeStore();
  const read = fakeRead(RECORDS);
  const r = await intakeEvidence(ask(png('hotel.png')), { store, read });
  assert.deepEqual(r, { ok: true, kept: true, name: 'hotel.png', label: '숙박 증빙', note: '', summary: '고양호텔 1박 143,000원', todo: true });
  assert.deepEqual(read.calls, [{ name: 'hotel.png', ctx: { trip: TRIP, me: '김거화' } }], '출장 기간·출장지·출장자를 알려 주고 읽는다');
  const [k] = await store.list('TR-1');
  assert.deepEqual([k.name, k.label, k.date, k.total, k.todo, k.record.vendor, k.trip.seq, k.dataUrl], ['hotel.png', '숙박 증빙', '2026-09-10', 143000, true, '고양호텔', '145580', 'data:image/png;base64,AAAA']);
  assert.deepEqual(mirrored.at(-1), { 'TR-1': [{ name: 'hotel.png', label: '숙박 증빙', todo: true }] }, '홈 카드가 볼 수 있게 줄여 적는다');
});
await ta('항공권은 항공기 증명으로(아직 안 올림), 출장지에서 결제한 영수증은 출장지 영수증으로 담는다 — 영수증은 사후정산에 올릴 것이 없다', async () => {
  const { store } = fakeStore();
  const read = fakeRead(RECORDS);
  const a = await intakeEvidence(ask(png('ticket.png')), { store, read });
  const b = await intakeEvidence(ask(png('lunch.png')), { store, read });
  assert.deepEqual([a.kept, a.label, a.todo, b.kept, b.label, b.todo], [true, '항공기 증명', true, true, '출장지 영수증', false]);
  const day = await intakeEvidence(ask(png('lunch.png'), { docNo: 'TR-2', trip: { ...TRIP, to: '2026-09-09' } }), { store, read });
  assert.equal(day.label, '당일출장 증명', '당일 출장이면 당일출장 증명이다');
  const kept = await store.list('TR-1');
  assert.deepEqual(kept.map((k) => [k.name, k.label, !!k.todo, 'record' in k]), [['ticket.png', '항공기 증명', true, true], ['lunch.png', '출장지 영수증', false, false]]);
  assert.equal(kept[0].date, '2026-09-09', '항공권의 날짜는 탑승일이다');
});
await ta('증빙으로 쓸 수 없는 문서는 담지 않고 까닭을 답한다 — 출장지에서 결제하지 않은 영수증, 기차표', async () => {
  const { store, mirrored } = fakeStore();
  const read = fakeRead(RECORDS);
  const cafe = await intakeEvidence(ask(png('cafe.png')), { store, read });
  const ktx = await intakeEvidence(ask(png('ktx.png')), { store, read });
  assert.deepEqual([cafe.ok, cafe.kept, cafe.label, cafe.note], [true, false, '출장지 영수증', '출장지에서 결제한 영수증이 아닙니다(부산 해운대)']);
  assert.deepEqual([ktx.kept, ktx.label], [false, '기차·버스표']);
  assert.match(ktx.note, /증빙으로 받지 않습니다/);
  assert.deepEqual([await store.list('TR-1'), mirrored], [[], []]);
});
// 2026-10-05 사용자 지정: "출장 기간동안의 내용이 아니면 알림을 줘 안맞다고, 맞는것만 선별취급 해서 올리고 해당 없는거는 문서보관에 알림표지 하고
// 확정 해주기 전까지는 보내기 해도 같이 보내지 말고"
await ta('출장 기간의 것이 아닌 문서는 버리지 않고 알림 표시를 붙여 담는다 — 까닭을 답하고, "아직 안 올림"은 붙이지 않는다(올리지 않는다). 읽은 기록은 같이 둔다', async () => {
  const { store, mirrored } = fakeStore();
  const read = fakeRead({
    ...RECORDS,
    'jeju.png': { docType: 'lodging_receipt', summary: '제주호텔 1박', vendor: '제주호텔', payDate: '2026-09-21', checkIn: '2026-09-20', checkOut: '2026-09-21', total: 90000, currency: 'KRW' },
    'late.png': { docType: 'flight_ticket', summary: '김해→김포', flightDate: '2026-09-20', total: 89000 },
    'old.png': { docType: 'other_receipt', summary: '점심', payDate: '2026-09-01', total: 9000, atDestination: true },
  });
  const jeju = await intakeEvidence(ask(png('jeju.png')), { store, read });
  assert.deepEqual(jeju, { ok: true, kept: true, name: 'jeju.png', label: '숙박 증빙', note: '', warn: '묵은 기간(9/20~9/21)이 출장 기간(9/9~9/10) 밖입니다', summary: '제주호텔 1박', todo: false });
  const late = await intakeEvidence(ask(png('late.png')), { store, read });
  const old = await intakeEvidence(ask(png('old.png')), { store, read });
  assert.deepEqual([late.kept, late.label, late.warn, late.todo], [true, '항공기 증명', '탑승일(9/20)이 출장 기간(9/9~9/10) 밖입니다', false]);
  assert.deepEqual([old.kept, old.label, old.warn, old.todo], [true, '출장지 영수증', '결제일(9/1)이 출장 기간(9/9~9/10) 밖입니다', false]);
  // 맞는 것은 전처럼 담긴다 — 맞는 것만 올라간다
  const hotel = await intakeEvidence(ask(png('hotel.png')), { store, read });
  assert.deepEqual([hotel.warn, hotel.todo], [undefined, true]);
  assert.deepEqual((await store.list('TR-1')).map((k) => [k.name, k.label, !!k.warn, !!k.todo, !!k.record]),
    [['jeju.png', '숙박 증빙', true, false, true], ['late.png', '항공기 증명', true, false, true], ['old.png', '출장지 영수증', true, false, true], ['hotel.png', '숙박 증빙', false, true, true]]);
  assert.deepEqual(mirrored.at(-1)['TR-1'].map((k) => [k.name, k.warn || '', !!k.todo]), [
    ['jeju.png', '묵은 기간(9/20~9/21)이 출장 기간(9/9~9/10) 밖입니다', false], ['late.png', '탑승일(9/20)이 출장 기간(9/9~9/10) 밖입니다', false],
    ['old.png', '결제일(9/1)이 출장 기간(9/9~9/10) 밖입니다', false], ['hotel.png', '', true]], '홈 카드도 알림 표시를 본다');
  // 확정하면 표시가 걷히고, 숙박 증빙은 올릴 것이 된다
  await store.confirm('TR-1', 'jeju.png', { todo: true });
  assert.deepEqual((await store.list('TR-1')).filter((k) => k.name === 'jeju.png').map((k) => [!!k.warn, k.todo, k.record.confirmed]), [[false, true, true]]);
});
await ta('사후정산이 완료된 출장이면 읽지 않고 보낼 증빙으로 담는다 — 패널 송부 칸의 "증빙 넣기"와 같다', async () => {
  const { store } = fakeStore();
  const read = fakeRead(RECORDS);
  const r = await intakeEvidence(ask(png('hotel.png'), { settled: true }), { store, read });
  assert.deepEqual([r.ok, r.kept, r.label, r.todo, read.calls.length], [true, true, PLAIN_LABEL, false, 0]);
  const [k] = await store.list('TR-1');
  assert.deepEqual([k.label, k.todo, 'record' in k], ['증빙', undefined, false]);
});
await ta('붙여 넣은 그림은 이름이 같다 — 내용이 다르면 번호를 붙여 앞의 증빙을 덮지 않고, 같은 내용이면 새것으로 바꾼다', async () => {
  const { store } = fakeStore();
  const read = fakeRead({ 'image.png': RECORDS['lunch.png'] });
  const a = await intakeEvidence(ask(png('image.png', 'AAAA')), { store, read });
  const b = await intakeEvidence(ask(png('image.png', 'BBBB')), { store, read });
  const c = await intakeEvidence(ask(png('image.png', 'AAAA')), { store, read });
  assert.deepEqual([a.name, b.name, c.name], ['image.png', 'image (2).png', 'image.png']);
  assert.deepEqual((await store.list('TR-1')).map((k) => k.name).sort(), ['image (2).png', 'image.png']);
});
t('이름 고르기 — 다른 내용의 같은 이름이 있으면 빈 번호를 찾는다(확장자 앞에)', () => {
  const kept = [{ name: 'a.png', dataUrl: 'x' }, { name: 'a (2).png', dataUrl: 'y' }, { name: '메모', dataUrl: 'z' }];
  assert.deepEqual([uniqueName('a.png', 'x', kept), uniqueName('a.png', 'q', kept), uniqueName('메모', 'q', kept), uniqueName('b.png', 'q', kept)],
    ['a.png', 'a (3).png', '메모 (2)', 'b.png']);
});
await ta('못 받으면 던지지 않고 까닭을 답한다 — 읽지 못함, 보관함에 못 담음, 파일 없음, 너무 큼, 어느 출장인지 모름', async () => {
  const { store } = fakeStore();
  const read = fakeRead(RECORDS);
  const unread = await intakeEvidence(ask(png('모르는것.png')), { store, read });
  assert.deepEqual([unread.ok, unread.name], [false, '모르는것.png']);
  assert.match(unread.error, /증빙을 읽지 못했습니다/);
  const broken = { list: async () => { throw new Error('보관함을 열지 못했습니다.'); }, keep: async () => { throw new Error('보관함에 쓰지 못했습니다.'); } };
  assert.deepEqual(await intakeEvidence(ask(png('hotel.png')), { store: broken, read }), { ok: false, name: 'hotel.png', error: '보관함에 쓰지 못했습니다.' });
  assert.deepEqual(await intakeEvidence(ask({ name: 'x.png' }), { store, read }), { ok: false, error: '받을 파일이 없습니다.' });
  const big = { name: 'big.png', type: 'image/png', dataUrl: `data:image/png;base64,${'A'.repeat(Math.ceil(INTAKE_LIMIT / 0.75) + 8)}` };
  assert.match((await intakeEvidence(ask(big), { store, read })).error, /너무 큽니다/);
  assert.deepEqual(await intakeEvidence({ file: png('hotel.png') }, { store, read }), { ok: false, error: '어느 출장의 증빙인지 알 수 없습니다.' });
  assert.equal((await store.list('TR-1')).length, 0);
});

console.log('보관함을 줄여 적기 — 홈 카드의 아이콘이 보는 것');
await ta('담거나 뺄 때마다 보관함 전체에서 다시 지어 적는다 — 출장마다 이름과 무엇의 증명인지만(파일은 적지 않는다)', async () => {
  const { store, mirrored } = fakeStore();
  const item = (name, label, over = {}) => ({ ...png(name), label, summary: '', date: null, total: null, trip: TRIP, ...over });
  await store.keep('TR-1', [item('a.png', '숙박 증빙', { todo: true, record: {} }), item('b.pdf', '항공기 증명')]);
  await store.keep('TR-2', [item('c.png', '당일출장 증명')]);
  assert.deepEqual(mirrored.at(-1), { 'TR-1': [{ name: 'a.png', label: '숙박 증빙', todo: true }, { name: 'b.pdf', label: '항공기 증명' }], 'TR-2': [{ name: 'c.png', label: '당일출장 증명' }] });
  // 패널이 그 증빙을 사후정산에 올리면서 다시 담으면(todo 없이) 표시가 없어진다
  await store.keep('TR-1', [item('a.png', '숙박 증빙')]);
  assert.deepEqual(mirrored.at(-1)['TR-1'].find((k) => k.name === 'a.png'), { name: 'a.png', label: '숙박 증빙' });
  await store.remove('TR-2', 'c.png');
  assert.deepEqual(Object.keys(mirrored.at(-1)), ['TR-1']);
  assert.deepEqual(await store.sync(), mirrored.at(-1), '배경이 홈 카드의 부탁으로 한 번 통째로 적어 줄 때도 같은 것이다');
  assert.equal(MARKS_KEY, 'evidenceMarks');
});
await ta('홈 카드가 사후정산에 올린 증빙은 표시만 걷는다(settle) — 읽은 기록과 담은 차례는 그대로이고, 줄여 적은 것에서도 표시가 빠진다', async () => {
  const { store, mirrored } = fakeStore();
  const read = fakeRead(RECORDS);
  await intakeEvidence(ask(png('hotel.png')), { store, read });
  await intakeEvidence(ask(png('lunch.png')), { store, read });
  await intakeEvidence(ask(png('ticket.png')), { store, read });
  assert.equal(await store.settle('TR-1', ['hotel.png', 'lunch.png', '없는것.png']), 1, '표시가 있던 것만 센다');
  assert.deepEqual((await store.list('TR-1')).map((k) => [k.name, !!k.todo, !!k.record]), [['hotel.png', false, true], ['lunch.png', false, false], ['ticket.png', true, true]]);
  assert.deepEqual(mirrored.at(-1)['TR-1'], [{ name: 'hotel.png', label: '숙박 증빙' }, { name: 'lunch.png', label: '출장지 영수증' }, { name: 'ticket.png', label: '항공기 증명', todo: true }]);
  const n = mirrored.length;
  assert.deepEqual([await store.settle('TR-1', ['hotel.png']), await store.settle('TR-2', ['ticket.png']), mirrored.length], [0, 0, n], '걷을 것이 없으면 다시 적지 않는다');
});
await ta('줄여 적지 못해도 담고 빼는 일은 된 것이다', async () => {
  const backend = fakeBackend();
  const store = createEvidenceStore(backend, { mirror: () => { throw new Error('저장소에 쓰지 못했습니다.'); } });
  await store.keep('TR-1', [{ ...png('a.png'), label: '숙박 증빙' }]);
  assert.equal((await store.list('TR-1')).length, 1);
  await store.remove('TR-1', 'a.png');
  assert.equal((await store.list('TR-1')).length, 0);
});
t('이름표가 없는 것은 "증빙"으로 적는다', () => {
  assert.deepEqual(marksOf([{ docNo: 'A', name: 'x', savedAt: 2 }, { docNo: 'A', name: 'y', label: '숙박 증빙', savedAt: 1 }]), { A: [{ name: 'y', label: '숙박 증빙' }, { name: 'x', label: '증빙' }] });
});

console.log('배경: 홈 카드 대신 증빙을 받는다');
{
  const HOTEL = { docType: 'lodging_receipt', summary: '고양호텔 1박', vendor: '고양호텔', payDate: '2026-09-10', nights: 1, total: 143000, currency: 'KRW' };
  /** 배경을 새로 올리고 홈 카드가 보내는 것과 같은 부탁을 보낸다. 이 환경에는 IndexedDB 가 없다 — 보관함은 열리지 않는다. */
  async function send(msg, { native = () => ({ ok: true, data: HOTEL }) } = {}) {
    const calls = { listeners: [], native: [], sets: [] };
    const data = {};
    globalThis.chrome = {
      sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
      runtime: {
        onMessage: { addListener: (fn) => calls.listeners.push(fn) },
        sendNativeMessage: async (host, body) => { calls.native.push(body); return native(body); },
      },
      storage: { local: {
        get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, data[k]])),
        set: async (obj) => { calls.sets.push(obj); Object.assign(data, obj); },
      } },
    };
    await import(`../background.js?bust=${Math.random()}`);
    const answer = await new Promise((resolve) => {
      assert.equal(calls.listeners.at(-1)(msg, { tab: { id: 1 } }, resolve), true, '답을 나중에 주겠다고 해야 한다');
    });
    await new Promise((r) => setTimeout(r, 10));
    return { answer, calls, data };
  }
  await ta('증빙 받기 부탁(evidenceKeep)을 받는다 — 패널과 같은 길로 읽고, 보관함에 못 담으면 던지지 않고 까닭을 답하며 활동 기록에 남긴다', async () => {
    const { answer, calls, data } = await send({ type: 'evidenceKeep', docNo: 'TR-1', trip: TRIP, me: '김거화', file: png('hotel.png'), settled: false });
    assert.deepEqual([calls.native[0].task, calls.native[0].files[0].name], ['receipt', 'hotel.png']);
    assert.match(calls.native[0].input, /출장 정보: 2026-09-09 ~ 2026-09-10 · 출장지 경기도 고양시 · 출장자 김거화/);
    assert.deepEqual([answer.ok, answer.name], [false, 'hotel.png']);
    assert.match(answer.error, /보관함\(IndexedDB\)이 없습니다/);
    assert.deepEqual([data.activityLog.at(-1).kind, data.activityLog.at(-1).ok], ['trip', false]);
    assert.match(data.activityLog.at(-1).text, /^홈 카드에서 받은 증빙: hotel\.png · 실패/);
  });
  await ta('파일이 없는 부탁은 Claude 를 부르지 않는다', async () => {
    const { answer, calls } = await send({ type: 'evidenceKeep', docNo: 'TR-1', trip: TRIP, file: { name: 'x' } });
    assert.deepEqual([answer, calls.native.length], [{ ok: false, error: '받을 파일이 없습니다.' }, 0]);
  });
  await ta('보관함을 줄여 적어 달라는 부탁(evidenceMarks)도 받는다 — 보관함이 안 열리면 그렇다고 답한다', async () => {
    const { answer } = await send({ type: 'evidenceMarks' });
    assert.equal(answer.ok, false);
    assert.match(answer.error, /보관함\(IndexedDB\)이 없습니다/);
  });
  await ta('홈 카드가 사후정산에 올릴 때 보관함에 하는 부탁(evidenceGiven·evidenceFile·evidenceDone)도 받는다 — 못 하면 던지지 않고 까닭을 답한다', async () => {
    for (const msg of [{ type: 'evidenceGiven', docNo: 'TR-1' }, { type: 'evidenceFile', docNo: 'TR-1', name: 'hotel.png' }, { type: 'evidenceDone', docNo: 'TR-1', names: ['hotel.png'] }]) {
      const { answer, calls } = await send(msg);
      assert.deepEqual([answer.ok, calls.native.length], [false, 0], msg.type);
      assert.match(answer.error, /보관함\(IndexedDB\)이 없습니다/, msg.type);
    }
  });
  await ta('홈 카드가 여비계산서에 한 일(tripLog)을 활동 기록에 남긴다', async () => {
    const { answer, data } = await send({ type: 'tripLog', ok: true, text: '여비계산서(사후정산) 작성: 145580 · 숙박 고양호텔 1박 143,000원 · 홈 카드에서 넣은 증빙', data: { seq: '145580', files: ['hotel.png'] } });
    assert.deepEqual(answer, { ok: true });
    const last = data.activityLog.at(-1);
    assert.deepEqual([last.kind, last.ok, last.data.files], ['trip', true, ['hotel.png']]);
    assert.match(last.text, /^여비계산서\(사후정산\) 작성: 145580 · /);
  });
}

console.log(`\n통과 ${pass}건`);
