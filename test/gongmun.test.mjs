// 공문(전자결재 품의) 작성의 순수 로직 — src/gongmun.js. 틀 채우기·조사·한도·결재선·공문 설정 채우기를 못 박는다.
// 화면 쪽(탭 전환·채팅·한도 차단·새 공문 열기)은 test/wiring.test.mjs 의 "공문 탭" 이 본다.
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  delegationOf, docSettingOf, settingText, writePlan,
} from '../src/gongmun.js';
import { readRecipe, checkRecipe, render as renderRecipe, build as buildRecipe } from '../tools/gen-gongmun.mjs';
import {
  KINDS, KIND_ORDER, FORMS, DEFAULT_TEMPLATES, MAX_PROJECTS, PURCHASE_LIMIT, FIELDS, VARS, varsFor,
  templateOf, templateEdited, templatePatch, normalizePreset, normalizeProjects, namesOf, josa, hasBatchim, fillTemplate,
  totalOf, gistOf, fromRecord, blankDraft, overLimit, approvalLine, lineText, compose, needs, bodyHtml, draftUrl, attachName,
  moneyOf, won, dotDate, summaryOf, parseSetupLocal, mergeSetup, attachList, attachBlock, mergeDraft, applyReason, reasonInput, REASON_KEYS,
  eduModeOf, EDU_MODES, spreadParts, attachWithCut, rndContent, rndProjects, OUTSIDE_TYPES, outsideTypeOf, REASON_LABEL, missingDocs, moreLead,
  normalizeRndExtra, sameProject,
} from '../src/gongmun.js';
import { normalizeBook } from '../src/rnd.js';
import { structure, systemPrompt, promptOf, InputError } from '../src/input.js';
import { checkSpec } from '../tools/gen-input.mjs';
import { TASKS } from '../src/input.js';
import { INPUT_SPEC } from '../src/inputspec.js';
import { DOC_NAMES, whoOf } from '../src/gongmun.js';
import { gongmunInput, gongmunSetupSmart } from '../src/llm.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const PRESET = { dept: '연구본부 수소전기추진연구팀', head: '노길태', refs: '홍길동, 이몽룡' };
const PROJECT = { name: 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발', code: 'RND-20-2026', lead: '박기도', about: '', account: '' };
const CTX = { me: '김거화', preset: PRESET, project: PROJECT, today: '2026-10-07' };

console.log('갈래와 양식');
t('갈래는 구매·교육·출장·외부활동 넷이고 넷 다 문서를 넣어 읽는다(2026-10-08 사용자 지정)', () => {
  assert.deepEqual(KIND_ORDER, ['purchase', 'edu', 'trip', 'outside']);
  assert.deepEqual(KIND_ORDER.map((k) => KINDS[k].label), ['구매', '교육', '출장', '외부활동']);
  for (const k of KIND_ORDER) assert.ok(KINDS[k].doc && KINDS[k].ask && KINDS[k].more, `${k} 에 문서 넣는 곳의 말`);
  assert.equal(KINDS.trip.ask, '행사·회의 안내문이나 초청장을 넣으세요');
  assert.deepEqual(FIELDS.trip.map((f) => f.key), ['place', 'from', 'to', 'who', 'cost', 'division', 'purpose', 'reason', 'account'], '출장 구분(국내·해외)은 위임전결을 가른다');
  assert.deepEqual(FIELDS.trip.filter((f) => f.open).map((f) => f.key), ['purpose', 'reason'], '펼쳐 두는 칸은 출장목적·출장사유');
  assert.equal(KINDS.outside.title, '외부활동 허가 신청서');
  assert.deepEqual(FIELDS.outside.map((f) => f.key), ['type', 'org', 'subject', 'from', 'to', 'hours', 'place', 'fee', 'topics', 'who', 'purpose', 'reason']);
  assert.deepEqual(FIELDS.outside.filter((f) => f.open).map((f) => f.key), ['purpose', 'reason'], '펼쳐 두는 칸은 활동목적·신청사유');
  assert.deepEqual(OUTSIDE_TYPES, ['강의', '자문', '심사·평가', '발표', '위원 활동', '집필', '기타']);
  assert.deepEqual([outsideTypeOf('lecture'), outsideTypeOf('review'), outsideTypeOf('자문'), outsideTypeOf('x'), outsideTypeOf(null)], ['강의', '심사·평가', '자문', '', '']);
});
t('구매만 100만원 한도가 있다', () => {
  assert.equal(PURCHASE_LIMIT, 1_000_000);
  assert.equal(KINDS.purchase.limit, PURCHASE_LIMIT);
  assert.equal(KINDS.edu.limit, null);
});
t('양식은 고친 것만 저장하고, 비운 칸은 기본으로 돌아간다', () => {
  const patch = templatePatch('purchase', { form: DEFAULT_TEMPLATES.purchase.form, title: '[구매] {품목요지}', body: '' });
  assert.deepEqual(patch, { title: '[구매] {품목요지}' });
  const saved = { purchase: patch };
  assert.equal(templateOf('purchase', saved).title, '[구매] {품목요지}');
  assert.equal(templateOf('purchase', saved).body, DEFAULT_TEMPLATES.purchase.body);
  assert.ok(templateEdited('purchase', saved));
  assert.ok(!templateEdited('edu', saved));
  assert.equal(templateOf('edu', saved).form, 'KR_EA_Research_Task');
});
t('eclass 양식은 본문을 붙여 넣는 것만 고른다 — 구매요청서(칸이 정해진 폼)는 없다', () => {
  assert.deepEqual(FORMS.map((f) => f.id), ['KR_EA_Research_Task', 'KR_EA_Form2']);
});

console.log('틀 채우기');
t('받침에 맞는 조사 — 모르면 둘 다', () => {
  assert.equal(josa('수소전기추진연구팀', '은'), '수소전기추진연구팀은');
  assert.equal(josa('모니터', '을'), '모니터를');
  assert.equal(josa('모니터 외 1건', '를'), '모니터 외 1건을');
  assert.equal(josa('34인치 모니터 (U3425WE)', '을'), '34인치 모니터 (U3425WE)를', '끝의 괄호는 건너뛴다');
  assert.equal(josa('U3425WE', '을'), 'U3425WE을(를)');
  assert.equal(josa('서울', '으로'), '서울로', 'ㄹ 받침 뒤는 로');
  assert.equal(josa('부산', '로'), '부산으로');
  assert.equal(hasBatchim('3'), true);
  assert.equal(hasBatchim('2'), false);
});
t('{이름} 은 값, 비면 [이름] 으로 남기고 알린다 · {이름?} 줄은 비면 뺀다 · 모르는 이름은 그대로', () => {
  const tpl = '제목 {가}\n- 사양 : {나?}\n- 금액 : {다}\n{모름}';
  const out = fillTemplate(tpl, { 가: '모니터', 나: '', 다: '' });
  assert.equal(out.text, '제목 모니터\n- 금액 : [다]\n{모름}');
  assert.deepEqual(out.missing, ['다']);
});
t('{{#목록}} 은 줄마다 되풀이하고 번호를 매긴다 — 빠지는 줄은 그 항목 안에서만 빠진다', () => {
  const tpl = '가.\n{{#품목}}\n  ({번호}) {품목명}\n    - 금액 : {금액?}\n{{/품목}}끝';
  const out = fillTemplate(tpl, {}, { 품목: [{ 품목명: 'A', 금액: '1원' }, { 품목명: 'B', 금액: '' }] });
  assert.equal(out.text, '가.\n  (1) A\n    - 금액 : 1원\n  (2) B\n끝');
  assert.equal(fillTemplate('{{#품목}}\n{없음?}\n{{/품목}}끝', {}, { 품목: [{ 없음: '' }] }).text, '끝', '줄이 다 빠진 항목은 빈 줄도 남기지 않는다');
});

console.log('읽은 문서 → 초안');
t('합계는 최종 금액 → 공급가액+부가세 → 품목 금액 합(알림) 순이다', () => {
  assert.deepEqual(totalOf({ total: 989000, supply: 1, vat: 1 }), { total: 989000, note: '' });
  assert.deepEqual(totalOf({ supply: 900000, vat: 90000 }), { total: 990000, note: '' });
  assert.equal(totalOf({ items: [{ amount: 100 }, { amount: 200 }] }).total, 300);
  assert.match(totalOf({ items: [{ amount: 100 }, { amount: 200 }] }).note, /부가세/);
  assert.equal(totalOf({ items: [{ amount: 100 }, { name: 'x' }] }).total, null, '금액이 빠진 줄이 있으면 더하지 않는다');
});
t('구매 — 품목 요지와 요약("…을 구매하고자")을 만든다', () => {
  const { draft, notes } = fromRecord('purchase', {
    docType: 'quote', vendor: 'OO상사', quoteDate: '2026-10-01', total: 989000, gist: null,
    items: [{ name: '34인치 모니터', spec: 'WQHD', qty: 1, unit: '대', amount: 890000 }, { name: '모니터암', qty: 1, amount: 99000 }],
  });
  assert.equal(draft.gist, '34인치 모니터 외 1건');
  assert.equal(draft.summary, '34인치 모니터 외 1건을 구매하고자');
  assert.equal(draft.total, 989000);
  assert.deepEqual(notes, []);
  assert.equal(gistOf([], '대체'), '대체');
  assert.equal(summaryOf(''), '');
});
t('교육 — 교육명·기간·교육비, 참석자는 나', () => {
  const { draft } = fromRecord('edu', { docType: 'course', provider: '한국전력기술교육원', course: '전력변환 설계 실무', from: '2026-10-12', to: '2026-10-14', fee: 450000 }, { me: '김거화' });
  assert.deepEqual([draft.course, draft.provider, draft.from, draft.to, draft.fee, draft.attendees], ['전력변환 설계 실무', '한국전력기술교육원', '2026-10-12', '2026-10-14', 450000, '김거화']);
});
t('외화 문서는 원화로 고쳐 달라고 알린다', () => {
  assert.match(fromRecord('purchase', { currency: 'USD', total: 500 }).notes.join(), /USD/);
});

console.log('한도');
t('100만원 이하만 작성 — 딱 100만원은 된다', () => {
  assert.equal(overLimit('purchase', { total: 1_000_000 }).over, false);
  assert.equal(overLimit('purchase', { total: 1_000_001 }).over, true);
  assert.equal(overLimit('purchase', { total: '1,239,000' }).over, true, '쉼표 글도 읽는다');
});
t('합계를 모르거나 원화가 아니면 가리지 못한다(unknown) — 화면이 막는다', () => {
  assert.deepEqual(overLimit('purchase', { total: null }), { over: false, unknown: true, limit: PURCHASE_LIMIT, amount: null });
  assert.equal(overLimit('purchase', { total: 500, currency: 'USD' }).unknown, true);
});
t('교육은 한도가 없다', () => assert.deepEqual(overLimit('edu', { fee: 5_000_000 }), { over: false, unknown: false, limit: null, amount: 5_000_000 }));

console.log('결재선');
t('기안자 → 합의자(과제책임자) → 결재자(부서장) · 참조자', () => {
  const line = approvalLine(CTX);
  assert.deepEqual(line.steps, [
    { role: '기안', name: '김거화' }, { role: '합의', name: '박기도', why: '과제책임자' }, { role: '결재', name: '노길태', why: '부서장' },
  ]);
  assert.deepEqual(line.refs, ['홍길동', '이몽룡']);
  assert.equal(lineText(line), '기안자 김거화 → 합의자 박기도 → 결재자 노길태 · 참조자 홍길동, 이몽룡');
});
t('과제책임자가 기안자 본인이면 합의는 뺀다 — 본인이 아니면 부서장이어도 합의자다(2026-10-08 사용자 지정)', () => {
  const mine = approvalLine({ ...CTX, project: { ...PROJECT, lead: '김거화' } });
  assert.deepEqual(mine.steps.map((s) => s.role), ['기안', '결재']);
  assert.match(mine.notes[0], /기안자라 합의는 뺐습니다/);
  const head = approvalLine({ ...CTX, project: { ...PROJECT, lead: '노 길태' } });
  assert.deepEqual(head.steps.map((s) => `${s.role} ${s.name}`), ['기안 김거화', '합의 노 길태', '결재 노길태']);
  assert.match(head.notes[0], /부서장이라 합의와 결재가 같은 사람/);
  assert.deepEqual(approvalLine({ ...CTX, project: { ...PROJECT, lead: '' } }).steps.map((s) => s.role), ['기안', '결재'], '책임자를 모르면 합의 자리가 빈다 — 화면이 채우라고 보인다');
});
t('결재선에 이미 있는 사람은 참조에서 뺀다', () => {
  assert.deepEqual(approvalLine({ ...CTX, preset: { ...PRESET, refs: '박기도, 홍길동' } }).refs, ['홍길동']);
});

console.log('공문 만들기');
t('구매 — 기본 양식의 첫 줄·요약·품목·합계·계정·첨부', () => {
  const draft = { ...fromRecord('purchase', { total: 989000, items: [{ name: '34인치 모니터', spec: 'WQHD · 커브드', qty: 1, unit: '대', amount: 890000 }, { name: '모니터암', amount: 99000 }] }).draft, vendor: 'OO상사', use: '회의 자료 검토용', reason: '대화면 필요' };
  const c = compose('purchase', draft, CTX);
  assert.equal(c.title, '34인치 모니터 외 1건 구매 품의');
  assert.equal(c.form, 'KR_EA_Research_Task');
  const lines = c.body.split('\n');
  assert.equal(lines[0], `1. 연구본부 수소전기추진연구팀은 「${PROJECT.name}」 과제를 수행하고 있습니다.`);
  assert.equal(lines[1], '2. 이와 관련하여 34인치 모니터 외 1건을 구매하고자 아래와 같이 품의하오니 재가하여 주시기 바랍니다.');
  assert.ok(lines.includes('------------ 아   래 ------------'));
  assert.ok(lines.includes('    (1) 구매품 : 34인치 모니터'));
  assert.ok(lines.includes('        - 수량 : 1대'));
  assert.ok(lines.includes('    (2) 구매품 : 모니터암'));
  assert.ok(!lines.some((l) => /\[사양\]|\[수량\]/.test(l)), '빠져도 되는 칸은 줄째 빠진다');
  assert.ok(lines.includes('나. 구매금액 : 989,000원 (VAT 포함)'));
  assert.ok(lines.includes('라. 구매계정 : 연구활동비(연구실운용비)'));
  assert.equal(lines.at(-1), '    1. 견적서 1부.  끝.');
  assert.deepEqual(c.missing, []);
});
t('과제 개요·계정을 적어 두면 그것을 쓴다', () => {
  const c = compose('purchase', blankDraft('purchase'), { ...CTX, project: { ...PROJECT, about: '친환경 선박용 MVDC 차단기 개발을 수행하고 있습니다', account: '연구재료비' } });
  assert.match(c.body, /^1\. 연구본부 수소전기추진연구팀은 친환경 선박용 MVDC 차단기 개발을 수행하고 있습니다\./);
  assert.match(c.body, /라\. 구매계정 : 연구재료비\n마\. 용도 : \[용도\]/);
  assert.match(c.body, /구매계정 : 연구재료비/);
  assert.deepEqual(c.missing.sort(), ['구매사유', '업체', '요약', '용도', '품목요지', '합계'].sort());
});
const EDU_REC = { course: '전력변환 설계 실무', provider: '교육원', from: '2026-10-12', to: '2026-10-14', fee: 450000, purpose: '전력변환 설계 역량 강화' };
const FULL = { ...PROJECT, alias: '차단기 과제', period: '2026.04.01 ~ 2029.12.31' };
t('교육 — 제목은 "[과제 별명] 수행을 위한 교육 품의", 본문은 가. 과제 개요 · 나. 교육 내용(기간은 며칠인지까지)', () => {
  const { draft } = fromRecord('edu', EDU_REC, { me: '김거화' });
  assert.equal(draft.mode, '교육', '교육장소가 온라인이 아니면 교육');
  const c = compose('edu', draft, { ...CTX, project: FULL });
  assert.equal(c.title, '차단기 과제 수행을 위한 교육 품의');
  assert.match(c.body, /전력변환 설계 역량 강화를 위하여 아래와 같이 교육에 참가하고자/);
  assert.match(c.body, new RegExp(`가\\. 과제 개요\n {4}\\(1\\) 과 제 명 : ${PROJECT.name}\n {4}\\(2\\) 과제번호 : RND-20-2026\n`
    + ' {4}\\(3\\) 연구기간 : 2026\\.04\\.01 ~ 2029\\.12\\.31\n {4}\\(4\\) 과제책임자 : 박기도\n나\\. 교육 내용\n {4}\\(1\\) 교 육 명 : 전력변환 설계 실무\n'));
  assert.match(c.body, / {4}\(3\) 교육기간 : 2026\. 10\. 12\. ~ 2026\. 10\. 14\. \(3일\)/);
  // 교육시간·교육내용이 없어 그 줄이 빠져도 (1)·(2)… 는 이어진다({세부차례}).
  assert.match(c.body, /\(4\) 교육장소 : \[교육장소\]\n {4}\(5\) 참 석 자 : 김거화\n {4}\(6\) 교 육 비 : 450,000원 \(VAT 포함\)/);
  assert.match(c.body, /\(7\) 예산계정 : 연구활동비\(교육훈련비\)\n {4}\(8\) 교육사유 : \[교육사유\]/);
  assert.ok(!/교육시간|교육내용/.test(c.body), '교육시간·교육내용이 없으면 그 줄을 뺀다');
  assert.match(c.body, /※ 첨 부\n {4}1\. 교육 견적서 1부\.\n {4}2\. 교육 내용 1부\.  끝\.$/, '문서 없이 써도 교육 견적서·교육 내용 두 줄');
});
t('교육 — 온라인이면 "… 수행을 위한 온라인교육 품의", 고른 교육 구분이 이긴다', () => {
  const { draft } = fromRecord('edu', { ...EDU_REC, provider: '인프런', place: '온라인' }, { me: '김거화' });
  assert.equal(draft.mode, '온라인교육');
  const c = compose('edu', draft, { ...CTX, project: FULL });
  assert.equal(c.title, '차단기 과제 수행을 위한 온라인교육 품의');
  assert.match(c.body, /아래와 같이 온라인교육에 참가하고자/);
  assert.equal(compose('edu', { ...draft, mode: '교육' }, { ...CTX, project: FULL }).title, '차단기 과제 수행을 위한 교육 품의', '칸에서 고르면 그것');
  assert.deepEqual(EDU_MODES, ['교육', '온라인교육']);
  assert.equal(eduModeOf({ place: '서울 본사 교육장', provider: '한국전력기술교육원' }), '교육');
  assert.equal(eduModeOf({ place: '', provider: 'Udemy' }), '온라인교육', '온라인 강의 사이트면 장소가 비어도 온라인');
  assert.equal(eduModeOf({ place: '실시간 비대면(Zoom)' }), '온라인교육');
});
t('교육 — 별명이 없으면 제목에 과제명, 번호·기간이 없으면 과제 개요의 그 줄이 빠지고 (1)(2)… 는 이어진다', () => {
  const c = compose('edu', fromRecord('edu', EDU_REC).draft, { ...CTX, project: { ...PROJECT, code: '' } });
  assert.equal(c.title, `${PROJECT.name} 수행을 위한 교육 품의`);
  assert.match(c.body, /가\. 과제 개요\n {4}\(1\) 과 제 명 : .+\n {4}\(2\) 과제책임자 : 박기도\n나\. 교육 내용/);
  const none = compose('edu', fromRecord('edu', EDU_REC).draft, { ...CTX, project: null });
  assert.equal(none.title, '[과제별명] 수행을 위한 교육 품의', '과제를 고르지 않으면 눈에 띄게 남는다');
  assert.ok(none.missing.includes('과제별명'));
});
const TRIP_REC = { docType: 'event', place: '부산(한국선급 본사)', from: '2026-10-20', to: '2026-10-21', cost: 300000, purpose: '실증 시험 참관', summary: '실증 시험 참관 안내' };
t('출장 — 행사 안내문에서 출장지·기간·목적·예상경비를 읽고, 제목은 "[과제 별명] 수행을 위한 출장 품의", 본문에 과제 개요·출장 내용·첨부', () => {
  assert.equal(DEFAULT_TEMPLATES.trip.title, '{과제별명} 수행을 위한 출장 품의');
  const { draft, notes } = fromRecord('trip', TRIP_REC, { me: '김거화' });
  assert.deepEqual([draft.place, draft.from, draft.to, draft.who, draft.purpose, draft.cost, notes], ['부산(한국선급 본사)', '2026-10-20', '2026-10-21', '김거화', '실증 시험 참관', 300000, []]);
  // 목적이 문서에 없으면 행사명으로 "○○ 참석" 처럼 쓰는 것은 읽기 지시문(레시피 trip/purpose.yaml 의 purpose read)이 한다.
  assert.match(systemPrompt('gongmun.trip'), /- purpose \(글 또는 null\): [^\n]*없으면 행사·회의명으로 "○○ 참석"/);
  assert.equal(fromRecord('trip', { ...TRIP_REC, purpose: null }).draft.purpose, '', '못 읽었으면 비어 남은 것에 뜬다');
  const c = compose('trip', { ...draft, reason: '과제의 실증 시험 결과 확인에 필요함' }, { ...CTX, project: FULL });
  assert.equal(c.title, '차단기 과제 수행을 위한 출장 품의');
  assert.match(c.body, /가\. 과제 개요\n[\s\S]*나\. 출장 내용\n {4}\(1\) 출 장 지 : 부산\(한국선급 본사\)\n {4}\(2\) 출장기간 : 2026\. 10\. 20\. ~ 2026\. 10\. 21\. \(2일\)\n {4}\(3\) 출 장 자 : 김거화/);
  assert.match(c.body, /\(4\) 출장목적 : 실증 시험 참관\n {4}\(5\) 출장사유 : 과제의 실증 시험 결과 확인에 필요함\n {4}\(6\) 예상경비 : 300,000원\n {4}\(7\) 예산계정 : 연구활동비\(국내여비\)\n\n※ 첨 부\n {4}1\. 행사 안내문 1부\.  끝\.$/);
});
const OUTSIDE_REC = {
  docType: 'request', org: '부산대학교 조선해양공학과', subject: 'MVDC 차단기 기술 특강', type: '강의', from: '2026-11-05', to: '2026-11-05',
  hours: '14:00~16:00 (2시간)', place: '부산대학교 공학관', topics: 'MVDC 차단기 개요 · 시험 결과', fee: 300000, purpose: '연구 성과 확산', summary: '특강 요청 공문',
  parts: [{ file: '요청.png', kind: 'request' }],
};
t('외부활동 — 요청 공문에서 요청 기관·활동명·구분·기간·시간·장소·내용·사례비를 읽고, 제목은 "[요청 기관] [구분] 외부활동 허가 신청", 본문에 과제 개요·외부활동 내용·첨부', () => {
  assert.equal(DEFAULT_TEMPLATES.outside.title, '{요청기관} {활동구분} 외부활동 허가 신청');
  const { draft, notes } = fromRecord('outside', OUTSIDE_REC, { me: '김거화', files: ['요청.png'] });
  assert.deepEqual([draft.type, draft.org, draft.subject, draft.from, draft.to, draft.hours, draft.place, draft.topics, draft.who, draft.fee, draft.purpose, notes],
    ['강의', '부산대학교 조선해양공학과', 'MVDC 차단기 기술 특강', '2026-11-05', '2026-11-05', '14:00~16:00 (2시간)', '부산대학교 공학관', 'MVDC 차단기 개요 · 시험 결과', '김거화', 300000, '연구 성과 확산', []]);
  assert.deepEqual(draft.attach, [{ label: '요청 공문', files: ['요청.png'] }]);
  assert.equal(fromRecord('outside', { ...OUTSIDE_REC, type: null }).draft.type, '강의', '구분을 못 읽으면 첫 번째');
  assert.equal(fromRecord('outside', { ...OUTSIDE_REC, type: '자문' }).draft.type, '자문', '읽기는 구분을 이름 그대로 돌려준다');
  assert.equal(blankDraft('outside', { me: '김거화' }).who, '김거화');
  const c = compose('outside', { ...draft, reason: '과제 연구 성과의 확산에 필요함' }, { ...CTX, project: FULL });
  assert.equal(c.title, '부산대학교 조선해양공학과 강의 외부활동 허가 신청');
  assert.match(c.body, /^1\. 연구본부 수소전기추진연구팀은 「MW급[^\n]*\n2\. 이와 관련하여 부산대학교 조선해양공학과의 요청으로 아래와 같이 외부활동\(강의\)을 하고자 하오니 허가하여 주시기 바랍니다\./);
  assert.match(c.body, /가\. 과제 개요\n[\s\S]*나\. 외부활동 내용\n {4}\(1\) 활동구분 : 강의\n {4}\(2\) 요청기관 : 부산대학교 조선해양공학과\n {4}\(3\) 활 동 명 : MVDC 차단기 기술 특강\n {4}\(4\) 활동기간 : 2026\. 11\. 5\. \(1일\)\n {4}\(5\) 활동시간 : 14:00~16:00 \(2시간\)\n {4}\(6\) 활동장소 : 부산대학교 공학관/);
  assert.match(c.body, /\(7\) 활동내용 : MVDC 차단기 개요 · 시험 결과\n {4}\(8\) 활 동 자 : 김거화\n {4}\(9\) 사 례 비 : 300,000원\n {4}\(10\) 활동목적 : 연구 성과 확산\n {4}\(11\) 신청사유 : 과제 연구 성과의 확산에 필요함\n\n※ 첨 부\n {4}1\. 요청 공문 1부\.  끝\.$/);
  assert.ok(!c.body.includes('예산계정'), '외부활동에는 예산 계정이 없다');
  const none = compose('outside', { ...draft, fee: null, hours: '', topics: '', reason: 'r' }, { ...CTX, project: FULL }).body;
  assert.ok(!/사 례 비|활동시간|활동내용/.test(none), '사례비·시간·내용이 비면 그 줄이 빠진다');
  assert.match(none, /\(5\) 활동장소 : 부산대학교 공학관\n {4}\(6\) 활 동 자 : 김거화\n {4}\(7\) 활동목적/);
});
t('외부활동 — 남은 것·사유 쓰기 입력·첨부 이름', () => {
  assert.deepEqual(needs('outside', blankDraft('outside'), { preset: PRESET, project: FULL, projects: [FULL] }), ['요청 기관', '활동명', '활동기간', '활동장소', '활동목적', '신청사유']);
  assert.deepEqual(needs('outside', { org: 'o', subject: 's', from: '2026-11-05', place: 'p', purpose: 'u', reason: 'r' }, { preset: PRESET, project: PROJECT, projects: [PROJECT] }), [],
    '제목에 과제 별명을 쓰지 않으니 별명을 묻지 않는다');
  const text = reasonInput('outside', { type: '강의', subject: 'MVDC 차단기 기술 특강', org: '부산대학교', topics: '개요', purpose: '확산', fee: 300000 }, { ...PROJECT, content: 'MVDC 차단기 시험' });
  assert.match(text, /^품의 종류: 외부활동 허가 신청서\n/);
  assert.match(text, /품의할 것:\n외부활동: 강의 — MVDC 차단기 기술 특강\n요청 기관: 부산대학교\n활동 내용: 개요\n지금 적힌 활동목적: 확산/);
  assert.ok(!/300/.test(text), '사례비는 사유에 넣지 않는다');
  assert.deepEqual(attachList('outside', [{ file: 'a.png', kind: 'request' }, { file: 'b.png', kind: 'content' }], ['a.png', 'b.png']),
    [{ label: '요청 공문', files: ['a.png'] }, { label: '활동 자료', files: ['b.png'] }]);
  assert.equal(attachName('outside', { org: '부산대학교 조선해양공학과' }, '2026-10-08'), '요청공문_부산대학교조선해양공학과_2026-10-08.pdf');
});
t('구매 — 제목·본문은 그대로(원본에서도 과제 개요를 빼는 lean 목적)', () => {
  assert.equal(DEFAULT_TEMPLATES.purchase.title, '{품목요지} 구매 품의');
  assert.ok(!DEFAULT_TEMPLATES.purchase.body.includes('과제 개요'));
});
t('남은 것 — 과제·부서장·합의자·용도·구매사유', () => {
  assert.deepEqual(needs('purchase', blankDraft('purchase'), { preset: {}, project: null, projects: [] }),
    ['과제 등록(R&D 탭)', '부서장(공문 설정)', '부서(공문 설정)', '품목', '합계', '용도', '구매사유']);
  assert.deepEqual(needs('purchase', { gist: 'x', total: 1, use: 'u', reason: 'r' }, { preset: PRESET, project: { name: 'p' }, projects: [{ name: 'p' }] }), ['합의자(과제책임자)']);
});
t('남은 것 — 교육·출장은 제목에 쓸 과제 별명(구매는 묻지 않는다)', () => {
  const edu = { course: 'c', from: '2026-10-12', fee: 1, purpose: 'p', reason: 'r' };
  assert.deepEqual(needs('edu', edu, { preset: PRESET, project: PROJECT, projects: [PROJECT] }), ['과제 별명(공문 설정 — 제목)']);
  assert.deepEqual(needs('edu', edu, { preset: PRESET, project: FULL, projects: [FULL] }), []);
  assert.deepEqual(needs('trip', blankDraft('trip'), { preset: PRESET, project: FULL, projects: [FULL] }), ['출장지', '출장기간', '예상경비', '출장목적', '출장사유']);
  assert.deepEqual(needs('trip', { place: '부산', from: '2026-10-20', cost: 1, purpose: 'p', reason: 'r' }, { preset: PRESET, project: FULL, projects: [FULL] }), []);
});
t('편집기에 넣을 HTML — 줄마다 div, 들여쓰기는 &nbsp;, 빈 줄은 <br>, 아 래 줄은 가운데(SetHTMLBody 로 저장까지 남은 꼴)', () => {
  const html = bodyHtml('가. 구매\n    (1) A\n\n------------ 아   래 ------------\n<b>');
  assert.equal(html, '<div>가. 구매</div><div>&nbsp;&nbsp;&nbsp;&nbsp;(1) A</div><div><br></div>'
    + '<div style="text-align:center;">------------ 아   래 ------------</div><div>&lt;b&gt;</div>');
});
t('새 공문 주소는 loginbyname 을 거친다 — 이상한 양식 ID 는 기본 양식으로', () => {
  const doc = '/RealEANet/Main/DocumentView.aspx?FORMID=KR_EA_Form2&DOCID=&GROUPID=0&MDTID=0&DID=0&ISMODIFY=0&OLDDOC=&ATTYN=0&ALERTMAIL=0&DOCCNT=0&EXEMTD=RETMTD&ACTYPE=0';
  assert.equal(draftUrl('KR_EA_Form2'), `https://eclass.krs.co.kr/RealEANET/loginbyname.aspx?ReturnUrl=${encodeURIComponent(doc)}`);
  assert.match(decodeURIComponent(draftUrl('x"><script>')), /FORMID=KR_EA_Research_Task&/);
});
t('첨부 파일 이름', () => {
  assert.equal(attachName('purchase', { vendor: '(주) OO상사' }, '2026-10-07'), '견적서_(주)OO상사_2026-10-07.pdf');
  assert.equal(attachName('edu', { provider: '' }, '2026-10-07'), '교육견적서_2026-10-07.pdf');
  assert.equal(attachName('edu', { provider: '한국교육원' }, '2026-10-07', '교육 내용'), '교육내용_한국교육원_2026-10-07.pdf');
  assert.equal(attachName('trip', { place: '대전 (한국기계연구원)' }, '2026-10-20'), '행사안내문_대전(한국기계연구원)_2026-10-20.pdf');
});
t('작은 도우미', () => {
  assert.equal(moneyOf('1,239,000원'), 1239000);
  assert.equal(moneyOf('abc'), null);
  assert.equal(won(989000), '989,000원');
  assert.equal(dotDate('2026-10-07'), '2026. 10. 7.');
  assert.deepEqual(namesOf('홍길동, 이몽룡·홍길동\n성춘향'), ['홍길동', '이몽룡', '성춘향']);
});

console.log('첨부 — 교육 견적서와 교육 내용');
t('읽은 파일을 문서 종류로 묶는다 — 교육이면 교육 견적서·교육 내용이 한 줄씩', () => {
  const parts = [{ file: 'a.png', kind: 'quote' }, { file: 'b.png', kind: 'content' }, { file: 'c.png', kind: 'content' }];
  assert.deepEqual(attachList('edu', parts, ['a.png', 'b.png', 'c.png']), [
    { label: '교육 견적서', files: ['a.png'] }, { label: '교육 내용', files: ['b.png', 'c.png'] },
  ]);
  assert.deepEqual(attachList('purchase', [], ['x.pdf']), [{ label: '견적서', files: ['x.pdf'] }], '종류를 모르면 갈래의 기본 문서');
  assert.deepEqual(attachList('edu'), [{ label: '교육 견적서', files: [] }, { label: '교육 내용', files: [] }], '교육은 꼭 드는 두 문서');
  assert.deepEqual(attachList('purchase'), [{ label: '견적서', files: [] }]);
});
t('교육의 첨부는 교육 견적서·교육 내용 둘 — 안내문·강의 소개·그 밖의 장은 교육 내용, 청구서·결제 화면은 교육 견적서이고 늘 그 차례', () => {
  const parts = [{ file: '안내.png', kind: 'course' }, { file: '기타.png', kind: 'other' }, { file: '결제.png', kind: 'order' }, { file: '청구.pdf', kind: 'statement' }];
  assert.deepEqual(attachList('edu', parts, ['안내.png', '기타.png', '결제.png', '청구.pdf']), [
    { label: '교육 견적서', files: ['결제.png', '청구.pdf'] }, { label: '교육 내용', files: ['안내.png', '기타.png'] },
  ]);
  assert.deepEqual(attachList('edu', [{ file: '안내.png', kind: 'course' }], ['안내.png']), [
    { label: '교육 견적서', files: [] }, { label: '교육 내용', files: ['안내.png'] },
  ], '안내문만 읽었어도 교육 견적서 줄이 앞에 선다');
});
t('빠진 첨부 — 교육 안내문만 넣었으면 교육 견적서가 남은 것이 되고, 넣는 곳은 견적서를 넣으라고 한다', () => {
  const only = attachList('edu', [{ file: '안내.png', kind: 'course' }], ['안내.png']);
  assert.deepEqual(missingDocs('edu', only).map((d) => d.label), ['교육 견적서']);
  assert.equal(moreLead('edu', only), '교육 견적서(수강료 화면) 더 넣기');
  const quote = attachList('edu', [{ file: '견적.pdf', kind: 'quote' }], ['견적.pdf']);
  assert.equal(moreLead('edu', quote), '교육 내용(커리큘럼) 캡처 더 넣기');
  const both = attachList('edu', [{ file: '견적.pdf', kind: 'quote' }, { file: '커리큘럼.png', kind: 'content' }], ['견적.pdf', '커리큘럼.png']);
  assert.deepEqual(missingDocs('edu', both), []);
  assert.equal(moreLead('edu', both), KINDS.edu.more);
  assert.deepEqual(missingDocs('edu', attachList('edu')), [], '파일을 넣지 않았으면(손으로 쓰기·글 붙여넣기) 짚지 않는다');
  assert.deepEqual(missingDocs('purchase', attachList('purchase', [], ['x.png'])), [], '구매는 꼭 드는 문서가 없다');
  assert.equal(moreLead('purchase', []), KINDS.purchase.more);
  const draft = { course: 'c', from: '2026-10-12', fee: 1, purpose: 'p', reason: 'r', attach: only };
  assert.deepEqual(needs('edu', draft, { preset: PRESET, project: FULL, projects: [FULL] }), ['교육 견적서(첨부)']);
});
t('교육 — 온라인 강의 페이지에서 수강료 칸을 오리면 그것이 교육 견적서, 페이지 장은 교육 내용으로 남는다', () => {
  const tiles = ['인프런_1.png', '인프런_2.png', '인프런_3.png'];
  const parts = [{ file: tiles[0], kind: 'course' }, { file: tiles[1], kind: 'other' }, { file: tiles[2], kind: 'order' }];
  const cut = { name: '견적서_가격부분.png', drop: [tiles[2]], on: true };
  const { draft } = fromRecord('edu', { docType: 'course', course: '웹 해킹 입문', fee: 77000, parts }, { files: tiles, cut });
  assert.deepEqual(draft.attach, [{ label: '교육 견적서', files: ['견적서_가격부분.png'] }, { label: '교육 내용', files: tiles.slice(0, 2) }]);
  assert.match(compose('edu', draft, CTX).body, /※ 첨 부\n {4}1\. 교육 견적서 1부\.\n {4}2\. 교육 내용 1부\.  끝\.$/);
  assert.deepEqual(attachWithCut('edu', parts, tiles, { ...cut, on: false }), [
    { label: '교육 견적서', files: [tiles[2]] }, { label: '교육 내용', files: tiles.slice(0, 2) },
  ], '원래 장으로 — 결제 화면 장이 교육 견적서');
});
t('첨부 줄 — 마지막 줄에만 끝.', () => {
  assert.equal(attachBlock([{ label: '교육 견적서' }, { label: '교육 내용' }]), '    1. 교육 견적서 1부.\n    2. 교육 내용 1부.  끝.');
});
t('교육 — 견적서와 교육 내용을 함께 읽으면 교육내용 줄과 첨부 두 줄이 들어간다', () => {
  const { draft } = fromRecord('edu', {
    course: '전력변환 설계 실무', provider: '교육원', from: '2026-10-12', fee: 450000, topics: 'DC-DC 컨버터 · 제어 루프 설계',
    parts: [{ file: '견적.png', kind: 'quote' }, { file: '커리큘럼.png', kind: 'content' }],
  }, { me: '김거화', files: ['견적.png', '커리큘럼.png'] });
  const body = compose('edu', draft, CTX).body;
  assert.match(body, /교육내용 : DC-DC 컨버터 · 제어 루프 설계/);
  assert.match(body, /※ 첨 부\n {4}1\. 교육 견적서 1부\.\n {4}2\. 교육 내용 1부\.  끝\.$/);
});
t('{차례} 는 남은 줄끼리 가·나·다', () => {
  assert.equal(fillTemplate('{차례}. A\n{차례}. B {x?}\n{차례}. C', { x: '' }).text, '가. A\n나. C');
});
t('{세부차례} 는 (1)(2)… — {차례} 줄마다 새로 세고, 빠진 줄은 건너뛴다', () => {
  const tpl = '{차례}. A\n    {세부차례} a\n    {세부차례} b {x?}\n    {세부차례} c\n{차례}. B\n    {세부차례} d';
  assert.equal(fillTemplate(tpl, { x: '' }).text, '가. A\n    (1) a\n    (2) c\n나. B\n    (1) d');
});
t('다시 읽어도 — 교육 구분은 손대지 않았으면 (고친) 교육장소를 따라가고, 고쳤으면 둔다', () => {
  const prev = { place: '온라인', mode: '교육' };
  const next = { place: '', mode: '교육' };
  assert.equal(mergeDraft(prev, next, ['place']).mode, '온라인교육');
  assert.equal(mergeDraft(prev, next, ['place', 'mode']).mode, '교육');
});
t('더 넣어 다시 읽으면 — 고친 칸과 새로 읽지 못한 칸은 두고, 첨부는 새 목록', () => {
  const prev = { course: '내가 고친 교육명', provider: '교육원', reason: '써 둔 사유', attendees: '김거화, 홍길동', attach: [{ label: '교육 견적서', files: ['a'] }] };
  const next = { course: '읽은 교육명', provider: '', reason: '', attendees: '김거화', topics: '새로 읽은 내용', attach: [{ label: '교육 견적서', files: ['a'] }, { label: '교육 내용', files: ['b'] }] };
  const out = mergeDraft(prev, next, ['course', 'attendees']);
  assert.equal(out.course, '내가 고친 교육명');
  assert.equal(out.attendees, '김거화, 홍길동');
  assert.equal(out.provider, '교육원', '새로 읽은 값이 비면 쓰던 값');
  assert.equal(out.reason, '써 둔 사유');
  assert.equal(out.topics, '새로 읽은 내용');
  assert.equal(out.attach.length, 2);
});

console.log('과제 내용으로 사유 쓰기');
t('사유 칸 — 구매는 구매사유·용도, 교육은 교육사유·교육목적, 출장은 출장사유·출장목적, 외부활동은 신청사유·활동목적', () => {
  assert.deepEqual(REASON_KEYS, {
    purchase: { reason: 'reason', use: 'use' }, edu: { reason: 'reason', use: 'purpose' }, trip: { reason: 'reason', use: 'purpose' }, outside: { reason: 'reason', use: 'purpose' },
  });
  assert.deepEqual(REASON_LABEL, { purchase: '구매사유', edu: '교육사유', trip: '출장사유', outside: '신청사유' });
});
t('Claude 에 주는 글에 과제 내용과 품의할 것이 들어가고, 금액·업체는 없다', () => {
  const text = reasonInput('purchase', { items: [{ name: '34인치 모니터', spec: 'WQHD', qty: 1, unit: '대', amount: 890000 }], vendor: 'OO상사', use: '회의용' },
    { ...PROJECT, content: 'MVDC 차단기 시험·평가 체계 구축' });
  assert.match(text, /^품의 종류: 구매품의\n과제명: MW급/);
  assert.match(text, /과제 내용:\n<<<\nMVDC 차단기 시험·평가 체계 구축\n>>>/);
  // 품의할 것은 레시피 purchase/purpose.yaml 의 writing.context — 틀과 같은 꼴로 품목마다 사양·수량을 적는다.
  assert.match(text, /품의할 것:\n품목: 34인치 모니터\n {2}사양: WQHD\n {2}수량: 1대\n/);
  assert.match(text, /지금 적힌 용도: 회의용/);
  assert.ok(!/890|OO상사/.test(text));
  assert.match(reasonInput('edu', { course: '전력변환 설계', topics: 'DC-DC' }, null), /과제명: \(없음\)[\s\S]*교육 내용: DC-DC/);
  const trip = reasonInput('trip', { place: '부산', from: '2026-10-20', to: '2026-10-21', purpose: '실증 시험 참관', reason: '필요함', cost: 300000 }, null, { ask: '더 짧게' });
  assert.match(trip, /품의 종류: 출장품의[\s\S]*출장지: 부산\n출장기간: 2026\. 10\. 20\. ~ 2026\. 10\. 21\. \(2일\)\n지금 적힌 출장목적: 실증 시험 참관\n지금 적힌 출장사유: 필요함\n사용자의 말:/);
  assert.ok(!/300/.test(trip), '예상경비는 넣지 않는다');
});
t('써 온 사유는 넣고, 용도는 사용자가 고쳤으면 둔다', () => {
  const data = { reason: ' 과제의 시험 데이터 검토에 필요함 ', use: '시험 데이터 검토용' };
  assert.deepEqual(applyReason('purchase', { reason: '', use: '' }, data), { reason: '과제의 시험 데이터 검토에 필요함', use: '시험 데이터 검토용' });
  assert.equal(applyReason('purchase', { use: '내가 쓴 용도' }, data, { touched: ['use'] }).use, '내가 쓴 용도');
  // 답의 키는 초안 칸의 key 다 — 교육은 교육목적 칸(purpose)으로 답한다.
  assert.equal(applyReason('edu', { purpose: '' }, { reason: data.reason, purpose: '시험 데이터 검토 역량 강화' }).purpose, '시험 데이터 검토 역량 강화');
  assert.equal(applyReason('edu', { purpose: '' }, data).purpose, '', '다른 갈래의 키(use)는 넣지 않는다');
});

console.log('공문 설정');
t('과제는 이름이 있는 것만, R&D 탭과 같은 열 개까지(처음의 다섯 개는 풀었다 — 연장·겹치는 과제)', () => {
  assert.equal(MAX_PROJECTS, 10);
  const list = normalizeProjects([{ name: '' }, ...Array.from({ length: MAX_PROJECTS + 2 }, (_, i) => ({ name: `과제${i}`, about: '개요.', content: ' 연구내용 ' }))]);
  assert.equal(list.length, MAX_PROJECTS);
  assert.equal(list[0].content, '연구내용', '과제 내용도 담는다');
  assert.equal(list[0].about, '개요', '끝의 마침표는 틀이 붙인다');
  const [one] = normalizeProjects([{ name: '과제', alias: ' 차단기 과제 ', period: '2026.04.01 ~ 2029.12.31' }]);
  assert.deepEqual([one.alias, one.period], ['차단기 과제', '2026.04.01 ~ 2029.12.31'], '별명·연구기간도 담는다');
  assert.deepEqual(normalizePreset({ refs: '가, 나' }), { dept: '', head: '', refs: ['가', '나'], director: '', chief: '', docNo: '' });
  assert.equal(normalizePreset({ docNo: ' (8100) ' }).docNo, '8100', '문서번호 부서는 숫자만');
});
t('채팅 — 과제 목록 표(머리글 줄은 건너뛴다)·부서장·참조를 규칙으로 읽는다', () => {
  const { patch, reply } = parseSetupLocal(`과제명\t과제번호\t책임자\n${PROJECT.name}\tRND-20-2026\t박기도 책임\n선박용 수소 엔진-연료전지 하이브리드 추진 시스템 | RND-21-2026 | 김거화 수석\n부서장: 노길태 팀장\n참조 홍길동, 이몽룡 선임`);
  assert.deepEqual(patch.projects, [
    { name: PROJECT.name, code: 'RND-20-2026', lead: '박기도' },
    { name: '선박용 수소 엔진-연료전지 하이브리드 추진 시스템', code: 'RND-21-2026', lead: '김거화' },
  ]);
  assert.equal(patch.head, '노길태');
  assert.equal(patch.refs, '홍길동, 이몽룡');
  assert.match(reply, /과제 2개와 합의자/);
});
t('채팅 — 과제 줄 뒤의 "내용:"·"개요:" 는 그 과제에, 과제 없이 내용만이면 지금 고른 과제 몫', () => {
  const { patch } = parseSetupLocal('과제: MMC 기반 전력변환 기술 개발, 책임자 박기도\n내용: 모듈형 멀티레벨 컨버터 설계\n연구목표: 효율 98%\n개요: MMC 전력변환 기술 개발을 수행하고 있습니다');
  assert.deepEqual(patch.projects, [{ name: 'MMC 기반 전력변환 기술 개발', lead: '박기도', content: '모듈형 멀티레벨 컨버터 설계\n효율 98%', about: 'MMC 전력변환 기술 개발을 수행하고 있습니다' }]);
  assert.deepEqual(parseSetupLocal('연구내용: 차단기 시험').patch, { content: '차단기 시험' });
  const res = mergeSetup([{ name: '과제A' }], {}, { content: '차단기 시험' }, { current: '과제A' });
  assert.equal(res.rows[0].content, '차단기 시험');
  assert.match(mergeSetup([{ name: '과제A' }], {}, { content: 'x' }).skipped[0], /과제 내용\(어느 과제인지/);
});
t('채팅 — 과제 줄 뒤의 "별명:"·"기간:" 은 그 과제에, 과제 없이 적으면 지금 고른 과제 몫', () => {
  const { patch, reply } = parseSetupLocal('과제: MMC 기반 전력변환 기술 개발, 책임자 박기도\n별명: MMC 과제\n연구기간: 2026.04.01 ~ 2029.12.31');
  assert.deepEqual(patch.projects, [{ name: 'MMC 기반 전력변환 기술 개발', lead: '박기도', alias: 'MMC 과제', period: '2026.04.01 ~ 2029.12.31' }]);
  assert.match(reply, /과제 1개와 합의자/);
  assert.deepEqual(parseSetupLocal('약칭: 차단기 과제').patch, { alias: '차단기 과제' });
  assert.deepEqual(parseSetupLocal('기간 = 2026.04 ~ 2029.12').patch, { period: '2026.04 ~ 2029.12' });
  const res = mergeSetup([{ name: '과제A' }], {}, { alias: '차단기 과제', period: '2026.04 ~ 2029.12' }, { current: '과제A' });
  assert.deepEqual([res.rows[0].alias, res.rows[0].period], ['차단기 과제', '2026.04 ~ 2029.12']);
  assert.deepEqual(res.done, ['과제 별명 차단기 과제 — 과제A', '연구기간 — 과제A']);
  assert.match(mergeSetup([{ name: '과제A' }], {}, { alias: 'x' }).skipped[0], /과제 별명 x\(어느 과제인지/);
  const named = mergeSetup([], {}, { projects: [{ name: '과제B', alias: 'B 과제', period: '2026' }] });
  assert.deepEqual([named.rows[0].alias, named.rows[0].period], ['B 과제', '2026']);
  assert.match(named.done[0], /과제 등록 — 과제B · 별명 B 과제 · 연구기간/);
});
t('채팅 — "과제: …, 책임자 ○○○" 문장과, 과제 없이 "합의자 ○○○"', () => {
  assert.deepEqual(parseSetupLocal('과제: MMC 기반 전력변환 기술 개발, 책임자 박기도').patch, { projects: [{ name: 'MMC 기반 전력변환 기술 개발', lead: '박기도' }] });
  assert.deepEqual(parseSetupLocal('합의자 박기도 책임').patch, { lead: '박기도' });
  assert.deepEqual(parseSetupLocal('안녕하세요').patch, {});
});
t('얹기 — 이름·번호가 같은 과제는 고치고, 빈 줄을 먼저 채우고, 한도(열 개)를 넘으면 뺀다', () => {
  const rows = [{ name: PROJECT.name, code: '', lead: '' }, { name: '' }];
  const res = mergeSetup(rows, { head: '옛 부서장' }, {
    projects: [{ name: PROJECT.name, lead: '박기도 책임' }, { name: '새 과제 A', code: 'RND-1' }, { name: '새 과제 B' }],
    head: '노길태', refs: '홍길동',
  });
  assert.deepEqual(res.rows.map((r) => [r.name, r.lead]), [[PROJECT.name, '박기도'], ['새 과제 A', ''], ['새 과제 B', '']]);
  assert.deepEqual(res.preset, { dept: '', head: '노길태', refs: ['홍길동'], director: '', chief: '', docNo: '' });
  assert.equal(res.skipped.length, 0);
  const five = Array.from({ length: 5 }, (_, i) => ({ name: `과제${i}`, code: `C${i}` }));
  assert.deepEqual(mergeSetup(five, {}, { projects: [{ name: '여섯째' }] }).rows.at(-1).name, '여섯째', '다섯 개 넘게도 둔다(연장·겹치는 과제)');
  const full = Array.from({ length: MAX_PROJECTS }, (_, i) => ({ name: `과제${i}`, code: `C${i}` }));
  const over = mergeSetup(full, {}, { projects: [{ name: '열한째' }, { name: '다른이름', code: 'C2', lead: '박기도' }] });
  assert.deepEqual(over.skipped, ['열한째']);
  assert.equal(over.rows[2].lead, '박기도', '번호가 같으면 같은 과제');
  assert.equal(over.rows[2].name, '과제2', '이미 있는 과제 이름은 두고');
});
t('얹기 — 사람만 왔으면 지금 고른 과제의 합의자, 고른 과제가 없으면 넣지 못한다', () => {
  assert.equal(mergeSetup([{ name: '과제A' }], {}, { lead: '박기도' }, { current: '과제A' }).rows[0].lead, '박기도');
  assert.match(mergeSetup([{ name: '과제A' }], {}, { lead: '박기도' }).skipped[0], /어느 과제인지 모릅니다/);
});

console.log('입력 명세 — gongmun.<갈래>·gongmunSetup');
t('명세가 맞다(목록 형 포함)', () => assert.deepEqual(checkSpec({ tasks: TASKS }), []));
t('목록 안의 목록·줄 칸이 없는 목록은 생성기가 거부한다', () => {
  const broken = structuredClone({ tasks: TASKS });
  broken.tasks['gongmun.purchase'].fields.items.item.sub = { type: 'list', desc: '안', item: { a: { type: 'string', desc: 'a' } } };
  broken.tasks.gongmunSetup.fields.projects.item = {};
  const errors = checkSpec(broken).join('\n');
  assert.match(errors, /items\.sub: 목록 안에 목록을 둘 수 없습니다/);
  assert.match(errors, /projects: 목록은 줄의 칸\(item\)이 있어야 합니다/);
});
t('지시문에 목록의 줄 칸이 들여 적힌다', () => {
  const text = systemPrompt('gongmun.purchase');
  assert.match(text, /- items \(목록\(30줄까지\) — 줄마다 아래 키의 객체 또는 null\)/);
  assert.match(text, /\n {4}- name \(글, 필수\): 품목명/);
});
t('관문 — 품목명이 없는 줄은 빼고 알린다, 목록이 아니면 비운다', () => {
  const { data, notes } = structure('gongmun.purchase', { docType: 'quote', gist: '모니터', summary: '견적서', items: [{ name: 'A', qty: '2', amount: '1000' }, { qty: 1 }, 'x'], total: '1000' });
  assert.deepEqual(data.items, [{ name: 'A', spec: null, qty: 2, unit: null, unitPrice: null, amount: 1000 }]);
  assert.deepEqual(notes, ['품목 중 2줄은 받을 수 없어 뺐습니다']);
  assert.equal(structure('gongmun.purchase', { docType: 'quote', gist: 'g', summary: 's', items: 'A' }).data.items, null);
  assert.throws(() => structure('gongmun.purchase', { docType: 'quote', gist: 'g' }), InputError, '한 줄 요약(summary)은 꼭 있어야 한다');
});
t('공문 설정 조각은 부분 수정 — 말하지 않은 칸은 빠진다', () => {
  assert.deepEqual(structure('gongmunSetup', { projects: [{ name: '과제', lead: '박기도' }], head: null, reply: '채웠습니다' }).data,
    { projects: [{ name: '과제', code: null, lead: '박기도', alias: null, period: null, about: null, content: null }], reply: '채웠습니다' });
});
t('읽기는 파일마다 문서 종류(parts)를 돌려준다 — 모르는 종류의 줄은 뺀다', () => {
  const { data, notes } = structure('gongmun.edu', { docType: 'quote', course: 'c', summary: 's', parts: [{ file: 'a.png', kind: 'quote' }, { file: 'b.png', kind: 'menu' }] });
  assert.deepEqual(data.parts, [{ file: 'a.png', kind: 'quote' }]);
  assert.deepEqual(notes, ['파일 중 1줄은 받을 수 없어 뺐습니다']);
});
t('사유 쓰기의 답은 사유가 꼭 있어야 한다', () => {
  assert.deepEqual(structure('gongmunReason.purchase', { reason: '필요함', use: null }).data, { reason: '필요함', use: null, reply: null });
  assert.deepEqual(structure('gongmunReason.trip', { reason: '필요함', purpose: '학회 참석' }).data, { reason: '필요함', purpose: '학회 참석', reply: null });
  assert.throws(() => structure('gongmunReason.purchase', { use: 'x' }), InputError);
});
t('읽기 입력 — 파일이면 장 수와 이름, 글이면 글을 싸서 보낸다', () => {
  assert.equal(gongmunInput({ files: [{ name: 'a.png' }, { name: 'b.png' }] }, { kind: 'purchase', today: '2026-10-07' }),
    '품의 종류: 구매(견적서·거래명세서·쇼핑몰 주문 화면)\n오늘은 2026-10-07 입니다.\n첨부한 문서 2장(파일 이름: a.png, b.png)을 읽어 출력 키를 채웁니다.'
    + ' 여러 장은 같은 건의 문서들(여러 쪽, 또는 견적서와 교육 내용 등)이니 함께 보고, parts 에 파일마다 무슨 문서인지 적습니다.');
  assert.match(gongmunInput({ files: [{ name: 'a.png' }], text: '커리큘럼 1일차' }, { kind: 'edu' }), /파일 이름: a\.png[\s\S]*붙여 넣은 글도 함께 봅니다\.\n<<<\n커리큘럼 1일차\n>>>$/);
  assert.match(gongmunInput({ text: '모니터 1대 890,000원' }, { kind: 'edu' }), /^품의 종류: 교육[\s\S]*<<<\n모니터 1대 890,000원\n>>>$/);
});
console.log('웹페이지 캡처 묶음의 문서 종류 잇기 (spreadParts)');
t('읽기에 보내지 않은 뒷장은 같은 묶음에서 앞서 가린 종류를 이어 받는다 — 앞 장이 교육 내용이면 뒷장도', () => {
  const tiles = (n) => Array.from({ length: n }, (_, i) => ({ name: `화면캡처_inflearn.com_2026-10-08_${i + 1}.png`, group: 'cap1' }));
  const files = [{ name: '교육견적.png' }, ...tiles(7)];
  const parts = [{ file: '교육견적.png', kind: 'quote' }, { file: tiles(1)[0].name, kind: 'course' }, { file: tiles(2)[1].name, kind: 'content' }];
  const out = spreadParts(parts, files);
  assert.deepEqual(out.map((p) => `${p.file.replace(/^화면캡처_inflearn\.com_2026-10-08_/, 't')}:${p.kind}`),
    ['교육견적.png:quote', 't1.png:course', 't2.png:content', 't3.png:content', 't4.png:content', 't5.png:content', 't6.png:content', 't7.png:content']);
  const attach = attachList('edu', out, files.map((f) => f.name));
  assert.deepEqual(attach.map((a) => [a.label, a.files.length]), [['교육 견적서', 1], ['교육 내용', 7]]);
});
t('묶음이 아닌 파일과 가린 것이 없는 묶음은 그대로 둔다 — 갈래의 기본 문서가 된다', () => {
  assert.deepEqual(spreadParts([{ file: 'a.png', kind: 'quote' }], [{ name: 'a.png' }, { name: 'b.png' }]), [{ file: 'a.png', kind: 'quote' }]);
  assert.deepEqual(spreadParts(null, [{ name: 'x_1.png', group: 'g' }, { name: 'x_2.png', group: 'g' }]), []);
  assert.deepEqual(spreadParts([{ file: 'x_2.png', kind: 'content' }], [{ name: 'x_1.png', group: 'g' }, { name: 'x_2.png', group: 'g' }, { name: 'x_3.png', group: 'g' }]),
    [{ file: 'x_2.png', kind: 'content' }, { file: 'x_3.png', kind: 'content' }], '앞 장은 뒤의 것을 거꾸로 받지 않는다');
  assert.deepEqual(spreadParts([{ file: 'a', kind: 'quote' }, { bad: true }, { file: 'b' }], []), [{ file: 'a', kind: 'quote' }], '모양이 틀린 줄은 뺀다');
});

console.log('구매 — 가격 부분을 오린 견적서(attachWithCut)');
t('오린 견적서가 있으면 그것이 첫 줄 견적서이고, 오려 낸 화면의 장은 첨부에서 빠진다 — 따로 넣은 문서는 남는다', () => {
  const files = ['화면캡처_coupang.com_1.png', '화면캡처_coupang.com_2.png', '사양서.pdf'];
  const parts = [{ file: files[0], kind: 'order' }, { file: files[1], kind: 'order' }, { file: '사양서.pdf', kind: 'other' }];
  const cut = { name: '견적서_가격부분_2026-10-08.png', drop: files.slice(0, 2), on: true };
  assert.deepEqual(attachWithCut('purchase', parts, files, cut), [
    { label: '견적서', files: ['견적서_가격부분_2026-10-08.png'] }, { label: '참고 자료', files: ['사양서.pdf'] },
  ]);
  assert.deepEqual(attachWithCut('purchase', parts, files, { ...cut, on: false }), [
    { label: '주문 내역', files: files.slice(0, 2) }, { label: '참고 자료', files: ['사양서.pdf'] },
  ], '원래 장으로 — 넣은 파일 그대로');
  assert.deepEqual(attachWithCut('purchase', parts, files, null), attachList('purchase', parts, files));
});
t('초안의 첨부와 본문 ※ 첨부 — 쇼핑몰 화면 일곱 장이 견적서 한 줄이 된다', () => {
  const tiles = Array.from({ length: 7 }, (_, i) => `화면캡처_coupang.com_${i + 1}.png`);
  const rec = { docType: 'order', vendor: '쿠팡', gist: '34인치 모니터', total: 489000, parts: tiles.map((file) => ({ file, kind: 'order' })) };
  const { draft } = fromRecord('purchase', rec, { files: tiles, cut: { name: '견적서_가격부분.png', drop: tiles, on: true } });
  assert.deepEqual(draft.attach, [{ label: '견적서', files: ['견적서_가격부분.png'] }]);
  assert.match(compose('purchase', draft, CTX).body, /※ 첨 부\n {4}1\. 견적서 1부\.  끝\.$/);
});
t('읽기는 오릴 칸(quoteArea)을 그림마다 % 로 돌려준다 — 범위 밖·빠진 칸의 줄은 뺀다', () => {
  const { data, notes } = structure('gongmun.purchase', {
    docType: 'order', gist: 'g', summary: 's',
    quoteArea: [{ file: 'a.png', left: 5, top: 10, right: 95, bottom: 40 }, { file: 'b.png', left: -1, top: 0, right: 50, bottom: 50 }, { file: 'c.png', left: 0, top: 0 }],
  });
  assert.deepEqual(data.quoteArea, [{ file: 'a.png', left: 5, top: 10, right: 95, bottom: 40 }]);
  assert.deepEqual(notes, ['견적서로 오릴 칸 중 2줄은 받을 수 없어 뺐습니다']);
  // 오릴 칸은 레시피에 quote_crop 이 있는 갈래(구매·교육)에만 있고, 오린 칸에 꼭 들어갈 것(견적서의 필수 내용)이 지시문에 적힌다.
  assert.match(systemPrompt('gongmun.purchase'), /- quoteArea [^\n]*오린 칸에 꼭 들어갈 것: 상품명·모델·옵션·수량·단가·할인·배송비·합계·판매자\. 넣지 않을 것: 추천 상품/);
  assert.match(systemPrompt('gongmun.edu'), /오린 칸에 꼭 들어갈 것: 수강료\(정가·할인가·결제 금액\)·강의명/);
  assert.deepEqual(['trip', 'outside'].map((k) => 'quoteArea' in TASKS[`gongmun.${k}`].fields), [false, false]);
  assert.deepEqual(KIND_ORDER.filter((k) => KINDS[k].cut), ['purchase', 'edu']);
});

console.log('구매로 산 강의 — 견적서와 강의 내용');
t('강의 소개·커리큘럼(course·content)은 구매에서도 강의 내용으로 첨부된다 — 오린 견적서와 두 줄', () => {
  const files = ['인프런_1.png', '인프런_2.png', '인프런_3.png'];
  const parts = [{ file: files[0], kind: 'order' }, { file: files[1], kind: 'content' }, { file: files[2], kind: 'content' }];
  const cut = { name: '견적서_가격부분.png', drop: [files[0]], on: true };
  assert.deepEqual(attachWithCut('purchase', parts, files, cut), [
    { label: '견적서', files: ['견적서_가격부분.png'] }, { label: '강의 내용', files: files.slice(1) },
  ]);
  const { draft } = fromRecord('purchase', { docType: 'order', gist: '강의', total: 84700, parts }, { files, cut });
  assert.match(compose('purchase', draft, CTX).body, /※ 첨 부\n {4}1\. 견적서 1부\.\n {4}2\. 강의 내용 1부\.  끝\.$/);
});

console.log('R&D 탭의 과제 — 연구 내용으로 사유 쓰기·에이전트');
{
  const TODAY = '2026-10-08';
  const book = normalizeBook({
    projects: [{
      id: 'p1', name: 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발', alias: 'SSCB', code: 'RS-2026-0001', lead: '박기도',
      start: '2026-04-01', end: '2029-12-31', note: '산업부 과제',
      years: {
        1: { logs: [
          { date: '2026-04-01', title: '연구개발 계획', key: 'plan', text: '■ 개발목표\n1. 10kV 반도체 차단기 시제품 설계' },
          { date: '2026-09-01', title: '시험 장비 선정', text: '고전압 프로브 비교' },
        ] },
      },
    }, { id: 'p2', name: '계획서 없는 과제', alias: '빈과제', start: '2026-01-01', end: '2026-12-31' }],
  });
  t('연구 내용 — 올해 차년도의 연구개발 계획과 진행 기록, 비고', () => {
    const got = rndContent(book.projects[0], TODAY);
    assert.deepEqual([got.year, got.plan, got.logs], [1, 1, 1]);
    assert.match(got.text, /^\[연구개발 계획 — 1차년도\]\n■ 개발목표\n1\. 10kV 반도체 차단기 시제품 설계\n\n\[진행 기록 — 1차년도\]\n- 2026\.09\.01 시험 장비 선정 — 고전압 프로브 비교\n\n\[비고\]\n산업부 과제$/);
    assert.deepEqual(rndContent(book.projects[1], TODAY), { text: '', year: 1, plan: 0, logs: 0 });
  });
  t('올해 차년도에 계획서가 없으면 앞 차년도의 계획을 쓴다 — 진행 기록은 올해 것', () => {
    const got = rndContent(book.projects[0], '2027-05-01');
    assert.deepEqual([got.year, got.plan, got.logs], [2, 1, 0]);
    assert.match(got.text, /\[연구개발 계획 — 1차년도\]/);
  });
  t('R&D 탭의 과제를 공문의 과제로 — 별칭·번호·책임자·연구기간은 그 과제, 개요·계정·빈 칸은 공문 설정의 같은 과제에서', () => {
    const preset = [{ name: '다른 이름', code: 'RS-2026-0001', about: '차단기 과제를 수행하고 있습니다', account: '연구재료비', content: '공문 설정의 내용' },
      { name: '계획서 없는 과제', lead: '홍길동', content: '공문 설정에 적은 과제 내용' }];
    const [a, b] = rndProjects(book, preset, TODAY);
    assert.deepEqual({ ...a, content: a.content.slice(0, 11) }, {
      name: 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발', alias: 'SSCB', code: 'RS-2026-0001', lead: '박기도', period: '2026.04.01 ~ 2029.12.31',
      about: '차단기 과제를 수행하고 있습니다', content: '[연구개발 계획 — ', account: '연구재료비', rnd: { id: 'p1', year: 1, plan: 1, logs: 1 },
    });
    assert.deepEqual([b.lead, b.content, b.rnd.plan], ['홍길동', '공문 설정에 적은 과제 내용', 0], '연구 내용이 없으면 공문 설정의 과제 내용');
    assert.deepEqual(rndProjects(normalizeBook(null), preset), []);
  });
  t('R&D 과제 몫으로 공문 설정에서 적은 개요·계정(과제 id 로 묶는다)이 같은 과제 줄의 것보다 먼저다 — 비워 두었으면 비운 대로', () => {
    const preset = [{ name: '다른 이름', code: 'RS-2026-0001', about: '줄의 개요', account: '연구재료비' }];
    const extra = normalizeRndExtra({ p1: { about: ' 차단기 과제를 수행하고 있습니다. ', account: '' }, p9: { about: '없는 과제' }, '': { about: 'x' }, p2: 'x' });
    assert.deepEqual(extra, { p1: { about: '차단기 과제를 수행하고 있습니다', account: '' }, p9: { about: '없는 과제', account: '' } });
    const [a, b] = rndProjects(book, preset, TODAY, extra);
    assert.deepEqual([a.about, a.account], ['차단기 과제를 수행하고 있습니다', ''], '적은 것이 이긴다 — 계정을 비웠으면 갈래 기본값');
    assert.deepEqual([b.about, b.account], ['', '']);
    const [c] = rndProjects(book, preset, TODAY);
    assert.deepEqual([c.about, c.account], ['줄의 개요', '연구재료비'], '적은 적이 없으면 같은 과제 줄의 것');
  });
  t('공문 설정의 과제 줄과 R&D 과제가 같은 과제인가 — 과제번호·과제명·별칭 가운데 하나(공백·대소문자 무시)', () => {
    const p = book.projects[0];
    assert.equal(sameProject(p, { name: '다른 이름', code: 'rs-2026-0001' }), true);
    assert.equal(sameProject(p, { name: ' MW급 10kV 고전압 직류 시스템용 반도체 차단기개발' }), true);
    assert.equal(sameProject(p, { name: '다른 이름', alias: 'sscb' }), true);
    assert.equal(sameProject(p, { name: '다른 이름', code: '', alias: '' }), false);
    assert.equal(sameProject(book.projects[1], { name: '다른 이름', code: '', alias: '' }), false, '번호 없는 R&D 과제와 번호 없는 줄은 번호로 같지 않다');
  });
  t('에이전트에 적은 말 — 지금 적힌 사유와 사용자의 말을 넘기고, 과제 내용이 R&D 연구 내용임을 알린다', () => {
    const [p] = rndProjects(book, [], TODAY);
    const text = reasonInput('purchase', { gist: '고전압 프로브', reason: '시험에 필요함', use: '시험용' }, p, { ask: '사유를 시험 장비 검증 쪽으로' });
    assert.match(text, /과제 내용\(R&D 탭의 연구 내용 — 연구개발 계획·진행 기록\):\n<<<\n\[연구개발 계획 — 1차년도\]/);
    assert.match(text, /지금 적힌 구매사유: 시험에 필요함\n사용자의 말:\n<<<\n사유를 시험 장비 검증 쪽으로\n>>>$/);
    assert.ok(!/사용자의 말/.test(reasonInput('purchase', { gist: '프로브' }, p)), '말이 없으면 넣지 않는다');
  });
  t('에이전트에 적은 말로 쓴 용도는 사용자가 고친 칸이어도 넣는다 — 고쳐 달라고 한 사람이 원한 것', () => {
    const data = { reason: '시험 장비 검증에 필요함', use: '고전압 시험 장비 검증용', reply: '사유를 고쳤습니다' };
    assert.equal(applyReason('purchase', { use: '내가 쓴 용도' }, data, { touched: ['use'] }).use, '내가 쓴 용도');
    assert.equal(applyReason('purchase', { use: '내가 쓴 용도' }, data, { touched: ['use'], asked: true }).use, '고전압 시험 장비 검증용');
  });
  t('초안의 칸 — 용도(교육목적)·사유만 펼쳐 두고 나머지 읽은 칸은 접는다', () => {
    assert.deepEqual(FIELDS.purchase.filter((f) => f.open).map((f) => f.key), ['use', 'reason']);
    assert.deepEqual(FIELDS.edu.filter((f) => f.open).map((f) => f.key), ['purpose', 'reason']);
  });
}

console.log('레시피(recipes/gongmun) — 위임전결·문서설정·쓸 것');
{
  const FULL_PRESET = { ...PRESET, director: '송강현', chief: '김대헌' };
  t('레시피 생성물이 레시피와 같고, 틀린 레시피는 생성기가 막는다', () => {
    assert.equal(fs.readFileSync(new URL('../src/gmrecipe.js', import.meta.url), 'utf8'), renderRecipe(), '`node tools/gen-gongmun.mjs` 를 돌리세요');
    const raw = readRecipe();
    assert.deepEqual(checkRecipe(raw), []);
    const broken = structuredClone(raw);
    broken.delegation.rules.연구비집행.source = '';
    broken.forms.find((f) => f.manifest.form_id === 'KR_EA_Research_Task').purposes.find((p) => p.id === 'edu').purpose.rule_key = '없는규정';
    const errs = checkRecipe(broken);
    assert.ok(errs.some((e) => /연구비집행: source\(규정 근거\)가 없습니다/.test(e)), errs.join('\n'));
    assert.ok(errs.some((e) => /purposes\/edu\/purpose.yaml: rule_key 없는규정/.test(e)), errs.join('\n'));
  });
  t('위임전결 — 연구비 집행은 2천만원 이하 팀장·넘으면 소장, 출장은 국내 팀장·해외 본부장, 외부활동은 팀장', () => {
    assert.equal(delegationOf('purchase', { total: 989_000 }).rank, '팀장');
    assert.deepEqual(pick(delegationOf('edu', { fee: 20_000_000 }), ['rank', 'basis', 'unknown']), { rank: '팀장', basis: '20,000,000원', unknown: false }, '2천만원은 이하');
    assert.equal(delegationOf('edu', { fee: 20_000_001 }).rank, '소장');
    assert.deepEqual(pick(delegationOf('edu', {}), ['rank', 'unknown']), { rank: '팀장', unknown: true }, '금액을 모르면 맨 아래 구간이고 모른다고 알린다');
    assert.equal(delegationOf('trip', { division: '해외', cost: 1 }).rank, '본부장');
    assert.equal(delegationOf('trip', {}).rank, '팀장', '구분이 비면 국내');
    assert.equal(delegationOf('outside', {}).rank, '팀장');
    assert.match(delegationOf('purchase', {}).source, /QI-01K Rev164 45절/);
    assert.deepEqual(pick(delegationOf('purchase', { total: 1 }, { rank: '소장' }), ['rank', 'auto', 'overridden']), { rank: '소장', auto: '팀장', overridden: true }, '고른 전결권자가 이긴다');
  });
  t('결재선은 부서장부터 전결권자까지 — 이름이 없는 직책은 남은 것으로', () => {
    const line = approvalLine({ ...CTX, preset: FULL_PRESET, kind: 'trip', draft: { division: '해외' } });
    assert.equal(lineText(line), '기안자 김거화 → 합의자 박기도 → 결재자 노길태 → 결재자 송강현 → 결재자 김대헌 · 참조자 홍길동, 이몽룡');
    assert.deepEqual(line.steps.slice(-2).map((s) => s.why), ['소장', '본부장']);
    const short = approvalLine({ ...CTX, kind: 'edu', draft: { fee: 30_000_000 } });
    assert.deepEqual([short.steps.at(-1).name, short.missing], ['노길태', ['소장']]);
    assert.deepEqual(needs('edu', { course: 'c', from: '2026-11-01', fee: 30_000_000, purpose: 'p', reason: 'r' }, { preset: PRESET, project: FULL, projects: [FULL] }),
      ['소장(공문 설정 — 위임전결)']);
    assert.deepEqual(approvalLine({ ...CTX, kind: 'purchase', draft: { total: 1 } }).steps, approvalLine(CTX).steps, '부서장 전결은 예전 결재선과 같다');
  });
  t('문서설정 — 보존 10년 · 기안 팀 채번(부서 이름으로) · 내부결재 · 결재선 공개, 이 공문에서 바꾼 것이 이긴다', () => {
    const s = docSettingOf('purchase', PRESET);
    assert.deepEqual(pick(s, ['profile', 'retention', 'retentionText', 'docNo', 'docNoFrom', 'receiver', 'scope', 'scopeCode', 'emergency']),
      { profile: '연구품의', retention: '120', retentionText: '10년', docNo: '8100', docNoFrom: '부서(수소전기추진연구팀)', receiver: '내부결재', scope: '결재선', scopeCode: 'YNN', emergency: false });
    assert.equal(settingText(s), '보존 10년 · Doc No. 8100 · 수신 내부결재 · 공개 결재선');
    const mine = docSettingOf('purchase', { ...PRESET, docNo: '7200' }, { retention: '36', scope: '기안부서', emergency: 1, receiver: '없는곳', tag: ' 장비 ' });
    assert.deepEqual(pick(mine, ['retention', 'docNo', 'docNoFrom', 'scopeCode', 'emergency', 'receiver', 'tag']),
      { retention: '36', docNo: '7200', docNoFrom: '공문 설정', scopeCode: 'NNY', emergency: true, receiver: '내부결재', tag: '장비' }, '모르는 수신처는 버린다');
    assert.equal(docSettingOf('purchase', { dept: '모르는팀' }).docNo, '');
    assert.deepEqual(needs('purchase', { gist: 'x', total: 1, use: 'u', reason: 'r' }, { preset: { ...PRESET, dept: '모르는팀' }, project: FULL, projects: [FULL] }), ['문서번호 부서(공문 설정)']);
  });
  t('쓸 것(writePlan) — 폼의 칸 지도·값·문서설정·결재선을 한데, 줄표는 바꾸고 제목은 99자', () => {
    const project = { ...FULL, rnd: { id: 'x', year: 1 } };
    const plan = writePlan('purchase', { title: `모니터 — 구매 품의${'가'.repeat(120)}`, body: '1. 사유 — 시험\n\n------------ 아   래 ------------', draft: { total: 989_000 } },
      { me: '김거화', preset: PRESET, project });
    assert.equal(plan.form, 'KR_EA_Research_Task');
    assert.equal(plan.url, draftUrl('KR_EA_Research_Task'));
    assert.equal(plan.fields.job.kind, 'picker');
    assert.equal(plan.fields.body.control, 'ctl00_ContentPlaceHolder_Content_EditorControl1');
    assert.equal(plan.values.title.length, 99);
    assert.ok(plan.values.title.startsWith('모니터 - 구매 품의'), plan.values.title);
    assert.equal(plan.values.html, '<div>1. 사유 - 시험</div><div><br></div><div style="text-align:center;">------------ 아   래 ------------</div>');
    assert.deepEqual([plan.values.degree, plan.values.job], ['1', { name: FULL.name, code: FULL.code }]);
    assert.equal(plan.setting.docNo, '8100');
    assert.deepEqual(plan.line, { approvers: ['노길태'], agree: ['박기도'], refs: ['홍길동', '이몽룡'], missing: [], rank: '팀장', team: '수소전기추진연구팀' });
    const other = writePlan('purchase', { title: 't', body: 'b', form: 'KR_Something' }, { preset: PRESET });
    assert.deepEqual([other.known, other.fields], [false, {}], '칸 지도가 없는 양식은 열기만 한다');
    assert.equal(writePlan('trip', { title: 't', body: 'b', form: 'KR_EA_Form2' }, { preset: PRESET }).fields.job.source, 'jobText', '기안문의 Job Id. 는 글 칸');
  });
}

console.log('레시피 — 칸마다 읽는 법과 틀의 자리(인라인 프롬프트, 2026-10-09 사용자 지정)');
{
  const purposeOf = (raw, id) => raw.forms.flatMap((f) => f.purposes).find((p) => p.id === id);
  const flat = (s) => String(s).replace(/\s+/g, ' ').trim();
  t('문서에서 읽는 칸의 read·example 이 그대로 지시문에 들어가고, 과제 내용으로 쓰는 칸(사유)은 읽지 않는다', () => {
    for (const k of KIND_ORDER) {
      const task = TASKS[`gongmun.${k}`];
      const text = systemPrompt(`gongmun.${k}`);
      assert.match(text, new RegExp(`^당신은 [^\\n]*${KINDS[k].title}에 넣을 값을 뽑습니다`), `${k}: 역할에 갈래 이름`);
      for (const f of FIELDS[k].filter((x) => x.from === 'document')) {
        assert.ok(text.includes(`- ${f.key} (`), `${k}.${f.key}`);
        assert.ok(text.includes(flat(f.read).slice(0, 40)), `${k}.${f.key} 의 read`);
        if ('example' in f) assert.ok(text.includes(`예: ${f.example}`), `${k}.${f.key} 의 example`);
      }
      for (const f of FIELDS[k].filter((x) => x.from === 'write')) assert.ok(!(f.key in task.fields), `${k}.${f.key} 는 읽지 않는다`);
    }
  });
  t('읽기의 키가 곧 초안 칸의 key 다 — 예시로 만든 기록이 초안에 그대로 들어간다', () => {
    for (const k of KIND_ORDER) {
      const rec = Object.fromEntries(FIELDS[k].filter((x) => x.from === 'document' && 'example' in x).map((x) => [x.key, x.example]));
      const got = structure(`gongmun.${k}`, { ...rec, docType: 'quote', summary: 's' });
      assert.deepEqual(got.notes, [], `${k}: 예시는 관문을 그대로 지난다`);
      const { draft } = fromRecord(k, got.data, { me: '김거화' });
      for (const [key, v] of Object.entries(rec)) assert.equal(draft[key], v, `${k}.${key}`);
    }
  });
  t('종료일이 시작일보다 앞서면 종료일만 비우고 알린다(레시피의 not_before)', () => {
    const { data, notes } = structure('gongmun.edu', { docType: 'course', summary: 's', from: '2026-11-05', to: '2026-11-03' });
    assert.deepEqual([data.from, data.to], ['2026-11-05', null]);
    assert.deepEqual(notes, ['교육 종료일이 시작일보다 앞서 종료일은 뺐습니다']);
  });
  t('틀의 자리는 레시피의 from·show 대로 — 기간은 며칠까지, 금액은 원, 비면 내 이름 · 양식 칸 아래에 꼴의 예가 보인다', () => {
    const v = varsFor('edu', { from: '2026-11-03', to: '2026-11-05', fee: 450000, attendees: '' }, { me: '김거화' });
    assert.deepEqual([v.교육기간, v.교육비, v.참석자, v.교육구분], ['2026. 11. 3. ~ 2026. 11. 5. (3일)', '450,000원', '김거화', '교육']);
    assert.equal(varsFor('trip', { from: '2026-10-20' }).출장기간, '2026. 10. 20. (1일)', '하루면 (1일)');
    assert.ok(VARS.edu.some(([tok, d]) => tok === '{교육기간}' && d.includes('2026. 11. 3. ~ 2026. 11. 5. (3일)')));
    assert.ok(VARS.purchase.some(([tok, d]) => tok === '{{#품목}} … {{/품목}}' && d.includes('{번호}·{품목명}·{사양}·{수량}')));
    assert.ok(VARS.trip.some(([tok]) => tok === '{과제별명}'), '공통 자리(registries/vars.yaml)도 갈래마다 앞에');
  });
  t('남은 것의 이름은 레시피의 need 다', () => {
    assert.deepEqual(FIELDS.edu.filter((f) => f.need).map((f) => `${f.key}:${f.need}`), ['course:교육명', 'fee:교육비', 'from:교육기간', 'purpose:교육목적', 'reason:교육사유']);
    assert.deepEqual(needs('edu', { ...blankDraft('edu'), course: 'c' }, { preset: PRESET, project: FULL, projects: [FULL] }), ['교육비', '교육기간', '교육목적', '교육사유']);
  });
  t('틀린 칸·자리는 생성기가 막는다 — 읽지 않는 칸의 read, 꼴이 틀린 예시, read 없는 읽는 칸, 틀에 없는 이름, 없는 칸을 가리키는 자리', () => {
    const broken = structuredClone(readRecipe());
    const edu = purposeOf(broken, 'edu');
    edu.purpose.fields.find((f) => f.key === 'reason').read = '사유를 읽는다';
    edu.purpose.fields.find((f) => f.key === 'from').example = '2026.11.03';
    delete edu.purpose.fields.find((f) => f.key === 'course').read;
    edu.body.body += '\n{교육일정}';
    edu.body.vars.교육기간.from = ['from', 'until'];
    broken.vars.common.결재자 = '없는 자리';
    const errs = checkRecipe(broken).join('\n');
    assert.match(errs, /fields\[\d+\]\(reason\): read 는 from: document 칸에만 씁니다/);
    assert.match(errs, /fields\[\d+\]\(from\): example\(2026\.11\.03\)은 YYYY-MM-DD 날짜여야 합니다/);
    assert.match(errs, /fields\[0\]\(course\): from: document 칸은 read/);
    assert.match(errs, /edu\/body_spec\.yaml body: \{교육일정\} 가 vars·공통 자리/);
    assert.match(errs, /vars\.교육기간: from 의 until 가 칸\(key\)에 없습니다/);
    assert.match(errs, /vars\.yaml common: 결재자 는 코드가 채우지 않는 자리/);
  });
  t('--prompt 는 레시피에서 바로 지시문 전문을 만든다 — 확장이 보내는 것과 같다(읽기·사유 쓰기·공문 설정 채우기)', () => {
    const { tasks } = buildRecipe();
    for (const k of KIND_ORDER) {
      assert.equal(promptOf(tasks[`gongmun.${k}`]), systemPrompt(`gongmun.${k}`), k);
      assert.equal(promptOf(tasks[`gongmunReason.${k}`]), systemPrompt(`gongmunReason.${k}`), `${k} 사유`);
    }
    assert.equal(promptOf(tasks.gongmunSetup), systemPrompt('gongmunSetup'));
  });
  t('공문의 작업은 모두 레시피가 만든다 — input.yaml 에는 공문 작업이 없다', () => {
    assert.deepEqual(Object.keys(INPUT_SPEC.tasks).filter((n) => n.startsWith('gongmun')), []);
    assert.deepEqual(Object.keys(TASKS).filter((n) => n.startsWith('gongmun')).sort(),
      ['gongmunSetup', ...KIND_ORDER.flatMap((k) => [`gongmun.${k}`, `gongmunReason.${k}`])].sort());
  });
  t('사유 쓰기 — 칸의 write·example 이 지시문이 되고, 답의 키는 칸의 key, 사유 칸은 꼭 있어야 한다', () => {
    for (const k of KIND_ORDER) {
      const text = systemPrompt(`gongmunReason.${k}`);
      assert.match(text, new RegExp(`${KINDS[k].title} 본문에 들어갈 다음 칸을 공문체로 씁니다: [^\\n]*${REASON_LABEL[k]}`));
      for (const f of FIELDS[k].filter((x) => x.write)) {
        assert.ok(text.includes(`- ${f.key} (글${f.from === 'write' ? ', 필수' : ' 또는 null'})`), `${k}.${f.key}`);
        assert.ok(text.includes(flat(f.write).slice(0, 30)), `${k}.${f.key} 의 write`);
      }
    }
    assert.match(systemPrompt('gongmunReason.outside'), /직무와 상충하지 않는지/, '외부활동 사유 쓰기만의 말은 그 칸의 write 에');
  });
  t('공문 설정 채우기도 레시피(registries/setup.yaml)의 키마다 읽는 법·예시로 — 부분 수정이다', () => {
    const text = systemPrompt('gongmunSetup');
    assert.match(text, /\n {4}- code \(글 또는 null\): 과제번호\. 예: RND-20-2026/);
    assert.match(text, /- 필수가 아닌 키는 사용자가 말하지 않았으면 null 입니다\.$/);
  });
  t('읽은 문서의 이름·누구의 것·온라인으로 보는 말도 레시피에서', () => {
    assert.deepEqual([DOC_NAMES.quote, DOC_NAMES.request, DOC_NAMES.unknown], ['견적서', '요청 공문', '문서']);
    assert.deepEqual(KIND_ORDER.map((k) => whoOf(k, { vendor: 'V', provider: 'P', place: 'L', org: 'O' })), ['V', 'P', 'L', 'O']);
    assert.equal(eduModeOf({ provider: 'Coursera' }), '온라인교육', 'mode 칸의 online 에 있는 말(대소문자 무시)');
    assert.equal(eduModeOf({ place: '인터넷 강의' }), '온라인교육', '띄어쓰기는 보지 않는다');
  });
  t('사유 쓰기의 틀린 칸은 생성기가 막는다 — 쓰지 않는 칸의 write, write 없는 사유 칸, 품의할 것의 없는 이름, 없는 who', () => {
    const broken = structuredClone(readRecipe());
    const trip = purposeOf(broken, 'trip');
    trip.purpose.fields.find((f) => f.key === 'who').write = '출장자를 쓴다';
    delete trip.purpose.fields.find((f) => f.key === 'reason').write;
    trip.purpose.writing.context += '\n출장 예산: {출장예산?}';
    trip.attach.who = 'host';
    const errs = checkRecipe(broken).join('\n');
    assert.match(errs, /fields\[\d+\]\(who\): write 는 from: document·write 칸에만/);
    assert.match(errs, /fields\[\d+\]\(reason\): from: write 칸은 write/);
    assert.match(errs, /trip\/purpose\.yaml writing\.context: \{출장예산\} 가 vars·공통 자리/);
    assert.match(errs, /trip\/attach_rules\.yaml: who\(host\)/);
  });
}

await ta('Claude 가 닿지 않으면 채팅은 규칙 해석으로 내려가고, 그 답도 관문을 지난다', async () => {
  const got = await gongmunSetupSmart('과제: MMC 기반 전력변환 기술 개발, 책임자 박기도 책임', {}, { apiKey: '', useNative: false });
  assert.equal(got.via, 'local');
  assert.deepEqual(got.patch, { projects: [{ name: 'MMC 기반 전력변환 기술 개발', code: null, lead: '박기도', alias: null, period: null, about: null, content: null }] });
  assert.match(got.reply, /과제 1개와 합의자/);
});

console.log(`통과 ${pass}건`);
