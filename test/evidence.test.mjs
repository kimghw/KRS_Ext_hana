// 출장 증빙 보관함(src/evidence.js) — 출장(HR 신청서 번호)마다 담고, 꺼내고, 뺀다.
// 뒷단(IndexedDB)은 가짜로 바꿔 돌린다 — 진짜 IndexedDB 는 브라우저에서만 있다.
import assert from 'node:assert/strict';
import { createEvidenceStore, idbBackend, EVIDENCE_DB, EVIDENCE_STORE } from '../src/evidence.js';

let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

/** 열쇠-값 뒷단 흉내. */
function fakeBackend() {
  const data = new Map();
  return { data, set: async (k, v) => { data.set(k, structuredClone(v)); }, delete: async (k) => { data.delete(k); }, all: async () => [...data.values()].map((v) => structuredClone(v)) };
}
const PNG = (name, label) => ({ name, type: 'image/png', dataUrl: 'data:image/png;base64,AAAA', label, summary: `${name} 요약`, date: '2026-09-09', total: 12000, trip: { seq: '145580', from: '2026-09-09', to: '2026-09-09', location: '서울' } });

console.log('보관함');
await ta('출장마다 담고 담은 차례대로 꺼낸다 — 다른 출장의 것은 섞이지 않는다', async () => {
  let tick = 0;
  const store = createEvidenceStore(fakeBackend(), { now: () => ++tick });
  await store.keep('TR-1', [PNG('점심.png', '당일출장 증명'), PNG('항공권.pdf', '항공기 증명')]);
  await store.keep('TR-2', [PNG('점심.png', '당일출장 증명')]);
  const mine = await store.list('TR-1');
  assert.deepEqual(mine.map((x) => [x.docNo, x.name, x.label, x.savedAt]), [['TR-1', '점심.png', '당일출장 증명', 1], ['TR-1', '항공권.pdf', '항공기 증명', 2]]);
  assert.deepEqual([mine[0].dataUrl, mine[0].type, mine[0].date, mine[0].total, mine[0].trip.seq], ['data:image/png;base64,AAAA', 'image/png', '2026-09-09', 12000, '145580'],
    '보내는 쪽이 쓸 것(파일·종류·날짜·금액·출장)이 그대로 들어 있다');
  assert.equal((await store.list('TR-2')).length, 1);
  assert.deepEqual(await store.list('TR-9'), []);
});
await ta('같은 출장에 같은 이름의 파일을 다시 담으면 새것으로 바뀐다 — 두 번 들어가지 않는다', async () => {
  let tick = 0;
  const store = createEvidenceStore(fakeBackend(), { now: () => ++tick });
  await store.keep('TR-1', [PNG('점심.png', '당일출장 증명')]);
  await store.keep('TR-1', [{ ...PNG('점심.png', '당일출장 증명'), total: 15000 }]);
  assert.deepEqual((await store.list('TR-1')).map((x) => [x.name, x.total, x.savedAt]), [['점심.png', 15000, 2]]);
});
await ta('하나를 빼면 그것만 없어진다', async () => {
  const store = createEvidenceStore(fakeBackend());
  await store.keep('TR-1', [PNG('점심.png', '당일출장 증명'), PNG('항공권.pdf', '항공기 증명')]);
  await store.remove('TR-1', '점심.png');
  assert.deepEqual((await store.list('TR-1')).map((x) => x.name), ['항공권.pdf']);
});
// 2026-10-05 사용자 지정: 출장 기간의 것이 아닌 문서는 알림 표시를 붙여 보관하고, 확정하기 전에는 올리지도 보내지도 않는다.
await ta('알림 표시(warn)로 담은 증빙을 확정하면 표시가 걷히고 확정했다고 적힌다 — 읽은 기록에도 적고, 올려야 하는 것이면 "아직 안 올림"이 붙는다', async () => {
  const marks = [];
  const store = createEvidenceStore(fakeBackend(), { mirror: (m) => { marks.push(m); } });
  const WHY = '묵은 기간(9/15~9/16)이 출장 기간(9/9) 밖입니다';
  await store.keep('TR-1', [
    { ...PNG('hotel.png', '숙박 증빙'), warn: WHY, record: { docType: 'lodging_receipt', checkIn: '2026-09-15', checkOut: '2026-09-16' } },
    { ...PNG('lunch.png', '당일출장 증명'), warn: '결제일(9/8)이 출장 기간(9/9) 밖입니다', record: { docType: 'other_receipt', payDate: '2026-09-08' } },
    PNG('점심.png', '당일출장 증명'),
  ]);
  assert.deepEqual(marks.at(-1)['TR-1'], [{ name: 'hotel.png', label: '숙박 증빙', warn: WHY },
    { name: 'lunch.png', label: '당일출장 증명', warn: '결제일(9/8)이 출장 기간(9/9) 밖입니다' }, { name: '점심.png', label: '당일출장 증명' }], '줄여 적은 것에도 알림 표시가 있다');
  const hotel = await store.confirm('TR-1', 'hotel.png', { todo: true });
  assert.deepEqual([hotel.warn, hotel.confirmed, hotel.todo, hotel.record.confirmed, hotel.dataUrl], [undefined, true, true, true, 'data:image/png;base64,AAAA']);
  const lunch = await store.confirm('TR-1', 'lunch.png');
  assert.deepEqual([lunch.warn, lunch.confirmed, lunch.todo, lunch.record.confirmed], [undefined, true, undefined, true], '올릴 것이 없는 영수증에는 "아직 안 올림"을 붙이지 않는다');
  assert.deepEqual(marks.at(-1)['TR-1'], [{ name: 'hotel.png', label: '숙박 증빙', todo: true }, { name: 'lunch.png', label: '당일출장 증명' }, { name: '점심.png', label: '당일출장 증명' }]);
  assert.deepEqual((await store.list('TR-1')).map((x) => [x.name, !!x.warn, !!x.confirmed]), [['hotel.png', false, true], ['lunch.png', false, true], ['점심.png', false, false]]);
  assert.deepEqual([await store.confirm('TR-1', '점심.png'), await store.confirm('TR-1', '없는것.png'), await store.confirm('TR-1', 'hotel.png')], [null, null, null],
    '알림 표시가 없는 것·없는 파일·이미 확정한 것은 건드리지 않는다');
});
await ta('IndexedDB 가 없는 환경에서는 던진다 — 부르는 쪽(패널)이 잡아 "보관하지 못했다"고 말한다', async () => {
  assert.deepEqual([EVIDENCE_DB, EVIDENCE_STORE], ['krsWorkspace', 'tripEvidence']);
  const store = createEvidenceStore(idbBackend({ idb: undefined }));
  await assert.rejects(() => store.list('TR-1'), /보관함\(IndexedDB\)이 없습니다/);
  await assert.rejects(() => store.keep('TR-1', [PNG('a.png', '당일출장 증명')]), /보관함\(IndexedDB\)이 없습니다/);
});

console.log(`\n통과 ${pass}건`);
