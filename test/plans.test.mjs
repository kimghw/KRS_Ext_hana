// 현황에 보여줄 근태를 읽어 담아 두는 일(src/plans.js)과, 홈의 WORKSPACE 카드 대신 그것을 읽어 주는 배경(background.js).
//
// 지키려는 것은 둘이다.
//   - 하루에 한 번만 HR 을 연다. 오늘 읽어 둔 것이 있으면 패널이든 배경이든 그것을 쓴다.
//   - 배경은 **자기가 연** HR 작업 탭만 닫는다. 패널이 쓰고 있는 탭을 닫으면 패널의 다음 요청이 끊긴다.
//
// 이 파일은 DOM 없이 돈다 — 배경은 서비스 워커라 document 가 없다. 배경이 끌어오는 모듈 가운데 하나라도
// 불러올 때 DOM 을 건드리면 여기서 걸린다(그러면 실제로는 워커가 뜨지 못해 패널 열기까지 죽는다).
import assert from 'node:assert/strict';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const TODAY = plus(0);

const HR = 'https://hr.krs.co.kr';
/** HR 문서함이 주는 한 줄. */
const ROW = {
  docNo: 'T-1', statusCode: '5', statusName: '결재완료', formId: 'TR', formName: '출장신청서', workCodeKindName: '국내출장',
  startDate: plus(3).replace(/-/g, ''), endDate: plus(4).replace(/-/g, ''), startTime: '0700', endTime: '2000',
  wrkGubunName: '시간', reqRsn: '착수회의', pgmUrlAd: '/uhr/docappr/apprtrav100/view',
};

/**
 * 확장 API 흉내. HR 작업 탭은 열자마자 HR 첫 화면에 닿은 것으로 치고, 그 안에서 도는 함수(pageShell·pageFetch)는
 * 이름으로 가려 답한다. calls 에 무엇을 했는지 적는다.
 */
function fakeChrome({ store = {}, tabs = {}, listFails = false } = {}) {
  const calls = { created: [], removed: [], fetched: [], listeners: [] };
  const live = { ...tabs };
  let nextId = 7;
  globalThis.chrome = {
    sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
    runtime: { onMessage: { addListener: (fn) => calls.listeners.push(fn) } },
    storage: {
      local: {
        get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]])),
        set: async (obj) => { Object.assign(store, obj); },
        remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
      },
    },
    tabs: {
      get: async (id) => { if (!live[id]) throw new Error('No tab'); return live[id]; },
      create: async (opts) => {
        const tab = { id: nextId++, url: `${HR}/`, status: 'complete' };
        live[tab.id] = tab;
        calls.created.push(opts);
        return tab;
      },
      update: async (id) => live[id],
      remove: async (id) => { delete live[id]; calls.removed.push(id); },
    },
    scripting: {
      executeScript: async ({ func, args }) => {
        if (func.name === 'pageShell') return [{ result: { href: `${HR}/`, shell: true, login: false } }];
        if (func.name !== 'pageFetch') return [{ result: null }];
        const path = args[0];
        calls.fetched.push(path);
        if (path === '/api/user') return [{ result: { status: 200, url: '', text: JSON.stringify({ loginUserId: '12345', loginUserNm: '홍길동' }) } }];
        if (listFails) return [{ result: { status: 500, url: '', text: 'boom' } }];
        return [{ result: { status: 200, url: '', text: JSON.stringify([ROW]) } }];
      },
    },
  };
  // 포털 로그인 확인(portalState). 살아 있다고 답한다.
  globalThis.fetch = async () => ({ ok: true, status: 200, type: 'basic', arrayBuffer: async () => new TextEncoder().encode('<html>home</html>').buffer });
  return { calls, store, live };
}

const { PLANS_KEY, plansFresh, loadPlans, plansToShow, TRIP_LOOKBACK_DAYS } = await import('../src/plans.js');
const { listItems: rowsToItems } = await import('../src/attend.js');

console.log('담아 둔 근태를 써도 되는가');
t('오늘 읽었고 넉넉히 거슬러 읽어 둔 것만 쓴다', () => {
  const saved = { day: TODAY, since: plus(-240), items: [] };
  assert.ok(plansFresh(saved, TODAY, TODAY));
  assert.ok(!plansFresh({ ...saved, day: plus(-1) }, TODAY, TODAY), '어제 읽은 것');
  assert.ok(!plansFresh({ ...saved, since: plus(-30) }, TODAY, TODAY), '한 달 치만 읽어 둔 것');
  assert.ok(!plansFresh({ ...saved, items: null }, TODAY, TODAY));
  assert.ok(!plansFresh(undefined, TODAY, TODAY));
  assert.ok(!plansFresh(saved, plus(-90), TODAY), '석 달 전부터 보려면 더 거슬러 읽어야 한다');
});

console.log('읽어 담기');
{
  const listDocs = (rows, seen = []) => async (range) => { seen.push(range); return { rows }; };
  await ta('담아 둔 것이 없으면 HR 을 읽어 담는다(화면에 쓸 것만)', async () => {
    const { store } = fakeChrome();
    const seen = [];
    const r = await loadPlans(TODAY, { listDocs: listDocs([ROW], seen) });
    assert.equal(r.error, '');
    assert.deepEqual(r.items.map((it) => [it.docNo, it.kindName, it.from, it.start, it.statusName]), [['T-1', '국내출장', plus(3), '07:00', '결재완료']]);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].to, TODAY);
    assert.ok(seen[0].from <= plus(-180), '신청일을 여섯 달 넘게 거슬러 읽는다: ' + seen[0].from);
    assert.equal(store[PLANS_KEY].day, TODAY);
    assert.deepEqual(store[PLANS_KEY].items, r.items);
    assert.ok(!('actions' in r.items[0]), '할 수 있는 일 같은 화면 조각은 담지 않는다');
  });
  await ta('오늘 읽어 둔 것이 있으면 HR 을 읽지 않는다', async () => {
    fakeChrome({ store: { [PLANS_KEY]: { day: TODAY, since: plus(-240), items: [{ docNo: 'OLD' }] } } });
    const seen = [];
    const r = await loadPlans(TODAY, { listDocs: listDocs([ROW], seen) });
    assert.deepEqual(r.items, [{ docNo: 'OLD' }]);
    assert.equal(seen.length, 0);
  });
  await ta('force 면 오늘 읽어 둔 것이 있어도 다시 읽는다', async () => {
    const { store } = fakeChrome({ store: { [PLANS_KEY]: { day: TODAY, since: plus(-240), items: [{ docNo: 'OLD' }] } } });
    const r = await loadPlans(TODAY, { force: true, listDocs: listDocs([ROW]) });
    assert.equal(r.items[0].docNo, 'T-1');
    assert.equal(store[PLANS_KEY].items[0].docNo, 'T-1');
  });
  await ta('못 읽으면 던지지 않고 까닭을 준다 — 오늘 읽어 둔 것이 있으면 그것이라도', async () => {
    const boom = async () => { throw new Error('HR 에 들어가지 못했습니다.'); };
    fakeChrome();
    assert.deepEqual(await loadPlans(TODAY, { listDocs: boom }), { items: [], error: 'HR 에 들어가지 못했습니다.' });
    fakeChrome({ store: { [PLANS_KEY]: { day: TODAY, since: plus(-240), items: [{ docNo: 'OLD' }] } } });
    assert.deepEqual(await loadPlans(TODAY, { force: true, listDocs: boom }), { items: [{ docNo: 'OLD' }], error: 'HR 에 들어가지 못했습니다.' });
  });
}

console.log('배경: 홈 카드 대신 근태를 읽어 준다');
{
  /** 배경을 새로 올리고, 홈 카드가 보내는 것과 같은 부탁을 보낸다. */
  async function ask(env, msg = { type: 'hrPlans' }) {
    await import(`../background.js?bust=${Math.random()}`);
    const listener = env.calls.listeners.at(-1);
    return new Promise((resolve) => {
      const kept = listener(msg, { tab: { id: 1 } }, resolve);
      assert.equal(kept, true, '답을 나중에 주겠다고 해야 한다');
    });
  }

  await ta('오늘 읽어 둔 것이 있으면 HR 작업 탭을 열지 않는다', async () => {
    const env = fakeChrome({ store: { [PLANS_KEY]: { day: TODAY, since: plus(-240), items: [{ docNo: 'OLD' }] } } });
    const r = await ask(env);
    assert.deepEqual(r, { ok: true, items: [{ docNo: 'OLD' }], error: '' });
    assert.equal(env.calls.created.length, 0);
    assert.equal(env.calls.removed.length, 0);
  });
  await ta('없으면 뒷전에 작업 탭을 열어 읽고, 담고, 자기가 연 탭을 닫는다', async () => {
    const env = fakeChrome();
    const r = await ask(env);
    assert.equal(r.ok, true);
    assert.equal(r.error, '');
    assert.deepEqual(r.items.map((it) => it.docNo), ['T-1']);
    assert.equal(env.calls.created.length, 1);
    assert.equal(env.calls.created[0].active, false, '작업 탭이 앞으로 튀어나오면 안 된다');
    assert.match(env.calls.created[0].url, /SSOMessage/);
    assert.ok(env.calls.fetched.some((p) => p.startsWith('/empmenu/docappr/docapprdocmstremp100/search?')), env.calls.fetched.join(', '));
    assert.deepEqual(env.calls.removed, [7]);
    assert.equal(env.store[PLANS_KEY].items.length, 1);
    assert.equal(env.store.hrWorkerTab, null, '닫은 탭 번호를 남겨 두지 않는다');
  });
  await ta('읽다가 실패해도 자기가 연 탭은 닫고, 까닭을 답한다', async () => {
    const env = fakeChrome({ listFails: true });
    const r = await ask(env);
    assert.equal(r.ok, true);
    assert.match(r.error, /HR 응답 오류 \(HTTP 500\)/);
    assert.deepEqual(r.items, []);
    assert.equal(env.calls.created.length, 1);
    assert.deepEqual(env.calls.removed, [7]);
    assert.equal(env.store[PLANS_KEY], undefined, '못 읽은 것을 담지 않는다');
  });
  await ta('패널이 쓰던 작업 탭이 있으면 그것으로 읽고 닫지 않는다', async () => {
    const env = fakeChrome({
      store: { hrWorkerTab: { id: 3 } },
      tabs: { 3: { id: 3, url: `${HR}/`, status: 'complete' } },
    });
    const r = await ask(env, { type: 'hrPlans', force: true });
    assert.deepEqual(r.items.map((it) => it.docNo), ['T-1']);
    assert.equal(env.calls.created.length, 0);
    assert.deepEqual(env.calls.removed, []);
    assert.ok(env.live[3], '패널의 탭이 닫혔다');
  });
  await ta('모르는 부탁에는 답하지 않는다', async () => {
    const env = fakeChrome();
    await import(`../background.js?bust=${Math.random()}`);
    assert.equal(env.calls.listeners.at(-1)({ type: 'nope' }, {}, () => {}), false);
  });
  await ta('패널 열기 부탁은 그대로 받는다', async () => {
    const env = fakeChrome();
    assert.deepEqual(await ask(env, { type: 'openSidePanel' }), { ok: true });
  });
}

console.log('현황·홈 카드에 올릴 근태 — 출장은 다녀온 뒤 2주까지');
{
  const row = (docNo, kind, formId, from, to) => ({ ...ROW, docNo, workCodeKindName: kind, formId, startDate: from.replace(/-/g, ''), endDate: to.replace(/-/g, '') });
  const items = rowsToItems([
    row('T-OLD', '국내출장', 'TR', plus(-16), plus(-15)), row('T-WEEK', '국내출장', 'TR', plus(-14), plus(-14)), row('T-NOW', '국내출장', 'TR', plus(1), plus(2)),
    row('O-PAST', '외근', 'TRO', plus(-3), plus(-3)), row('O-NOW', '외근', 'TRO', plus(0), plus(0)),
  ]);
  t('출장은 start 의 2주 전부터(다녀온 뒤 2주까지 남는다), 그 밖은 start 부터 — 다녀온 출장의 여비를 정산해야 하므로', () => {
    assert.deepEqual(plansToShow(items, TODAY, plus(30)).map((p) => p.docNo), ['T-WEEK', 'O-NOW', 'T-NOW']);
    assert.equal(TRIP_LOOKBACK_DAYS, 14);
  });
}

console.log(`\n통과 ${pass}건`);
