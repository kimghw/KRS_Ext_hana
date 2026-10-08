// R&D 과제 관리의 순수 로직 — src/rnd.js. 연구기간 읽기·차년도 자르기·금액 읽기·예산 셈·저절로 남는 변경이력·요약·
// 공문 탭에서 가져오기·JSON 내보내기·들여오기를 못 박는다. 화면 쪽(칩·줄 적기·탭 전환)은 test/rndpanel.test.mjs 와
// test/wiring.test.mjs 의 "R&D 탭" 이 본다.
import assert from 'node:assert/strict';

import {
  BOOK_KEY, MAX_PROJECTS, MAX_YEARS, BUDGET_ITEMS, CHANGE_KINDS,
  periodOf, periodText, isYmd, amountOf, comma, won, shortWon,
  yearsOf, currentYear, yearState, yearLabel,
  blankYear, normalizeYear, normalizeProject, normalizeBook, viewYear, yearBook,
  budgetTotals, budgetChanges, projectChanges, newestFirst,
  fromGongmun, mergeProjects, exportJson, exportName, importJson, restoreBook, summaryText,
} from '../src/rnd.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
/** id 는 만들 때마다 다르다 — 견줄 때 뺀다. */
const noId = (list) => list.map(({ id, ...rest }) => rest);

console.log('연구기간·날짜');
t('연구기간 글을 시작일·종료일로 읽는다 — 점·대시·빗금, 한 자리 달·날', () => {
  assert.deepEqual(periodOf('2026.04.01 ~ 2029.12.31'), { start: '2026-04-01', end: '2029-12-31' });
  assert.deepEqual(periodOf('2026-04-01~2029-12-31'), { start: '2026-04-01', end: '2029-12-31' });
  assert.deepEqual(periodOf('2026.4.1 - 2029.12.31'), { start: '2026-04-01', end: '2029-12-31' });
  assert.deepEqual(periodOf('2026/04/01'), { start: '2026-04-01', end: '' }, '하나뿐이면 시작일만');
  assert.deepEqual(periodOf('2029.12.31 ~ 2026.04.01'), { start: '2029-12-31', end: '' }, '종료일이 앞서면 버린다');
  assert.deepEqual(periodOf('2026.02.30 ~ 2027.01.01'), { start: '2027-01-01', end: '' }, '달력에 없는 날은 건너뛴다');
  assert.equal(periodOf(''), null);
  assert.equal(periodOf(null), null);
  assert.equal(periodOf('연구기간 미정'), null);
});
t('periodText · isYmd', () => {
  assert.equal(periodText({ start: '2026-04-01', end: '2029-12-31' }), '2026.04.01 ~ 2029.12.31');
  assert.equal(periodText({ start: '2026-04-01', end: '' }), '2026.04.01 ~');
  assert.equal(periodText({ start: '', end: '2029-12-31' }), '');
  assert.equal(periodText(null), '');
  assert.ok(isYmd('2028-02-29'));
  assert.ok(!isYmd('2027-02-29'));
  assert.ok(!isYmd('2026-13-01'));
  assert.ok(!isYmd('2026-4-1'));
  assert.ok(!isYmd(20260401));
});

console.log('차년도');
const P = { start: '2026-04-01', end: '2029-12-31' };
t('시작일부터 한 해씩, 마지막은 종료일까지 — 2026.04.01~2029.12.31 은 4차년도', () => {
  assert.deepEqual(yearsOf(P), [
    { n: 1, start: '2026-04-01', end: '2027-03-31' }, { n: 2, start: '2027-04-01', end: '2028-03-31' },
    { n: 3, start: '2028-04-01', end: '2029-03-31' }, { n: 4, start: '2029-04-01', end: '2029-12-31' },
  ]);
});
t('딱 한 해면 한 차년도, 종료일이 없으면 한 해, 시작일이 없으면 기간 없는 1차년도 하나', () => {
  assert.deepEqual(yearsOf({ start: '2026-01-01', end: '2026-12-31' }), [{ n: 1, start: '2026-01-01', end: '2026-12-31' }]);
  assert.deepEqual(yearsOf({ start: '2026-04-01', end: '' }), [{ n: 1, start: '2026-04-01', end: '2027-03-31' }]);
  assert.deepEqual(yearsOf({ start: '', end: '' }), [{ n: 1, start: '', end: '' }]);
  assert.deepEqual(yearsOf(null), [{ n: 1, start: '', end: '' }]);
  assert.deepEqual(yearsOf({ start: '2026-04-01', end: '2026-01-01' }), [{ n: 1, start: '2026-04-01', end: '2027-03-31' }], '종료일이 앞서면 없는 셈');
});
t('2월 29일에 시작해도 날짜가 어긋나지 않는다', () => {
  assert.deepEqual(yearsOf({ start: '2028-02-29', end: '2030-02-28' }), [
    { n: 1, start: '2028-02-29', end: '2029-02-28' }, { n: 2, start: '2029-03-01', end: '2030-02-28' },
  ]);
});
t('잘못 적은 긴 기간도 스무 차년도까지만', () => assert.equal(yearsOf({ start: '2000-01-01', end: '2099-12-31' }).length, MAX_YEARS));
t('오늘이 든 차년도 — 시작 전은 1, 끝난 뒤는 마지막, 기간이 없으면 1', () => {
  assert.equal(currentYear(P, '2026-10-08'), 1);
  assert.equal(currentYear(P, '2027-03-31'), 1);
  assert.equal(currentYear(P, '2027-04-01'), 2);
  assert.equal(currentYear(P, '2029-12-31'), 4);
  assert.equal(currentYear(P, '2025-01-01'), 1);
  assert.equal(currentYear(P, '2031-01-01'), 4);
  assert.equal(currentYear({}, '2026-10-08'), 1);
});
t('차년도의 형편', () => {
  assert.equal(yearState({ start: '2026-04-01', end: '2027-03-31' }, '2026-10-08'), '진행 중');
  assert.equal(yearState({ start: '2027-04-01', end: '2028-03-31' }, '2026-10-08'), '예정');
  assert.equal(yearState({ start: '2026-04-01', end: '2027-03-31' }, '2027-04-01'), '지남');
  assert.equal(yearState({ start: '', end: '' }, '2026-10-08'), '연구기간 미정');
  assert.equal(yearLabel(3), '3차년도');
});

console.log('금액');
t('금액 글을 원으로 — 쉼표·원·만·억·천만', () => {
  assert.equal(amountOf('1,500,000'), 1500000);
  assert.equal(amountOf('1500000원'), 1500000);
  assert.equal(amountOf(' ₩ 1,500,000 '), 1500000);
  assert.equal(amountOf('150만'), 1500000);
  assert.equal(amountOf('1.5억'), 150000000);
  assert.equal(amountOf('3천만'), 30000000);
  assert.equal(amountOf('2백만'), 2000000);
  assert.equal(amountOf('5천'), 5000);
  assert.equal(amountOf('0'), 0);
  assert.equal(amountOf(1500000.4), 1500000);
  assert.equal(amountOf(''), null);
  assert.equal(amountOf(null), null);
  assert.equal(amountOf('abc'), null);
  assert.equal(amountOf('-5'), null);
  assert.equal(amountOf(-1), null);
  assert.equal(amountOf('1,500,000 (추정)'), null);
});
t('comma · won · shortWon', () => {
  assert.equal(comma(1500000), '1,500,000');
  assert.equal(comma(null), '');
  assert.equal(won(0), '0원');
  assert.equal(won(null), '');
  assert.equal(shortWon(150000000), '1.5억');
  assert.equal(shortWon(125000000), '1.3억');
  assert.equal(shortWon(100000000), '1억');
  assert.equal(shortWon(35000000), '3,500만');
  assert.equal(shortWon(15000), '2만');
  assert.equal(shortWon(5000), '5,000원');
  assert.equal(shortWon(-20000), '-2만');
  assert.equal(shortWon(NaN), '');
});

console.log('모양');
t('빈 차년도 — 기본 비목 여섯 줄에 줄마다 id, 연구내역·변경이력 없음', () => {
  const y = blankYear();
  assert.deepEqual(y.budget.map((r) => r.item), [...BUDGET_ITEMS]);
  assert.ok(y.budget.every((r) => r.id && r.plan === null && r.used === null));
  assert.deepEqual([y.logs, y.changes], [[], []]);
  assert.equal(BOOK_KEY, 'rndBook');
  assert.deepEqual([...CHANGE_KINDS], ['예산', '연구내용', '연구기간', '연구진', '기타']);
});
t('normalizeYear — 금액 글은 원으로, 내용 없는 연구내역·변경이력은 버리고, 모르는 구분은 기타', () => {
  const y = normalizeYear({
    budget: [{ id: 'a', item: '인건비', plan: '1,000만', used: '' }, { item: '', plan: 'x' }],
    logs: [{ date: '2026-05-01', title: 'x' }, { title: '', text: '' }, { date: '2026-02-30', text: '날짜가 틀림' }],
    changes: [{ date: '2026-05-01', kind: '이상한', item: 'x', before: '1', after: '2', auto: 'yes' }, { kind: '예산' }],
  });
  assert.deepEqual(noId(y.budget), [{ item: '인건비', plan: 10000000, used: null }, { item: '', plan: null, used: null }]);
  assert.equal(y.budget[0].id, 'a');
  assert.ok(y.budget[1].id);
  assert.deepEqual(noId(y.logs), [{ date: '2026-05-01', title: 'x', text: '' }, { date: '', title: '', text: '날짜가 틀림' }]);
  assert.deepEqual(noId(y.changes), [{ date: '2026-05-01', kind: '기타', item: 'x', before: '1', after: '2', reason: '', auto: false }]);
  assert.deepEqual(normalizeYear(null).budget.length, 6);
  assert.deepEqual(normalizeYear({ budget: [] }).budget, [], '비목을 다 뺀 차년도는 빈 채로 둔다');
});
t('normalizeProject — 날짜 칸이 비면 연구기간 글에서, 앞선 종료일은 버림, id 없으면 만듦, 차년도는 1~20 만', () => {
  const p = normalizeProject({ name: ' 차단기 ', period: '2026.04.01 ~ 2029.12.31', years: { 1: { budget: [{ item: '인건비', plan: '1,000만' }] }, x: {}, 0: {}, 21: {} } });
  assert.equal(p.name, '차단기');
  assert.equal(p.start, '2026-04-01');
  assert.equal(p.end, '2029-12-31');
  assert.ok(p.id);
  assert.deepEqual(Object.keys(p.years), ['1']);
  assert.equal(p.years[1].budget[0].plan, 10000000);
  assert.equal(normalizeProject({ name: 'a', start: '2026-01-01', end: '2027-01-01', period: '2000.01.01 ~ 2001.01.01' }).start, '2026-01-01', '날짜 칸이 이긴다');
  assert.equal(normalizeProject({ name: 'a', start: '2027-01-01', end: '2026-01-01' }).end, '');
  assert.equal(normalizeProject({ name: 'a', end: '2026-01-01' }).end, '', '시작일 없이 종료일만은 버린다');
  assert.deepEqual(normalizeProject(null), { id: normalizeProject(null).id, name: '', alias: '', code: '', lead: '', start: '', end: '', note: '', years: {} });
});
t('normalizeBook — 이름 없는 과제는 버리고 열 개까지, current 는 있는 과제·차년도만', () => {
  const raw = {
    projects: [{ name: '' }, ...Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `과제 ${i}` }))],
    current: { project: 'p3', year: { p3: 2, p11: 1, zz: 1, p1: 99, p2: '2' } },
  };
  const b = normalizeBook(raw);
  assert.equal(b.projects.length, MAX_PROJECTS);
  assert.equal(b.current.project, 'p3');
  assert.deepEqual(b.current.year, { p3: 2 });
  assert.equal(normalizeBook({ projects: [{ id: 'a', name: 'A' }], current: { project: 'nope' } }).current.project, 'a', '없는 과제면 첫 과제');
  assert.deepEqual(normalizeBook(null), { projects: [], current: { project: '', year: {} } });
});
t('viewYear — 골라 둔 차년도가 아직 있으면 그것, 없으면 오늘이 든 차년도 · yearBook 은 없으면 만든다', () => {
  const p = normalizeProject({ id: 'a', name: 'A', start: '2026-04-01', end: '2029-12-31' });
  const book = { projects: [p], current: { project: 'a', year: { a: 3 } } };
  assert.equal(viewYear(book, p, '2026-10-08'), 3);
  book.current.year.a = 9;
  assert.equal(viewYear(book, p, '2026-10-08'), 1);
  delete book.current.year.a;
  assert.equal(viewYear(book, p, '2027-06-01'), 2);
  const y = yearBook(p, 2);
  assert.equal(y.budget.length, 6);
  assert.equal(yearBook(p, 2), y, '같은 것을 돌려준다');
  assert.deepEqual(Object.keys(p.years), ['2']);
});

console.log('예산');
t('합계·잔액·집행률 — 계획이 없으면 집행률은 null', () => {
  assert.deepEqual(budgetTotals([{ plan: 1000000, used: 250000 }, { plan: null, used: 50000 }, { plan: 500000, used: null }]), { plan: 1500000, used: 300000, left: 1200000, rate: 20 });
  assert.deepEqual(budgetTotals([]), { plan: 0, used: 0, left: 0, rate: null });
  assert.deepEqual(budgetTotals([{ plan: 100, used: 150 }]), { plan: 100, used: 150, left: -50, rate: 150 });
});
t('계획이 바뀐 줄만 변경이력으로 — 전에 적은 계획이 있던 줄만, id 로 맞춤(이름을 고쳐도 같은 줄), 뺀 비목도', () => {
  const before = [
    { id: 'a', item: '인건비', plan: 1000000, used: null }, { id: 'b', item: '재료비', plan: null, used: null },
    { id: 'c', item: '활동비', plan: 500000, used: 100000 }, { id: 'd', item: '수당', plan: 0, used: null },
  ];
  const after = [
    { id: 'a', item: '인건비(연구원)', plan: 1500000, used: null }, { id: 'b', item: '재료비', plan: 2000000, used: null },
    { id: 'd', item: '수당', plan: 300000, used: null }, { id: 'e', item: '간접비', plan: 100000, used: null },
  ];
  const out = budgetChanges(before, after, '2026-10-08');
  assert.deepEqual(noId(out), [
    { date: '2026-10-08', kind: '예산', item: '인건비(연구원)', before: '1,000,000원', after: '1,500,000원', reason: '', auto: true },
    { date: '2026-10-08', kind: '예산', item: '활동비', before: '500,000원', after: '(비목 뺌)', reason: '', auto: true },
  ]);
  assert.ok(out.every((c) => c.id));
  assert.deepEqual(budgetChanges(after, after), []);
  assert.deepEqual(budgetChanges(before, [{ id: 'a', item: '인건비', plan: null, used: null }]).map((c) => c.after), ['(비움)', '(비목 뺌)']);
  assert.deepEqual(budgetChanges([{ id: 'a', item: 'x', plan: 100, used: 0 }], [{ id: 'a', item: 'x', plan: 100, used: 50 }]), [], '집행은 변경이 아니다');
  assert.deepEqual(budgetChanges(null, after), []);
});
t('과제의 책임자·연구기간을 고치면 변경이력으로 — 전에 적힌 값이 있을 때만', () => {
  const a = { lead: '박기도', start: '2026-04-01', end: '2029-12-31' };
  assert.deepEqual(noId(projectChanges(a, { ...a, lead: '김철수' }, '2026-10-08')),
    [{ date: '2026-10-08', kind: '연구진', item: '과제책임자', before: '박기도', after: '김철수', reason: '', auto: true }]);
  assert.deepEqual(projectChanges(a, { ...a, end: '2030-03-31' }).map((c) => [c.kind, c.before, c.after]), [['연구기간', '2026.04.01 ~ 2029.12.31', '2026.04.01 ~ 2030.03.31']]);
  assert.deepEqual(projectChanges(a, { ...a, lead: '김철수', start: '2026-05-01' }).map((c) => c.kind), ['연구진', '연구기간']);
  assert.deepEqual(projectChanges({ lead: '', start: '', end: '' }, a), [], '처음 적는 것은 변경이 아니다');
  assert.deepEqual(projectChanges(a, { ...a, lead: '' }).map((c) => c.after), ['(비움)']);
  assert.deepEqual(projectChanges(a, { ...a, start: '', end: '' }).map((c) => c.after), ['(비움)']);
  assert.deepEqual(projectChanges(a, { ...a, name: '다른 이름', alias: '별명' }), [], '이름·별명은 이력이 아니다');
});
t('늦은 것부터 — 같은 날은 뒤에 넣은 것이 앞, 날짜 없는 것은 맨 뒤', () => {
  const list = [{ date: '2026-01-01', n: 1 }, { date: '2026-03-01', n: 2 }, { date: '2026-03-01', n: 3 }, { date: '', n: 4 }];
  assert.deepEqual(newestFirst(list).map((x) => x.n), [3, 2, 1, 4]);
  assert.deepEqual(list.map((x) => x.n), [1, 2, 3, 4], '원래 것은 안 건드린다');
});

console.log('가져오기·내보내기');
t('공문 탭의 과제 → 이 모양 · 보태기: 과제번호(없으면 과제명)가 같으면 같은 과제, 빈 칸만 채움, 열 개 넘으면 뺌', () => {
  const gm = [
    { name: 'MVDC 차단기 개발', alias: '차단기 과제', code: 'RND-20-2026', lead: '박기도', period: '2026.04.01 ~ 2029.12.31', about: '', content: '', account: '' },
    { name: '' },
    { name: '수소 추진', code: '', lead: '' },
  ];
  const inc = fromGongmun(gm);
  assert.equal(inc.length, 2);
  assert.equal(inc[0].start, '2026-04-01');
  assert.equal(inc[0].end, '2029-12-31');
  const book = normalizeBook({ projects: [{ id: 'x', name: 'MVDC 차단기 개발 (구)', code: 'rnd-20-2026', lead: '', years: { 1: { logs: [{ title: '남아 있어야' }] } } }] });
  const res = mergeProjects(book, inc);
  assert.deepEqual([res.added, res.filled, res.skipped], [['수소 추진'], ['MVDC 차단기 개발 (구)'], []]);
  const x = res.book.projects.find((p) => p.id === 'x');
  assert.equal(x.name, 'MVDC 차단기 개발 (구)', '이름은 안 바꾼다');
  assert.equal(x.code, 'rnd-20-2026', '있는 칸은 안 바꾼다');
  assert.deepEqual([x.lead, x.alias, x.start, x.end], ['박기도', '차단기 과제', '2026-04-01', '2029-12-31']);
  assert.equal(x.years[1].logs[0].title, '남아 있어야');
  assert.equal(res.book.current.project, 'x');
  assert.ok(res.book.projects[1].id && res.book.projects[1].id !== inc[1].id, '더한 과제는 새 id');
  const again = mergeProjects(res.book, inc);
  assert.deepEqual([again.added, again.filled], [[], []], '한 번 더 가져와도 달라질 것 없음');
  const full = normalizeBook({ projects: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `과제 ${i}` })) });
  const r2 = mergeProjects(full, [{ name: '열한 번째' }, { name: '과제 3', lead: '홍길동' }]);
  assert.deepEqual([r2.skipped, r2.filled], [['열한 번째'], ['과제 3']]);
  assert.equal(r2.book.projects.length, 10);
  assert.deepEqual(fromGongmun(null), []);
});
t('JSON 으로 내보내고 들여오면 그대로 — 머리에 무엇의 파일인지, 못 읽는 파일은 Error', () => {
  const book = normalizeBook({ projects: [{ id: 'a', name: 'A', years: { 1: { logs: [{ id: 'l', title: 'x' }] } } }, { id: 'b', name: 'B' }], current: { project: 'b', year: { b: 1 } } });
  const json = exportJson(book, new Date('2026-10-08T00:00:00Z'));
  const obj = JSON.parse(json);
  assert.equal(obj.kind, 'rndBook');
  assert.equal(obj.app, 'KRS WORKSPACE');
  assert.equal(obj.savedAt, '2026-10-08T00:00:00.000Z');
  assert.deepEqual(importJson(json), book);
  assert.equal(exportName('2026-10-08'), 'R&D과제_2026-10-08.json');
  assert.throws(() => importJson('{'), /JSON 파일이 아닙니다/);
  assert.throws(() => importJson('{"a":1}'), /projects/);
  assert.throws(() => importJson('[]'), /projects/);
  assert.throws(() => importJson('{"projects":[{"name":""}]}'), /과제가 없습니다/);
});
t('들여온 장부를 얹기 — 같은 id 는 파일 것으로, 없던 과제는 더하고, 파일에 없는 과제는 그대로', () => {
  const file = normalizeBook({ projects: [{ id: 'a', name: 'A', years: { 1: { logs: [{ id: 'l', title: 'file' }] } } }, { id: 'b', name: 'B' }], current: { project: 'b', year: { b: 1 } } });
  const local = normalizeBook({ projects: [{ id: 'a', name: 'A 고침', years: { 1: { logs: [{ id: 'm', title: 'local' }] } } }, { id: 'c', name: 'C' }], current: { project: 'c', year: { c: 1, a: 1 } } });
  const res = restoreBook(local, file);
  assert.deepEqual([res.replaced, res.added], [['A'], ['B']]);
  assert.deepEqual(res.book.projects.map((p) => p.id), ['a', 'c', 'b']);
  assert.equal(res.book.projects[0].name, 'A');
  assert.equal(res.book.projects[0].years[1].logs[0].title, 'file');
  assert.equal(res.book.current.project, 'b');
  assert.deepEqual(res.book.current.year, { c: 1, a: 1, b: 1 });
});

console.log('요약');
t('과제 한 차년도를 붙여 넣을 글로 — 개요 · 예산표 · 연구내역(이른 것부터) · 변경이력', () => {
  const p = normalizeProject({
    id: 'a', name: 'MVDC 차단기 개발', alias: '차단기 과제', code: 'RND-20-2026', lead: '박기도', start: '2026-04-01', end: '2029-12-31',
    years: { 1: {
      budget: [{ id: 'r1', item: '인건비', plan: 10000000, used: 2500000 }, { id: 'r2', item: '간접비', plan: null, used: null }, { id: 'r3', item: '', plan: 5, used: null }],
      logs: [{ id: 'l2', date: '2026-09-01', title: '둘째', text: '여러\n줄' }, { id: 'l1', date: '2026-05-01', title: '첫째', text: '' }],
      changes: [{ id: 'c1', date: '2026-08-01', kind: '예산', item: '인건비', before: '8,000,000원', after: '10,000,000원', reason: '인력 충원', auto: true }],
    } },
  });
  assert.equal(summaryText(p, 1, '2026-10-08'), [
    '[차단기 과제] 1차년도 (2026.04.01 ~ 2027.03.31) — 진행 중',
    '과제명: MVDC 차단기 개발', '과제번호: RND-20-2026', '과제책임자: 박기도', '연구기간: 2026.04.01 ~ 2029.12.31 (총 4차년도)',
    '', '■ 예산 (1차년도)',
    '- 인건비: 계획 10,000,000원 · 집행 2,500,000원 · 잔액 7,500,000원 · 집행률 25%',
    '- 합계: 계획 10,000,000원 · 집행 2,500,000원 · 잔액 7,500,000원 · 집행률 25%',
    '', '■ 연구내역 (2건)', '- 2026.05.01 첫째', '- 2026.09.01 둘째 — 여러 / 줄',
    '', '■ 변경이력 (1건)', '- 2026.08.01 [예산] 인건비: 8,000,000원 → 10,000,000원 (인력 충원)',
  ].join('\n'));
  const empty = summaryText(p, 3, '2026-10-08');
  assert.match(empty, /^\[차단기 과제\] 3차년도 \(2028\.04\.01 ~ 2029\.03\.31\) — 예정\n/);
  assert.equal(empty.match(/- 적은 것 없음/g).length, 3);
  const bare = summaryText(normalizeProject({ name: '이름만' }), 1, '2026-10-08');
  assert.match(bare, /^\[이름만\] 1차년도 — 연구기간 미정\n과제명: 이름만\n\n■ 예산/);
  assert.match(summaryText(p, 99, '2026-10-08'), /^\[차단기 과제\] 1차년도/, '없는 차년도면 첫 차년도');
});

console.log(`\n${pass} passed`);
