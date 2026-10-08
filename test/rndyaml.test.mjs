// 연구개발계획서 YAML 을 R&D 장부에 넣는 순수 로직 — src/rndyaml.js. 머리 주석·연구기간·파일 종류 읽기, 스냅샷 → 과제·차년도·예산·계획·참여연구자,
// 두 번째 스냅샷(r2)의 달라진 것 → 변경이력, history 세 파일(개정 레지스트리·예산 이력·참여연구원 이력) → 변경이력, 한 번에 넣기.
// 검사 자료(test/fixtures/rnd)는 실제 RND 폴더 파일과 같은 모양이고 값은 지어낸 것이다. YAML 풀이는 npm yaml(확장은 vendor/yaml 의 같은 것)을 쓴다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'yaml';

import { normalizeBook, yearsOf } from '../src/rnd.js';
import {
  KIND_LABEL, KIND_ORDER, headerOf, projectHint, periodOfLoose, kindOf, itemName, sameItem, readSnapshot, findProject,
  applySnapshot, applyRevisions, applyBudgetHistory, applyResearchersHistory, applyYaml,
} from '../src/rndyaml.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const fx = (name) => fs.readFileSync(new URL(`./fixtures/rnd/${name}`, import.meta.url), 'utf8');
const TODAY = '2026-10-08';
const noId = ({ id, ...rest }) => rest;

console.log('글 읽기');
t('머리 주석 — 꼬리표와 변경분', () => {
  const h = headerOf(fx('snapshot_r2.yaml'));
  assert.equal(h.tag, '재생성 r2');
  assert.equal(h.changed, '예산.참여연구자인건비(r1: 이몽룡 제외·홍길동·성춘향 재배분) + 예산.비목별[1차년도](r2: 연구활동비→연구시설·장비비 10,000 재배분·총액 불변)');
  assert.equal(headerOf(fx('snapshot_r0.yaml')).tag, '1차년도 최초');
  assert.equal(headerOf(fx('snapshot_r0.yaml')).changed, '');
  assert.deepEqual(headerOf('meta:\n  a: 1\n# 뒤의 주석은 머리가 아니다'), { lines: [], tag: '', changed: '' });
  assert.deepEqual(headerOf(''), { lines: [], tag: '', changed: '' });
});
t('이력 파일의 project 줄 주석에서 과제명', () => {
  assert.equal(projectHint(fx('revisions.yaml')), '시험용 직류 차단기 개발');
  assert.equal(projectHint('project: X\n'), '');
  assert.equal(projectHint(null), '');
});
t('연구기간 — 달까지만 적은 것은 그 달의 첫날·마지막 날', () => {
  assert.deepEqual(periodOfLoose('2026-04 ~ 2029-12'), { start: '2026-04-01', end: '2029-12-31' });
  assert.deepEqual(periodOfLoose('2024-07-01 ~ 2027-12-31'), { start: '2024-07-01', end: '2027-12-31' });
  assert.deepEqual(periodOfLoose('2024.02 ~ 2024.02'), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(periodOfLoose('2024.02'), { start: '2024-02-01', end: '' });
  assert.deepEqual(periodOfLoose('2026-04 ~ 2025-12'), { start: '2026-04-01', end: '' });
  assert.equal(periodOfLoose('미정'), null);
  assert.equal(periodOfLoose(null), null);
});
t('무슨 파일인가', () => {
  assert.equal(kindOf(parse(fx('snapshot_r0.yaml'))), 'snapshot');
  assert.equal(kindOf(parse(fx('revisions.yaml'))), 'revisions');
  assert.equal(kindOf(parse(fx('budget_history.yaml'))), 'budget');
  assert.equal(kindOf(parse(fx('researchers_history.yaml'))), 'researchers');
  for (const v of [null, [], {}, { meta: {} }, { meta: { 과제명: '' } }, { entity: 'budget' }, 'x']) assert.equal(kindOf(v), '');
  assert.deepEqual(KIND_ORDER.map((k) => KIND_LABEL[k]), ['연구개발계획서 스냅샷', '개정 레지스트리', '예산 이력', '참여연구원 이력']);
});
t('비목 이름 — 직접비/ 를 떼고 연구시설장비비는 장부 이름으로', () => {
  assert.equal(itemName('직접비/연구시설장비비'), '연구시설·장비비');
  assert.equal(itemName('연구시설장비비'), '연구시설·장비비');
  assert.equal(itemName('직접비/연구활동비'), '연구활동비');
  assert.equal(itemName('간접비'), '간접비');
  assert.equal(itemName('위탁연구개발비'), '위탁연구개발비');
  assert.ok(sameItem('연구시설·장비비', '직접비/연구시설장비비'));
  assert.ok(!sameItem('인건비', '연구수당'));
});

console.log('스냅샷 읽기');
const r0 = parse(fx('snapshot_r0.yaml'));
t('과제·차년도·연구기간(1월 1일 기준)·예산(천원 → 원, 0 원 비목은 뺌)·계획·참여연구자', () => {
  const s = readSnapshot(r0);
  assert.deepEqual(s.project, {
    name: '시험용 직류 차단기 개발', code: 'RS-2026-00000001', lead: '홍길동', start: '2026-04-01', end: '2029-12-31', calendar: true,
    note: '산업통상부 · 조선해양산업기술개발사업 · 주관 가나전기',
  });
  assert.equal(s.n, 1);
  assert.equal(s.rev, 'r0');
  assert.equal(s.date, '2026-05-22');
  assert.deepEqual(s.budget, [{ item: '인건비', plan: 30000000 }, { item: '연구활동비', plan: 50000000 }, { item: '연구수당', plan: 6000000 }, { item: '간접비', plan: 20000000 }]);
  assert.equal(s.plan.title, '연구개발 계획 — 1차년도');
  assert.equal(s.plan.text, [
    '■ 개발목표', '1. 규정 공백 분석 및 평가 기준 도출', '2. 용어 분류 체계 설계',
    '■ 개발내용', '- 규정 공백 분석 및 평가 기준 도출', '  · 선급규정 및 국제표준 비교', '  · 시험기준 도출', '- 용어 분류 체계 설계', '  · 핵심 개념 추출',
    '■ 성능목표', '- 규정 공백 분석: 1 건 (자체평가)',
    '■ 주요결과물', '- 평가 기준서',
    '■ 수행일정 (9개월)', '- 규정 공백 분석 및 평가 기준 도출 32주',
  ].join('\n'));
  assert.deepEqual(s.plan.goals, ['규정 공백 분석 및 평가 기준 도출', '용어 분류 체계 설계']);
  assert.equal(s.roster.title, '참여연구자 — 1차년도');
  assert.equal(s.roster.text, ['이몽룡 — 수석 · 15% · 9개월 · 인건비 11,250,000원', '홍길동 — 수석 · 20% · 9개월 · 인건비 15,000,000원', '성춘향 — 책임 · 10% · 9개월 · 인건비 3,750,000원'].join('\n'));
  // 그 연구기간을 1월 1일 기준으로 자르면 1차년도는 아홉 달이고 그 뒤는 해마다
  assert.deepEqual(yearsOf(s.project).map((y) => [y.n, y.start, y.end]), [[1, '2026-04-01', '2026-12-31'], [2, '2027-01-01', '2027-12-31'], [3, '2028-01-01', '2028-12-31'], [4, '2029-01-01', '2029-12-31']]);
});
t('연차별기간이 있으면 그것으로, 책임자는 KR연구책임자로도, 과제번호는 표지에서도', () => {
  const s = readSnapshot({
    meta: {
      과제명: 'X', 차년도: '3차년도', KR연구책임자: '박기도', 기간: '2024-07-01 ~ 2027-12-31',
      연차별기간: { '1차년도': '2024-07-01 ~ 2024-12-31', '2차년도': '2025-01-01 ~ 2025-12-31', '3차년도': '2026-01-01 ~ 2026-12-31', '4차년도': '2027-01-01 ~ 2027-12-31' },
      표지: { 연구개발과제번호: 'RS-2024-1', 사업명: '소재부품기술개발사업', 주관연구개발기관: { 기관명: 'HD조선' } },
    },
    예산: { 단위: '천원', 비목별: [{ 연차: '3차년도', 직접비: { 인건비: 70270, 연구시설장비비: 0, 연구재료비: 31376, 소계: 1 }, 간접비: 32854, 총액: 200000 }] },
  });
  assert.equal(s.n, 3);
  assert.deepEqual([s.project.lead, s.project.code, s.project.calendar, s.project.start, s.project.end, s.project.note], ['박기도', 'RS-2024-1', true, '2024-07-01', '2027-12-31', '소재부품기술개발사업 · 주관 HD조선']);
  assert.deepEqual(s.budget, [{ item: '인건비', plan: 70270000 }, { item: '연구재료비', plan: 31376000 }, { item: '간접비', plan: 32854000 }]);
  assert.equal(s.plan, null);
  assert.equal(s.roster, null);
  assert.equal(s.date, '');
});
t('협약일 기준 과제(3월 말에 끝남)는 시작일부터 한 해씩, 단위가 원이면 그대로, 차년도를 모르면 1', () => {
  const s = readSnapshot({ meta: { 과제명: 'Y', 기간: '2026-04-01 ~ 2029-03-31' }, 예산: { 단위: '원', 비목별: [{ 연차: 1, 직접비: { 인건비: 1234 } }] } });
  assert.equal(s.project.calendar, false);
  assert.equal(s.n, 1);
  assert.deepEqual(s.budget, [{ item: '인건비', plan: 1234 }]);
});

console.log('장부에 넣기 — 스냅샷');
{
  const book = normalizeBook(null);
  t('처음 넣으면 과제를 만들고 1차년도 예산·계획·참여연구자가 들어가며 변경이력은 없다(기준선)', () => {
    const rep = applySnapshot(book, readSnapshot(r0), { today: TODAY, header: headerOf(fx('snapshot_r0.yaml')), file: 'snapshot_r0.yaml' });
    assert.ok(rep.created);
    assert.equal(rep.n, 1);
    assert.equal(rep.budget, 4);
    assert.deepEqual(rep.logs, ['연구개발 계획 — 1차년도 넣음', '참여연구자 — 1차년도 넣음']);
    assert.deepEqual(rep.changes, []);
    const p = book.projects[0];
    assert.equal(rep.project, p);
    assert.deepEqual([p.code, p.lead, p.start, p.end, p.calendar], ['RS-2026-00000001', '홍길동', '2026-04-01', '2029-12-31', true]);
    assert.equal(book.current.project, p.id);
    assert.equal(book.current.year[p.id], 1);
    const y = p.years[1];
    assert.deepEqual(y.budget.map((r) => [r.item, r.plan]), [['인건비', 30000000], ['연구시설·장비비', null], ['연구재료비', null], ['연구활동비', 50000000], ['연구수당', 6000000], ['간접비', 20000000]]);
    assert.deepEqual(y.logs.map((l) => [l.key, l.date, l.title]), [['plan', '2026-05-22', '연구개발 계획 — 1차년도'], ['roster', '2026-05-22', '참여연구자 — 1차년도']]);
    assert.deepEqual(y.changes, []);
    assert.deepEqual(y.snapshot, { rev: 'r0', date: TODAY, file: 'snapshot_r0.yaml', items: ['인건비', '연구활동비', '연구수당', '간접비'] });
  });
  t('같은 파일을 다시 넣어도 달라질 것 없다', () => {
    const rep = applySnapshot(book, readSnapshot(r0), { today: TODAY, header: headerOf(fx('snapshot_r0.yaml')) });
    assert.ok(!rep.created);
    assert.deepEqual([rep.logs, rep.changes], [[], []]);
    assert.equal(book.projects.length, 1);
    assert.equal(book.projects[0].years[1].logs.length, 2);
  });
  t('r2 재생성본을 넣으면 달라진 비목·참여연구자가 변경이력에 — 사유는 머리의 변경분', () => {
    const rep = applySnapshot(book, readSnapshot(parse(fx('snapshot_r2.yaml'))), { today: TODAY, header: headerOf(fx('snapshot_r2.yaml')), file: 'snapshot_r2.yaml' });
    const y = book.projects[0].years[1];
    assert.deepEqual(y.budget.map((r) => [r.item, r.plan]), [['인건비', 30000000], ['연구시설·장비비', 10000000], ['연구재료비', null], ['연구활동비', 40000000], ['연구수당', 6000000], ['간접비', 20000000]]);
    const reason = '예산.참여연구자인건비(r1: 이몽룡 제외·홍길동·성춘향 재배분) + 예산.비목별[1차년도](r2: 연구활동비→연구시설·장비비 10,000 재배분·총액 불변)';
    assert.deepEqual(rep.changes.map(noId), [
      { date: TODAY, kind: '예산', item: '연구시설·장비비', before: '(없음)', after: '10,000,000원', reason, auto: false, key: 'snapshot:r2:1:연구시설장비비' },
      { date: TODAY, kind: '예산', item: '연구활동비', before: '50,000,000원', after: '40,000,000원', reason, auto: false, key: 'snapshot:r2:1:연구활동비' },
      { date: TODAY, kind: '연구진', item: '참여연구자', before: '이몽룡 15% · 홍길동 20% · 성춘향 10%', after: '홍길동 27.45% · 성춘향 20%', reason, auto: false, key: 'snapshot:r2:1:roster' },
    ]);
    assert.deepEqual(rep.logs, ['참여연구자 — 1차년도 고침']);
    assert.equal(y.changes.length, 3);
    assert.equal(y.logs.find((l) => l.key === 'roster').text, '홍길동 — 수석 · 27.45% · 9개월 · 인건비 20,900,000원\n성춘향 — 책임 · 20% · 9개월 · 인건비 9,100,000원');
    assert.equal(y.logs.find((l) => l.key === 'plan').text.split('\n')[1], '1. 규정 공백 분석 및 평가 기준 도출', '계획은 그대로');
    assert.equal(y.snapshot.rev, 'r2');
  });
  t('r0 를 다시 넣으면(되돌림) 빠진 비목은 비워지고 그것도 변경이력에', () => {
    const rep = applySnapshot(book, readSnapshot(r0), { today: TODAY, header: headerOf(fx('snapshot_r0.yaml')) });
    assert.deepEqual(rep.changes.map((c) => [c.item, c.before, c.after, c.reason]), [
      ['연구활동비', '40,000,000원', '50,000,000원', 'r0 스냅샷 반영'],
      ['연구시설·장비비', '10,000,000원', '(비목 뺌)', 'r0 스냅샷 반영'],
      ['참여연구자', '홍길동 27.45% · 성춘향 20%', '이몽룡 15% · 홍길동 20% · 성춘향 10%', 'r0 스냅샷 반영'],
    ]);
    assert.equal(book.projects[0].years[1].budget.find((r) => r.item === '연구시설·장비비').plan, null);
  });
  t('계획의 목표가 바뀐 재생성본 — 연구내용 변경이력에 전·후 목표', () => {
    const obj = parse(fx('snapshot_r0.yaml'));
    obj.meta.rev = 'r3';
    obj.연구개발내용.목표[0].개발목표[1] = '용어 사전 편찬';
    const rep = applySnapshot(book, readSnapshot(obj), { today: TODAY });
    assert.deepEqual(rep.changes.map((c) => [c.kind, c.item, c.before, c.after, c.reason]), [['연구내용', '연구개발 계획', '규정 공백 분석 및 평가 기준 도출 / 용어 분류 체계 설계', '규정 공백 분석 및 평가 기준 도출 / 용어 사전 편찬', 'r3 스냅샷 반영']]);
    assert.deepEqual(rep.logs, ['연구개발 계획 — 1차년도 고침']);
    obj.연구개발내용.목표[0].개발내용[0].세부.push('한 줄 더');
    const rep2 = applySnapshot(book, readSnapshot(obj), { today: TODAY });
    assert.deepEqual(rep2.changes.map((c) => [c.before, c.after]), [['(세부 내용)', '(세부 내용 갱신)']]);
  });
  t('손으로 적은 계획이 있는 과제에 처음 넣으면 그 줄만 변경이력에, 집행은 그대로, 빈 칸은 채움', () => {
    const b2 = normalizeBook({ projects: [{ id: 'x', name: '시험용 직류 차단기 개발', years: { 1: { budget: [{ id: 'a', item: '인건비', plan: 1000000, used: 200000 }] } } }] });
    const rep = applySnapshot(b2, readSnapshot(r0), { today: TODAY });
    assert.ok(!rep.created);
    const p = b2.projects[0];
    assert.deepEqual([p.id, p.code, p.lead, p.start, p.calendar], ['x', 'RS-2026-00000001', '홍길동', '2026-04-01', true]);
    assert.deepEqual(rep.changes.map((c) => [c.kind, c.item, c.before, c.after]), [['예산', '인건비', '1,000,000원', '30,000,000원']]);
    const y = p.years[1];
    assert.equal(y.budget.find((r) => r.item === '인건비').used, 200000);
    assert.deepEqual(y.budget.map((r) => r.item), ['인건비', '연구활동비', '연구수당', '간접비']);
  });
  t('책임자·연구기간이 적혀 있던 과제에 넣으면 달라진 것이 변경이력에 — 과제번호로 찾는다', () => {
    const b3 = normalizeBook({ projects: [{ id: 'x', name: '다른 이름', code: 'rs-2026-00000001', lead: '임꺽정', start: '2026-04-01', end: '2029-03-31' }] });
    const rep = applySnapshot(b3, readSnapshot(r0), { today: TODAY });
    assert.ok(!rep.created);
    assert.equal(b3.projects[0].lead, '임꺽정', '있는 책임자는 안 바꾼다');
    assert.deepEqual(rep.changes.map((c) => [c.kind, c.item, c.before, c.after]), [
      ['연구기간', '연구기간', '2026.04.01 ~ 2029.03.31', '2026.04.01 ~ 2029.12.31'], ['연구기간', '차년도 끊는 기준', '시작일부터 한 해씩', '1월 1일(첫 해는 시작일부터 12월 31일까지)'],
    ]);
  });
  t('과제가 열 개 차 있으면 넣지 못한다 · 과제명 없는 스냅샷도', () => {
    const full = normalizeBook({ projects: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `과제 ${i}` })) });
    assert.throws(() => applySnapshot(full, readSnapshot(r0)), /10개까지/);
    assert.throws(() => applySnapshot(book, readSnapshot({ meta: {} })), /과제명/);
  });
  t('findProject — 과제번호(둘 다 있을 때)가 먼저, 아니면 과제명', () => {
    const b = normalizeBook({ projects: [{ id: 'a', name: 'A', code: 'C-1' }, { id: 'b', name: 'B' }] });
    assert.equal(findProject(b, { code: 'c-1', name: '다른' }).id, 'a');
    assert.equal(findProject(b, { code: 'C-9', name: 'B' }).id, 'b');
    assert.equal(findProject(b, { name: 'b' }).id, 'b');
    assert.equal(findProject(b, { code: 'C-9', name: 'A' }), null, '번호가 다르면 이름이 같아도 다른 과제');
  });
}

console.log('장부에 넣기 — 이력 파일');
{
  const book = normalizeBook(null);
  applySnapshot(book, readSnapshot(r0), { today: TODAY });
  const p = book.projects[0];
  t('개정 레지스트리 — rev 마다 한 줄, 검토중은 사유에 붙고, 다시 넣으면 고치기만', () => {
    const rep = applyRevisions(book, parse(fx('revisions.yaml')), { project: p, today: TODAY });
    assert.deepEqual(rep, { n: 1, added: 3, updated: 0 });
    assert.deepEqual(p.years[1].changes.map((c) => [c.date, c.kind, c.item, c.reason, c.key, c.auto]), [
      ['2026-05-22', '기타', 'r0 최초협약', '최초 기준선', 'rev:r0', false],
      ['2026-06-29', '연구진', 'r1 연차변경', '이몽룡 수석 하차·잔여 인건비를 홍길동·성춘향이 흡수', 'rev:r1', false],
      ['2026-07-15', '예산', 'r2 계획수정', '연구활동비→연구시설·장비비 10,000 재배분(총액 불변) (검토중)', 'rev:r2', false],
    ]);
    const again = applyRevisions(book, parse(fx('revisions.yaml').replace('status: 검토중', 'status: 확정')), { project: p, today: TODAY });
    assert.deepEqual(again, { n: 1, added: 0, updated: 1 });
    assert.equal(p.years[1].changes[2].reason, '연구활동비→연구시설·장비비 10,000 재배분(총액 불변)');
    assert.equal(p.years[1].changes.length, 3);
  });
  t('예산 이력 — 이웃 rev 사이를 한 줄로(날짜는 레지스트리의 것), 현재 금액은 계획으로, 다시 넣어도 겹치지 않는다', () => {
    const rep = applyBudgetHistory(book, parse(fx('budget_history.yaml')), { project: p, today: TODAY });
    assert.deepEqual(rep, { n: 1, added: 2, updated: 0, budget: 5 });
    const y = p.years[1];
    assert.deepEqual(y.changes.slice(3).map(noId), [
      { date: '2026-07-15', kind: '예산', item: '연구시설·장비비', before: '0원', after: '10,000,000원', reason: '연구활동비→연구시설·장비비 10,000 재배분', auto: false, key: 'budget:r2:연구시설장비비' },
      { date: '2026-07-15', kind: '예산', item: '연구활동비', before: '50,000,000원', after: '40,000,000원', reason: '연구활동비→연구시설·장비비 10,000 재배분', auto: false, key: 'budget:r2:연구활동비' },
    ]);
    assert.deepEqual(y.budget.map((r) => [r.item, r.plan]), [['인건비', 30000000], ['연구시설·장비비', 10000000], ['연구재료비', null], ['연구활동비', 40000000], ['연구수당', 6000000], ['간접비', 20000000]]);
    assert.deepEqual(applyBudgetHistory(book, parse(fx('budget_history.yaml')), { project: p, today: TODAY }), { n: 1, added: 0, updated: 0, budget: 5 });
  });
  t('참여연구원 이력 — 참여율·인건비·제외가 달라진 사람마다 한 줄(연구진), 날짜는 레지스트리의 것', () => {
    const rep = applyResearchersHistory(book, parse(fx('researchers_history.yaml')), { project: p, today: TODAY });
    assert.deepEqual(rep, { n: 1, added: 2 });
    assert.deepEqual(p.years[1].changes.slice(5).map(noId), [
      { date: '2026-06-29', kind: '연구진', item: '이몽룡', before: '활성 · 참여율 15% · 인건비 11,250천원', after: '제외', reason: '이몽룡 수석 1차년도 참여 제외(하차)', auto: false, key: 'researchers:r1:이몽룡' },
      { date: '2026-06-29', kind: '연구진', item: '홍길동', before: '활성 · 참여율 20% · 인건비 15,000천원', after: '활성 · 참여율 27.45% · 인건비 20,900천원', reason: '이몽룡 제외분 흡수·실급여 반영', auto: false, key: 'researchers:r1:홍길동' },
    ]);
    assert.deepEqual(applyResearchersHistory(book, parse(fx('researchers_history.yaml')), { project: p, today: TODAY }), { n: 1, added: 0 });
  });
  t('과제 없이 이력 파일은 못 넣는다', () => {
    for (const fn of [applyRevisions, applyBudgetHistory, applyResearchersHistory]) assert.throws(() => fn(normalizeBook(null), parse(fx('revisions.yaml')), { project: null }), /먼저 그 과제의 스냅샷/);
  });
}

console.log('한 번에 — applyYaml');
{
  const book = normalizeBook(null);
  t('스냅샷 → 레지스트리(주석의 과제명으로 찾음) → r2 스냅샷 → 예산 이력(같은 변경에는 사유만 붙임) → 참여연구원 이력', () => {
    const a = applyYaml(book, parse(fx('snapshot_r0.yaml')), { text: fx('snapshot_r0.yaml'), file: 'KR_test.yaml', today: TODAY });
    assert.equal(a.kind, 'snapshot');
    assert.equal(a.summary, '과제 만듦: 시험용 직류 차단기 개발 · 1차년도 · 비목 4개 · 연구개발 계획 — 1차년도 넣음 · 참여연구자 — 1차년도 넣음');
    const b = applyYaml(book, parse(fx('revisions.yaml')), { text: fx('revisions.yaml'), current: null, today: TODAY });
    assert.equal(b.summary, '시험용 직류 차단기 개발 1차년도 · 변경이력 3건 넣음');
    const c = applyYaml(book, parse(fx('snapshot_r2.yaml')), { text: fx('snapshot_r2.yaml'), file: 'KR_test_r2.yaml', today: TODAY });
    assert.equal(c.summary, '과제 찾음: 시험용 직류 차단기 개발 · 1차년도 · 비목 5개 · 참여연구자 — 1차년도 고침 · 변경이력 3건');
    const d = applyYaml(book, parse(fx('budget_history.yaml')), { current: book.projects[0], today: TODAY });
    assert.equal(d.summary, '시험용 직류 차단기 개발 1차년도 · 변경이력 0건 넣음 · 2건에 사유 붙임 · 비목 5개');
    const y = book.projects[0].years[1];
    const up = y.changes.filter((ch) => ch.key?.startsWith('budget:'));
    assert.deepEqual(up.map((ch) => [ch.item, ch.before, ch.after, ch.reason, ch.date]), [
      ['연구시설·장비비', '(없음)', '10,000,000원', '연구활동비→연구시설·장비비 10,000 재배분', '2026-07-15'],
      ['연구활동비', '50,000,000원', '40,000,000원', '연구활동비→연구시설·장비비 10,000 재배분', '2026-07-15'],
    ]);
    const e = applyYaml(book, parse(fx('researchers_history.yaml')), { current: book.projects[0], today: TODAY });
    assert.equal(e.label, '참여연구원 이력');
    assert.equal(y.changes.length, 3 + 3 + 2);
    assert.throws(() => applyYaml(book, { foo: 1 }), /아는 모양의 YAML/);
    assert.throws(() => applyYaml(normalizeBook(null), parse(fx('budget_history.yaml')), { current: null }), /먼저 그 과제의 스냅샷/);
  });
}

console.log(`\n${pass} passed`);
