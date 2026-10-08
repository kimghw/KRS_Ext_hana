// R&D 탭의 화면(rndpanel.js) — 과제·차년도 칩, 예산 줄(계획을 고치면 변경이력에 저절로), 연구내역·변경이력 적기·고치기·지우기(두 번),
// 과제 더하기·고치기(책임자·연구기간을 바꾸면 변경이력에 저절로)·지우기, 요약 복사·JSON 저장·불러오기, 공문 탭의 과제 가져오기, 다시 열기.
// 진짜 화면(sidepanel.html)에 붙여 눌러 본다. 어디에도 보내지 않는다 — 저장소는 흉내이고 날짜는 2026-10-08 로 못 박는다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

import { readZip } from '../src/zip.js';
import { PAGE_TITLE, blockHtml, findBlock, readBlock } from '../src/rndnote.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok) => { for (let i = 0; i < 80 && !ok(); i++) await wait(25); };

const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const { window } = new JSDOM(html, { url: 'https://example.org/' });
const doc = window.document;
for (const g of ['document', 'FileReader', 'Element', 'HTMLElement', 'File', 'Blob']) globalThis[g] = window[g];
globalThis.window = window;

// 공문 탭의 사전 설정에 과제 하나가 있다. 저장은 복사해 둔다 — 정말 저장이 됐는지 보려고.
const store = { gongmunProjects: [{ name: 'MVDC 차단기 개발', alias: '차단기 과제', code: 'RND-20-2026', lead: '박기도', period: '2026.04.01 ~ 2029.12.31', about: '', content: '', account: '' }] };
globalThis.chrome = { storage: { local: { get: async () => store, set: async (obj) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); } } } };

const { createRndPanel } = await import('../rndpanel.js');
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logs = [];
const copied = [];
const downloads = [];
const flashed = [];
// 원노트 흉내(KR_MS365_mcp 의 onenote 서버 자리) — 섹션 하나, 페이지는 글(body)로 둔다. 다른 기기가 고친 것은 body 를 직접 바꿔 흉내 낸다.
// 목록(list_pages)은 서버 PC 의 저장분이라 sync_onenote_db 뒤에야 다른 데서 만든 페이지가 보인다.
const one = { up: true, pages: [], listed: [], calls: [], n: 0 };
const fakeNote = {
  async tool(name, a) {
    one.calls.push(`${name}${a.action ? `:${a.action}` : ''}`);
    const fail = (error) => { throw new Error(error); };
    if (name === 'read_onenote' && a.action === 'list_sections') return { sections: [{ id: 's1', display_name: 'R&D', parent_notebook_name: '연구' }] };
    if (name === 'read_onenote' && a.action === 'list_pages') return { pages: one.listed.filter((p) => p.section === a.section_id).map((p) => ({ page_id: p.id, title: p.title, web_url: p.url })) };
    if (name === 'sync_onenote_db') { one.listed = [...one.pages]; return { success: true }; }
    if (name === 'write_onenote' && a.action === 'create_page') {
      const p = { id: `p${++one.n}`, section: a.section_id, title: a.title, url: `https://onenote.example/p${one.n}`, body: a.content };
      one.pages.push(p);
      one.listed.push(p);
      return { success: true, page: { id: p.id, web_url: p.url } };
    }
    const p = one.pages.find((x) => x.id === a.page_id) || fail('page not found');
    // Graph 처럼 생성 id 를 붙여 돌려주고, replace 는 그 id 로만 받는다.
    if (a.action === 'get_content') return { success: true, content: `<html><head><title>${p.title}</title></head><body>${p.body.replace('<table data-id', '<table id="table:{t1}{1}" data-id')}</body></html>` };
    if (a.action === 'replace') { if (a.target !== 'table:{t1}{1}') fail('bad target'); p.body = p.body.replace(/<table[\s\S]*<\/table>/, a.content); return { success: true }; }
    if (a.action === 'append') { p.body += a.content; return { success: true }; }
    return fail(`모르는 도구 ${name}`);
  },
};
const make = () => createRndPanel({
  openNote: async () => (one.up ? fakeNote : Promise.reject(new Error('이 PC 의 OneNote MCP 서버(http://localhost:5005/mcp)에 닿지 않습니다'))),
  $: (id) => doc.getElementById(id), escapeHtml,
  logEvent: (kind, ok, text) => logs.push({ kind, ok, text }),
  copyText: async (text) => { copied.push(text); return true; },
  flash: (btn, text) => flashed.push([btn.id, text]),
  download: async (text, name, type) => { downloads.push({ text, name, type }); },
  // 확장 안의 파일(rnd/skills.json · rnd/skills/…)은 저장소에서 읽는다.
  readAsset: async (p, as) => { const buf = fs.readFileSync(new URL(`../${p}`, import.meta.url)); return as === 'bytes' ? new Uint8Array(buf) : buf.toString('utf8'); },
  today: () => '2026-10-08',
});
let panel = make();
panel.wire();
await panel.show();

const $ = (id) => doc.getElementById(id);
const q = (sel) => doc.querySelector(sel);
const type = (node, value, ev = 'input') => { node.value = value; node.dispatchEvent(new window.Event(ev, { bubbles: true })); };
/** 다 적고 칸을 나간다(input 뒤 change). */
const commit = (node, value) => { type(node, value); node.dispatchEvent(new window.Event('change', { bubbles: true })); };
const chips = () => [...$('rdProjects').querySelectorAll('[data-proj]')].map((b) => [b.textContent, b.classList.contains('active')]);
const years = () => [...$('rdYears').querySelectorAll('[data-year]')].map((b) => `${b.textContent}${b.classList.contains('active') ? '*' : ''}`);
const rows = () => [...$('rdBudget').querySelectorAll('.rd-brow')].map((r) => [r.querySelector('[data-k="item"]').value, r.querySelector('[data-k="plan"]').value, r.querySelector('[data-k="used"]').value, r.querySelector('[data-left]').textContent]);
const row = (item) => [...$('rdBudget').querySelectorAll('.rd-brow')].find((r) => r.querySelector('[data-k="item"]').value === item);
const sum = () => [...$('rdBudgetSum').children].map((s) => s.textContent);
// 연구내역의 줄들만(:scope > li) — 계획서에서 온 줄 안에는 목록(li)이 더 있다.
const logItems = () => [...$('rdLogs').querySelectorAll(':scope > li')].map((li) => [li.querySelector('.rd-date').textContent, li.querySelector('.rd-title').textContent, li.querySelector('.rd-text')?.textContent || '']);
/** 계획서에서 온 줄의 꼴 — 참여연구자 표의 줄들, 계획의 절 제목들. */
const rosterTable = (li) => [...li.querySelectorAll('.rd-table tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent));
const sectionHeads = (li) => [...li.querySelectorAll('.rd-sec h4')].map((h) => h.textContent);
const chItems = () => [...$('rdChanges').querySelectorAll('li')].map((li) => [
  li.querySelector('.rd-date').textContent, li.querySelector('.rd-kind').textContent, li.querySelector('.rd-title').textContent,
  li.querySelector('.rd-diff')?.textContent || '', li.querySelector('.rd-reason')?.textContent || '', li.classList.contains('auto'),
]);
const status = () => $('rdStatus').textContent;
const hidden = (id) => $(id).classList.contains('hidden');
/** 머리의 접힌 과제 정보 — "과제번호 RND-20-2026 · 책임자 박기도 · …" 처럼 이어서. */
const metaText = () => [...$('rdMeta').querySelectorAll('div')].map((d) => `${d.querySelector('dt').textContent} ${d.querySelector('dd').textContent}`).join(' · ');
/** 복사 아이콘을 누른 뒤 — 체크로 바뀌었는가. */
const copiedIcon = (id) => $(id).classList.contains('done') && !!$(id).querySelector('svg');

console.log('처음 열기 — 공문 탭의 과제를 가져온다');
t('과제 칩 하나(별칭)가 켜져 있고 머리는 별칭 한 줄 — 과제명·번호·책임자·연구기간(총 4차년도)은 접힌 과제 정보 안에', () => {
  assert.deepEqual(chips(), [['차단기 과제', true]]);
  assert.ok(hidden('rdEmpty'));
  assert.ok(!hidden('rdHead'));
  assert.ok(!hidden('rdBody'));
  assert.ok(hidden('rdForm'));
  assert.equal($('rdName').textContent, '차단기 과제');
  assert.equal($('rdName').title, 'MVDC 차단기 개발');
  assert.ok(!$('rdInfo').open, '과제 정보는 처음엔 접혀 있다');
  assert.ok($('rdInfo').contains($('rdEdit')), '과제 고치기도 접힌 칸 안에');
  assert.ok(hidden('rdAliasAsk'), '별칭이 있으면 정하는 칸은 없다');
  assert.match(metaText(), /MVDC 차단기 개발.*과제번호 RND-20-2026.*책임자 박기도.*연구기간 2026\.04\.01 ~ 2029\.12\.31 \(총 4차년도\)/);
  assert.match(status(), /공문 탭의 과제 1개를 가져왔습니다/);
  assert.ok(logs.some((l) => l.kind === 'rnd' && /처음 열 때/.test(l.text)));
});
t('차년도 칩은 넷, 오늘(2026-10-08)이 든 1차년도가 켜져 있고 "올해" 표시', () => {
  assert.deepEqual(years(), ['1차년도올해*', '2차년도', '3차년도', '4차년도']);
  assert.equal(q('#rdYears .rd-year.now').dataset.year, '1');
  assert.equal(q('#rdYears [data-year="2"]').title, '2027.04.01 ~ 2028.03.31');
  assert.equal($('rdYearNote').textContent, '1차년도 · 2026.04.01 ~ 2027.03.31 · 진행 중');
});
t('기본 비목 여섯 줄, 아직 적은 것 없음 · 계획서가 없으면 참여연구자·연구개발 계획은 넣는 곳을 짚는다 · 변경이력 구분 다섯', () => {
  assert.deepEqual(rows().map((r) => r[0]), ['인건비', '연구시설·장비비', '연구재료비', '연구활동비', '연구수당', '간접비']);
  assert.equal($('rdBudgetState').textContent, '적은 것 없음');
  assert.deepEqual([$('rdRosterState').textContent, $('rdPlanState').textContent], ['계획서 없음', '계획서 없음']);
  assert.match($('rdRoster').textContent, /맨 아래 칸에 연구개발계획서 YAML/);
  assert.ok(hidden('rdRosterTools') && hidden('rdPlanTools'), '복사할 것이 없으면 복사 아이콘도 없다');
  assert.ok(!$('rdRosterBox').open && !$('rdPlanBox').open && !$('rdLogBox').open, '참여연구자·연구개발 계획·진행 기록은 접혀 있다');
  assert.deepEqual([...$('rdBody').querySelectorAll(':scope > details > summary > span:first-of-type')].map((s) => s.textContent), ['예산', '참여연구자', '연구개발 계획', '진행 기록', '변경이력']);
  assert.ok(!$('rnd').textContent.includes('연구내역'), '"연구내역" 이라는 말은 화면에 없다');
  assert.equal($('rnd').lastElementChild.id, 'rdSkillBox');
  assert.equal($('rdSkillBox').previousElementSibling.id, 'rdIntake', '연구개발계획서 넣기는 맨 아래(스킬 칸 바로 위)');
  assert.equal($('rdLogState').textContent, '적은 것 없음');
  assert.equal($('rdChangeState').textContent, '적은 것 없음');
  assert.deepEqual([...$('rdChKind').options].map((o) => o.value), ['예산', '연구내용', '연구기간', '연구진', '기타']);
  assert.equal($('rdLogDate').value, '2026-10-08');
});
await ta('저장소(rndBook)에 남는다', async () => {
  await wait(500);
  assert.equal(store.rndBook.projects.length, 1);
  assert.deepEqual([store.rndBook.projects[0].alias, store.rndBook.projects[0].start, store.rndBook.projects[0].end], ['차단기 과제', '2026-04-01', '2029-12-31']);
});

console.log('예산');
t('계획을 1,000만처럼 적으면 원으로 읽어 쉼표로 보이고, 처음 적는 것은 변경이 아니다', () => {
  commit(row('인건비').querySelector('[data-k="plan"]'), '1,000만');
  assert.equal(row('인건비').querySelector('[data-k="plan"]').value, '10,000,000');
  assert.equal(row('인건비').querySelector('[data-left]').textContent, '10,000,000');
  assert.deepEqual(sum(), ['합계', '10,000,000', '0', '10,000,000', '']);
  assert.equal($('rdBudgetState').textContent, '계획 1,000만 · 집행 0원 (0%)');
  assert.equal(chItems().length, 0);
});
t('집행을 적으면 잔액·집행률 — 막대 80%. 집행은 변경이 아니다', () => {
  commit(row('인건비').querySelector('[data-k="used"]'), '8000000');
  assert.equal(row('인건비').querySelector('[data-left]').textContent, '2,000,000');
  assert.equal(row('인건비').querySelector('.rd-bar').style.width, '80%');
  assert.equal($('rdBudgetState').textContent, '계획 1,000만 · 집행 800만 (80%)');
  assert.equal(chItems().length, 0);
});
t('계획을 고치면 변경이력에 저절로 남고 사유를 묻는다', () => {
  commit(row('인건비').querySelector('[data-k="plan"]'), '1,500만');
  assert.deepEqual(chItems(), [['2026.10.08', '예산', '인건비', '10,000,000원→15,000,000원', '', true]]);
  assert.equal($('rdChangeState').textContent, '1건 · 사유 없음 1');
  assert.match(status(), /변경이력에 1건을 남겼습니다/);
  assert.ok($('rdChanges').querySelector('[data-reason]'), '줄 안에 사유 칸');
  assert.deepEqual(sum(), ['합계', '15,000,000', '8,000,000', '7,000,000', '']);
});
t('줄 안의 사유 칸에 적으면 붙는다', () => {
  commit($('rdChanges').querySelector('[data-reason]'), '연구원 1명 충원');
  assert.equal(chItems()[0][4], '연구원 1명 충원');
  assert.equal($('rdChangeState').textContent, '1건');
  assert.ok(!$('rdChanges').querySelector('[data-reason]'));
});
t('못 읽는 금액은 되돌리고 말한다', () => {
  commit(row('인건비').querySelector('[data-k="plan"]'), 'abc');
  assert.equal(row('인건비').querySelector('[data-k="plan"]').value, '15,000,000');
  assert.match(status(), /금액을 읽지 못했습니다/);
  assert.equal(chItems().length, 1);
});
t('집행이 계획을 넘으면 잔액이 빨갛고 막대도 넘침', () => {
  commit(row('인건비').querySelector('[data-k="used"]'), '2천만');
  assert.equal(row('인건비').querySelector('[data-left]').textContent, '-5,000,000');
  assert.ok(row('인건비').querySelector('[data-left]').classList.contains('over'));
  assert.ok(row('인건비').querySelector('.rd-bar').classList.contains('over'));
  assert.equal(row('인건비').querySelector('.rd-bar').style.width, '100%');
  commit(row('인건비').querySelector('[data-k="used"]'), '8,000,000');
  assert.ok(!row('인건비').querySelector('[data-left]').classList.contains('over'));
});
t('비목 더하기 → 이름 적기. 빈 줄은 바로 빼고 금액 있는 줄은 두 번 — 뺀 비목도 변경이력에', () => {
  $('rdBudgetAdd').click();
  assert.equal(rows().length, 7);
  type(q('#rdBudget .rd-brow:last-child [data-k="item"]'), '위탁연구개발비');
  commit(q('#rdBudget .rd-brow:last-child [data-k="plan"]'), '300만');
  assert.equal(chItems().length, 1, '처음 적는 계획은 변경이 아니다');
  $('rdBudgetAdd').click();
  assert.equal(rows().length, 8);
  q('#rdBudget .rd-brow:last-child [data-del]').click();
  assert.equal(rows().length, 7, '빈 줄은 바로');
  const del = row('위탁연구개발비').querySelector('[data-del]');
  del.click();
  assert.equal(rows().length, 7, '한 번으로는 안 뺀다');
  assert.equal(del.textContent, '정말');
  del.click();
  assert.equal(rows().length, 6);
  assert.deepEqual(chItems()[0].slice(1, 4), ['예산', '위탁연구개발비', '3,000,000원→(비목 뺌)']);
  assert.equal($('rdChangeState').textContent, '2건 · 사유 없음 1');
});

console.log('진행 기록(손으로 적는 것)');
t('제목을 적고 기록 — 늦은 것부터, 내용은 여러 줄, 칸은 비운다', () => {
  type($('rdLogTitle'), '차단기 시제품 1차 시험');
  type($('rdLogText'), '10kV 인가\n차단 성공');
  $('rdLogAdd').click();
  type($('rdLogDate'), '2026-06-15');
  type($('rdLogTitle'), '설계 검토회');
  $('rdLogAdd').click();
  assert.deepEqual(logItems(), [['2026.10.08', '차단기 시제품 1차 시험', '10kV 인가\n차단 성공'], ['2026.06.15', '설계 검토회', '']]);
  assert.equal($('rdLogState').textContent, '2건');
  assert.equal($('rdLogTitle').value, '');
  assert.equal($('rdLogDate').value, '2026-10-08');
});
t('빈 채로 기록은 안 된다 · Enter 로도 기록', () => {
  $('rdLogAdd').click();
  assert.equal(logItems().length, 2);
  assert.match(status(), /제목이나 내용을 적으세요/);
  type($('rdLogTitle'), 'Enter 로 적음');
  $('rdLogTitle').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(logItems().length, 3);
  const del = q('#rdLogs li [data-del]');
  del.click();
  del.click();
  assert.equal(logItems().length, 2);
});
t('고치기 → 칸에 올라오고 저장하면 바뀐다 · 그만두기', () => {
  q('#rdLogs li:nth-child(2) [data-edit]').click();
  assert.equal($('rdLogTitle').value, '설계 검토회');
  assert.equal($('rdLogDate').value, '2026-06-15');
  assert.equal($('rdLogAdd').textContent, '저장');
  assert.ok(!hidden('rdLogCancel'));
  assert.ok(q('#rdLogs li:nth-child(2)').classList.contains('editing'));
  type($('rdLogTitle'), '설계 검토회(2차)');
  $('rdLogAdd').click();
  assert.equal(logItems()[1][1], '설계 검토회(2차)');
  assert.equal($('rdLogAdd').textContent, '기록');
  assert.ok(hidden('rdLogCancel'));
  q('#rdLogs li [data-edit]').click();
  $('rdLogCancel').click();
  assert.equal($('rdLogTitle').value, '');
  assert.ok(!q('#rdLogs li.editing'));
});
t('지우기는 두 번', () => {
  const del = q('#rdLogs li:nth-child(2) [data-del]');
  del.click();
  assert.equal(logItems().length, 2);
  assert.equal(del.textContent, '정말 지우기');
  del.click();
  assert.equal(logItems().length, 1);
  assert.match(status(), /진행 기록을 지웠습니다/);
});

console.log('변경이력 — 손으로');
t('구분·항목·전후·사유를 적고 기록하면 날짜 차례에 들어가고 칸은 비운다', () => {
  type($('rdChDate'), '2026-09-20');
  $('rdChKind').value = '연구내용';
  type($('rdChItem'), '2차년도 목표');
  type($('rdChBefore'), '10kV');
  type($('rdChAfter'), '12kV');
  type($('rdChReason'), '발주처 요청');
  $('rdChAdd').click();
  assert.deepEqual(chItems().at(-1), ['2026.09.20', '연구내용', '2차년도 목표', '10kV→12kV', '발주처 요청', false]);
  assert.equal($('rdChangeState').textContent, '3건 · 사유 없음 1');
  assert.equal($('rdChKind').value, '예산');
  assert.equal($('rdChItem').value, '');
  $('rdChAdd').click();
  assert.equal(chItems().length, 3, '빈 채로는 안 된다');
  assert.match(status(), /항목이나 변경 전·후를 적으세요/);
});
t('고치기·지우기(두 번)', () => {
  q('#rdChanges li:last-child [data-edit]').click();
  assert.equal($('rdChItem').value, '2차년도 목표');
  assert.equal($('rdChKind').value, '연구내용');
  type($('rdChAfter'), '12.5kV');
  $('rdChAdd').click();
  assert.equal(chItems().at(-1)[3], '10kV→12.5kV');
  const del = q('#rdChanges li:last-child [data-del]');
  del.click();
  assert.equal(chItems().length, 3);
  del.click();
  assert.equal(chItems().length, 2);
});

console.log('차년도 바꾸기');
t('2차년도를 누르면 그 차년도의 빈 장부, 1차년도로 돌아오면 그대로', () => {
  q('#rdYears [data-year="2"]').click();
  assert.deepEqual(years(), ['1차년도올해', '2차년도*', '3차년도', '4차년도']);
  assert.equal($('rdYearNote').textContent, '2차년도 · 2027.04.01 ~ 2028.03.31 · 예정');
  assert.equal($('rdBudgetState').textContent, '적은 것 없음');
  assert.equal(rows().length, 6);
  assert.equal(logItems().length, 0);
  assert.equal(chItems().length, 0);
  q('#rdYears [data-year="1"]').click();
  assert.equal(logItems().length, 1);
  assert.equal(chItems().length, 2);
  assert.equal(rows().find((r) => r[0] === '인건비')[1], '15,000,000');
});
await ta('보고 있던 차년도가 저장된다', async () => {
  q('#rdYears [data-year="3"]').click();
  await wait(500);
  const id = store.rndBook.projects[0].id;
  assert.equal(store.rndBook.current.year[id], 3);
  q('#rdYears [data-year="1"]').click();
});

console.log('과제 더하기·고치기·지우기');
t('＋ → 폼이 서고 머리·몸통은 숨는다. 과제명 없이는 저장 안 됨', () => {
  q('#rdProjects [data-add]').click();
  assert.ok(!hidden('rdForm'));
  assert.ok(hidden('rdHead'));
  assert.ok(hidden('rdBody'));
  assert.ok(hidden('rdFDel'));
  assert.equal($('rdFormTitle').textContent, '새 과제');
  $('rdFSave').click();
  assert.equal($('rdFNeed').textContent, '과제명을 적으세요.');
  assert.ok(!hidden('rdForm'));
});
t('별칭은 필수이고 다른 과제와 겹치면 안 된다(띄어쓰기·대소문자 무시)', () => {
  type($('rdFName'), '수소 추진');
  $('rdFSave').click();
  assert.match($('rdFNeed').textContent, /^별칭을 적으세요/);
  assert.ok(!hidden('rdForm'));
  type($('rdFAlias'), '차단기  과제');
  $('rdFSave').click();
  assert.equal($('rdFNeed').textContent, '같은 별칭의 과제가 있습니다 — MVDC 차단기 개발');
  assert.ok(!hidden('rdForm'));
});
t('종료일이 시작일보다 앞서면 안 됨', () => {
  type($('rdFAlias'), '수소');
  type($('rdFStart'), '2027-01-01');
  type($('rdFEnd'), '2026-12-31');
  $('rdFSave').click();
  assert.equal($('rdFNeed').textContent, '종료일이 시작일보다 앞섭니다.');
});
t('저장하면 칩이 둘(별칭)이고 새 과제가 켜진다 — 연구기간 없는 과제는 1차년도 하나·미정', () => {
  type($('rdFStart'), '');
  type($('rdFEnd'), '');
  $('rdFSave').click();
  assert.deepEqual(chips(), [['차단기 과제', false], ['수소', true]]);
  assert.equal(q('#rdProjects .active').title, '수소 추진', '칩의 툴팁은 과제명');
  assert.ok(hidden('rdForm'));
  assert.ok(!hidden('rdHead'));
  assert.deepEqual(years(), ['1차년도*']);
  assert.match(metaText(), /연구기간 미정/);
  assert.equal($('rdYearNote').textContent, '1차년도 · 연구기간 미정');
  assert.ok(logs.some((l) => l.kind === 'rnd' && /과제 더함: 수소 추진/.test(l.text)));
});
t('칩을 누르면 그 과제로', () => {
  q('#rdProjects [data-proj]').click();
  assert.deepEqual(chips(), [['차단기 과제', true], ['수소', false]]);
  assert.equal(chItems().length, 2);
});
t('과제 고치기 — 책임자·연구기간을 바꾸면 변경이력에 저절로 두 줄', () => {
  $('rdEdit').click();
  assert.equal($('rdFormTitle').textContent, '과제 고치기');
  assert.equal($('rdFName').value, 'MVDC 차단기 개발');
  assert.equal($('rdFLead').value, '박기도');
  assert.equal($('rdFEnd').value, '2029-12-31');
  assert.ok(!hidden('rdFDel'));
  type($('rdFLead'), '김철수');
  type($('rdFEnd'), '2030-03-31');
  $('rdFSave').click();
  assert.match(metaText(), /책임자 김철수.*2026\.04\.01 ~ 2030\.03\.31 \(총 4차년도\)/);
  assert.deepEqual(chItems().slice(0, 2).map((c) => c.slice(1, 4)), [
    ['연구기간', '연구기간', '2026.04.01 ~ 2029.12.31→2026.04.01 ~ 2030.03.31'], ['연구진', '과제책임자', '박기도→김철수'],
  ]);
  assert.equal($('rdChangeState').textContent, '4건 · 사유 없음 3');
  assert.match(status(), /변경이력에 2건을 남겼습니다/);
});
t('Enter 로 저장 · Esc 로 닫기 · 과제 지우기는 두 번', () => {
  $('rdEdit').click();
  type($('rdFNote'), '산업부');
  $('rdFNote').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.ok(hidden('rdForm'));
  assert.match(metaText(), /산업부/);
  assert.equal(chItems().length, 4, '비고는 이력이 아니다');
  doc.querySelectorAll('#rdProjects [data-proj]')[1].click();
  $('rdEdit').click();
  $('rdForm').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(hidden('rdForm'));
  $('rdEdit').click();
  $('rdFDel').click();
  assert.equal($('rdFDel').textContent, '정말 지우기');
  assert.equal(chips().length, 2);
  $('rdFDel').click();
  assert.deepEqual(chips(), [['차단기 과제', true]]);
  assert.ok(hidden('rdForm'));
  assert.match(status(), /과제를 지웠습니다 — 수소/);
});

console.log('요약 복사 · JSON 저장·불러오기 · 공문 탭의 과제 가져오기');
await ta('요약 복사 — 보고 있는 과제·차년도의 개요·예산·연구내역·변경이력', async () => {
  $('rdCopy').click();
  await wait(10);
  assert.equal(copied.length, 1);
  assert.match(copied[0], /^\[차단기 과제\] 1차년도 \(2026\.04\.01 ~ 2027\.03\.31\) — 진행 중\n/);
  assert.match(copied[0], /- 인건비: 계획 15,000,000원 · 집행 8,000,000원 · 잔액 7,000,000원 · 집행률 53%/);
  assert.match(copied[0], /- 2026\.10\.08 차단기 시제품 1차 시험\n  10kV 인가\n  차단 성공\n/);
  assert.match(copied[0], /\[연구진\] 과제책임자: 박기도 → 김철수/);
  assert.deepEqual(flashed.at(-1), ['rdCopy', '복사했습니다 ✓']);
});
await ta('JSON 저장', async () => {
  $('rdExport').click();
  await wait(10);
  assert.equal(downloads[0].name, 'R&D과제_2026-10-08.json');
  const obj = JSON.parse(downloads[0].text);
  assert.equal(obj.kind, 'rndBook');
  assert.equal(obj.projects.length, 1);
  assert.match(status(), /저장했습니다 — R&D과제_2026-10-08\.json/);
});
await ta('JSON 불러오기 — 같은 id 는 파일 것으로, 없던 과제는 더함', async () => {
  const obj = JSON.parse(downloads[0].text);
  obj.projects[0].years[1].logs.push({ id: 'from-file', date: '2026-07-07', title: '파일에서 온 기록' });
  obj.projects.push({ id: 'new-from-file', name: '파일 과제', start: '2026-01-01', end: '2026-12-31' });
  const file = new window.File([JSON.stringify(obj)], 'rnd.json', { type: 'application/json' });
  Object.defineProperty($('rdImport'), 'files', { value: [file], configurable: true });
  $('rdImport').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(60);
  assert.deepEqual(chips(), [['차단기 과제', true], ['파일 과제', false]]);
  assert.ok(logItems().some((l) => l[1] === '파일에서 온 기록'));
  assert.match(status(), /들여왔습니다 — 바꿈 1 · 더함 1 \(과제 2개\)/);
});
await ta('못 읽는 파일은 말만 하고 아무것도 바꾸지 않는다', async () => {
  const file = new window.File(['{"x":1}'], 'bad.json');
  Object.defineProperty($('rdImport'), 'files', { value: [file], configurable: true });
  $('rdImport').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(60);
  assert.match(status(), /들여오지 못했습니다 — R&D 과제 파일이 아닙니다/);
  assert.equal(chips().length, 2);
  assert.ok(logs.some((l) => l.kind === 'rnd' && !l.ok && /불러오기 실패/.test(l.text)));
});
await ta('공문 탭의 과제 가져오기 — 이미 있으면 그대로(빈 칸만 채움), 새것은 더한다, 다시 누르면 달라질 것 없음', async () => {
  store.gongmunProjects.push({ name: '수소전기추진 연구', alias: '', code: 'RND-21-2026', lead: '노길태', period: '', about: '', content: '', account: '' });
  $('rdImportGm').click();
  await wait(20);
  assert.deepEqual(chips().map((c) => c[0]), ['차단기 과제', '파일 과제', '수소전기추진 연구']);
  assert.match(status(), /공문 탭의 과제를 가져왔습니다 — 더함 1$/);
  assert.match(metaText(), /책임자 김철수/, '있는 칸은 공문 탭 것으로 덮지 않는다');
  $('rdImportGm').click();
  await wait(20);
  assert.match(status(), /이미 다 있습니다/);
  assert.equal(chips().length, 3);
});

console.log('연구개발계획서 YAML 넣기 — RND 폴더의 KR_<과제>.yaml · history/*.yaml');
const fx = (name) => fs.readFileSync(new URL(`./fixtures/rnd/${name}`, import.meta.url), 'utf8');
const dropFiles = (files, target = $('rnd')) => {
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files, types: ['Files'], dropEffect: '' } });
  target.dispatchEvent(ev);
  return ev;
};
const paste = (text, target = doc.body) => {
  const ev = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: { files: [], getData: () => text, types: ['text/plain'] } });
  target.dispatchEvent(ev);
  return ev;
};
await ta('스냅샷을 탭 어디에나 끌어다 놓으면 과제가 생기고(1월 1일 기준 차년도) 예산·계획·참여연구자가 들어간다', async () => {
  const ev = dropFiles([new window.File([fx('snapshot_r0.yaml')], 'KR_test.yaml', { type: 'application/x-yaml' })], $('rdLogs'));
  assert.ok(ev.defaultPrevented);
  await until(() => chips().length === 4);
  assert.deepEqual(chips().map((c) => c[0]), ['차단기 과제', '파일 과제', '수소전기추진 연구', '시험용 직류 차단기 개발']);
  assert.equal(chips().at(-1)[1], true, '넣은 과제가 켜진다');
  assert.deepEqual(years(), ['1차년도올해*', '2차년도', '3차년도', '4차년도']);
  assert.equal($('rdYearNote').textContent, '1차년도 · 2026.04.01 ~ 2026.12.31 · 진행 중');
  assert.match(metaText(), /과제번호 RS-2026-00000001.*책임자 홍길동.*연구기간 2026\.04\.01 ~ 2029\.12\.31 \(총 4차년도 · 1월 1일 기준\).*산업통상부/);
  assert.deepEqual(rows().map((r) => [r[0], r[1]]), [['인건비', '30,000,000'], ['연구시설·장비비', ''], ['연구재료비', ''], ['연구활동비', '50,000,000'], ['연구수당', '6,000,000'], ['간접비', '20,000,000']]);
  assert.equal($('rdBudgetState').textContent, '계획 1.1억 · 집행 0원 (0%)');
  // 계획서에서 온 두 줄은 진행 기록이 아니라 저마다의 칸에 — 참여연구자는 표로, 계획은 절 제목과 번호·점 목록으로(글은 그대로).
  assert.deepEqual(logItems(), [], '진행 기록에는 없다');
  const roster = $('rdRoster');
  const plan = $('rdPlan');
  assert.equal($('rdRosterState').textContent, '3명 · 인건비 3,000만');
  assert.equal($('rdPlanState').textContent, '목표 2개 · 9개월');
  assert.deepEqual([$('rdRosterSrc').textContent, $('rdPlanSrc').textContent], ['연구개발계획서 r0 기준', '연구개발계획서 r0 기준']);
  assert.ok(!hidden('rdRosterTools') && !hidden('rdPlanTools'));
  assert.deepEqual([...roster.querySelectorAll('.rd-table th')].map((th) => th.textContent), ['성명', '직위', '계상률', '참여', '계상인건비']);
  assert.deepEqual(rosterTable(roster), [['이몽룡', '수석', '15%', '9개월', '11,250,000원'], ['홍길동', '수석', '20%', '9개월', '15,000,000원'], ['성춘향', '책임', '10%', '9개월', '3,750,000원']]);
  assert.deepEqual(sectionHeads(plan), ['개발목표', '개발내용', '성능목표', '주요결과물', '수행일정9개월']);
  assert.deepEqual([...plan.querySelectorAll('.rd-sec:first-child ol > li')].map((n) => n.textContent), ['규정 공백 분석 및 평가 기준 도출', '용어 분류 체계 설계']);
  assert.deepEqual([...plan.querySelectorAll('.rd-sec:nth-child(2) > ul > li > ul > li')].map((n) => n.textContent), ['선급규정 및 국제표준 비교', '시험기준 도출', '핵심 개념 추출']);
  assert.equal(plan.querySelector('.rd-sec:nth-child(3) li b').textContent, '규정 공백 분석', '"항목: 값" 은 항목이 굵다');
  assert.ok(!plan.querySelector('.rd-text'), '글 그대로가 아니라 꼴을 입혔다');
  assert.equal(chItems().length, 0, '처음 넣는 것은 기준선');
  assert.match(status(), /^연구개발계획서 스냅샷\(KR_test\.yaml\): 과제 만듦: 시험용 직류 차단기 개발 · 1차년도 · 비목 4개/);
  assert.ok(logs.some((l) => l.kind === 'rnd' && /YAML 넣음 — 연구개발계획서 스냅샷/.test(l.text)));
  assert.ok(!hidden('rdAliasAsk'), '계획서로 만든 과제는 별칭이 없어 정하는 칸이 선다');
});
t('머리에서 별칭 정하기 — 겹치면 안 되고, 정하면 칩·머리가 별칭으로 바뀌고 칸은 걷힌다(Enter 로도)', () => {
  $('rdAliasSet').click();
  assert.match(status(), /별칭을 적으세요/);
  type($('rdAliasIn'), '차단기 과제');
  $('rdAliasSet').click();
  assert.equal(status(), '같은 별칭의 과제가 있습니다 — MVDC 차단기 개발');
  assert.ok(!hidden('rdAliasAsk'));
  type($('rdAliasIn'), 'TEST');
  $('rdAliasIn').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(chips().at(-1)[0], 'TEST');
  assert.equal($('rdName').textContent, 'TEST');
  assert.ok(hidden('rdAliasAsk'));
  assert.equal(status(), '별칭을 정했습니다 — TEST');
  assert.ok(logs.some((l) => l.kind === 'rnd' && /별칭: 시험용 직류 차단기 개발 → TEST/.test(l.text)));
});
await ta('과제 고치기 폼에 1월 1일 기준이 켜져 있다 — 끄면 차년도가 시작일 기준으로 바뀌고 변경이력에 남는다', async () => {
  $('rdEdit').click();
  assert.ok($('rdFCalendar').checked);
  $('rdFCalendar').checked = false;
  $('rdFSave').click();
  assert.deepEqual(years().slice(0, 2), ['1차년도올해*', '2차년도']);
  assert.equal($('rdYearNote').textContent, '1차년도 · 2026.04.01 ~ 2027.03.31 · 진행 중');
  assert.deepEqual(chItems()[0].slice(1, 4), ['연구기간', '차년도 끊는 기준', '1월 1일(첫 해는 시작일부터 12월 31일까지)→시작일부터 한 해씩']);
  $('rdEdit').click();
  $('rdFCalendar').checked = true;
  $('rdFSave').click();
  assert.equal($('rdYearNote').textContent, '1차년도 · 2026.04.01 ~ 2026.12.31 · 진행 중');
  assert.equal(chItems().length, 2);
});
await ta('r2 재생성본과 history 세 파일을 한꺼번에 넣으면 차례대로(스냅샷 → 레지스트리 → 예산 → 참여연구원) 들어가고 변경이력이 선다', async () => {
  dropFiles([
    new window.File([fx('researchers_history.yaml')], 'researchers_history.yaml'),
    new window.File([fx('revisions.yaml')], 'revisions.yaml'),
    new window.File([fx('snapshot_r2.yaml')], 'KR_test_r2.yaml'),
    new window.File([fx('budget_history.yaml')], 'budget_history.yaml'),
  ]);
  await until(() => /참여연구원 이력/.test(status()));
  assert.deepEqual(rows().map((r) => [r[0], r[1]]).filter((r) => r[1]), [['인건비', '30,000,000'], ['연구시설·장비비', '10,000,000'], ['연구활동비', '40,000,000'], ['연구수당', '6,000,000'], ['간접비', '20,000,000']]);
  const items = chItems();
  // 앞서 둘(차년도 기준) + 스냅샷 r2 의 달라진 것 셋 + 레지스트리 셋 + 예산 이력은 스냅샷 줄에 사유만 붙임 + 참여연구원 둘
  assert.equal(items.length, 2 + 3 + 3 + 0 + 2);
  assert.ok(items.some((c) => c[1] === '예산' && c[2] === '연구활동비' && c[3] === '50,000,000원→40,000,000원' && c[4] === '연구활동비→연구시설·장비비 10,000 재배분' && c[0] === '2026.07.15'), '스냅샷이 남긴 줄에 예산 이력의 사유·날짜가 붙는다');
  assert.ok(items.some((c) => c[1] === '연구진' && c[2] === '이몽룡' && c[3].endsWith('→제외')));
  assert.ok(items.some((c) => c[0] === '2026.07.15' && c[1] === '예산' && c[2] === 'r2 계획수정'));
  assert.ok(items.some((c) => c[1] === '연구진' && c[2] === '참여연구자' && c[3] === '이몽룡 15% · 홍길동 20% · 성춘향 10%→홍길동 27.45% · 성춘향 20%'));
  assert.match(status(), /^연구개발계획서 스냅샷\(KR_test_r2\.yaml\): .* \/ 개정 레지스트리\(revisions\.yaml\): .* \/ 예산 이력\(budget_history\.yaml\): .*2건에 사유 붙임.* \/ 참여연구원 이력\(researchers_history\.yaml\): .*2건 넣음$/);
  assert.equal($('rdChangeState').textContent, '10건 · 사유 없음 2', '사유가 빈 것은 앞서 손으로 바꾼 차년도 기준 두 줄뿐 — 파일에서 온 줄은 사유가 있다');
  assert.deepEqual(rosterTable($('rdRoster')), [['홍길동', '수석', '27.45%', '9개월', '20,900,000원'], ['성춘향', '책임', '20%', '9개월', '9,100,000원']]);
  assert.equal($('rdRosterState').textContent, '2명 · 인건비 3,000만');
  assert.equal($('rdRosterSrc').textContent, '연구개발계획서 r2 기준');
  assert.equal(chips().at(-1)[0], 'TEST', '레지스트리의 project: TEST 는 이미 그 별칭인 과제로 찾았다');
});
await ta('스냅샷을 섞어 놓아도(r2 다음 r0) 판 차례로 넣어 최종본이 남는다 — 오래된 r0 는 넣지 않고 알려 준다', async () => {
  const n = chItems().length;
  dropFiles([new window.File([fx('snapshot_r2.yaml')], 'KR_test_r2.yaml'), new window.File([fx('snapshot_r0.yaml')], 'KR_test.yaml')]);
  await until(() => /오래된 r0/.test(status()));
  assert.equal(status(), '연구개발계획서 스냅샷(KR_test.yaml): TEST 1차년도에는 이미 r2 가 들어 있어 더 오래된 r0 는 넣지 않았습니다 — 최종본(KR_<과제>_rN.yaml)을 넣으세요'
    + ' / 연구개발계획서 스냅샷(KR_test_r2.yaml): 과제 찾음: TEST · 1차년도 · 비목 5개');
  assert.deepEqual(rosterTable($('rdRoster')).map((r) => [r[0], r[2]]), [['홍길동', '27.45%'], ['성춘향', '20%']]);
  assert.equal($('rdRosterSrc').textContent, '연구개발계획서 r2 기준');
  assert.equal(chItems().length, n, '되돌린 변경이력이 생기지 않는다');
});
await ta('칸마다 복사 아이콘 — 예산·참여연구자는 탭으로 나눈 표, 계획은 글 그대로, 변경이력은 전부·한 줄. 누르면 아이콘이 체크로', async () => {
  const n = copied.length;
  for (const id of ['rdBudgetCopy', 'rdRosterCopy', 'rdPlanCopy', 'rdLogsCopy', 'rdChangesCopy']) {
    assert.ok($(id).classList.contains('rd-icon') && $(id).querySelector('svg') && $(id).textContent === '', `${id} 는 글 없는 아이콘`);
    assert.match($(id).getAttribute('aria-label'), /복사$/);
  }
  $('rdBudgetCopy').click();
  await until(() => copied.length === n + 1);
  assert.equal(copied[n], ['비목\t계획(원)\t집행(원)\t잔액(원)\t집행률', '인건비\t30,000,000\t0\t30,000,000\t0%', '연구시설·장비비\t10,000,000\t0\t10,000,000\t0%', '연구활동비\t40,000,000\t0\t40,000,000\t0%', '연구수당\t6,000,000\t0\t6,000,000\t0%', '간접비\t20,000,000\t0\t20,000,000\t0%', '합계\t106,000,000\t0\t106,000,000\t0%'].join('\n'));
  assert.ok(copiedIcon('rdBudgetCopy'), '체크로 바뀐다');
  assert.ok(!flashed.some((f) => f[0] === 'rdBudgetCopy'), '아이콘은 글자를 바꾸는 flash 를 쓰지 않는다');
  $('rdRosterCopy').click();
  await until(() => copied.length === n + 2);
  assert.equal(copied[n + 1], ['참여연구자 — 1차년도', '성명\t직위\t계상률\t참여\t계상인건비', '홍길동\t수석\t27.45%\t9개월\t20,900,000원', '성춘향\t책임\t20%\t9개월\t9,100,000원'].join('\n'));
  $('rdPlanCopy').click();
  await until(() => copied.length === n + 3);
  assert.match(copied[n + 2], /^연구개발 계획 — 1차년도\n■ 개발목표\n1\. 규정 공백 분석/);
  $('rdChangesCopy').click();
  await until(() => copied.length === n + 4);
  const lines = copied[n + 3].split('\n');
  assert.equal(lines.length, 10);
  assert.match(lines[0], /^- 2026\.05\.22 \[기타\] r0 최초협약 \(최초 기준선\)$/);
  assert.ok(lines.includes('- 2026.07.15 [예산] 연구활동비: 50,000,000원 → 40,000,000원 (연구활동비→연구시설·장비비 10,000 재배분)'));
  q('#rdChanges li [data-copy]').click();
  await until(() => copied.length === n + 5);
  assert.match(copied[n + 4], /^2026\.10\.08 \[연구진\] 참여연구자: 이몽룡 15% · 홍길동 20% · 성춘향 10% → 홍길동 27\.45% · 성춘향 20% \(/, '맨 위 줄(같은 날짜면 뒤에 넣은 것)');
  assert.ok(logs.some((l) => l.kind === 'rnd' && /R&D 복사 — 예산 표 \(TEST 1차년도\)/.test(l.text)));
});
await ta('진행 기록에는 손으로 적은 것만 — 전부 복사도 그것만, 줄의 복사도 아이콘', async () => {
  type($('rdLogTitle'), '시제품 설계 검토');
  $('rdLogAdd').click();
  assert.deepEqual(logItems().map((l) => l[1]), ['시제품 설계 검토']);
  assert.equal($('rdLogState').textContent, '1건');
  const n = copied.length;
  $('rdLogsCopy').click();
  await until(() => copied.length === n + 1);
  assert.equal(copied[n], '- 2026.10.08 시제품 설계 검토');
  const rowCopy = q('#rdLogs li [data-copy]');
  assert.ok(rowCopy.classList.contains('rd-icon') && rowCopy.querySelector('svg'));
  rowCopy.querySelector('svg').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));   // 아이콘의 그림을 눌러도
  await until(() => copied.length === n + 2);
  assert.equal(copied[n + 1], '시제품 설계 검토');
});
await ta('붙여 넣은 YAML 글도 읽는다 — project: 값(별칭)으로 과제를 찾고, 칸에 적는 중이면 가로채지 않는다', async () => {
  q('#rdProjects [data-proj]').click();   // 다른 과제를 보고 있어도
  const ev = paste(fx('revisions.yaml').replace('rev: r2', 'rev: r3'));
  assert.ok(ev.defaultPrevented);
  await until(() => /개정 레지스트리/.test(status()));
  assert.equal(chips().at(-1)[1], true, '넣은 과제로 간다');
  assert.equal(chItems().filter((c) => c[2] === 'r3 계획수정').length, 1);
  assert.equal(chItems().length, 11);
  const ev2 = paste('meta:\n  과제명: x', $('rdLogTitle'));
  assert.ok(!ev2.defaultPrevented);
  const ev3 = paste('그냥 글');
  assert.ok(!ev3.defaultPrevented);
});
await ta('YAML 이 아니거나 모르는 모양이면 말만 하고 아무것도 바꾸지 않는다', async () => {
  dropFiles([new window.File(['a: [1, 2'], 'bad.yaml')]);
  await until(() => /읽지 못했습니다/.test(status()));
  assert.match(status(), /^bad\.yaml: YAML 을 읽지 못했습니다/);
  dropFiles([new window.File(['foo: 1\n'], 'other.yaml')]);
  await until(() => /아는 모양/.test(status()));
  dropFiles([new window.File(['x'], 'note.txt')]);
  await wait(30);
  assert.match(status(), /YAML 파일\(\.yaml · \.yml\)만/);
  assert.equal(chItems().length, 11);
  assert.ok(logs.some((l) => l.kind === 'rnd' && !l.ok && /YAML 넣기 실패/.test(l.text)));
});
await ta('과제가 없는 장부에 이력 파일만 넣으면 먼저 스냅샷을 넣으라고 한다', async () => {
  const empty = createRndPanel({ $: (id) => doc.getElementById(id), escapeHtml, logEvent: () => {}, today: () => '2026-10-08' });
  // 같은 화면을 빌려 쓰되 저장소는 빈 것으로 — 배선은 하지 않고 넣기만 부른다
  const saved = store.rndBook;
  delete store.rndBook;
  const gm = store.gongmunProjects;
  store.gongmunProjects = [];
  await empty.show();
  assert.ok(!hidden('rdEmpty'));
  assert.match($('rdEmpty').textContent, /연구개발계획서 YAML/);
  store.rndBook = saved;
  store.gongmunProjects = gm;
  await panel.show();
});

console.log('차년도 YAML 뽑는 스킬 — 목록·묶음 저장(zip)·쓰는 법 복사');
await ta('칸을 펴면 스킬 다섯 개가 서고, zip 으로 받고(README 가 맨 앞), 쓰는 법을 복사한다', async () => {
  assert.equal($('rdSkills').children.length, 0, '펴기 전에는 읽지 않는다');
  $('rdSkillBox').open = true;
  $('rdSkillBox').dispatchEvent(new window.Event('toggle'));
  await until(() => $('rdSkills').children.length > 0);
  assert.deepEqual([...$('rdSkills').querySelectorAll('li strong')].map((s) => s.textContent), ['rnd-kr-extract', 'rnd-kr-history', 'rnd-manpower-change', 'rnd-budget-change', 'rnd-export-latest']);
  assert.match($('rdSkillState').textContent, /^스킬 5개 · \d+K · 복사 \d{4}-\d{2}-\d{2}$/);
  assert.match(q('#rdSkills li').title, /^인자: /);
  const n = downloads.length;
  $('rdSkillZip').click();
  await until(() => downloads.length === n + 1);
  const d = downloads[n];
  assert.deepEqual([d.name, d.type], ['rnd-skills_2026-10-08.zip', 'application/zip']);
  assert.ok(d.text instanceof Uint8Array);
  const names = readZip(d.text).map((e) => e.name);
  assert.equal(names[0], 'README.md');
  assert.ok(names.includes('rnd-kr-extract/SKILL.md') && names.includes('rnd-kr-history/templates/history/revisions.yaml') && names.includes('rnd-kr-extract/scripts/year_slice.py'));
  assert.equal(names.length, 31);
  assert.match(status(), /스킬 묶음을 저장했습니다 — rnd-skills_2026-10-08\.zip \(\d+K\)\. 과제 작업 프로젝트의 \.claude\/skills\/ 에 푸세요\./);
  assert.deepEqual(flashed.at(-1), ['rdSkillZip', '저장됨 ✓']);
  const c = copied.length;
  $('rdSkillGuide').click();
  await until(() => copied.length === c + 1);
  assert.match(copied[c], /^KRS WORKSPACE — R&D 과제의 차년도 YAML 을 뽑는 Claude Code 스킬 묶음 \(2026-10-08\)\n/);
  assert.match(copied[c], /\n1\. 연구개발계획서\(PDF·HWP\)를 구조화 — \/rnd-kr-extract <계획서\.pdf> --format structured --stage <n>차년도\n/);
  assert.ok(logs.some((l) => l.kind === 'rnd' && /스킬 묶음 저장: rnd-skills_2026-10-08\.zip/.test(l.text)));
});
await ta('목록을 못 읽으면 버튼을 잠그고 까닭을 보인다', async () => {
  // 같은 화면을 빌려 쓰되 배선은 하지 않는다(배선된 패널의 리스너가 이미 붙어 있다) — 읽기만 직접 부른다.
  const broken = createRndPanel({ $: (id) => doc.getElementById(id), escapeHtml, logEvent: () => {}, readAsset: async () => { throw new Error('없음'); }, today: () => '2026-10-08' });
  assert.equal(await broken.skills(), null);
  assert.match($('rdSkills').textContent, /스킬 목록을 읽지 못했습니다 — 없음/);
  assert.ok($('rdSkillZip').disabled && $('rdSkillGuide').disabled);
  assert.equal($('rdSkillState').textContent, '목록 없음');
  assert.equal(await broken.skills(), null, '다시 불러도 다시 읽지 않고 같은 까닭');
  const m = await panel.skills();
  assert.equal(m.skills.length, 5);
  assert.ok(!$('rdSkillZip').disabled);
  $('rdSkillBox').open = false;
});

console.log('원노트 공유(선택) — 과제 정보만 원노트의 한 페이지에 두고 다른 기기와 맞춘다');
const pageData = () => readBlock(findBlock(one.pages[0].body).inner);
const change = (node, value) => { if (value !== undefined) node.value = value; node.dispatchEvent(new window.Event('change', { bubbles: true })); };
const pickChip = (label) => [...doc.querySelectorAll('#rdProjects [data-proj]')].find((b) => b.textContent === label).click();
t('꺼져 있는 것이 기본 — 아무 데도 닿지 않는다. 칸은 YAML 넣는 곳 위에, 과제가 없어도 보인다(rdBody 밖)', () => {
  assert.equal($('rdNoteState').textContent, '꺼짐');
  assert.ok(!$('rdNoteOn').checked);
  assert.ok($('rdNoteSync').disabled && $('rdNoteSection').disabled);
  assert.deepEqual(one.calls, []);
  assert.equal($('rdNoteBox').nextElementSibling.id, 'rdIntake');
  assert.ok(!$('rdBody').contains($('rdNoteBox')));
});
await ta('켜면 섹션을 불러와 고르게 한다', async () => {
  $('rdNoteOn').checked = true;
  change($('rdNoteOn'));
  await until(() => $('rdNoteSection').options.length === 2);
  assert.deepEqual([...$('rdNoteSection').options].map((o) => o.textContent), ['섹션 고르기 — 1개', '연구 › R&D']);
  assert.equal($('rdNoteState').textContent, '섹션을 고르세요');
  assert.match($('rdNoteMsg').textContent, /다른 기기에서도 같은 노트북의 같은 섹션/);
  assert.ok($('rdNoteSync').disabled, '섹션을 고르기 전에는 맞출 수 없다');
  assert.ok(logs.some((l) => l.kind === 'rnd' && l.text === 'R&D 원노트 공유 켬'));
});
await ta('섹션을 고르면 페이지를 찾고(없으면 목록을 새로 받은 뒤) 만들어 과제 정보 넷을 표로 쓴다 — 차년도 내용은 올리지 않는다', async () => {
  change($('rdNoteSection'), 's1');
  await until(() => /^맞춤 /.test($('rdNoteState').textContent));
  assert.deepEqual(one.calls, ['read_onenote:list_sections', 'read_onenote:list_pages', 'sync_onenote_db', 'read_onenote:list_pages', 'write_onenote:create_page']);
  assert.equal(one.pages[0].title, PAGE_TITLE);
  assert.deepEqual(pageData().projects.map((p) => p.alias || p.name), ['차단기 과제', '파일 과제', '수소전기추진 연구', 'TEST']);
  assert.ok(!/인건비|시제품 설계 검토|참여연구자/.test(one.pages[0].body), '예산·기록·참여연구자는 원노트에 없다');
  assert.equal($('rdNoteMsg').textContent, '맞췄습니다 — 원노트에 씀 (과제 4개)');
  assert.ok(!hidden('rdNoteOpen'));
  assert.equal($('rdNoteOpen').href, 'https://onenote.example/p1');
  await wait(10);
  assert.deepEqual([store.rndNote.on, store.rndNote.sectionId, store.rndNote.sectionLabel, store.rndNote.pageId], [true, 's1', '연구 › R&D', 'p1']);
});
await ta('다른 기기에서 고친 것(별칭)과 더한 과제를 지금 맞추기로 받는다 — 달라진 것이 원노트 쪽뿐이면 페이지는 그대로', async () => {
  const d = pageData();
  const later = Date.now() + 1000;
  const projects = d.projects.map((p) => (p.name === '파일 과제' ? { ...p, alias: '파일', ts: later } : p));
  projects.push({ id: 'other1', name: '다른 기기 과제', alias: 'OTHER', code: '', lead: '', start: '', end: '', calendar: false, note: '', ts: later });
  one.pages[0].body = blockHtml({ projects, del: d.del });
  const n = one.calls.length;
  $('rdNoteSync').click();
  await until(() => chips().some((c) => c[0] === 'OTHER'));
  await until(() => !$('rdNoteSync').disabled);
  assert.deepEqual(chips().map((c) => c[0]), ['차단기 과제', '파일', '수소전기추진 연구', 'TEST', 'OTHER']);
  assert.equal($('rdNoteMsg').textContent, '맞췄습니다 — 원노트에서 더함 1 · 받아 고침 1 (과제 5개)');
  assert.deepEqual(one.calls.slice(n), ['read_onenote:get_content'], '기억해 둔 페이지를 바로 읽고, 쓸 것은 없다');
});
await ta('이 기기에서 과제를 지우면 잠깐 뒤 저절로 맞춰 원노트에 묘비가 선다', async () => {
  pickChip('OTHER');
  $('rdEdit').click();
  $('rdFDel').click();
  $('rdFDel').click();
  assert.ok(!chips().some((c) => c[0] === 'OTHER'));
  await until(() => pageData().del.other1 > 0);
  assert.ok(!pageData().projects.some((p) => p.id === 'other1'));
  assert.ok(one.calls.at(-1) === 'write_onenote:replace', '있던 표를 생성 id 로 통째로 바꾼다');
  assert.ok(logs.some((l) => l.kind === 'rnd' && /R&D 원노트 맞춤\(고침\)/.test(l.text)));
});
await ta('서버가 없으면 까닭을 보이고 장부는 그대로', async () => {
  one.up = false;
  $('rdNoteSync').click();
  await until(() => $('rdNoteState').textContent === '못 맞춤');
  assert.match($('rdNoteMsg').textContent, /^원노트와 맞추지 못했습니다 — 이 PC 의 OneNote MCP 서버/);
  assert.ok($('rdNoteMsg').classList.contains('error'));
  assert.equal(chips().length, 4);
  one.up = true;
});
await ta('끄면 더는 닿지 않는다 — 과제 정보를 고쳐도', async () => {
  $('rdNoteOn').checked = false;
  change($('rdNoteOn'));
  assert.equal($('rdNoteState').textContent, '꺼짐');
  const n = one.calls.length;
  pickChip('파일');
  $('rdEdit').click();
  type($('rdFAlias'), '파일 과제');
  $('rdFSave').click();
  await wait(1500);
  assert.equal(one.calls.length, n);
  pickChip('TEST');
});

console.log('다시 열기');
await ta('저장된 것으로 다시 선다 — 공문 탭에서 다시 가져오지 않는다', async () => {
  await wait(500);
  panel.hide();
  assert.ok(hidden('rnd'));
  panel = make();
  $('rdNoteSection').innerHTML = '';   // 새로 연 화면에는 섹션 목록이 없다
  await panel.show();
  assert.ok(!hidden('rnd'));
  assert.deepEqual([...$('rdNoteSection').options].map((o) => [o.value, o.textContent]), [['s1', '연구 › R&D']], '고른 섹션은 이름으로 다시 선다');
  assert.equal($('rdNoteState').textContent, '꺼짐');
  assert.deepEqual(chips().map((c) => c[0]), ['차단기 과제', '파일 과제', '수소전기추진 연구', 'TEST']);
  assert.equal(chips().at(-1)[1], true);
  assert.equal(logItems().length, 1);
  assert.equal(rosterTable($('rdRoster')).length, 2);
  assert.equal(chItems().length, 11);
  assert.equal(rows().find((r) => r[0] === '인건비')[1], '30,000,000');
  assert.equal(panel.book().projects.length, 4);
  assert.equal(panel.book().projects[3].years[1].snapshot.rev, 'r2');
});

console.log(`\n${pass} passed`);
