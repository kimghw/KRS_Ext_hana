// R&D 과제 정보를 원노트에 두고 다른 기기와 맞추는 선택 기능 — src/rndnote.js. 맞추기 규칙(나중에 고친 쪽 · 처음엔 원노트 쪽 · 묘비 ·
// 따로 만든 같은 과제 묶기 · 열 개 한도), 원노트 표 블록 쓰기·찾기·읽기, OneNote MCP 서버와의 왕복(흉내 fetch).
// 어디에도 보내지 않는다. 화면 쪽(켜기·섹션 고르기·고친 뒤 저절로 맞추기)은 test/rndpanel.test.mjs 의 "원노트 공유" 가 본다.
import assert from 'node:assert/strict';

import { normalizeProject } from '../src/rnd.js';
import {
  NOTE_KEY, ONENOTE_MCP_URL, PAGE_TITLE, BLOCK_ID, INFO_KEYS, normalizeNote, infoOf, infoHash, bookHash, syncInfo,
  blockHtml, findBlock, readBlock, openNote, listSections, findPage, createPage, readPage, writeBlock,
} from '../src/rndnote.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const P = (o) => normalizeProject({ start: '2026-04-01', end: '2029-12-31', ...o });
const DAY = 864e5;

console.log('모양');
t('저장해 두는 형편 — 꺼짐이 기본, 모르는 것은 버린다', () => {
  assert.equal(NOTE_KEY, 'rndNote');
  assert.equal(ONENOTE_MCP_URL, 'http://localhost:5005/mcp');
  assert.deepEqual(normalizeNote(null), { on: false, sectionId: '', sectionLabel: '', pageId: '', webUrl: '', at: 0, memo: {}, del: {}, last: '', error: '' });
  assert.equal(normalizeNote({ on: 'yes' }).on, false);
  assert.deepEqual(normalizeNote({ memo: [1], del: 'x' }).memo, {});
});
t('과제 정보는 여덟 칸뿐 — 차년도 내용은 올라가지 않는다', () => {
  assert.deepEqual(INFO_KEYS, ['name', 'alias', 'code', 'lead', 'start', 'end', 'calendar', 'note']);
  const p = P({ id: 'a', name: 'A', alias: 'AA', years: { 1: { logs: [{ title: 'x' }] } } });
  assert.deepEqual(Object.keys(infoOf(p)), ['id', ...INFO_KEYS]);
  assert.notEqual(infoHash(p), infoHash({ ...p, alias: 'AB' }));
  assert.equal(infoHash(p), infoHash({ ...p, years: {} }), '지문에 차년도 내용은 없다');
  assert.notEqual(bookHash({ projects: [p] }), bookHash({ projects: [{ ...p, id: 'b' }] }));
});

console.log('맞추기');
t('처음 — 원노트가 비었으면 이 기기의 과제를 모두 올린다', () => {
  const r = syncInfo([P({ id: 'a', name: 'A', alias: 'AA' })], { projects: [], del: {} }, { now: 1000 });
  assert.deepEqual([r.added, r.updated, r.removed, r.renames], [[], [], [], []]);
  assert.equal(r.push, true);
  assert.deepEqual(r.page.projects.map((p) => [p.id, p.alias, p.ts]), [['a', 'AA', 1000]]);
  assert.deepEqual(r.memo, { a: { h: infoHash(r.page.projects[0]), ts: 1000 } });
});
t('새 기기 — 비어 있으면 원노트의 과제를 받는다 · 처음 맞추는 같은 과제는 원노트 쪽이 기준', () => {
  const remote = { projects: [{ ...infoOf(P({ id: 'a', name: 'A', alias: '새 별칭' })), ts: 500 }], del: {} };
  const empty = syncInfo([], remote, { now: 1000 });
  assert.deepEqual(empty.added, ['a']);
  assert.equal(empty.push, false, '원노트는 그대로');
  const stale = syncInfo([P({ id: 'a', name: 'A', alias: '옛 별칭' })], remote, { now: 1000 });
  assert.deepEqual(stale.updated, ['a']);
  assert.equal(stale.projects[0].alias, '새 별칭');
});
t('다른 기기에서 따로 만든 같은 과제(과제번호, 없으면 과제명)는 원노트 id 로 묶는다', () => {
  const remote = { projects: [{ ...infoOf(P({ id: 'r1', name: 'MVDC 차단기', code: 'RND-20', alias: 'SSCB' })), ts: 500 }, { ...infoOf(P({ id: 'r2', name: '수소 추진' })), ts: 500 }], del: {} };
  const r = syncInfo([P({ id: 'l1', name: '다른 이름', code: 'rnd-20' }), P({ id: 'l2', name: '수소  추진' }), P({ id: 'l3', name: '새 과제' })], remote, { now: 1000 });
  assert.deepEqual(r.renames, [['l1', 'r1'], ['l2', 'r2']]);
  assert.deepEqual(r.projects.map((p) => p.id), ['r1', 'r2', 'l3']);
  assert.equal(r.projects[0].alias, 'SSCB', '원노트 쪽이 기준');
  assert.deepEqual(r.updated, ['r1', 'r2'], '이름이 달랐던 것도 원노트 것으로');
  assert.equal(r.push, true, '새 과제(l3)를 올린다');
});
t('그 뒤 — 이 기기에서 고친 것은 지금 시각, 그대로인 것은 지난 시각. 나중에 고친 쪽이 이긴다', () => {
  const a = P({ id: 'a', name: 'A', alias: 'AA' });
  const b = P({ id: 'b', name: 'B', alias: 'BB' });
  const first = syncInfo([a, b], { projects: [], del: {} }, { now: 1000 });
  const page = first.page;
  // 다른 기기가 2000 에 b 의 별칭을 고쳤다. 이 기기는 3000 에 a 의 책임자를 고쳤다.
  const remote = { projects: page.projects.map((p) => (p.id === 'b' ? { ...p, alias: 'B2', ts: 2000 } : p)), del: {} };
  const r = syncInfo([{ ...a, lead: '홍길동' }, b], remote, { memo: first.memo, now: 3000 });
  assert.deepEqual(r.updated, ['b']);
  assert.deepEqual(r.projects.map((p) => [p.id, p.alias, p.lead, p.ts]), [['a', 'AA', '홍길동', 3000], ['b', 'B2', '', 2000]]);
  assert.equal(r.push, true);
  // 같은 과제를 양쪽에서 고쳤으면 늦은 쪽
  const both = syncInfo([{ ...a, alias: '이 기기' }, b], { projects: page.projects.map((p) => (p.id === 'a' ? { ...p, alias: '저 기기', ts: 5000 } : p)), del: {} }, { memo: first.memo, now: 4000 });
  assert.equal(both.projects[0].alias, '저 기기');
  // 아무것도 안 고쳤으면 쓸 것도 없다
  const same = syncInfo([a, b], page, { memo: first.memo, now: 9000 });
  assert.deepEqual([same.updated, same.added, same.removed, same.push], [[], [], [], false]);
});
t('지운 과제는 묘비로 퍼진다 — 묘비보다 늦게 고친 과제는 살아남고, 90일 지난 묘비는 버린다', () => {
  const a = P({ id: 'a', name: 'A' });
  const b = P({ id: 'b', name: 'B' });
  const first = syncInfo([a, b], { projects: [], del: {} }, { now: 1000 });
  // 이 기기에서 b 를 지웠다 → 원노트에 묘비
  const gone = syncInfo([a], first.page, { memo: first.memo, now: 2000 });
  assert.deepEqual(gone.page.projects.map((p) => p.id), ['a']);
  assert.deepEqual(gone.page.del, { b: 2000 });
  assert.equal(gone.push, true);
  // 다른 기기(아직 b 가 있고 그대로)는 받으면 지운다
  const other = syncInfo([a, b], gone.page, { memo: first.memo, now: 3000 });
  assert.deepEqual(other.removed, ['b']);
  // 묘비보다 늦게 고친 기기에서는 살아남는다
  const edited = syncInfo([a, { ...b, alias: '살림' }], gone.page, { memo: first.memo, now: 3000 });
  assert.deepEqual(edited.removed, []);
  assert.deepEqual(edited.del, {});
  // 오래된 묘비는 버린다
  const old = syncInfo([a], { projects: gone.page.projects, del: { b: 2000 } }, { memo: gone.memo, now: 2000 + 91 * DAY });
  assert.deepEqual(old.del, {});
});
t('과제가 열 개 차면 원노트의 것을 다 들이지 못한다 — 못 들인 것은 원노트에 두고 지운 것으로 치지 않는다', () => {
  const local = Array.from({ length: 9 }, (_, i) => P({ id: `l${i}`, name: `L${i}` }));
  const remote = { projects: [1, 2, 3].map((i) => ({ ...infoOf(P({ id: `r${i}`, name: `R${i}` })), ts: 500 })), del: {} };
  const r = syncInfo(local, remote, { now: 1000 });
  assert.deepEqual(r.added, ['r1']);
  assert.equal(r.page.projects.length, 12, '원노트에는 모두 남는다');
  assert.ok(!('r2' in r.memo) && !('r3' in r.memo));
  const again = syncInfo([...local, P({ id: 'r1', name: 'R1' })], r.page, { memo: r.memo, del: r.del, now: 2000 });
  assert.deepEqual(again.del, {}, '못 들인 r2·r3 에 묘비가 서지 않는다');
});

console.log('원노트 표 블록');
t('쓰고 찾고 읽으면 그대로 — 표는 보기용(별칭·과제명·…), 기준은 맨 아래 칸의 base64 JSON', () => {
  const page = syncInfo([P({ id: 'a', name: 'MVDC <차단기> & 시험', alias: 'SSCB', code: 'RS-1', lead: '홍길동', note: '산업부 "주관"', calendar: true })], { projects: [], del: {} }, { now: 1000 }).page;
  page.del = { z: 900 };
  const html = blockHtml(page, Date.UTC(2026, 9, 8, 3, 5));
  assert.match(html, new RegExp(`^<table data-id="${BLOCK_ID}" border="1">`));
  assert.match(html, /<td>SSCB<\/td><td>MVDC &lt;차단기&gt; &amp; 시험<\/td><td>RS-1<\/td><td>홍길동<\/td><td>2026\.04\.01 ~ 2029\.12\.31<\/td><td>산업부 &quot;주관&quot;<\/td>/);
  // Graph 는 속성 차례를 바꾸고 생성 id 를 붙이며, 긴 글을 span 으로 감싸거나 줄을 나눈다
  const graph = `<html><head><title>${PAGE_TITLE}</title></head><body><p>위</p>${html.replace('<table data-id', '<table id="table:{1a2b}{3}" data-id').replace(/krsrnd1:(\w{10})/, 'krsrnd1:<span>$1</span>\n')}<p>아래 krsrnd1:QUFB</p></body></html>`;
  const block = findBlock(graph);
  assert.equal(block.id, 'table:{1a2b}{3}');
  const back = readBlock(block.inner);
  assert.equal(back.at, Date.UTC(2026, 9, 8, 3, 5));
  assert.deepEqual(back.del, { z: 900 });
  assert.deepEqual(back.projects, [{ ...infoOf(page.projects[0]), ts: 1000 }]);
  assert.equal(back.projects[0].name, 'MVDC <차단기> & 시험');
  assert.equal(findBlock('<table data-id="other"></table>'), null);
  assert.equal(readBlock('<td>krsrnd1:!!!</td>'), null);
  assert.equal(readBlock('<td>표만 있고 기계용 칸이 없다</td>'), null);
});

console.log('OneNote MCP 서버와의 왕복(흉내 fetch)');
/** MCP Streamable HTTP 흉내 — initialize 에 세션 id, 도구 답은 SSE 로. tools 는 { 도구이름: (args) => 답 JSON }. */
function fakeServer(tools) {
  const seen = [];
  const fetchFn = async (url, init) => {
    const msg = JSON.parse(init.body);
    seen.push({ url, method: msg.method, session: init.headers['Mcp-Session-Id'] || '', name: msg.params?.name, args: msg.params?.arguments });
    const reply = (result) => ({ ok: true, status: 200, headers: { get: (h) => (h === 'mcp-session-id' ? 's-1' : null) }, text: async () => `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n` });
    if (msg.method === 'initialize') return reply({ protocolVersion: '2025-03-26' });
    if (!('id' in msg)) return { ok: true, status: 202, headers: { get: () => null }, text: async () => '' };
    const fn = tools[msg.params.name];
    const out = fn ? fn(msg.params.arguments) : { success: false, error: `no tool ${msg.params.name}` };
    return reply({ content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }], isError: false });
  };
  return { fetchFn, seen };
}
await ta('섹션 목록 · 페이지 찾기(못 찾으면 sync_onenote_db 뒤 한 번 더) · 만들기 · 읽기 · 표 바꾸기/붙이기', async () => {
  let synced = false;
  const { fetchFn, seen } = fakeServer({
    read_onenote: (a) => {
      if (a.action === 'list_sections') return { success: true, sections: [{ id: 's2', display_name: '회의', parent_notebook_name: '나' }, { id: 's1', display_name: 'R&D', parent_notebook_name: '공유' }] };
      if (a.action === 'list_pages') return { success: true, pages: synced ? [{ page_id: 'p1', title: PAGE_TITLE, web_url: 'https://x/p1' }, { page_id: 'p0', title: '다른 페이지' }] : [] };
      if (a.action === 'get_content') return { success: true, content: `<html><body>${a.include_ids ? 'ids' : ''}</body></html>` };
      return { success: false, error: 'bad' };
    },
    sync_onenote_db: () => { synced = true; return { success: true }; },
    write_onenote: (a) => (a.action === 'create_page' ? { success: true, page: { id: 'p9', web_url: 'https://x/p9' } } : { success: true, action: a.action, target: a.target || '' }),
  });
  const nc = await openNote({ fetchFn });
  assert.equal(seen[0].url, ONENOTE_MCP_URL);
  assert.deepEqual(await listSections(nc), [{ id: 's1', label: '공유 › R&D' }, { id: 's2', label: '나 › 회의' }]);
  assert.deepEqual(await findPage(nc, 's1'), { pageId: 'p1', webUrl: 'https://x/p1' });
  assert.deepEqual(seen.filter((s) => s.name).map((s) => [s.name, s.args.action || '']), [['read_onenote', 'list_sections'], ['read_onenote', 'list_pages'], ['sync_onenote_db', ''], ['read_onenote', 'list_pages']]);
  assert.ok(seen.slice(1).every((s) => s.session === 's-1'), 'initialize 뒤로는 세션 id 를 단다');
  assert.equal(await readPage(nc, 'p1'), '<html><body>ids</body></html>', 'include_ids 로 읽는다');
  assert.deepEqual(await createPage(nc, 's1', '<table></table>'), { pageId: 'p9', webUrl: 'https://x/p9' });
  assert.deepEqual(seen.at(-1).args, { action: 'create_page', section_id: 's1', title: PAGE_TITLE, content: '<table></table>' });
  assert.equal((await writeBlock(nc, 'p1', '<table/>', { id: 'table:{a}{1}' })).target, 'table:{a}{1}', '있던 표는 생성 id 로 통째로 바꾼다');
  assert.equal((await writeBlock(nc, 'p1', '<table/>', null)).action, 'append', '없으면 붙인다');
});
await ta('도구가 실패하면 그 까닭으로, 서버가 없으면 띄우라는 말로 던진다', async () => {
  const { fetchFn } = fakeServer({ read_onenote: () => ({ success: false, error: 'Graph 401' }) });
  const nc = await openNote({ fetchFn });
  await assert.rejects(() => listSections(nc), /Graph 401/);
  await assert.rejects(() => openNote({ fetchFn: async () => { throw new TypeError('Failed to fetch'); } }), /OneNote MCP 서버\(http:\/\/localhost:5005\/mcp\)에 닿지 않습니다 — KR_MS365_mcp 의 onenote 서버를 띄우세요\. \(Failed to fetch\)/);
});

console.log(`\n${pass} passed`);
