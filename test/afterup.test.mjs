// 홈의 WORKSPACE 카드에서 넣은 숙박 증빙·항공권을 **넣은 그 자리에서** 사후정산에 올린다(src/afterup.js) — 2026-10-04 사용자 지정
// ("올리면 바로 사후등록 하게 해줘, 항공권도 동일하게"). 패널의 출장 카드에 넣었을 때와 같은 차례다: 그때 읽은 기록으로 묶고, 사전정산이
// 미완료면 확정부터 하고, 상한액을 읽어 정산금액을 정한 뒤 올린다. 사람이 정해 줘야 하는 것이 있거나 못 올렸으면 "아직 안 올림" 표시를
// 남겨 둔다(패널의 출장 카드가 올린다). 보관함·저장소·여비계산서 사이트는 흉내다 — **실제 사이트에는 아무것도 보내지 않는다.**
import assert from 'node:assert/strict';
import { afterUp, upBusy, UP_BUSY_KEY, UP_BUSY_MS, PANEL_HOW, ASK_TEXT } from '../src/afterup.js';
import { intakeEvidence } from '../src/intake.js';
import { createEvidenceStore, MARKS_KEY } from '../src/evidence.js';
import { lodgeSame, lodgeKnown, lodgeComment, LODGE_OVER_REASON } from '../src/after.js';
import { STAGES_KEY } from '../src/settling.js';
import { todayStr } from '../src/parse.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));

const TRIP = { seq: '145580', from: '2026-09-09', to: '2026-09-10', location: '경기도 고양시' };
const KTX = (date, dep, arr) => ({ seq: '', trseq: '7380', revno: '', date, dep, arr, transport: 'Train', grade: '일반석', total: 59800, currency: 'KRW' });
const HOTEL = { docType: 'lodging_receipt', vendor: '킨텍스호텔', seller: null, sellerBiz: null, bizNo: '128-81-00000', payDate: '2026-09-10', checkIn: '2026-09-09', checkOut: '2026-09-10',
  nights: 1, total: 110000, totalKRW: null, supply: 100000, vat: 10000, currency: 'KRW', corporateCard: null, summary: '킨텍스호텔 1박 110,000원', extra: null };
const BOOKING = { ...HOTEL, docType: 'lodging_booking', payDate: null, total: 110000, supply: null, vat: null, summary: '킨텍스호텔 예약 확인서' };
const AGODA = { ...HOTEL, vendor: '고양 그랜드', seller: 'Agoda', bizNo: null, total: 88.46, supply: null, vat: null, currency: 'USD', summary: 'Agoda 88.46 USD' };
const SUITE = { ...HOTEL, vendor: '일산스위트', total: 150000, supply: null, vat: null, summary: '일산스위트 1박 150,000원' };
const FLY = (over) => ({ docType: 'flight_ticket', airline: '대한항공', flightNo: 'KE1104', flightDate: '2026-09-09', depPlace: '김해', arrPlace: '김포', depTime: '07:30', arrTime: '08:35',
  total: 89000, currency: 'KRW', seatClass: '일반석', mileage: null, corporateCard: null, summary: '김해→김포 KE1104', extra: null, ...over });
const LUNCH = { docType: 'other_receipt', payDate: '2026-09-09', total: 12000, atDestination: true, summary: '점심 12,000원', extra: null };
const png = (name) => ({ name, type: 'image/png', dataUrl: `data:image/png;base64,${Buffer.from(name).toString('base64')}` });

function fakeStorage(init = {}) {
  const data = structuredClone(init);
  return {
    data,
    get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
    set: async (obj) => { Object.assign(data, structuredClone(obj)); },
  };
}

/**
 * 여비계산서 사이트 흉내(src/trip.js 의 tripList·tripPreDetail·tripPreConfirm·tripLodgeMax·tripAfterSave 와 같은 모양).
 * saves 에 올린 사후정산이, calls 에 부른 차례가 적힌다. lodges 는 화면에 지금 있는 숙박 줄이다.
 */
function fakeSite({ pre = '완료', post = '대기', rows = [KTX('2026-09-09', '부산', '행신'), KTX('2026-09-10', '행신', '부산')], max = '120000', fail = null } = {}) {
  const s = { pre, post, lodges: [], saves: [], calls: [], next: 81561 };
  const row = () => ({ ...TRIP, pre: s.pre, travelers: [{ name: '김거화', post: s.post, trseq: s.pre === '완료' ? '157777' : '' }] });
  const stage = () => ({ phase: 'post', done: false, label: '사후정산 작성' });
  return Object.assign(s, {
    list: async () => { s.calls.push('list'); if (fail?.list) throw fail.list; return { rows: [row()], me: '김거화', pages: 1 }; },
    preDetail: async () => { s.calls.push('preDetail'); return { rows, transports: rows.map((r) => r.transport), plane: false, sHour: 7, eHour: 20 }; },
    preConfirm: async () => { s.calls.push('preConfirm'); s.pre = '완료'; return { row: row(), stage: { phase: 'pre', done: true, label: '사전정산 완료' }, sent: true }; },
    lodgeMax: async (trseq) => { s.calls.push(`lodgeMax:${trseq}`); return { maxtotal: max, maxcur: 'KRW', maxrate: '1', maxconv: max }; },
    // 화면에 지금 있는 숙박 줄(src/trip.js 의 tripAfterLodges) — 상한액을 넘는 줄을 묻기 전에, 이미 올라가 있는 줄인지 보려고 읽는다.
    haveLodges: async () => s.lodges.map((h) => ({ ...h, maxconv: max })),
    afterSave: async (r, trseq, plan) => {
      s.calls.push('afterSave');
      if (fail?.save) throw fail.save;
      const same = plan.lodge.filter((l) => s.lodges.some((h) => lodgeSame(l, h)));
      const send = plan.lodge.filter((l) => !same.includes(l));
      if (!send.length && !plan.trans.length && !plan.air) return { row: r, stage: stage(), sent: false, same, lodgeRows: [], lodgeSeqs: [] };
      const lodgeRows = send.map((l) => ({ seq: String(s.next++), del: '0', paydate: l.paydate, company: l.company, sday: String(l.sday), total: String(l.total) }));
      // comment 는 실제 폼에 나가는 비고다(src/after.js afterFields 가 lodgeComment 로 짓는다) — 상한액을 넘겨 실제 금액으로 정산하면 사유가 붙는다.
      s.saves.push({ trseq, lodge: send.map((l) => ({ company: l.company, paydate: l.paydate, sday: l.sday, total: l.total, samount: l.samount, vat: l.vat, comment: lodgeComment(l), file: l.file?.name || '', bytes: l.file?.dataUrl || '' })),
        trans: plan.trans.map((x) => `${x.date} ${x.dep}→${x.arr} ${x.transport} ${x.total}`), air: plan.air });
      s.lodges.push(...lodgeRows);
      s.post = '작성';
      return { row: row(), stage: stage(), sent: true, same, lodgeRows, lodgeSeqs: lodgeRows.map((h) => h.seq) };
    },
  });
}

/** 보관함과, 홈 카드가 배경에 부탁하는 것들(background.js 의 evidenceGiven·evidenceFile·evidenceDone 과 같은 일). */
function shelf() {
  const data = new Map();
  let tick = 0;
  const marks = [];
  const store = createEvidenceStore({ set: async (k, v) => { data.set(k, structuredClone(v)); }, delete: async (k) => { data.delete(k); }, all: async () => [...data.values()].map((v) => structuredClone(v)) },
    { now: () => ++tick, mirror: (m) => { marks.push(m); } });
  const logs = [];
  return {
    store, data, marks, logs,
    /** 홈 카드가 넣은 것처럼 담는다(src/intake.js) — Claude 가 읽은 기록은 흉내다. */
    drop: (name, record, docNo = 'TR-1') => intakeEvidence({ docNo, trip: TRIP, me: '김거화', file: png(name) }, { store, read: async () => ({ record }) }),
    deps: (site, storage = fakeStorage(), stages = []) => ({
      site, storage, onStage: (x) => stages.push(x),
      given: async (docNo) => (await store.list(docNo)).filter((k) => k.record).map((k) => ({ name: k.name, type: k.type, label: k.label, todo: !!k.todo, record: k.record })),
      fileOf: async (docNo, name) => (await store.list(docNo)).find((k) => k.name === name)?.dataUrl || '',
      done: (docNo, names) => store.settle(docNo, names),
      log: (ok, text, data) => { logs.push({ ok, text, data }); },
    }),
    todo: async (docNo = 'TR-1') => (await store.list(docNo)).filter((k) => k.todo).map((k) => k.name),
  };
}
const up = (deps, over = {}) => afterUp({ docNo: 'TR-1', row: TRIP, me: '김거화', ...over }, deps);

console.log('넣은 그 자리에서 사후정산에 올린다');
await ta('숙박 영수증 — 그때 읽은 기록으로 숙박 줄을 올리고(첨부도), "아직 안 올림" 표시를 걷는다. 담은 차례와 읽은 기록은 그대로다', async () => {
  const s = shelf();
  const site = fakeSite();
  const storage = fakeStorage();
  const stages = [];
  await s.drop('lunch.png', LUNCH);
  await s.drop('hotel.png', HOTEL);
  const r = await up(s.deps(site, storage, stages));
  assert.deepEqual([r.ok, r.sent, r.hold], [true, true, false]);
  assert.match(r.text, /^사후정산을 올렸습니다 — 숙박 킨텍스호텔 1박 110,000원/);
  assert.equal(r.brief, '사후정산을 올렸습니다 — 숙박 킨텍스호텔 1박 110,000원', '접어 둔 알림에 적을 한 줄 — 무엇을 올렸는지만');
  assert.deepEqual(site.saves, [{ trseq: '157777', trans: [], air: null,
    lodge: [{ company: '킨텍스호텔', paydate: '2026-09-10', sday: 1, total: 110000, samount: 100000, vat: 10000, comment: '', file: 'hotel.png', bytes: png('hotel.png').dataUrl }] }]);
  assert.deepEqual(site.calls, ['list', 'preDetail', 'lodgeMax:157777', 'afterSave'], '사전정산이 완료돼 있으면 확정하지 않는다');
  assert.deepEqual(await s.todo(), []);
  assert.deepEqual((await s.store.list('TR-1')).map((k) => [k.name, !!k.todo, !!k.record]), [['lunch.png', false, false], ['hotel.png', false, true]]);
  assert.deepEqual(s.marks.at(-1), { 'TR-1': [{ name: 'lunch.png', label: '출장지 영수증' }, { name: 'hotel.png', label: '숙박 증빙' }] }, '홈 카드와 패널이 보는 것에서도 표시가 걷힌다');
  assert.deepEqual(storage.data.attendLodgeMine, { 145580: { 81561: 'hotel.png' } }, '패널의 숙박비 내역이 그 줄을 증빙으로 올린 줄로 알아본다');
  assert.deepEqual(storage.data.attendLodgeActual, { 145580: { 81561: { actual: 110000, supply: 100000, vat: 10000, reason: null } } }, '실제 금액과 문서의 공급가액·부가세 — 패널의 상한 버튼이 되돌릴 때 쓴다(상한액 안이라 비고의 사유는 없다)');
  assert.ok(stages.includes('숙박비 상한액을 확인하는 중...'));
});
await ta('올린 것은 활동 기록에 남는다 — 패널이 남기는 기록과 같은 머리라 숙박비 내역이 알아본다', async () => {
  const s = shelf();
  await s.drop('hotel.png', HOTEL);
  await up(s.deps(fakeSite()));
  await wait();
  assert.deepEqual(s.logs.map((l) => [l.ok, l.text]), [[true, '여비계산서(사후정산) 작성: 145580 · 숙박 킨텍스호텔 1박 110,000원 · 홈 카드에서 넣은 증빙']]);
  assert.deepEqual([s.logs[0].data.files, s.logs[0].data.lodgeSeqs, s.logs[0].data.from, s.logs[0].data.docNo], [['hotel.png'], ['81561'], 'home', 'TR-1']);
});
await ta('같은 숙박의 영수증과 예약서를 같이 넣으면 한 줄로 올라간다 — 올리는 것은 한 번이다', async () => {
  const s = shelf();
  const site = fakeSite();
  await s.drop('booking.pdf', BOOKING);
  await s.drop('receipt.pdf', HOTEL);
  const r = await up(s.deps(site));
  assert.equal(r.sent, true);
  assert.deepEqual([site.saves.length, site.saves[0].lodge.length, site.saves[0].lodge[0].file, site.saves[0].lodge[0].total], [1, 1, 'receipt.pdf', 110000]);
  assert.deepEqual(await s.todo(), []);
});
await ta('사전정산이 아직 완료되지 않았으면 확정부터 하고 올린다 — 패널의 출장 카드에 넣었을 때와 같다', async () => {
  const s = shelf();
  const site = fakeSite({ pre: '작성', post: '' });
  const storage = fakeStorage();
  await s.drop('hotel.png', HOTEL);
  const r = await up(s.deps(site, storage));
  assert.deepEqual(site.calls, ['list', 'preDetail', 'preConfirm', 'lodgeMax:157777', 'afterSave'], '확정한 뒤에 생긴 출장자 번호로 올린다');
  assert.match(r.text, /^사전정산을 완료\(확정\)하고 사후정산을 올렸습니다 — 숙박 킨텍스호텔/);
  await wait();
  assert.deepEqual(s.logs.map((l) => l.text.split(' · ')[0]), ['여비계산서 사전정산 완료(확정): 145580', '여비계산서(사후정산) 작성: 145580']);
});
await ta('담아 둔 여비계산서 목록이 오늘 것이면 올린 뒤의 단계로 바꿔 적는다 — 홈 카드의 계산서 그림이 따라온다', async () => {
  const s = shelf();
  const today = todayStr();
  const storage = fakeStorage({ [STAGES_KEY]: { day: today, since: '2000-01-01', until: today, me: '김거화', rows: [{ seq: '145580', from: TRIP.from, to: TRIP.to, pre: '완료', location: TRIP.location, travelers: [{ name: '김거화', post: '대기', trseq: '157777' }] }] } });
  await s.drop('hotel.png', HOTEL);
  await up(s.deps(fakeSite(), storage));
  await wait();
  assert.equal(storage.data[STAGES_KEY].rows[0].travelers[0].post, '작성');
});

console.log('항공권도 같다');
await ta('가는 편 항공권 — 그 편이 비행기로, 나머지 편은 사전정산의 KTX 그대로 교통비 내역에 올라가고 항공 마일리지 칸이 켜진다. 고른 편도 적어 둔다', async () => {
  const s = shelf();
  const site = fakeSite();
  const storage = fakeStorage();
  await s.drop('go.pdf', FLY());
  const r = await up(s.deps(site, storage));
  assert.equal(r.sent, true);
  assert.deepEqual(site.saves[0].trans, ['2026-09-09 김해→김포 비행기 89000', '2026-09-10 행신→부산 기차(KTX등) 59800']);
  assert.deepEqual([site.saves[0].air.abroad, site.saves[0].air.airline, site.saves[0].lodge.length], ['Y', '대한항공', 0]);
  assert.equal(storage.data.attendLegs['TR-1'].go.t, 'plane', '홈 카드의 가는 편 아이콘과 패널의 출장 카드가 본다');
  assert.match(r.text, /^사후정산을 올렸습니다 — 비행기 2026-09-09 김해→김포 89,000원/);
  assert.deepEqual(await s.todo(), []);
});
await ta('오는 편 항공권을 나중에 넣어도 앞서 올린 가는 편 항공권과 같이 묶인다 — 두 편이 다 비행기로 올라간다', async () => {
  const s = shelf();
  const site = fakeSite();
  const storage = fakeStorage();
  await s.drop('go.pdf', FLY());
  await up(s.deps(site, storage));
  await s.drop('back.pdf', FLY({ flightNo: 'KE1105', flightDate: '2026-09-10', depPlace: '김포', arrPlace: '김해', depTime: '18:00', arrTime: '19:05', total: 91000, summary: '김포→김해 KE1105' }));
  const r = await up(s.deps(site, storage));
  assert.equal(r.sent, true);
  assert.deepEqual(site.saves[1].trans, ['2026-09-09 김해→김포 비행기 89000', '2026-09-10 김포→김해 비행기 91000']);
  assert.deepEqual([storage.data.attendLegs['TR-1'].go.t, storage.data.attendLegs['TR-1'].back.t], ['plane', 'plane']);
});
await ta('앞서 올린 숙박 증빙은 다시 묶지 않는다 — 사후정산에서 지운 숙박 줄이 항공권을 넣었다고 되살아나지 않는다', async () => {
  const s = shelf();
  const site = fakeSite();
  await s.drop('hotel.png', HOTEL);
  await up(s.deps(site));
  site.lodges = [];   // 사후정산 화면에서 그 줄을 지웠다
  await s.drop('go.pdf', FLY());
  await up(s.deps(site));
  assert.deepEqual([site.saves.length, site.saves[1].lodge.length, site.saves[1].trans.length], [2, 0, 2]);
});

console.log('숙박비가 상한액을 넘으면 넣은 자리에서 묻는다 — 상한액으로 / 실제 금액으로(상한액의 1.5배 이내면 부서장 승인)');
await ta('올리지 않고 무엇을 고를지 돌려준다 — 패널의 출장 카드와 같은 말(lodgeChoices)이고, 표시는 남는다', async () => {
  const s = shelf();
  const site = fakeSite();
  await s.drop('suite.png', SUITE);
  const r = await up(s.deps(site));
  assert.deepEqual([r.ok, r.sent, r.hold, r.text, site.saves.length], [true, false, true, ASK_TEXT, 0]);
  assert.deepEqual(r.ask, [{
    key: 'suite.png',
    question: '실제 금액 150,000원이 상한액 120,000원(1일 120,000원 × 1박)을 넘습니다. 정산금액을 어느 쪽으로 올릴까요?',
    choices: [
      { settle: 'cap', label: '상한액 120,000원으로' },
      // 실제 금액으로 올리면 비고에 들어가는 상한 초과 사유(2026-10-08 사용자 지정) — 홈 줄의 아이콘 풍선말에 적힌다.
      { settle: 'real', label: '실제 금액 150,000원으로 · 부서장 승인', note: '상한액의 1.5배(180,000원) 이내라 부서장 승인을 받아 실제 금액으로 정산할 수 있습니다', reason: LODGE_OVER_REASON },
    ],
  }]);
  assert.deepEqual(await s.todo(), ['suite.png']);
});
await ta('상한액으로 고르면 상한액으로 올린다 — 공급가액·부가세는 그 금액에서 되셈한다', async () => {
  const s = shelf();
  const site = fakeSite();
  await s.drop('suite.png', SUITE);
  const r = await up(s.deps(site), { settle: { 'suite.png': 'cap' } });
  assert.deepEqual([r.ok, r.sent, r.ask], [true, true, undefined]);
  assert.deepEqual(site.saves[0].lodge.map((l) => [l.company, l.total, l.samount, l.vat, l.comment]), [['일산스위트', 120000, 109091, 10909, '']], '상한액으로 정산하면 비고에 사유를 적지 않는다');
  assert.match(r.text, /^사후정산을 올렸습니다 — 숙박 일산스위트 1박 120,000원\(상한액\)/);
  assert.doesNotMatch(r.text, /부서장/);
  assert.deepEqual(await s.todo(), []);
});
await ta('실제 금액으로 고르면 그 금액으로 올리고, 부서장 승인이 필요하다고 줄에 적는다 — 고른 것은 기록에도 남는다', async () => {
  const s = shelf();
  const site = fakeSite();
  const storage = fakeStorage();
  await s.drop('suite.png', SUITE);
  const r = await up(s.deps(site, storage), { settle: { 'suite.png': 'real' } });
  assert.equal(r.sent, true);
  assert.deepEqual(site.saves[0].lodge.map((l) => [l.company, l.total, l.comment]), [['일산스위트', 150000, LODGE_OVER_REASON]], '실제 금액으로 올리면 비고에 상한 초과 사유(기본 문구)가 들어간다');
  assert.equal(storage.data.attendLodgeActual[145580][81561].reason, LODGE_OVER_REASON, '비고에 적은 사유를 실제 금액과 같이 적어 둔다 — 패널의 상한 버튼이 잇고 걷을 때 쓴다');
  assert.equal(r.text, '사후정산을 올렸습니다 — 숙박 일산스위트 1박 150,000원 · 일산스위트: 부서장 승인 필요 — 상한액의 1.5배(180,000원) 이내');
  assert.equal(r.brief, '사후정산을 올렸습니다 — 숙박 일산스위트 1박 150,000원 · 부서장 승인 필요', '접어 둔 한 줄에도 승인이 필요하다는 것은 남는다');
  await wait();
  assert.deepEqual(s.logs.at(-1).data.settle, { 'suite.png': 'real' });
  assert.ok(s.logs.at(-1).data.notes.some((n) => /부서장 승인 필요/.test(n)));
});
await ta('상한액의 1.5배를 넘으면 실제 금액 버튼에 부서장 승인이 붙지 않고, 범위를 벗어난다고 알린다 — 고르는 것은 막지 않는다', async () => {
  const s = shelf();
  const site = fakeSite();
  await s.drop('suite.png', { ...SUITE, total: 200000 });
  const r = await up(s.deps(site));
  assert.deepEqual(r.ask[0].choices.map((c) => [c.settle, c.label]), [['cap', '상한액 120,000원으로'], ['real', '실제 금액 200,000원으로']]);
  assert.match(r.ask[0].choices[1].note, /1\.5배\(180,000원\)를 넘어 부서장 승인으로 정산할 수 있는 범위를 벗어납니다/);
});
await ta('상한액을 넘는 숙박과 안 넘는 숙박을 같이 넣으면 넘는 줄만 묻는다 — 고르면 두 줄이 같이 올라간다', async () => {
  const s = shelf();
  const site = fakeSite();
  await s.drop('hotel.png', HOTEL);
  await s.drop('suite.png', SUITE);
  const asked = await up(s.deps(site));
  assert.deepEqual([asked.ask.map((a) => a.key), site.saves.length], [['suite.png'], 0]);
  const r = await up(s.deps(site), { settle: { 'suite.png': 'cap' } });
  assert.deepEqual([r.sent, site.saves[0].lodge.map((l) => [l.company, l.total])], [true, [['킨텍스호텔', 110000], ['일산스위트', 120000]]]);
});
await ta('사전정산이 미완료였으면 확정한 것을 묻는 말 앞에 적는다 — 고른 뒤에는 다시 확정하지 않는다', async () => {
  const s = shelf();
  const site = fakeSite({ pre: '작성', post: '' });
  await s.drop('suite.png', SUITE);
  const asked = await up(s.deps(site));
  assert.equal(asked.text, `사전정산을 완료(확정)했습니다 · ${ASK_TEXT}`);
  await up(s.deps(site), { settle: { 'suite.png': 'cap' } });
  assert.equal(site.calls.filter((c) => c === 'preConfirm').length, 1);
});

console.log('올리지 않고 남겨 두는 때 — 패널의 출장 카드가 올린다');
await ta('외화 문서인데 원화 금액이 없으면 올리지 않는다 — 표시가 남고, 패널에서 올리라고 말한다', async () => {
  const s = shelf();
  const site = fakeSite();
  await s.drop('agoda.pdf', AGODA);
  const r = await up(s.deps(site));
  assert.deepEqual([r.ok, r.sent, r.hold, site.saves.length], [false, false, true, 0]);
  assert.equal(r.text, `사후정산에는 올리지 않았습니다 — 외화 문서라 원화로 결제한 금액을 적어야 합니다 · ${PANEL_HOW}`);
  assert.deepEqual(await s.todo(), ['agoda.pdf']);
});
await ta('외화 문서와 상한액을 넘는 숙박이 같이 있어도 패널로 넘긴다 — 원화 금액은 적어야 하는 것이라 홈 줄에서 받지 않는다', async () => {
  const s = shelf();
  const site = fakeSite();
  await s.drop('agoda.pdf', AGODA);
  await s.drop('suite.png', SUITE);
  const r = await up(s.deps(site));
  assert.deepEqual([r.ok, r.hold, r.ask, site.saves.length], [false, true, undefined, 0]);
  assert.match(r.text, /외화 문서라 원화로 결제한 금액을 적어야 합니다/);
});
await ta('필수 값을 읽지 못한 증빙은 올리지 않는다 — 사전정산도 확정하지 않는다', async () => {
  const s = shelf();
  const site = fakeSite({ pre: '작성', post: '' });
  await s.drop('hotel.png', { ...HOTEL, total: null, supply: null, vat: null });
  const r = await up(s.deps(site));
  assert.deepEqual([r.hold, site.calls.includes('preConfirm'), site.calls.includes('afterSave')], [true, false, false]);
  assert.match(r.text, /정산금액을\(를\) 읽지 못했습니다/);
  assert.deepEqual(await s.todo(), ['hotel.png']);
});
await ta('값을 모르는 편이 있으면 교통비 내역을 바꾸지 않는다 — 항공권이 없는 비행기 편이 빠진 채 올라가지 않게', async () => {
  const s = shelf();
  const site = fakeSite();
  // 패널에서 오는 편을 비행기로 골라 두었는데 그 항공권은 없다 — 가는 편 항공권만 넣었다.
  const storage = fakeStorage({ attendLegs: { 'TR-1': { back: { t: 'plane', g: 'standard' } } } });
  await s.drop('go.pdf', FLY());
  const r = await up(s.deps(site, storage));
  assert.deepEqual([r.hold, site.saves.length], [true, 0]);
  assert.match(r.text, /오는 편: 비행기 요금을 모릅니다 — 항공권을 넣어 주세요/);
  assert.deepEqual(await s.todo(), ['go.pdf']);
});
await ta('사이트가 받지 않으면(로그인 만료 등) 까닭을 답한다 — 던지지 않고, 표시가 남고, 기록에 남는다', async () => {
  const s = shelf();
  await s.drop('hotel.png', HOTEL);
  const r = await up(s.deps(fakeSite({ fail: { save: new Error('저장을 보냈지만 목록의 사후정산이 바뀌지 않았습니다.') } })));
  assert.deepEqual([r.ok, r.sent, r.hold], [false, false, true]);
  assert.equal(r.text, `사후정산에 올리지 못했습니다 — 저장을 보냈지만 목록의 사후정산이 바뀌지 않았습니다. · ${PANEL_HOW}`);
  assert.deepEqual(await s.todo(), ['hotel.png']);
  await wait();
  assert.deepEqual([s.logs.at(-1).ok, /^여비계산서\(사후정산\) 실패: 145580 — /.test(s.logs.at(-1).text)], [false, true]);
  const lost = await up(s.deps(fakeSite({ fail: { list: new Error('로그인이 필요합니다.') } })));
  assert.match(lost.text, /^사후정산에 올리지 못했습니다 — 로그인이 필요합니다\./);
});

console.log('올릴 것이 없는 때');
await ta('같은 숙박 줄이 사후정산에 이미 있으면 다시 올리지 않고 표시만 걷는다', async () => {
  const s = shelf();
  const site = fakeSite();
  await s.drop('hotel.png', HOTEL);
  await up(s.deps(site));
  await s.drop('hotel.png', HOTEL);
  assert.deepEqual(await s.todo(), ['hotel.png']);
  const r = await up(s.deps(site));
  assert.deepEqual([r.ok, r.sent, r.text, site.saves.length], [true, false, '같은 숙박 줄이 사후정산에 이미 있어 다시 올리지 않았습니다', 1]);
  assert.deepEqual(await s.todo(), []);
});
await ta('당일 출장의 숙박 영수증은 사후정산에 넣을 것이 없다 — 올리지 않고 표시를 걷는다(보관은 돼 있다)', async () => {
  const s = shelf();
  const site = fakeSite();
  const day = { ...TRIP, to: TRIP.from };
  await s.drop('hotel.png', HOTEL);
  site.list = async () => ({ rows: [{ ...day, pre: '완료', travelers: [{ name: '김거화', post: '대기', trseq: '157777' }] }], me: '김거화' });
  site.preDetail = async () => ({ rows: [KTX('2026-09-09', '부산', '행신'), KTX('2026-09-09', '행신', '부산')], transports: ['Train', 'Train'] });
  const r = await up(s.deps(site), { row: day });
  assert.deepEqual([r.ok, r.sent, r.hold, r.text, site.saves.length], [true, false, false, '당일 출장이고 비행기를 타지 않아 사후정산은 올리지 않습니다', 0]);
  assert.deepEqual([await s.todo(), (await s.store.list('TR-1')).length], [[], 1]);
});
await ta('사후정산이 이미 완료된 출장이면 올리지 않고 표시만 걷는다 — 증빙은 보낼 때 같이 간다', async () => {
  const s = shelf();
  const site = fakeSite({ post: '완료' });
  await s.drop('hotel.png', HOTEL);
  const r = await up(s.deps(site));
  assert.deepEqual([r.ok, r.sent, site.calls], [true, false, ['list']]);
  assert.match(r.text, /^사후정산이 이미 완료돼 있어 올리지 않았습니다/);
  assert.deepEqual(await s.todo(), []);
});
// 2026-10-05 사용자 지정(같은 영수증을 두 번 넣어 올리기 버튼이 남은 것을 보고): "이게 확인이 안되나? 출장이랑 맞잖아"
await ta('이미 사후정산에 올라가 있는 숙박 줄이면 상한액을 넘어도 다시 묻지 않는다 — 같은 줄이라 올리지 않고 "아직 안 올림" 표시만 걷는다', async () => {
  const OVER = { ...HOTEL, total: 150000, supply: null, vat: null, summary: '킨텍스호텔 1박 150,000원' };
  for (const [how, total] of [['real', 150000], ['cap', 120000]]) {
    const s = shelf();
    const site = fakeSite();
    await s.drop('hotel.png', OVER);
    const asked = await up(s.deps(site));
    assert.deepEqual([asked.sent, asked.ask.length], [false, 1], '처음에는 묻는다');
    const first = await up(s.deps(site), { settle: { 'hotel.png': how } });
    assert.deepEqual([first.sent, site.saves.length, site.lodges[0].total], [true, 1, String(total)]);
    // 같은 영수증을 또 넣었다 — 화면의 줄과 맞춰 보고(결제일·업체명·박 수, 금액은 실제 금액이거나 상한액) 묻지도 올리지도 않는다
    await s.drop('hotel.png', OVER);
    assert.deepEqual(await s.todo(), ['hotel.png']);
    const again = await up(s.deps(site));
    assert.deepEqual([again, site.saves.length, await s.todo()],
      [{ ok: true, sent: false, hold: false, text: '같은 숙박 줄이 사후정산에 이미 있어 다시 올리지 않았습니다' }, 1, []], how);
  }
  // 금액이 다른 줄(다른 숙박)은 같은 줄이 아니다 — 묻는다
  assert.deepEqual([lodgeKnown({ paydate: '2026-09-10', company: '킨텍스호텔', sday: 1, actual: 150000, maxconv: '120000' },
    [{ del: '0', paydate: '2026-09-10', company: '킨텍스호텔', sday: '1', total: '99000' }, { del: '1', paydate: '2026-09-10', company: '킨텍스호텔', sday: '1', total: '150000' }])], [''],
  '금액이 다르거나 지운 줄은 치지 않는다');
});
// 2026-10-05 사용자 지정: "출장 기간동안의 내용이 아니면 알림을 줘 안맞다고, 맞는것만 선별취급 해서 올리고 해당 없는거는 문서보관에 알림표지 하고
// 확정 해주기 전까지는 보내기 해도 같이 보내지 말고"
await ta('출장 기간의 것이 아닌 증빙은 올리지 않는다 — 맞는 것만 올라가고, 안 맞는 것은 알림 표시로 남는다. 확정하면 그때 올라간다', async () => {
  const s = shelf();
  const site = fakeSite();
  const JEJU = { ...HOTEL, vendor: '제주호텔', payDate: '2026-09-21', checkIn: '2026-09-20', checkOut: '2026-09-21', total: 90000, supply: null, vat: null, summary: '제주호텔 1박' };
  const a = await s.drop('hotel.png', HOTEL);
  const b = await s.drop('jeju.png', JEJU);
  assert.deepEqual([a.warn, a.todo, b.warn, b.todo], [undefined, true, '묵은 기간(9/20~9/21)이 출장 기간(9/9~9/10) 밖입니다', false]);
  const r = await up(s.deps(site));
  assert.deepEqual([r.sent, site.saves.length, site.saves[0].lodge.map((l) => l.company)], [true, 1, ['킨텍스호텔']], '맞는 것만 올라간다');
  assert.deepEqual((await s.store.list('TR-1')).map((k) => [k.name, !!k.warn, !!k.todo]), [['hotel.png', false, false], ['jeju.png', true, false]]);
  assert.deepEqual([await up(s.deps(site)), site.saves.length], [{ ok: true, sent: false, hold: false, text: '' }, 1], '알림 표시로 둔 것은 다시 불러도 올리지 않는다');
  // 사람이 이 출장의 증빙이 맞다고 확정했다(패널의 보관 중인 증빙) — 올릴 것이 되고, 그 기록으로 올라간다.
  await s.store.confirm('TR-1', 'jeju.png', { todo: true });
  const again = await up(s.deps(site));
  assert.deepEqual([again.sent, site.saves.length, site.saves[1].lodge.map((l) => l.company)], [true, 2, ['제주호텔']]);
  assert.deepEqual(await s.todo(), []);
});
await ta('올릴 증빙이 없으면(출장지 영수증뿐) 사이트를 두드리지 않는다', async () => {
  const s = shelf();
  const site = fakeSite();
  await s.drop('lunch.png', LUNCH);
  assert.deepEqual([await up(s.deps(site)), site.calls], [{ ok: true, sent: false, hold: false, text: '' }, []]);
});

console.log('홈 카드가 올리는 중이라는 표시 — 패널의 버튼이 본다');
t('시작한 때부터 얼마 동안만 올리는 중으로 친다 — 홈 탭이 도중에 닫혀도 패널의 버튼이 영영 잠기지 않는다', () => {
  const now = 1_000_000_000;
  assert.deepEqual([upBusy({ 'TR-1': now - 1000 }, 'TR-1', now), upBusy({ 'TR-1': now - UP_BUSY_MS }, 'TR-1', now), upBusy({ 'TR-2': now }, 'TR-1', now), upBusy(undefined, 'TR-1', now)],
    [true, false, false, false]);
  assert.equal(UP_BUSY_KEY, 'afterUpBusy');
  assert.equal(MARKS_KEY, 'evidenceMarks');
});

console.log(`\n통과 ${pass}건`);
