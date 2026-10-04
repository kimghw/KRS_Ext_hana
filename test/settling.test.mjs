// 다녀온 출장 가운데 여비 정산이 덜 끝난 것만 남기는 규칙(src/settling.js) — 신청 내역·현황·홈의 WORKSPACE 카드가 같이 쓴다
// (2026-10-04 사용자 지정).
//
// 지키려는 것은 셋이다.
//   - 오늘부터의 것은 전부 보이고, 지난 것은 출장만 다녀온 뒤 4주(또는 8주)까지 — 안 보기로 하면 남지 않는다.
//   - 사후정산이 완료됐거나 증빙을 담당자에게 보낸 출장은 뺀다. **모르는 것을 끝났다고 하지 않는다**(목록을 못 읽으면 그대로 보인다).
//   - 여비계산서 목록은 하루에 한 번만 읽는다. 근태 탭이 읽은 것은 담아 둔 것에 덧대진다.
import assert from 'node:assert/strict';
import {
  BACK_KEY, SENT_KEY, STAGES_KEY, BACK_CHOICES, BACK_DEFAULT, BACK_MAX_DAYS, backWeeksOf, stagesWindow, stagesFresh,
  stageFor, stageNote, settledBy, itemsToShow, dropSettled, tripRule, loadStages, noteStages,
} from '../src/settling.js';
import { listItems } from '../src/attend.js';
import { plansToShow } from '../src/plans.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const TODAY = '2026-10-04';
const day = (n) => { const d = new Date(2026, 9, 4 + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** HR 문서함의 한 줄. */
const hr = (docNo, from, to = from, over = {}) => ({
  docNo, statusCode: '5', statusName: '결재완료', formId: 'TR', formName: '출장신청서', workCodeKindName: '국내출장',
  startDate: from.replace(/-/g, ''), endDate: to.replace(/-/g, ''), startTime: '0700', endTime: '2000', wrkGubunName: '시간',
  reqRsn: '', reqstDate: `${day(-40)} 09:00:00`, pgmUrlAd: '/uhr/docappr/apprtrav100/view', ...over,
});
const out = (docNo, from, over = {}) => hr(docNo, from, from, { formId: 'TRO', formName: '외근/교육 신청서', workCodeKindName: '외근', ...over });
/** 여비계산서 목록의 한 줄. */
const bt = (seq, from, to, pre, post) => ({ seq, href: `/BusinessTrip/CalPrint?seq=${seq}`, pre, from, to, location: '서울', writer: '김거화', written: day(-30),
  travelers: [{ name: '김거화', post, trseq: `9${seq}` }] });

function fakeStorage(init = {}) {
  const data = structuredClone(init);
  return {
    data, sets: 0,
    get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
    async set(obj) { this.sets++; Object.assign(data, structuredClone(obj)); },
  };
}

console.log('다녀온 출장을 몇 주 뒤까지 보일지');
t('고를 수 있는 값은 안 봄(0)·4주·8주이고, 고르지 않았으면 4주다 — 예전에 고른 2주도 4주로 읽는다', () => {
  assert.deepEqual([BACK_CHOICES, BACK_DEFAULT, BACK_MAX_DAYS], [[0, 4, 8], 4, 56]);
  assert.deepEqual([undefined, 0, 4, 8, 2, '4', null].map(backWeeksOf), [4, 0, 4, 8, 4, 4, 4]);
  assert.deepEqual(stagesWindow(TODAY), { from: '2026-08-09', to: TODAY });
});

console.log('정산이 끝났는가 — 사후정산 완료 또는 여비증빙 송부');
const STAGES = { day: TODAY, since: '2026-08-09', me: '김거화', rows: [
  bt('101', day(-3), day(-3), '작성', ''), bt('102', day(-5), day(-4), '완료', '대기'), bt('103', day(-8), day(-7), '완료', '작성'), bt('104', day(-10), day(-9), '완료', '완료'),
] };
const trip = (docNo, from, to = from) => ({ docNo, from, to });
t('여비계산서의 단계: 사전정산 작성·완료, 사후정산 작성·완료 — 계산서가 없으면 "여비계산서 없음", 목록을 못 읽었으면 모른다', () => {
  assert.deepEqual([trip('a', day(-3)), trip('b', day(-5), day(-4)), trip('c', day(-8), day(-7)), trip('d', day(-10), day(-9)), trip('e', day(-2))].map((x) => stageNote(x, STAGES)),
    ['사전정산 작성', '사전정산 완료', '사후정산 작성', '사후정산 완료', '여비계산서 없음']);
  assert.equal(stageNote(trip('a', day(-3)), null), '');
  assert.equal(stageFor(trip('e', day(-2)), STAGES), null);
});
t('사후정산 완료만 끝난 것이다 — 사전정산 완료·사후정산 작성은 아직이고, 계산서가 없는 출장도 아직이다', () => {
  const settled = settledBy({ stages: STAGES });
  assert.deepEqual([trip('a', day(-3)), trip('b', day(-5), day(-4)), trip('c', day(-8), day(-7)), trip('d', day(-10), day(-9)), trip('e', day(-2))].map(settled), ['', '', '', 'post', '']);
});
t('증빙을 담당자에게 보낸 출장은 단계와 상관없이 끝난 것이다(당일 출장은 사전정산 뒤에 보낸다)', () => {
  const settled = settledBy({ sent: { a: { at: 1, to: '홍길동', account: 'RND' } }, stages: STAGES });
  assert.deepEqual([settled(trip('a', day(-3))), settled(trip('b', day(-5), day(-4)))], ['sent', '']);
});
t('여비계산서 목록을 못 읽었으면 보낸 기록만 본다 — 모르는 것을 끝났다고 하지 않는다', () => {
  const settled = settledBy({ sent: { a: {} }, stages: null });
  assert.deepEqual([settled(trip('a', day(-3))), settled(trip('d', day(-10), day(-9)))], ['sent', '']);
  assert.equal(settledBy()(trip('d', day(-10), day(-9))), '');
});

console.log('신청 내역의 기본 보기 — 오늘부터 전부, 지난 것은 정산이 덜 끝난 출장만');
{
  const items = listItems([
    hr('T-FAR', day(200)), hr('T-NEXT', day(3), day(4)), out('O-TODAY', day(0)), hr('T-NOW', day(-1), day(1)),
    out('O-PAST', day(-2)),
    hr('T-A', day(-3)), hr('T-B', day(-5), day(-4)), hr('T-D', day(-10), day(-9)), hr('T-14', day(-14)), hr('T-15', day(-15)), hr('T-28', day(-28)), hr('T-29', day(-29)),
    hr('T-TEMP', day(-6), day(-6), { statusCode: '1', statusName: '임시저장' }), hr('T-BACK', day(-6), day(-6), { statusCode: '6', statusName: '회수' }),
    hr('T-REQ', day(-7), day(-7), { statusCode: '3', statusName: '결재요청' }),
    { ...out('C-OLD', day(0)), docNo: 'C-OLD', formId: 'TROC', workCodeKindName: '', formName: '외근/교육 취소 신청', startDate: '', endDate: '', startTime: '', endTime: '', reqstDate: `${day(-3)} 15:00:00` },
  ]);
  const ids = (rule) => itemsToShow(items, TODAY, rule).map((it) => it.docNo);
  t('오늘부터의 것은 한참 뒤의 것까지 전부(끝이 없다), 날짜가 늦은 것이 위다. 지난 것은 출장만 4주 전에 끝난 것까지', () => {
    assert.deepEqual(ids({ backDays: 28 }), ['T-FAR', 'T-NEXT', 'O-TODAY', 'T-NOW', 'T-A', 'T-B', 'T-REQ', 'T-D', 'T-14', 'T-15', 'T-28']);
  });
  t('지난 외근·지난 취소신청서는 기본 보기에 없다. 임시저장·회수한 지난 출장도 다녀온 출장이 아니다(결재요청 중인 것은 보인다)', () => {
    const got = ids({ backDays: 28 });
    assert.ok(!got.includes('O-PAST') && !got.includes('C-OLD') && !got.includes('T-TEMP') && !got.includes('T-BACK'), got.join());
    assert.ok(got.includes('T-REQ'));
  });
  t('8주로 고르면 8주 전에 끝난 출장까지, 안 봄(0)이면 지난 것은 하나도 없다', () => {
    assert.deepEqual(ids({ backDays: 56 }).slice(-4), ['T-14', 'T-15', 'T-28', 'T-29']);
    assert.deepEqual(ids({ backDays: 0 }), ['T-FAR', 'T-NEXT', 'O-TODAY', 'T-NOW']);
    assert.deepEqual(ids(), ['T-FAR', 'T-NEXT', 'O-TODAY', 'T-NOW'], '규칙을 주지 않으면 지난 것은 보이지 않는다');
  });
  const settled = settledBy({ sent: { 'T-A': { at: 1 } }, stages: { ...STAGES, rows: [...STAGES.rows, bt('200', day(-1), day(1), '완료', '완료'), bt('201', day(3), day(4), '완료', '완료')] } });
  t('사후정산이 완료됐거나(T-D) 증빙을 보낸(T-A) 다녀온 출장은 빠진다 — 앞으로의 출장·지금 가 있는 출장은 정산이 끝났어도 그대로다', () => {
    assert.deepEqual(ids({ backDays: 28, settled }), ['T-FAR', 'T-NEXT', 'O-TODAY', 'T-NOW', 'T-B', 'T-REQ', 'T-14', 'T-15', 'T-28']);
  });
  t('펴 둔 줄은 정산이 끝났어도 남긴다 — 방금 보낸 카드가 눈앞에서 사라지지 않는다', () => {
    assert.ok(ids({ backDays: 28, settled, keep: 'T-A' }).includes('T-A'));
    assert.ok(!ids({ backDays: 28, settled, keep: 'T-A' }).includes('T-D'));
  });
  t('이미 고른 목록에서 나중에 끝난 것으로 드러난 다녀온 출장만 뺀다(펴 둔 줄은 남긴다) — 기간은 다시 따지지 않는다', () => {
    const shown = itemsToShow(items, TODAY, { backDays: 28 });
    assert.deepEqual(dropSettled(shown, TODAY, { settled }).map((it) => it.docNo), ['T-FAR', 'T-NEXT', 'O-TODAY', 'T-NOW', 'T-B', 'T-REQ', 'T-14', 'T-15', 'T-28']);
    assert.deepEqual(dropSettled(shown, TODAY, { settled, keep: 'T-D' }).map((it) => it.docNo), ['T-FAR', 'T-NEXT', 'O-TODAY', 'T-NOW', 'T-B', 'T-REQ', 'T-D', 'T-14', 'T-15', 'T-28']);
    assert.equal(dropSettled(shown, TODAY).length, shown.length);
  });
  t('현황·홈 카드도 같은 규칙이다(plansToShow) — 기간과 끝난 것을 같이 따진다', () => {
    const p = (rule) => plansToShow(items, TODAY, day(30), rule).map((x) => x.docNo);
    assert.deepEqual(p({ backDays: 28, settled }), ['T-28', 'T-15', 'T-14', 'T-REQ', 'T-B', 'T-NOW', 'O-TODAY', 'T-NEXT']);
    assert.deepEqual(p({ backDays: 0, settled }), ['T-NOW', 'O-TODAY', 'T-NEXT']);
    assert.deepEqual(p({ backDays: 56 }), ['T-29', 'T-28', 'T-15', 'T-14', 'T-D', 'T-REQ', 'T-B', 'T-A', 'T-NOW', 'O-TODAY', 'T-NEXT']);
    assert.deepEqual(p(), ['T-28', 'T-15', 'T-14', 'T-D', 'T-REQ', 'T-B', 'T-A', 'T-NOW', 'O-TODAY', 'T-NEXT'], '규칙을 주지 않으면 4주 · 모두 보임');
  });
}

console.log('여비계산서 목록 — 하루에 한 번만 읽어 담아 둔다');
{
  const lister = (rows, seen = []) => async (range) => { seen.push(range); return { rows, me: '김거화' }; };
  t('오늘, 창의 처음(8주 전)부터 읽어 둔 것만 그대로 쓴다', () => {
    assert.ok(stagesFresh(STAGES, TODAY));
    assert.ok(!stagesFresh({ ...STAGES, since: day(-28) }, TODAY), '4주만 읽어 둔 것으로는 8주 전 출장의 단계를 모른다');
    assert.ok(!stagesFresh({ ...STAGES, since: undefined }, TODAY));
    assert.ok(!stagesFresh({ ...STAGES, day: day(-1) }, TODAY));
    assert.ok(!stagesFresh({ day: TODAY }, TODAY));
    assert.ok(!stagesFresh(undefined, TODAY));
  });
  t('어느 날까지의 출장을 덮는가(until)도 본다 — 홈 카드는 앞으로의 출장의 계산서도 찾는다. until 이 없는 예전 값은 오늘까지 읽은 것이다', () => {
    assert.ok(!stagesFresh(STAGES, TODAY, day(5)), '오늘까지만 읽어 둔 것으로는 닷새 뒤 출장의 계산서를 모른다');
    assert.ok(stagesFresh({ ...STAGES, until: day(5) }, TODAY, day(5)));
    assert.ok(stagesFresh({ ...STAGES, until: day(5) }, TODAY), '다녀온 출장의 단계를 보는 데는 그대로 쓴다');
    assert.ok(!stagesFresh({ ...STAGES, until: day(5) }, TODAY, day(6)));
  });
  await ta('담아 둔 것이 없으면 8주 전부터 오늘까지를 읽어 담는다 — 단계를 가리는 데 쓰는 것만', async () => {
    const storage = fakeStorage();
    const seen = [];
    const got = await loadStages({ list: lister(STAGES.rows, seen), storage, today: TODAY });
    assert.deepEqual(seen, [{ from: '2026-08-09', to: TODAY }]);
    assert.deepEqual(got.rows[3], { seq: '104', from: day(-10), to: day(-9), pre: '완료', location: '서울', travelers: [{ name: '김거화', post: '완료', trseq: '9104' }] },
      '출장지는 홈 카드가 증빙을 읽을 때 쓰고(출장지에서 결제했는가), 출장자 번호는 홈 카드의 계산서 보기가 쓴다');
    assert.deepEqual([got.day, got.since, got.until, got.me, storage.data[STAGES_KEY].rows.length], [TODAY, '2026-08-09', TODAY, '김거화', 4]);
  });
  await ta('앞으로의 출장까지 덮어야 하면(until) 그날까지 읽어 담는다 — 덮고 있으면 다시 읽지 않고, 못 읽으면 오늘 읽어 둔 것을 준다', async () => {
    const storage = fakeStorage({ [STAGES_KEY]: STAGES });
    const seen = [];
    const got = await loadStages({ list: lister([...STAGES.rows, bt('300', day(10), day(11), '작성', '')], seen), storage, today: TODAY, until: day(11) });
    assert.deepEqual(seen, [{ from: '2026-08-09', to: day(11) }]);
    assert.deepEqual([got.until, got.rows.length, storage.data[STAGES_KEY].until], [day(11), 5, day(11)]);
    await loadStages({ list: lister([], seen), storage, today: TODAY, until: day(8) });
    assert.equal(seen.length, 1, '11일 뒤까지 읽어 둔 것은 8일 뒤까지를 덮는다');
    const boom = async () => { throw new Error('로그인이 필요합니다.'); };
    assert.equal((await loadStages({ list: boom, storage: fakeStorage({ [STAGES_KEY]: STAGES }), today: TODAY, until: day(11) })).rows.length, 4);
  });
  await ta('오늘 읽어 둔 것이 있으면 다시 읽지 않고, force 면 다시 읽는다', async () => {
    const storage = fakeStorage({ [STAGES_KEY]: STAGES });
    const seen = [];
    assert.equal((await loadStages({ list: lister([], seen), storage, today: TODAY })).rows.length, 4);
    assert.equal(seen.length, 0);
    assert.equal((await loadStages({ list: lister([], seen), storage, today: TODAY, force: true })).rows.length, 0);
    assert.equal(seen.length, 1);
  });
  await ta('못 읽으면 던지지 않는다 — 오늘 읽어 둔 것이 있으면 그것, 없으면 null(끝났다고 가리지 않는다)', async () => {
    const boom = async () => { throw new Error('로그인이 필요합니다.'); };
    assert.equal(await loadStages({ list: boom, storage: fakeStorage(), today: TODAY }), null);
    assert.equal(await loadStages({ list: boom, storage: fakeStorage({ [STAGES_KEY]: { ...STAGES, day: day(-1) } }), today: TODAY }), null, '어제 것은 쓰지 않는다');
    assert.equal((await loadStages({ list: boom, storage: fakeStorage({ [STAGES_KEY]: STAGES }), today: TODAY, force: true })).rows.length, 4);
  });
  await ta('저장소에서 읽는 규칙: 고른 기간(주 → 일) · 보낸 기록 · 오늘 읽어 둔 목록', async () => {
    const rule = await tripRule({ storage: fakeStorage({ [BACK_KEY]: 8, [SENT_KEY]: { a: { at: 1 } }, [STAGES_KEY]: STAGES }), today: TODAY });
    assert.deepEqual([rule.backDays, rule.stages.rows.length, rule.settled(trip('a', day(-3))), rule.settled(trip('d', day(-10), day(-9))), rule.settled(trip('b', day(-5), day(-4)))],
      [56, 4, 'sent', 'post', '']);
    const bare = await tripRule({ storage: fakeStorage({ [STAGES_KEY]: { ...STAGES, day: day(-1) } }), today: TODAY });
    assert.deepEqual([bare.backDays, bare.stages, bare.settled(trip('d', day(-10), day(-9)))], [28, null, ''], '고르지 않았으면 4주, 어제 읽은 목록은 쓰지 않는다');
    assert.equal((await tripRule({ storage: fakeStorage({ [BACK_KEY]: 0 }), today: TODAY })).backDays, 0);
  });
}

console.log('근태 탭이 읽은 여비계산서 목록을 담아 둔 것에 덧댄다 — 패널에서 정산을 마치면 홈 카드도 따라온다');
{
  const read = (rows, from, to) => ({ rows, me: '김거화', from, to });
  await ta('창(8주 전 ~ 오늘)을 다 읽은 것이면 통째로 담는다 — 읽은 끝 날까지의 것(앞으로의 출장의 계산서도)이고, 8주보다 오래된 것은 담지 않는다', async () => {
    const storage = fakeStorage();
    await noteStages(read([...STAGES.rows, bt('300', day(10), day(11), '작성', ''), bt('301', day(-70), day(-69), '완료', '완료')], day(-56), day(30)), { storage, today: TODAY });
    assert.deepEqual(storage.data[STAGES_KEY].rows.map((r) => r.seq), ['101', '102', '103', '104', '300']);
    assert.deepEqual([storage.data[STAGES_KEY].day, storage.data[STAGES_KEY].since, storage.data[STAGES_KEY].until, storage.data[STAGES_KEY].me], [TODAY, '2026-08-09', day(30), '김거화']);
    const part = fakeStorage();
    await noteStages(read(STAGES.rows, day(-28), day(30)), { storage: part, today: TODAY });
    assert.equal(part.data[STAGES_KEY], undefined, '4주만 읽은 것은 창을 다 읽은 것이 아니다');
  });
  await ta('일부만 읽은 것이면(기간을 정해 조회) 오늘 담아 둔 것의 같은 계산서만 바꿔 끼운다', async () => {
    const storage = fakeStorage({ [STAGES_KEY]: STAGES });
    await noteStages(read([bt('103', day(-8), day(-7), '완료', '완료')], day(-8), day(-7)), { storage, today: TODAY });
    assert.deepEqual(storage.data[STAGES_KEY].rows.map((r) => [r.seq, r.travelers[0].post]), [['101', ''], ['102', '대기'], ['104', '완료'], ['103', '완료']]);
    assert.equal(settledBy({ stages: storage.data[STAGES_KEY] })(trip('c', day(-8), day(-7))), 'post');
    // 일부 읽기는 덮는 범위를 넓히지 않는다 — 담아 둔 것이 덮던 데(오늘)보다 뒤의 계산서는 끼우지 않는다.
    await noteStages(read([bt('300', day(10), day(11), '작성', '')], day(10), day(11)), { storage, today: TODAY });
    assert.deepEqual([storage.data[STAGES_KEY].rows.some((r) => r.seq === '300'), storage.data[STAGES_KEY].until], [false, TODAY]);
  });
  await ta('일부만 읽었는데 오늘 담아 둔 것이 없으면 담지 않는다 — 반쪽짜리 목록을 "다 읽은 것"으로 두지 않는다', async () => {
    const storage = fakeStorage({ [STAGES_KEY]: { ...STAGES, day: day(-1) } });
    await noteStages(read([bt('103', day(-8), day(-7), '완료', '완료')], day(-8), day(-7)), { storage, today: TODAY });
    assert.equal(storage.data[STAGES_KEY].day, day(-1));
    assert.equal(storage.sets, 0);
  });
  await ta('달라진 것이 없으면 적지 않는다 — 홈 카드를 괜히 다시 그리게 하지 않는다', async () => {
    const storage = fakeStorage();
    await noteStages(read(STAGES.rows, day(-56), TODAY), { storage, today: TODAY });
    await noteStages(read(STAGES.rows, day(-56), TODAY), { storage, today: TODAY });
    assert.equal(storage.sets, 1);
  });
}

console.log(`\n통과 ${pass}건`);
