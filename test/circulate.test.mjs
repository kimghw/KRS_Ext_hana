// DOC-Cruiser 미회람 문서 자동 열람: 목록 읽기, 건마다 열기와 다시 읽어 확인하기, 하루에 한 번, 설정 따르기.
// 가장 중요한 건 둘이다 — **켠 적이 없으면 한 건도 열지 않는 것**(읽음 처리는 되돌릴 수 없다)과,
// 못 연 건·열었는데 남은 건을 "다 했다"로 넘기지 않는 것.
//
// 목록 markup 은 2026-10-01 실제 화면을 본뜬 것이다. 실제 캡처는 사내 공문 제목이 수백 건 들어 있어 저장소에 두지 않는다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  parseNonCirculated, circulateAll, describeResult, stateText, runDaily, startCirculate, viewUrl,
  circulateEnabled, ENABLE_KEY, STATE_KEY, STALE_MS, HEARTBEAT_MS,
} from '../src/circulate.js';
import { NONCIR_LIST_URL, CIRC_VIEW_URL } from '../src/config.js';
import { AuthError } from '../src/net.js';
import { KIND_LABEL, LOG_KEY } from '../src/logbook.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
globalThis.DOMParser = new JSDOM('').window.DOMParser;

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

const TODAY = '2026-10-01';
const NOW = new Date('2026-10-01T09:00:00').getTime();

/* ------------------------------------------------------------ 가짜 사이트 */

const DOCS = [
  { rId: 'DA23FECD48980363D96B60E4E776FFE0', rcId: '1907FD8BBBD18C1CF6D21C35A9848884', ea: '9A3400CDAA7339D0', rcvNo: 'HER-124-2026', title: '부가가치세 신고 관련 자료 송부 요청', date: '2026.09.30' },
  { rId: 'DA23FECD48980363D58458560E866B6D', rcId: '5ADF8E84D5862FC998AF1EB89033CF02', ea: '0A88BD16D83D2AB7', rcvNo: 'HER-121-2026', title: 'Request for Setting Budget &amp; Business plan', date: '2026.09.28' },
  // 오프라인 문서는 셋째 인자(EA_DOCID)가 비어 있다.
  { rId: '461893A7831FD9689077B653509179FB', rcId: 'CA29738EBA3358E3055B39906D2E0548', ea: '', rcvNo: 'STS-110-2018', title: '2017 year-end Tax settlement', date: '2018.01.22' },
];

const row = (d, i) => `<tr class="${i % 2 ? 'rgAltRow' : 'rgRow'}" id="RadGridDOC_ctl00__${i}">
  <td align="center"> ${i + 1} </td><td align="center">${d.rcvNo}</td><td>
  <a id="RadGridDOC_ctl00_ctl${String(4 + 2 * i).padStart(2, '0')}_hlViewSndDoc" href="javascript:ViewCirculationDoc('${d.rId}', '${d.rcId}', '${d.ea}');">${d.title}</a>
  </td><td align="center" style="width:60px;">${d.date}</td><td>ROH Gilltae</td><td align="center">FIN1000-523-2026</td><td>Finance Team</td><td>KYE Donghan</td><td align="center">1</td>
</tr>`;

const listHtml = (docs, declared = docs.length) => `<html><head><title>Non-circular documents</title></head><body>
<form method="post" action="./Not_Circulation_List.aspx" id="frmNET">
<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="${'v'.repeat(2000)}">
<table><tbody><tr><td class="listTitleNew">Non-circulated documents</td>
<td><span id="lblUserInfo"><b>HONG Gildong (<font color="magenta">HER</font>)</b></span></td>
<td align="right"><span id="lblResult"><font color="red"><b>${declared}</b></font> results</span></td></tr></tbody></table>
<div id="RadGridDOC" class="RadGrid RadGrid_Office2007"><table class="rgMasterTable" id="RadGridDOC_ctl00">
<thead><tr><th class="rgHeader">No.</th><th class="rgHeader"><a href="javascript:__doPostBack('RadGridDOC$ctl00$ctl02$ctl00$ctl00','')">Rcv No.</a></th>
<th class="rgHeader">Title</th><th class="rgHeader">Rcv Date</th><th class="rgHeader">Rcv P.I.C</th><th class="rgHeader">Snd No.</th>
<th class="rgHeader">Sender</th><th class="rgHeader">Snd P.I.C</th><th class="rgHeader">Elapsed days</th></tr></thead>
<tbody>${docs.map(row).join('')}</tbody></table></div>
<input type="submit" name="btnSetCirculation" value="Set the all document circulation state" id="btnSetCirculation" class="button">
</form></body></html>`;

// 미인증이면 목록 대신 이 한 줄이 200 으로 온다(2026-10-01, 쿠키 없이 불러 확인).
const SIGNED_OUT = '<script language=\'javascript\'>alert("올바른 로그인 정보가 없습니다.\\r\\n\\r\\n다시 로그인하여 주시기 바랍니다!");history.back();</script>';

const viewHtml = (d) => `<html><body><form name="form1" method="post" action="./RfCirculation_View.aspx?R_ID=${d.rId}&amp;RC_ID=${d.rcId}" id="form1">
<span class="title">Information of Received Doc.(On-Line)</span>
<input name="txtRcvNo" type="text" value="${d.rcvNo}" readonly="readonly" id="txtRcvNo" class="inputTextField" />
</form></body></html>`;

/**
 * 목록과 문서 보기를 흉내 낸다. 진짜처럼 **문서를 열면 목록에서 빠진다.**
 *   failOn — 여는 요청이 터지는 건, junkOn — 문서 화면이 아닌 것이 오는 건, stickyOn — 열어도 목록에 남는 건
 */
function fakeSite(docs = DOCS, { failOn = [], junkOn = [], stickyOn = [], list = null, onView = null } = {}) {
  const left = new Map(docs.map((d) => [d.rcId, d]));
  const calls = [];
  const fetchPage = async (url, init) => {
    calls.push({ url, init });
    if (url === NONCIR_LIST_URL) return { html: list ? list() : listHtml([...left.values()]), finalUrl: url };
    const u = new URL(url);
    const d = docs.find((x) => x.rcId === u.searchParams.get('RC_ID') && x.rId === u.searchParams.get('R_ID'));
    await onView?.(d);
    if (!d || junkOn.includes(d.rcId)) return { html: '<html><body><h2>Runtime Error</h2></body></html>', finalUrl: url };
    if (failOn.includes(d.rcId)) throw new Error('HTTP 500');
    if (!stickyOn.includes(d.rcId)) left.delete(d.rcId);
    return { html: viewHtml(d), finalUrl: url };
  };
  return {
    fetchPage, calls, left,
    lists: () => calls.filter((c) => c.url === NONCIR_LIST_URL).length,
    views: () => calls.filter((c) => c.url !== NONCIR_LIST_URL).map((c) => c.url),
  };
}

/** chrome.storage.local 흉내. 바꾼 것은 onChanged 로 알린다 — 진짜처럼. */
function fakeStorage(init = {}) {
  const data = structuredClone(init);
  const listeners = [];
  const fire = (changes) => { for (const fn of [...listeners]) fn(changes, 'local'); };
  return {
    data,
    get: async (keys) => {
      const out = {};
      for (const k of [].concat(keys)) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    set: async (obj) => {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
        data[k] = structuredClone(v);
      }
      fire(changes);
    },
    onChanged: (fn) => {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    listenerCount: () => listeners.length,
  };
}

const RESULT = { total: 3, declared: 3, opened: 3, failed: [], unconfirmed: [], remaining: 0, aborted: false };

/** 정해 둔 결과를 돌려주는 가짜 열기. 몇 번 불렸는지, 멈춤 신호를 받았는지 남긴다. */
function fakeCirculate(result = RESULT, { gate = null } = {}) {
  const fn = async ({ signal, onProgress } = {}) => {
    fn.calls++;
    fn.signal = signal;
    fn.onProgress = onProgress;
    if (gate) await gate;
    if (result instanceof Error) throw result;
    return { ...result, aborted: result.aborted || !!signal?.aborted };
  };
  fn.calls = 0;
  return fn;
}

const daily = (storage, circulate, over = {}) =>
  runDaily({ storage, circulate, now: () => NOW, today: () => TODAY, ...over });
const logged = (storage) => (storage.data[LOG_KEY] || []).filter((e) => e.kind === 'circulate');

/* ------------------------------------------------------------ 목록 읽기 */

console.log('목록 읽기');
t('문서마다 R_ID·RC_ID·제목·수신 번호·날짜를 뽑는다', () => {
  const r = parseNonCirculated(listHtml(DOCS));
  assert.equal(r.recognized, true);
  assert.equal(r.declared, 3);
  assert.equal(r.docs.length, 3);
  assert.deepEqual(r.docs[0], {
    rId: DOCS[0].rId, rcId: DOCS[0].rcId, title: '부가가치세 신고 관련 자료 송부 요청',
    rcvNo: 'HER-124-2026', rcvDate: '2026.09.30',
  });
  assert.equal(r.docs[1].title, 'Request for Setting Budget & Business plan');
});
t('셋째 인자(EA_DOCID)가 빈 오프라인 문서도 뽑는다', () =>
  assert.equal(parseNonCirculated(listHtml(DOCS)).docs[2].rcvNo, 'STS-110-2018'));
t('정렬 링크(__doPostBack)는 문서가 아니다', () =>
  assert.ok(parseNonCirculated(listHtml(DOCS)).docs.every((d) => /^[0-9A-F]{32}$/.test(d.rId))));
t('같은 문서가 두 번 나와도 한 번만', () =>
  assert.equal(parseNonCirculated(listHtml([DOCS[0], DOCS[0], DOCS[1]])).docs.length, 2));
t('0건 목록도 목록이다', () => {
  const r = parseNonCirculated(listHtml([]));
  assert.equal(r.recognized, true);
  assert.equal(r.declared, 0);
  assert.equal(r.docs.length, 0);
});
t('미인증 안내는 목록이 아니다', () => assert.equal(parseNonCirculated(SIGNED_OUT).recognized, false));
t('보기 주소는 사이트의 ViewCirculationDoc 이 만드는 것과 같다', () =>
  assert.equal(viewUrl(DOCS[0]), `${CIRC_VIEW_URL}?R_ID=${DOCS[0].rId}&RC_ID=${DOCS[0].rcId}`));

/* ------------------------------------------------------------ 열기 */

console.log('열기');
await ta('건마다 보기 주소를 한 번씩 부르고, 끝나면 목록을 다시 받아 확인한다', async () => {
  const site = fakeSite();
  const r = await circulateAll({ fetchPage: site.fetchPage });
  assert.deepEqual(site.views().sort(), DOCS.map(viewUrl).sort());
  assert.equal(site.lists(), 2, '다시 읽어 확인하지 않았다');
  assert.deepEqual(r, { total: 3, declared: 3, opened: 3, failed: [], unconfirmed: [], remaining: 0, aborted: false });
  assert.deepEqual(describeResult(r), { ok: true, text: '미회람 문서 3건을 모두 열어 회람 처리했습니다' });
});
await ta('열 것이 없으면 목록 한 번만 받는다', async () => {
  const site = fakeSite([]);
  const r = await circulateAll({ fetchPage: site.fetchPage });
  assert.equal(site.calls.length, 1);
  assert.equal(r.total, 0);
  assert.equal(r.remaining, 0);
  assert.deepEqual(describeResult(r), { ok: true, text: '미회람 문서가 없습니다' });
});
await ta('한 건이 터져도 나머지는 열고, 못 연 건은 이유와 함께 남긴다', async () => {
  const site = fakeSite(DOCS, { failOn: [DOCS[1].rcId] });
  const r = await circulateAll({ fetchPage: site.fetchPage });
  assert.equal(r.opened, 2);
  assert.equal(r.remaining, 1);
  assert.deepEqual(r.failed, [{ rcvNo: 'HER-121-2026', title: 'Request for Setting Budget & Business plan', reason: 'HTTP 500' }]);
  const d = describeResult(r);
  assert.equal(d.ok, false);
  assert.match(d.text, /3건 중 2건을 열었습니다 · 실패 1건 · 남은 미회람 1건/);
});
await ta('문서 화면이 아닌 것이 오면 연 것으로 치지 않는다', async () => {
  const site = fakeSite(DOCS, { junkOn: [DOCS[0].rcId] });
  const r = await circulateAll({ fetchPage: site.fetchPage });
  assert.equal(r.opened, 2);
  assert.match(r.failed[0].reason, /문서 화면을 알아보지 못했습니다/);
});
await ta('열었는데 목록에 그대로 남아 있으면 그렇다고 말한다', async () => {
  const site = fakeSite(DOCS, { stickyOn: [DOCS[2].rcId] });
  const r = await circulateAll({ fetchPage: site.fetchPage });
  assert.equal(r.opened, 3);
  assert.deepEqual(r.unconfirmed, [{ rcvNo: 'STS-110-2018', title: '2017 year-end Tax settlement' }]);
  const d = describeResult(r);
  assert.equal(d.ok, false, '남아 있는데 다 했다고 했다');
  assert.match(d.text, /열었지만 목록에 남은 1건/);
});
await ta('확인용 목록을 다시 못 받으면 남은 건수를 모른다고 말한다', async () => {
  let n = 0;
  const site = fakeSite(DOCS, { list: () => (++n === 1 ? listHtml(DOCS) : SIGNED_OUT) });
  const r = await circulateAll({ fetchPage: site.fetchPage });
  assert.equal(r.opened, 3);
  assert.equal(r.remaining, null);
  assert.match(describeResult(r).text, /남은 건수는 확인하지 못했습니다/);
});
await ta('사이트가 센 건수와 뽑은 건수가 다르면 그것도 말한다', async () => {
  let n = 0;
  const site = fakeSite(DOCS, { list: () => (++n === 1 ? listHtml(DOCS, 5) : listHtml([])) });
  const r = await circulateAll({ fetchPage: site.fetchPage });
  assert.equal(r.declared, 5);
  assert.match(describeResult(r).text, /목록은 5건이라는데 3건만 읽었습니다/);
});
await ta('미인증이면 AuthError 이고 문서는 하나도 열지 않는다', async () => {
  const site = fakeSite(DOCS, { list: () => SIGNED_OUT });
  await assert.rejects(circulateAll({ fetchPage: site.fetchPage }),
    (err) => err instanceof AuthError && /로그인이 필요/.test(err.message));
  assert.equal(site.views().length, 0);
});
await ta('모르는 화면이면 로그인 문제라고 하지 않는다', async () => {
  const site = fakeSite(DOCS, { list: () => `<html><body>${'x'.repeat(3000)}</body></html>` });
  await assert.rejects(circulateAll({ fetchPage: site.fetchPage }),
    (err) => !(err instanceof AuthError) && /알아보지 못했습니다/.test(err.message));
});
await ta('제목에 "다시 로그인" 이 들어 있어도 목록은 목록이다', async () => {
  const docs = [{ ...DOCS[0], title: '시스템 점검 후 다시 로그인이 필요합니다' }];
  const r = await circulateAll({ fetchPage: fakeSite(docs).fetchPage });
  assert.equal(r.opened, 1);
});
await ta('처음부터 멈춰 있으면 목록만 받고 한 건도 열지 않는다', async () => {
  const site = fakeSite();
  const ac = new AbortController();
  ac.abort();
  const r = await circulateAll({ fetchPage: site.fetchPage, signal: ac.signal });
  assert.equal(site.views().length, 0);
  assert.equal(r.opened, 0);
  assert.equal(r.aborted, true);
  assert.equal(r.remaining, 3);
});
await ta('도중에 멈추면 거기까지만 열고, 멈췄다고 말한다', async () => {
  const ac = new AbortController();
  const site = fakeSite(DOCS, { onView: () => ac.abort() });
  const r = await circulateAll({ fetchPage: site.fetchPage, signal: ac.signal, concurrency: 1 });
  assert.equal(site.views().length, 1, '끈 뒤에도 더 열었다');
  assert.equal(r.aborted, true);
  assert.match(describeResult(r).text, /도중에 멈췄습니다/);
});
await ta('진행을 건마다 알린다', async () => {
  const seen = [];
  await circulateAll({ fetchPage: fakeSite().fetchPage, onProgress: (i, n) => seen.push(`${i}/${n}`) });
  assert.deepEqual(seen, ['1/3', '2/3', '3/3']);
});
await ta('한꺼번에 여는 수를 넘기지 않는다', async () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    ...DOCS[0], rcId: (i + 1).toString(16).toUpperCase().padStart(32, '0'), rcvNo: `HER-${i}-2026`,
  }));
  let live = 0;
  let peak = 0;
  const site = fakeSite(many, {
    onView: async () => { peak = Math.max(peak, ++live); await tick(5); live--; },
  });
  const r = await circulateAll({ fetchPage: site.fetchPage, concurrency: 3 });
  assert.equal(r.opened, 10);
  assert.equal(peak, 3);
});

/* ------------------------------------------------------------ 하루에 한 번 */

console.log('하루에 한 번');
t('켠다고 한 적이 없으면 끈 것이다', () => {
  assert.equal(circulateEnabled(undefined), false);
  assert.equal(circulateEnabled(false), false);
  assert.equal(circulateEnabled(true), true);
});
await ta('설정이 없으면 목록조차 받지 않는다', async () => {
  const storage = fakeStorage();
  const circ = fakeCirculate();
  assert.deepEqual(await daily(storage, circ), { skipped: 'off' });
  assert.equal(circ.calls, 0);
  assert.equal(storage.data[STATE_KEY], undefined);
});
await ta('켜져 있고 오늘 처음이면 돈다. 결과와 날짜를 적고 활동 기록에 남긴다', async () => {
  const storage = fakeStorage({ [ENABLE_KEY]: true });
  const circ = fakeCirculate();
  const r = await daily(storage, circ);
  assert.equal(circ.calls, 1);
  assert.equal(r.result.opened, 3);
  const st = storage.data[STATE_KEY];
  assert.equal(st.state, 'done');
  assert.equal(st.date, TODAY);
  assert.equal(st.at, NOW);
  assert.match(st.text, /3건을 모두 열어/);
  const log = logged(storage);
  assert.equal(log.length, 1);
  assert.equal(log[0].ok, true);
  assert.equal(log[0].data.opened, 3);
});
await ta('오늘 끝냈으면 다시 돌지 않는다', async () => {
  const storage = fakeStorage({ [ENABLE_KEY]: true });
  const circ = fakeCirculate();
  await daily(storage, circ);
  assert.deepEqual(await daily(storage, circ), { skipped: 'done' });
  assert.equal(circ.calls, 1);
});
await ta('방금 켠 것이면(force) 오늘 끝냈어도 한 번 더 돈다', async () => {
  const storage = fakeStorage({ [ENABLE_KEY]: true });
  const circ = fakeCirculate();
  await daily(storage, circ);
  await daily(storage, circ, { force: true });
  assert.equal(circ.calls, 2);
});
await ta('날이 바뀌면 다시 돈다', async () => {
  const storage = fakeStorage({ [ENABLE_KEY]: true });
  const circ = fakeCirculate();
  await daily(storage, circ);
  await daily(storage, circ, { today: () => '2026-10-02' });
  assert.equal(circ.calls, 2);
  assert.equal(storage.data[STATE_KEY].date, '2026-10-02');
});
await ta('다른 탭이 지금 돌고 있으면 겹쳐 돌지 않는다 (force 여도)', async () => {
  const storage = fakeStorage({ [ENABLE_KEY]: true, [STATE_KEY]: { date: TODAY, state: 'running', at: NOW - 1000 } });
  const circ = fakeCirculate();
  assert.deepEqual(await daily(storage, circ, { force: true }), { skipped: 'running' });
  assert.equal(circ.calls, 0);
});
await ta('돌던 탭이 닫혀 표식이 묵었으면 이어받는다', async () => {
  const storage = fakeStorage({ [ENABLE_KEY]: true, [STATE_KEY]: { date: TODAY, state: 'running', at: NOW - STALE_MS - 1 } });
  const circ = fakeCirculate();
  await daily(storage, circ);
  assert.equal(circ.calls, 1);
});
await ta('도는 동안 "도는 중"을 적어 두고, 진행은 간격을 두고 적는다', async () => {
  const storage = fakeStorage({ [ENABLE_KEY]: true });
  let clock = NOW;
  let during = null;
  const circ = async ({ onProgress }) => {
    during = structuredClone(storage.data[STATE_KEY]);
    onProgress(1, 3);                       // 간격 전 — 적지 않는다
    assert.equal(storage.data[STATE_KEY].done, undefined);
    clock += HEARTBEAT_MS;
    onProgress(2, 3);
    await tick(5);
    assert.deepEqual(storage.data[STATE_KEY], { date: TODAY, state: 'running', at: clock, done: 2, total: 3 });
    return RESULT;
  };
  await runDaily({ storage, circulate: circ, now: () => clock, today: () => TODAY });
  assert.deepEqual(during, { date: TODAY, state: 'running', at: NOW });
  assert.equal(storage.data[STATE_KEY].state, 'done');
});
await ta('로그인이 풀려 목록을 못 읽으면 끝냈다고 적지 않고, 다음에 다시 시도한다', async () => {
  const storage = fakeStorage({ [ENABLE_KEY]: true });
  const bad = fakeCirculate(new AuthError('로그인이 필요합니다.'));
  const r = await daily(storage, bad);
  assert.ok(r.error instanceof AuthError);
  assert.equal(storage.data[STATE_KEY].state, 'failed');
  assert.equal(logged(storage)[0].ok, false);
  assert.match(logged(storage)[0].text, /열람 실패: 로그인이 필요/);

  const good = fakeCirculate();
  await daily(storage, good);
  assert.equal(good.calls, 1, '실패한 날을 끝낸 날로 쳤다');
  assert.equal(storage.data[STATE_KEY].state, 'done');
});
await ta('못 연 건이 있으면 실패로 남기고 어느 문서인지 적는다', async () => {
  const storage = fakeStorage({ [ENABLE_KEY]: true });
  const failed = [{ rcvNo: 'HER-121-2026', title: 't', reason: 'HTTP 500' }];
  await daily(storage, fakeCirculate({ ...RESULT, opened: 2, failed, remaining: 1 }));
  const [entry] = logged(storage);
  assert.equal(entry.ok, false);
  assert.deepEqual(entry.data.failed, failed);
  assert.equal(storage.data[STATE_KEY].ok, false);
});
await ta('열 것이 없는 날이 이어지면 같은 줄을 쌓지 않는다', async () => {
  const storage = fakeStorage({ [ENABLE_KEY]: true });
  const none = fakeCirculate({ total: 0, declared: 0, opened: 0, failed: [], unconfirmed: [], remaining: 0, aborted: false });
  await daily(storage, none);
  await daily(storage, none, { today: () => '2026-10-02' });
  assert.equal(none.calls, 2);
  assert.equal(logged(storage).length, 1);
  assert.equal(logged(storage)[0].repeat, undefined);
});
await ta('도중에 껐으면 끝냈다고 적지 않는다 — 다시 켜면 이어서 한다', async () => {
  const storage = fakeStorage({ [ENABLE_KEY]: true });
  await daily(storage, fakeCirculate({ ...RESULT, opened: 1, remaining: 2, aborted: true }));
  assert.equal(storage.data[STATE_KEY].state, 'stopped');
  const again = fakeCirculate();
  await daily(storage, again);
  assert.equal(again.calls, 1);
});
await ta('기록을 못 남겨도 열람은 끝까지 한다', async () => {
  const storage = fakeStorage({ [ENABLE_KEY]: true });
  const r = await daily(storage, fakeCirculate(), { log: () => { throw new Error('quota'); } });
  assert.equal(r.result.opened, 3);
  assert.equal(storage.data[STATE_KEY].state, 'done');
});

/* ------------------------------------------------------------ 상태 줄 */

console.log('패널의 상태 줄');
t('한 번도 돌지 않았으면 빈 글', () => {
  assert.equal(stateText(undefined), '');
  assert.equal(stateText({}), '');
});
t('끝난 것은 언제 한 것인지와 함께', () =>
  assert.equal(stateText({ state: 'done', at: NOW, text: '미회람 문서 3건을 모두 열어 회람 처리했습니다' }, NOW),
    '2026-10-01 09:00:00 · 미회람 문서 3건을 모두 열어 회람 처리했습니다'));
t('도는 중이면 진행 건수', () => {
  assert.equal(stateText({ state: 'running', at: NOW, done: 37, total: 424 }, NOW + 1000), '열람 중 37/424...');
  assert.equal(stateText({ state: 'running', at: NOW }, NOW), '열람 중...');
});
t('도는 중 표식이 묵었으면 끊긴 것이라고 말한다', () =>
  assert.match(stateText({ state: 'running', at: NOW, done: 37, total: 424 }, NOW + STALE_MS), /도중에 끊겼습니다/));
t('실패는 이유와 함께', () =>
  assert.match(stateText({ state: 'failed', at: NOW, error: '로그인이 필요합니다.' }, NOW), /실패: 로그인이 필요/));

/* ------------------------------------------------------------ 설정 따르기 */

console.log('설정 따르기');
const start = (storage, circulate) => startCirculate({
  storage, onChanged: storage.onChanged, circulate, now: () => NOW, today: () => TODAY,
});
await ta('꺼져 있으면 홈을 열어도 돌지 않는다', async () => {
  const storage = fakeStorage();
  const circ = fakeCirculate();
  const ctl = start(storage, circ);
  assert.deepEqual(await ctl.ready, { skipped: 'off' });
  assert.equal(circ.calls, 0);
  ctl.stop();
});
await ta('켜져 있으면 홈을 열 때 돈다', async () => {
  const storage = fakeStorage({ [ENABLE_KEY]: true });
  const circ = fakeCirculate();
  const ctl = start(storage, circ);
  await ctl.ready;
  assert.equal(circ.calls, 1);
  ctl.stop();
});
await ta('패널에서 켜면 새로고침 없이 곧바로 돈다 — 오늘 이미 한 날이어도', async () => {
  const storage = fakeStorage({ [STATE_KEY]: { date: TODAY, state: 'done', at: NOW - 1000, text: '' } });
  const circ = fakeCirculate();
  const ctl = start(storage, circ);
  await ctl.ready;
  await storage.set({ [ENABLE_KEY]: true });
  await tick();
  assert.equal(circ.calls, 1);
  ctl.stop();
});
await ta('도는 중에 끄면 멈춤 신호가 간다', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const storage = fakeStorage({ [ENABLE_KEY]: true });
  const circ = fakeCirculate(RESULT, { gate });
  const ctl = start(storage, circ);
  await tick();
  assert.equal(circ.signal.aborted, false);
  await storage.set({ [ENABLE_KEY]: false });
  assert.equal(circ.signal.aborted, true);
  release();
  await ctl.ready;
  assert.equal(storage.data[STATE_KEY].state, 'stopped');
  ctl.stop();
});
await ta('도는 중에 켜기를 또 받아도 겹쳐 돌지 않는다', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const storage = fakeStorage({ [ENABLE_KEY]: true });
  const circ = fakeCirculate(RESULT, { gate });
  const ctl = start(storage, circ);
  await tick();
  await storage.set({ [ENABLE_KEY]: true });
  await tick();
  release();
  await ctl.ready;
  assert.equal(circ.calls, 1);
  ctl.stop();
});
await ta('다른 설정이 바뀐 것에는 움직이지 않는다', async () => {
  const storage = fakeStorage();
  const circ = fakeCirculate();
  const ctl = start(storage, circ);
  await ctl.ready;
  await storage.set({ myName: '홍길동', homeCard: false });
  await tick();
  assert.equal(circ.calls, 0);
  ctl.stop();
});
await ta('stop 하면 설정 변화를 더 듣지 않는다', async () => {
  const storage = fakeStorage();
  const circ = fakeCirculate();
  const ctl = start(storage, circ);
  await ctl.ready;
  assert.equal(storage.listenerCount(), 1);
  ctl.stop();
  assert.equal(storage.listenerCount(), 0);
  await storage.set({ [ENABLE_KEY]: true });
  await tick();
  assert.equal(circ.calls, 0);
});

/* ------------------------------------------------------------ 배선 */

console.log('확장 배선');
{
  const root = new URL('../', import.meta.url);
  const boot = fs.readFileSync(new URL('home.js', root), 'utf8');
  const panel = new JSDOM(fs.readFileSync(new URL('sidepanel.html', root), 'utf8')).window.document;
  t('홈의 시동 스크립트가 src/circulate.js 를 불러 startCirculate 를 부른다', () => {
    assert.match(boot, /getURL\('src\/circulate\.js'\)/);
    assert.match(boot, /startCirculate\(\)/);
  });
  t('주소는 사이트의 것 그대로', () => {
    assert.equal(NONCIR_LIST_URL, 'https://eclass.krs.co.kr/intra/intranet/VSDotNet/DORSY/Circulation/Not_Circulation_List.aspx');
    assert.equal(CIRC_VIEW_URL, 'https://eclass.krs.co.kr/DOCCruiser/Popup/RfCirculation_View.aspx');
  });
  t('패널의 체크박스는 꺼진 채로 들어 있다', () => {
    const box = panel.getElementById('docCirculate');
    assert.ok(box, '체크박스가 없다');
    assert.equal(box.hasAttribute('checked'), false, '기본이 켜져 있다');
    assert.match(box.closest('details.diag')?.querySelector('summary')?.textContent || '', /설정 및 연결/);
  });
  // 설명 문단은 두지 않는다. 그래도 되돌릴 수 없다는 말은 그 줄의 툴팁에 남긴다.
  t('되돌릴 수 없다는 것을 그 줄의 툴팁에 적어 둔다', () =>
    assert.match(panel.getElementById('docCirculate').closest('label').title, /되돌릴 수 없/));
  t('활동 기록에 이름이 있다', () => assert.equal(KIND_LABEL.circulate, '회람'));
}

console.log(`\n통과 ${pass}건`);
