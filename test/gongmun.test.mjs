// 공문(전자결재 품의) 작성의 순수 로직 — src/gongmun.js. 틀 채우기·조사·한도·결재선·사전 설정 채우기를 못 박는다.
// 화면 쪽(탭 전환·채팅·한도 차단·새 공문 열기)은 test/wiring.test.mjs 의 "공문 탭" 이 본다.
import assert from 'node:assert/strict';

import {
  KINDS, KIND_ORDER, FORMS, DEFAULT_TEMPLATES, MAX_PROJECTS, PURCHASE_LIMIT, FIELDS,
  templateOf, templateEdited, templatePatch, normalizePreset, normalizeProjects, namesOf, josa, hasBatchim, fillTemplate,
  totalOf, gistOf, fromRecord, blankDraft, overLimit, approvalLine, lineText, compose, needs, bodyHtml, draftUrl, attachName,
  moneyOf, won, dotDate, summaryOf, parseSetupLocal, mergeSetup, attachList, attachBlock, mergeDraft, applyReason, reasonInput, REASON_KEYS,
  eduModeOf, EDU_MODES, spreadParts, attachWithCut,
} from '../src/gongmun.js';
import { structure, systemPrompt, InputError } from '../src/input.js';
import { checkSpec } from '../tools/gen-input.mjs';
import { TASKS } from '../src/input.js';
import { gongmunInput, gongmunSetupSmart } from '../src/llm.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const PRESET = { dept: '연구본부 수소전기추진연구팀', head: '노길태', refs: '홍길동, 이몽룡' };
const PROJECT = { name: 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발', code: 'RND-20-2026', lead: '박기도', about: '', account: '' };
const CTX = { me: '김거화', preset: PRESET, project: PROJECT, today: '2026-10-07' };

console.log('갈래와 양식');
t('갈래는 구매·교육·출장 셋이고 출장만 아직 빈 껍데기다', () => {
  assert.deepEqual(KIND_ORDER, ['purchase', 'edu', 'trip']);
  assert.deepEqual(KIND_ORDER.map((k) => KINDS[k].label), ['구매', '교육', '출장']);
  assert.deepEqual(KIND_ORDER.map((k) => KINDS[k].ready), [true, true, false]);
  assert.deepEqual(FIELDS.trip, []);
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
  const { draft } = fromRecord('edu', { docType: 'course', vendor: '한국전력기술교육원', courseName: '전력변환 설계 실무', courseFrom: '2026-10-12', courseTo: '2026-10-14', total: 450000, gist: 'x' }, { me: '김거화' });
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
t('과제책임자가 기안자이거나 부서장이면 합의는 뺀다', () => {
  const mine = approvalLine({ ...CTX, project: { ...PROJECT, lead: '김거화' } });
  assert.deepEqual(mine.steps.map((s) => s.role), ['기안', '결재']);
  assert.match(mine.notes[0], /기안자라 합의는 뺐습니다/);
  const head = approvalLine({ ...CTX, project: { ...PROJECT, lead: '노 길태' } });
  assert.deepEqual(head.steps.map((s) => s.role), ['기안', '결재']);
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
const EDU_REC = { courseName: '전력변환 설계 실무', vendor: '교육원', courseFrom: '2026-10-12', courseTo: '2026-10-14', total: 450000, use: '전력변환 설계 역량 강화' };
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
  assert.match(c.body, /※ 첨 부\n {4}1\. 교육 견적서 1부\.  끝\.$/, '문서 없이 쓰면 기본 문서 한 줄');
});
t('교육 — 온라인이면 "… 수행을 위한 온라인교육 품의", 고른 교육 구분이 이긴다', () => {
  const { draft } = fromRecord('edu', { ...EDU_REC, vendor: '인프런', place: '온라인' }, { me: '김거화' });
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
t('출장 — 기본 양식의 제목은 "[과제 별명] 수행을 위한 출장 품의", 본문에 과제 개요', () => {
  assert.equal(DEFAULT_TEMPLATES.trip.title, '{과제별명} 수행을 위한 출장 품의');
  const c = compose('trip', { place: '부산', from: '2026-10-20', to: '2026-10-21', purpose: '실증 시험 참관', cost: 300000 }, { ...CTX, project: FULL });
  assert.equal(c.title, '차단기 과제 수행을 위한 출장 품의');
  assert.match(c.body, /가\. 과제 개요\n[\s\S]*나\. 출장 내용\n {4}\(1\) 출 장 지 : 부산\n {4}\(2\) 출장기간 : 2026\. 10\. 20\. ~ 2026\. 10\. 21\. \(2일\)/);
  assert.match(c.body, /\(6\) 예산계정 : 연구활동비\(국내여비\)  끝\.$/);
});
t('구매 — 제목·본문은 그대로(원본에서도 과제 개요를 빼는 lean 목적)', () => {
  assert.equal(DEFAULT_TEMPLATES.purchase.title, '{품목요지} 구매 품의');
  assert.ok(!DEFAULT_TEMPLATES.purchase.body.includes('과제 개요'));
});
t('남은 것 — 과제·부서장·합의자·용도·구매사유', () => {
  assert.deepEqual(needs('purchase', blankDraft('purchase'), { preset: {}, project: null, projects: [] }),
    ['과제 등록(사전 설정)', '부서장(사전 설정)', '부서(사전 설정)', '품목', '합계', '용도', '구매사유']);
  assert.deepEqual(needs('purchase', { gist: 'x', total: 1, use: 'u', reason: 'r' }, { preset: PRESET, project: { name: 'p' }, projects: [{ name: 'p' }] }), ['합의자(과제책임자)']);
});
t('남은 것 — 교육·출장은 제목에 쓸 과제 별명(구매는 묻지 않는다)', () => {
  const edu = { course: 'c', from: '2026-10-12', fee: 1, purpose: 'p', reason: 'r' };
  assert.deepEqual(needs('edu', edu, { preset: PRESET, project: PROJECT, projects: [PROJECT] }), ['과제 별명(사전 설정 — 제목)']);
  assert.deepEqual(needs('edu', edu, { preset: PRESET, project: FULL, projects: [FULL] }), []);
});
t('붙여 넣을 HTML — 들여쓰기는 &nbsp;, 아 래 줄은 가운데', () => {
  const html = bodyHtml('가. 구매\n    (1) A\n\n------------ 아   래 ------------\n<b>');
  assert.equal(html, '<p style="margin:0">가. 구매</p><p style="margin:0">&nbsp;&nbsp;&nbsp;&nbsp;(1) A</p><p style="margin:0">&nbsp;</p>'
    + '<p style="margin:0;text-align:center">------------ 아   래 ------------</p><p style="margin:0">&lt;b&gt;</p>');
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
  assert.deepEqual(attachList('edu'), [{ label: '교육 견적서', files: [] }]);
});
t('첨부 줄 — 마지막 줄에만 끝.', () => {
  assert.equal(attachBlock([{ label: '교육 견적서' }, { label: '교육 내용' }]), '    1. 교육 견적서 1부.\n    2. 교육 내용 1부.  끝.');
});
t('교육 — 견적서와 교육 내용을 함께 읽으면 교육내용 줄과 첨부 두 줄이 들어간다', () => {
  const { draft } = fromRecord('edu', {
    courseName: '전력변환 설계 실무', vendor: '교육원', courseFrom: '2026-10-12', total: 450000, topics: 'DC-DC 컨버터 · 제어 루프 설계',
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
t('사유 칸 — 구매는 구매사유·용도, 교육은 교육사유·교육목적', () => {
  assert.deepEqual(REASON_KEYS, { purchase: { reason: 'reason', use: 'use' }, edu: { reason: 'reason', use: 'purpose' } });
});
t('Claude 에 주는 글에 과제 내용과 품의할 것이 들어가고, 금액·업체는 없다', () => {
  const text = reasonInput('purchase', { items: [{ name: '34인치 모니터', spec: 'WQHD', qty: 1, unit: '대', amount: 890000 }], vendor: 'OO상사', use: '회의용' },
    { ...PROJECT, content: 'MVDC 차단기 시험·평가 체계 구축' });
  assert.match(text, /^품의 종류: 구매품의\n과제명: MW급/);
  assert.match(text, /과제 내용:\n<<<\nMVDC 차단기 시험·평가 체계 구축\n>>>/);
  assert.match(text, /품목: 34인치 모니터 \(WQHD\) × 1대/);
  assert.match(text, /지금 적힌 용도: 회의용/);
  assert.ok(!/890|OO상사/.test(text));
  assert.match(reasonInput('edu', { course: '전력변환 설계', topics: 'DC-DC' }, null), /과제명: \(없음\)[\s\S]*교육 내용: DC-DC/);
});
t('써 온 사유는 넣고, 용도는 사용자가 고쳤으면 둔다', () => {
  const data = { reason: ' 과제의 시험 데이터 검토에 필요함 ', use: '시험 데이터 검토용' };
  assert.deepEqual(applyReason('purchase', { reason: '', use: '' }, data), { reason: '과제의 시험 데이터 검토에 필요함', use: '시험 데이터 검토용' });
  assert.equal(applyReason('purchase', { use: '내가 쓴 용도' }, data, { touched: ['use'] }).use, '내가 쓴 용도');
  assert.equal(applyReason('edu', { purpose: '' }, data).purpose, '시험 데이터 검토용');
});

console.log('사전 설정');
t('과제는 이름이 있는 것만, 다섯 개까지', () => {
  const list = normalizeProjects([{ name: '' }, ...Array.from({ length: 7 }, (_, i) => ({ name: `과제${i}`, about: '개요.', content: ' 연구내용 ' }))]);
  assert.equal(list.length, MAX_PROJECTS);
  assert.equal(list[0].content, '연구내용', '과제 내용도 담는다');
  assert.equal(list[0].about, '개요', '끝의 마침표는 틀이 붙인다');
  const [one] = normalizeProjects([{ name: '과제', alias: ' 차단기 과제 ', period: '2026.04.01 ~ 2029.12.31' }]);
  assert.deepEqual([one.alias, one.period], ['차단기 과제', '2026.04.01 ~ 2029.12.31'], '별명·연구기간도 담는다');
  assert.deepEqual(normalizePreset({ refs: '가, 나' }), { dept: '', head: '', refs: ['가', '나'] });
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
t('얹기 — 이름·번호가 같은 과제는 고치고, 빈 줄을 먼저 채우고, 다섯 개를 넘으면 뺀다', () => {
  const rows = [{ name: PROJECT.name, code: '', lead: '' }, { name: '' }];
  const res = mergeSetup(rows, { head: '옛 부서장' }, {
    projects: [{ name: PROJECT.name, lead: '박기도 책임' }, { name: '새 과제 A', code: 'RND-1' }, { name: '새 과제 B' }],
    head: '노길태', refs: '홍길동',
  });
  assert.deepEqual(res.rows.map((r) => [r.name, r.lead]), [[PROJECT.name, '박기도'], ['새 과제 A', ''], ['새 과제 B', '']]);
  assert.deepEqual(res.preset, { dept: '', head: '노길태', refs: ['홍길동'] });
  assert.equal(res.skipped.length, 0);
  const full = Array.from({ length: 5 }, (_, i) => ({ name: `과제${i}`, code: `C${i}` }));
  const over = mergeSetup(full, {}, { projects: [{ name: '여섯째' }, { name: '다른이름', code: 'C2', lead: '박기도' }] });
  assert.deepEqual(over.skipped, ['여섯째']);
  assert.equal(over.rows[2].lead, '박기도', '번호가 같으면 같은 과제');
  assert.equal(over.rows[2].name, '과제2', '이미 있는 과제 이름은 두고');
});
t('얹기 — 사람만 왔으면 지금 고른 과제의 합의자, 고른 과제가 없으면 넣지 못한다', () => {
  assert.equal(mergeSetup([{ name: '과제A' }], {}, { lead: '박기도' }, { current: '과제A' }).rows[0].lead, '박기도');
  assert.match(mergeSetup([{ name: '과제A' }], {}, { lead: '박기도' }).skipped[0], /어느 과제인지 모릅니다/);
});

console.log('입력 명세 — gongmun·gongmunSetup');
t('명세가 맞다(목록 형 포함)', () => assert.deepEqual(checkSpec({ tasks: TASKS }), []));
t('목록 안의 목록·줄 칸이 없는 목록은 생성기가 거부한다', () => {
  const broken = structuredClone({ tasks: TASKS });
  broken.tasks.gongmun.fields.items.item.sub = { type: 'list', desc: '안', item: { a: { type: 'string', desc: 'a' } } };
  broken.tasks.gongmunSetup.fields.projects.item = {};
  const errors = checkSpec(broken).join('\n');
  assert.match(errors, /items\.sub: 목록 안에 목록을 둘 수 없습니다/);
  assert.match(errors, /projects: 목록은 줄의 칸\(item\)이 있어야 합니다/);
});
t('지시문에 목록의 줄 칸이 들여 적힌다', () => {
  const text = systemPrompt('gongmun');
  assert.match(text, /- items \(목록\(30줄까지\) — 줄마다 아래 키의 객체 또는 null\)/);
  assert.match(text, /\n {4}- name \(글, 필수\): 품목명/);
});
t('관문 — 품목명이 없는 줄은 빼고 알린다, 목록이 아니면 비운다', () => {
  const { data, notes } = structure('gongmun', { docType: 'quote', gist: '모니터', summary: '견적서', items: [{ name: 'A', qty: '2', amount: '1000' }, { qty: 1 }, 'x'], total: '1000' });
  assert.deepEqual(data.items, [{ name: 'A', spec: null, qty: 2, unit: null, unitPrice: null, amount: 1000 }]);
  assert.deepEqual(notes, ['품목 중 2줄은 받을 수 없어 뺐습니다']);
  assert.equal(structure('gongmun', { docType: 'quote', gist: 'g', summary: 's', items: 'A' }).data.items, null);
  assert.throws(() => structure('gongmun', { docType: 'quote', summary: 's' }), InputError);
});
t('사전 설정 조각은 부분 수정 — 말하지 않은 칸은 빠진다', () => {
  assert.deepEqual(structure('gongmunSetup', { projects: [{ name: '과제', lead: '박기도' }], head: null, reply: '채웠습니다' }).data,
    { projects: [{ name: '과제', code: null, lead: '박기도', alias: null, period: null, about: null, content: null }], reply: '채웠습니다' });
});
t('읽기는 파일마다 문서 종류(parts)를 돌려준다 — 모르는 종류의 줄은 뺀다', () => {
  const { data, notes } = structure('gongmun', { docType: 'quote', gist: 'g', summary: 's', parts: [{ file: 'a.png', kind: 'quote' }, { file: 'b.png', kind: 'menu' }] });
  assert.deepEqual(data.parts, [{ file: 'a.png', kind: 'quote' }]);
  assert.deepEqual(notes, ['파일 중 1줄은 받을 수 없어 뺐습니다']);
});
t('사유 쓰기의 답은 사유가 꼭 있어야 한다', () => {
  assert.deepEqual(structure('gongmunReason', { reason: '필요함', use: null }).data, { reason: '필요함', use: null });
  assert.throws(() => structure('gongmunReason', { use: 'x' }), InputError);
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
  assert.deepEqual(attach.map((a) => [a.label, a.files.length]), [['교육 견적서', 1], ['교육 안내문', 1], ['교육 내용', 6]]);
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
  const { data, notes } = structure('gongmun', {
    docType: 'order', gist: 'g', summary: 's',
    quoteArea: [{ file: 'a.png', left: 5, top: 10, right: 95, bottom: 40 }, { file: 'b.png', left: -1, top: 0, right: 50, bottom: 50 }, { file: 'c.png', left: 0, top: 0 }],
  });
  assert.deepEqual(data.quoteArea, [{ file: 'a.png', left: 5, top: 10, right: 95, bottom: 40 }]);
  assert.deepEqual(notes, ['견적서로 오릴 칸 중 2줄은 받을 수 없어 뺐습니다']);
  assert.match(systemPrompt('gongmun'), /quoteArea 는 구매일 때만 적습니다/);
});

await ta('Claude 가 닿지 않으면 채팅은 규칙 해석으로 내려가고, 그 답도 관문을 지난다', async () => {
  const got = await gongmunSetupSmart('과제: MMC 기반 전력변환 기술 개발, 책임자 박기도 책임', {}, { apiKey: '', useNative: false });
  assert.equal(got.via, 'local');
  assert.deepEqual(got.patch, { projects: [{ name: 'MMC 기반 전력변환 기술 개발', code: null, lead: '박기도', alias: null, period: null, about: null, content: null }] });
  assert.match(got.reply, /과제 1개와 합의자/);
});

console.log(`통과 ${pass}건`);
