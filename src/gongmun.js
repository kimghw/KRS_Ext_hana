// 공문(eclass 전자결재 품의) 작성의 순수 로직. 화면도 네트워크도 모른다 — 읽은 견적서·교육 안내문에서 무엇을 꺼내
// 어떤 틀(양식)에 넣을지, 결재선을 누구로 할지, 한도를 넘었는지만 정한다. 화면은 gongmunpanel.js 가, 문서 읽기는
// src/llm.js 의 gongmunSmart 가 한다.
//
// 원본은 krs-web-agents 의 ea_approval(연구업무추진품의 — eclass 전자결재 RealEANet 의 FORMID KR_EA_Research_Task)이다.
// 거기서는 Playwright 가 전자결재 화면에 직접 넣지만, 확장은 아직 넣지 않는다(2026-10-07) — 패널에서 제목·본문·결재선을 다 만들어
// 보여 주고, 새 공문 창을 열어 붙여 넣게 한다. 본문 편집기(DEXT5)는 실제 키 입력·붙여넣기만 저장한다(스크립트로 넣은 것은
// 저장되지 않는다 — 원본 KRS_ECLASS_APPROVAL.md §4). 사용자의 Ctrl+V 는 저장된다.
//
// 갈래는 구매·교육·출장 셋이다(2026-10-07 사용자 지정). 출장은 아직 빈 껍데기 — 양식만 보고 고칠 수 있다.
// 갈래마다 양식(eclass 양식·제목 틀·본문 틀)은 패널에서 보고 고친다(2026-10-07 사용자 지정 — "어떤 양식으로 할지는 거기서 보고 수정").

import { ORIGIN } from './config.js';

/* ------------------------------------------------------------ 저장소 키 */

export const KIND_KEY = 'gongmunKind';
export const PRESET_KEY = 'gongmunPreset';
export const PROJECTS_KEY = 'gongmunProjects';
export const TEMPLATES_KEY = 'gongmunTemplates';
export const DRAFT_KEY = 'gongmunDraft';

/** 과제는 다섯 개까지 등록해 두고 고른다(2026-10-07 사용자 지정). */
export const MAX_PROJECTS = 5;

/**
 * 부서 구매 품의는 100만원 이하(부가세 포함 합계)만 작성한다(2026-10-07 사용자 지정). 넘으면 본문을 만들지 않는다 —
 * 그보다 큰 구매는 결재선(원본 ea_rules.yaml 의 구매 구간)과 첨부(500만원 이상 비교견적서)가 달라 이 틀로 올리면 안 된다.
 */
export const PURCHASE_LIMIT = 1_000_000;

/**
 * 갈래. limit 는 합계 한도(원, 없으면 null), reads 는 문서를 넣어 읽는 갈래인가, account 는 계정의 기본값이다
 * (과제에 계정을 적어 두면 그것이 이긴다). 출장은 아직 읽지 않는다(ready: false — 빈 껍데기).
 */
// doc 은 문서 없이 쓸 때의 첨부 한 줄, ask 는 문서 넣는 곳의 말, more 는 이미 읽은 초안에 더 넣을 때의 말이다.
// 교육은 교육 견적서와 교육 내용(커리큘럼) 캡처를 같이 넣어 둘 다 첨부한다(2026-10-07 사용자 지정).
export const KINDS = {
  purchase: {
    label: '구매', title: '구매품의', ready: true, reads: true, limit: PURCHASE_LIMIT, account: '연구활동비(연구실운용비)',
    doc: '견적서', ask: '견적서를 넣으세요', more: '견적서 다음 쪽·거래명세서 더 넣기',
  },
  edu: {
    label: '교육', title: '교육품의', ready: true, reads: true, limit: null, account: '연구활동비(교육훈련비)',
    doc: '교육 견적서', ask: '교육 견적서·교육 내용을 넣으세요', more: '교육 내용(커리큘럼) 캡처 더 넣기',
  },
  trip: { label: '출장', title: '출장품의', ready: false, reads: false, limit: null, account: '연구활동비(국내여비)', doc: '', ask: '', more: '' },
};
export const KIND_ORDER = ['purchase', 'edu', 'trip'];

/**
 * eclass 전자결재 양식. 본문을 붙여 넣는 양식만 둔다 — 구매요청서(KR_Purchase_Order)는 칸이 정해진 폼이라 이 틀로 채울 수 없다.
 * 목록에 없는 양식은 양식 ID 를 직접 적는다.
 */
export const FORMS = [
  { id: 'KR_EA_Research_Task', label: '연구업무추진품의' },
  { id: 'KR_EA_Form2', label: '기안문' },
];
export const DEFAULT_FORM = 'KR_EA_Research_Task';

/* ------------------------------------------------------------ 양식(틀) */

// 본문 틀의 들여쓰기는 원본(ea_overview.yaml·body_spec.yaml)과 같다. `{이름}` 은 값으로 바뀌고, `{이름:은}` 은 값 뒤에
// 받침에 맞는 조사(은/는·이/가·을/를·과/와·으로/로)를 붙인다. `{이름?}` 이 있는 줄은 그 값이 비면 줄째 뺀다.
// `{{#품목}} … {{/품목}}` 은 품목마다 되풀이한다. `{차례}` 는 가·나·다… 를 차례로 매긴다 — 빠진 줄은 건너뛰고 잇는다.
// `{세부차례}` 는 (1)·(2)… 를 매기고 `{차례}` 줄마다 새로 센다(원본 연구공문의 '가. 과제 개요 / 나. … 내역 / (1) …' 꼴).
// 첨부 목록(`{첨부}`)은 읽은 파일마다 무슨 문서인지로 만든다(교육이면 교육 견적서·교육 내용 — 2026-10-07 사용자 지정).
//
// 교육·출장의 제목은 "[과제 별명] 수행을 위한 [교육|온라인교육|출장] 품의" 다(2026-10-07 사용자 지정). 본문은 원본 연구공문처럼
// '가. 과제 개요'(과제명·번호·연구기간·책임자 — 사전 설정의 과제 기본 내용)를 앞에 두고 '나.' 에 품의할 내용을 적는다.
// 구매는 원본에서도 과제 개요를 빼는 lean 목적이라(body_spec.yaml 의 skip) 제목·본문을 그대로 둔다.
const SEP = '------------ 아   래 ------------';

/** 본문의 '가. 과제 개요' — 교육·출장이 같이 쓴다. 값이 빈 줄(번호·기간·책임자)은 빠진다. */
const OVERVIEW = [
  '{차례}. 과제 개요',
  '    {세부차례} 과 제 명 : {과제명}',
  '    {세부차례} 과제번호 : {과제번호?}',
  '    {세부차례} 연구기간 : {연구기간?}',
  '    {세부차례} 과제책임자 : {과제책임자?}',
];

export const DEFAULT_TEMPLATES = {
  purchase: {
    form: DEFAULT_FORM,
    title: '{품목요지} 구매 품의',
    body: [
      '1. {부서:은} {과제개요}.',
      '2. 이와 관련하여 {요약} 아래와 같이 품의하오니 재가하여 주시기 바랍니다.',
      '',
      SEP,
      '',
      '{차례}. 구매 내역',
      '{{#품목}}',
      '    ({번호}) 구매품 : {품목명}',
      '        - 사양 : {사양?}',
      '        - 수량 : {수량?}',
      '        - 금액 : {금액?}',
      '{{/품목}}',
      '{차례}. 구매금액 : {합계} (VAT 포함)',
      '{차례}. 구매처 : {업체}',
      '{차례}. 구매계정 : {계정}',
      '{차례}. 용도 : {용도}',
      '{차례}. 구매사유 : {구매사유}',
      '',
      '※ 첨 부',
      '{첨부}',
    ].join('\n'),
  },
  edu: {
    form: DEFAULT_FORM,
    title: '{과제별명} 수행을 위한 {교육구분} 품의',
    body: [
      '1. {부서:은} {과제개요}.',
      '2. 이와 관련하여 {교육목적:을} 위하여 아래와 같이 {교육구분:에} 참가하고자 하오니 재가하여 주시기 바랍니다.',
      '',
      SEP,
      '',
      ...OVERVIEW,
      '{차례}. 교육 내용',
      '    {세부차례} 교 육 명 : {교육명}',
      '    {세부차례} 교육기관 : {교육기관}',
      '    {세부차례} 교육기간 : {교육기간}',
      '    {세부차례} 교육시간 : {교육시간?}',
      '    {세부차례} 교육장소 : {교육장소}',
      '    {세부차례} 교육내용 : {교육내용?}',
      '    {세부차례} 참 석 자 : {참석자}',
      '    {세부차례} 교 육 비 : {교육비} (VAT 포함)',
      '    {세부차례} 예산계정 : {계정}',
      '    {세부차례} 교육사유 : {교육사유}',
      '',
      '※ 첨 부',
      '{첨부}',
    ].join('\n'),
  },
  trip: {
    form: DEFAULT_FORM,
    title: '{과제별명} 수행을 위한 출장 품의',
    body: [
      '1. {부서:은} {과제개요}.',
      '2. 이와 관련하여 {출장목적:을} 위하여 아래와 같이 출장하고자 하오니 재가하여 주시기 바랍니다.',
      '',
      SEP,
      '',
      ...OVERVIEW,
      '{차례}. 출장 내용',
      '    {세부차례} 출 장 지 : {출장지}',
      '    {세부차례} 출장기간 : {출장기간}',
      '    {세부차례} 출 장 자 : {출장자}',
      '    {세부차례} 출장목적 : {출장목적}',
      '    {세부차례} 예상경비 : {예상경비}',
      '    {세부차례} 예산계정 : {계정}  끝.',
    ].join('\n'),
  },
};

/** 틀에 쓸 수 있는 이름 — 양식 칸 아래에 [적는 꼴, 뜻] 으로 보여 준다. 공통 이름은 갈래마다 앞에 붙는다. */
const tokens = (pairs) => pairs.map(([k, desc]) => [`{${k}}`, desc]);
const COMMON_VARS = tokens([
  ['부서', '사전 설정의 부서'], ['기안자', '내 이름'], ['과제명', '고른 과제'], ['과제별명', '고른 과제의 별명 — 제목에 쓴다(비면 과제명)'],
  ['과제번호', '고른 과제의 번호'], ['연구기간', '고른 과제의 연구기간'],
  ['과제책임자', '고른 과제의 책임자(합의자)'], ['과제개요', '과제 개요(비면 「과제명」 과제를 수행하고 있습니다)'], ['계정', '계정'], ['오늘', '오늘 날짜'],
  ['첨부', '첨부 목록 — 읽은 문서마다 한 줄, 마지막 줄에 끝.'],
]);
export const VARS = {
  purchase: [...COMMON_VARS, ...tokens([['품목요지', '제목에 쓸 품목 이름'], ['요약', '…을 구매하고자'], ['업체', '구매처'], ['견적일', '견적일'],
    ['합계', '합계(원)'], ['용도', '용도'], ['구매사유', '구매사유(과제 내용으로 쓴다)'], ['품목수', '품목 수']]),
  ['{{#품목}} … {{/품목}}', '품목마다 되풀이 — 안에서 {번호}·{품목명}·{사양}·{수량}·{단가}·{금액}']],
  edu: [...COMMON_VARS, ...tokens([['교육구분', '교육 또는 온라인교육 — 교육 구분 칸(교육장소가 온라인이면 저절로)'], ['교육명', '교육명'],
    ['교육기관', '교육기관'], ['교육기간', '시작 ~ 끝(며칠)'], ['교육시간', '교육시간'],
    ['교육장소', '교육장소'], ['교육내용', '교육 내용(커리큘럼)'], ['참석자', '참석자'], ['교육비', '교육비(원)'], ['교육목적', '교육목적'],
    ['교육사유', '교육사유(과제 내용으로 쓴다)']])],
  trip: [...COMMON_VARS, ...tokens([['출장지', '출장지'], ['출장기간', '출장기간'], ['출장자', '출장자'], ['출장목적', '출장목적'], ['예상경비', '예상경비']])],
};
/** 틀의 꾸밈 — 이름 뒤에 붙인다. */
export const VAR_MARKS = [
  ['{이름:은}', '받침에 맞춰 은/는 — 이/가·을/를·과/와·으로/로도 된다'], ['{이름?}', '값이 비면 그 줄을 뺀다'],
  ['{차례}', '가·나·다… 를 차례로 — 빠진 줄은 건너뛰고 잇는다'],
  ['{세부차례}', '(1)·(2)… 를 차례로 — {차례} 줄마다 새로 세고, 빠진 줄은 건너뛴다'],
];

/** 교육 구분 — 제목의 "… 수행을 위한 교육 품의 / 온라인교육 품의"(2026-10-07 사용자 지정). */
export const EDU_MODES = ['교육', '온라인교육'];
const ONLINE_RE = /온라인|online|비대면|원격|이러닝|e-?learning|웨비나|webinar|인터넷\s*강의|인강|동영상\s*강의|\bVOD\b|인프런|inflearn|유데미|udemy|코세라|coursera|패스트캠퍼스|클래스101|K-?MOOC/i;

/** 교육 구분을 정한다 — 칸에 고른 것이 먼저, 없으면 교육장소·교육기관이 온라인이면 온라인교육. */
export function eduModeOf(draft) {
  const picked = String(draft?.mode ?? '').trim();
  if (EDU_MODES.includes(picked)) return picked;
  return ONLINE_RE.test(`${draft?.place ?? ''} ${draft?.provider ?? ''}`) ? '온라인교육' : '교육';
}

const text = (v, max = 4000) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').slice(0, max) : '');

/** 저장해 둔 양식(고친 것만 있다)을 기본 양식 위에 얹는다. 비운 칸은 기본으로 돌아간다. */
export function templateOf(kind, saved) {
  const base = DEFAULT_TEMPLATES[kind] || DEFAULT_TEMPLATES.purchase;
  const mine = saved && typeof saved === 'object' ? saved[kind] : null;
  const pick = (key) => (text(mine?.[key]).trim() ? text(mine[key]) : base[key]);
  return { form: pick('form').trim(), title: pick('title').trim(), body: pick('body') };
}

/** 양식을 고쳤는가(기본 양식과 다른가). */
export function templateEdited(kind, saved) {
  const base = DEFAULT_TEMPLATES[kind];
  const now = templateOf(kind, saved);
  return !!base && (now.form !== base.form || now.title !== base.title || now.body !== base.body);
}

/** 고친 양식을 저장할 모양으로. 기본 양식과 같은 칸은 담지 않는다 — 나중에 기본 양식이 바뀌면 따라가게. */
export function templatePatch(kind, edited) {
  const base = DEFAULT_TEMPLATES[kind];
  const out = {};
  for (const key of ['form', 'title', 'body']) {
    const v = key === 'body' ? text(edited?.[key]) : text(edited?.[key]).trim();
    if (v.trim() && v !== base[key]) out[key] = v;
  }
  return out;
}

/* ------------------------------------------------------------ 사전 설정·과제 */

/** 이름 목록 — 쉼표·가운뎃점·줄바꿈으로 나눈다. 같은 이름은 한 번만. */
export function namesOf(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[,，·\n;]+/);
  return [...new Set(list.map((s) => String(s ?? '').trim()).filter(Boolean))].slice(0, 20);
}

/** 사전 설정 — 부서(본문 첫 줄), 부서장(결재), 참조자. */
export function normalizePreset(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return { dept: text(r.dept, 100).trim(), head: text(r.head, 40).trim(), refs: namesOf(r.refs) };
}

/**
 * 과제 — 이름은 반드시, 나머지(별명·번호·책임자(합의자)·연구기간·개요·내용·계정)는 있으면. 다섯 개까지.
 * 내용(content)은 연구목표·연구내용이다 — 품의의 사유(구매사유·교육사유)를 쓰는 근거가 된다(2026-10-07 사용자 지정).
 * 별명(alias)은 교육·출장 품의 제목("[과제 별명] 수행을 위한 … 품의")에, 연구기간(period)은 본문 '과제 개요'에 들어간다.
 */
export function normalizeProjects(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((p) => ({
      name: text(p?.name, 200).trim(), alias: text(p?.alias, 60).trim(), code: text(p?.code, 40).trim(), lead: text(p?.lead, 40).trim(),
      period: text(p?.period, 60).trim(),
      about: text(p?.about, 300).trim().replace(/[.。]+$/, ''), content: text(p?.content, 3000).trim(), account: text(p?.account, 60).trim(),
    }))
    .filter((p) => p.name)
    .slice(0, MAX_PROJECTS);
}

/* ------------------------------------------------------------ 글 다듬기 */

export const won = (n) => (Number.isFinite(n) ? `${Math.round(n).toLocaleString('ko-KR')}원` : '');

/** 숫자로 적힌 금액("1,239,000원", "1239000")을 수로. 못 읽으면 null. */
export function moneyOf(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  const s = String(v ?? '').replace(/[,\s원₩]/g, '');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/** 공문의 날짜 표기 — 2026. 10. 7. */
export const dotDate = (ymd) => {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}. ${+m[2]}. ${+m[3]}.` : '';
};

const DIGIT_BATCHIM = [true, true, false, true, false, false, true, true, true, false]; // 영 일 이 삼 사 오 육 칠 팔 구

/** 끝 글자에 받침이 있는가. 한글·숫자만 가린다 — 영문 등 모르면 null. 끝의 괄호(모델명 등)는 건너뛴다. */
export function hasBatchim(word) {
  const s = String(word ?? '').trim().replace(/\s*[([（][^)\]）]*[)\]）]$/, '').trim();
  const c = s.at(-1);
  if (!c) return null;
  const code = c.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/\d/.test(c)) return DIGIT_BATCHIM[+c];
  return null;
}

/** ㄹ 받침인가 — '으로/로' 는 ㄹ 받침 뒤에 '로' 다. */
const rieul = (word) => {
  const c = String(word ?? '').trim().at(-1);
  const code = c ? c.charCodeAt(0) : 0;
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8;
};

const JOSA = { 은: ['은', '는'], 는: ['은', '는'], 이: ['이', '가'], 가: ['이', '가'], 을: ['을', '를'], 를: ['을', '를'], 과: ['과', '와'], 와: ['과', '와'], 으로: ['으로', '로'], 로: ['으로', '로'] };

/** 낱말 뒤에 받침에 맞는 조사를 붙인다. 받침을 모르면 '을(를)' 처럼 둘 다 적는다. */
export function josa(word, mark) {
  const pair = JOSA[mark];
  if (!pair) return `${word}${mark}`;
  const b = hasBatchim(word);
  if (b == null) return `${word}${pair[0]}(${pair[1]})`;
  if (pair[0] === '으로') return `${word}${b && !rieul(word) ? '으로' : '로'}`;
  return `${word}${b ? pair[0] : pair[1]}`;
}

/* ------------------------------------------------------------ 틀 채우기 */

/**
 * 틀을 값으로 채운다.
 *   {이름}      값. 값이 비면 [이름] 으로 남겨 눈에 띄게 하고 missing 에 적는다
 *   {이름:은}   값 + 받침에 맞는 조사
 *   {이름?}     값이 비면 그 줄을 뺀다(빠져도 되는 칸)
 *   {{#목록}}…{{/목록}}  목록의 항목마다 되풀이한다. 안에서는 항목의 이름이 먼저 보인다
 *   {차례}      가·나·다… 를 차례로 매긴다 — 빠진 줄을 건너뛰고 남은 줄끼리 잇는다
 *   {세부차례}  (1)·(2)… 를 차례로 매긴다 — {차례} 줄을 만날 때마다 새로 센다
 * 모르는 이름은 그대로 둔다 — 오타가 화면에 보이게. 값에 줄바꿈이 있으면 여러 줄이 된다({첨부}).
 * @returns {{text: string, missing: string[]}}
 */
export function fillTemplate(tpl, vars = {}, lists = {}) {
  const missing = new Set();
  const known = (scope, key) => Object.hasOwn(scope, key);
  const one = (line, scope) => {
    let drop = false;
    const out = line.replace(/\{([^{}:?\s]+)(?::([^{}\s]+))?(\?)?\}/g, (whole, key, mark, optional) => {
      if (!known(scope, key)) return whole;
      const raw = scope[key] == null ? '' : String(scope[key]);
      const v = raw.trim();
      if (!v) {
        if (optional) drop = true;
        else missing.add(key);
        return optional ? '' : `[${key}]`;
      }
      if (mark) return josa(v, mark);
      // 한 줄을 혼자 차지한 값({첨부})은 제 들여쓰기가 꼴이다 — 앞 빈칸을 지킨다.
      return line.trim() === whole ? raw.replace(/\s+$/, '') : v;
    });
    return drop ? null : out;
  };
  const lines = (src, scope) => src.split('\n').map((l) => one(l, scope)).filter((l) => l != null);
  const expanded = String(tpl ?? '').replace(/\{\{#([^{}\s]+)\}\}\n?([\s\S]*?)\{\{\/\1\}\}\n?/g, (whole, name, inner) => {
    const rows = lists[name];
    if (!Array.isArray(rows)) return whole;
    const body = inner.replace(/\n$/, '');
    // 줄이 다 빠진 항목은 빈 줄도 남기지 않는다.
    return rows.map((row, i) => {
      const got = lines(body, { ...vars, 번호: String(i + 1), ...row });
      return got.length ? `${got.join('\n')}\n` : '';
    }).join('');
  });
  let n = 0;
  let sub = 0;
  const out = lines(expanded, vars).map((line) => line
    .replace(/\{차례\}/g, () => { sub = 0; return ORDER[n++] || ORDER.at(-1); })
    .replace(/\{세부차례\}/g, () => `(${++sub})`)).join('\n');
  return { text: out, missing: [...missing] };
}

/** 공문의 항목 차례. */
const ORDER = [...'가나다라마바사아자차카타파하'];

/* ------------------------------------------------------------ 초안의 칸 */

/**
 * 초안의 칸 — 화면이 이 차례로 그린다. type: money(원, 쉼표로 보인다)·date·choice(options 중 하나), 그 밖은 글.
 * area 는 여러 줄, wide 는 한 줄을 다 쓴다. 출장은 아직 칸이 없다(빈 껍데기).
 */
export const FIELDS = {
  purchase: [
    { key: 'gist', label: '품목 요지 (제목)', wide: true },
    { key: 'vendor', label: '구매처' },
    { key: 'total', label: '합계 (VAT 포함, 원)', type: 'money' },
    { key: 'use', label: '용도', wide: true },
    { key: 'reason', label: '구매사유', wide: true, area: true, placeholder: '과제와 이어지는 필요성 — 비워 두지 않습니다' },
    { key: 'summary', label: '요약 (2. 이와 관련하여 …)', wide: true },
    { key: 'account', label: '구매계정', wide: true },
  ],
  edu: [
    { key: 'course', label: '교육명', wide: true },
    { key: 'provider', label: '교육기관' },
    { key: 'fee', label: '교육비 (VAT 포함, 원)', type: 'money' },
    { key: 'from', label: '시작일', type: 'date' },
    { key: 'to', label: '종료일', type: 'date' },
    { key: 'place', label: '교육장소' },
    // 제목의 교육·온라인교육. 읽을 때 교육장소·교육기관으로 정하고, 손대지 않았으면 교육장소를 고칠 때 따라간다(eduModeOf).
    { key: 'mode', label: '교육 구분 (제목)', type: 'choice', options: EDU_MODES },
    { key: 'hours', label: '교육시간', wide: true },
    { key: 'topics', label: '교육내용', wide: true, area: true },
    { key: 'attendees', label: '참석자', wide: true },
    { key: 'purpose', label: '교육목적', wide: true },
    { key: 'reason', label: '교육사유', wide: true, area: true, placeholder: '과제와 이어지는 필요성 — 비워 두지 않습니다' },
    { key: 'account', label: '예산계정', wide: true },
  ],
  trip: [],
};

/** 구매의 요약 줄 — "모니터 외 1건을 구매하고자". 품목 요지를 고치면 요약도 따라간다(요약을 손대지 않았을 때). */
export const summaryOf = (gist) => (String(gist ?? '').trim() ? `${josa(String(gist).trim(), '을')} 구매하고자` : '');

/* ------------------------------------------------------------ 읽은 문서 → 초안 */

const sum = (list) => list.reduce((a, b) => a + b, 0);
const qtyText = (it) => (it.qty != null ? `${Number(it.qty).toLocaleString('ko-KR')}${it.unit || ''}` : '');

/** 구매의 합계. 문서의 최종 금액이 먼저고, 없으면 공급가액+부가세, 그것도 없으면 품목 금액을 더한다(부가세 포함인지 모른다). */
export function totalOf(rec) {
  if (Number.isFinite(rec?.total)) return { total: rec.total, note: '' };
  if (Number.isFinite(rec?.supply) && Number.isFinite(rec?.vat)) return { total: rec.supply + rec.vat, note: '' };
  const amounts = (rec?.items || []).map((it) => it?.amount).filter(Number.isFinite);
  if (amounts.length && amounts.length === (rec?.items || []).length) {
    return { total: sum(amounts), note: '문서에 합계가 없어 품목 금액을 더했습니다 — 부가세가 들었는지 확인해 주세요' };
  }
  return { total: null, note: '합계를 읽지 못했습니다 — 직접 적어 주세요' };
}

/** 제목에 쓸 품목 이름 — 첫 품목에 "외 N건". */
export function gistOf(items, fallback = '') {
  const first = String(items?.[0]?.name || '').trim();
  if (!first) return String(fallback || '').trim();
  return items.length > 1 ? `${first} 외 ${items.length - 1}건` : first;
}

/** 첨부 목록에 적는 문서 이름 — 읽은 파일의 종류(input.yaml gongmun 의 parts.kind)마다. */
const PART_LABEL = {
  purchase: { quote: '견적서', statement: '거래명세서', order: '주문 내역', course: '안내문', content: '참고 자료', other: '참고 자료' },
  edu: { quote: '교육 견적서', statement: '교육비 청구서', order: '교육 신청 내역', course: '교육 안내문', content: '교육 내용', other: '참고 자료' },
};

/**
 * 첨부 목록 — 읽은 파일을 문서 종류로 묶는다. 교육이면 교육 견적서·교육 내용이 따로 한 줄씩이 된다(2026-10-07 사용자 지정).
 * 파일이 없으면(글을 붙여 넣었거나 손으로 쓴다) 갈래의 기본 문서(견적서·교육 안내문) 한 줄이다.
 * @param {{file:string, kind:string}[]} parts 읽기가 가린 파일마다의 종류
 * @param {string[]} files 읽은 파일 이름(넣은 차례)
 * @returns {{label: string, files: string[]}[]}
 */
export function attachList(kind, parts = [], files = []) {
  const names = PART_LABEL[kind] || PART_LABEL.purchase;
  const out = [];
  for (const file of files) {
    const part = (parts || []).find((p) => p?.file === file);
    const label = names[part?.kind] || KINDS[kind]?.doc || '첨부';
    const group = out.find((g) => g.label === label);
    if (group) group.files.push(file);
    else out.push({ label, files: [file] });
  }
  return out.length ? out : [{ label: KINDS[kind]?.doc || '첨부', files: [] }];
}

/**
 * 읽기가 가린 파일 종류(parts)를 같은 묶음의 나머지 파일에도 편다 — 웹페이지를 통째로 캡처한 장들(src/pagecap.js)은 한 묶음(group)인데,
 * 읽기에는 앞의 몇 장만 보내고 나머지는 첨부에만 넣으니(gongmunpanel.js 의 MAX_FILES) 그 장들은 parts 에 없다. 묶음 안에서 앞서 가린
 * 종류를 이어 받는다(앞 장이 교육 내용이면 뒤 장도 교육 내용). 묶음에 가린 것이 하나도 없으면 그대로 둔다 — 갈래의 기본 문서가 된다.
 * @param {{file:string, kind:string}[]|null} parts 읽기의 답
 * @param {{name:string, group?:string}[]} files 넣은 차례의 파일
 * @returns {{file:string, kind:string}[]}
 */
export function spreadParts(parts, files = []) {
  const out = (Array.isArray(parts) ? parts : []).filter((p) => p && typeof p.file === 'string' && p.kind).map((p) => ({ file: p.file, kind: p.kind }));
  const last = {};
  for (const f of files || []) {
    const have = out.find((p) => p.file === f?.name);
    if (have) {
      if (f.group) last[f.group] = have.kind;
      continue;
    }
    if (f?.group && last[f.group]) out.push({ file: f.name, kind: last[f.group] });
  }
  return out;
}

/** 본문의 첨부 줄 — "    1. 교육 견적서 1부." … 마지막 줄 끝에 "  끝." */
export function attachBlock(attach) {
  const list = (attach || []).filter((a) => String(a?.label || '').trim());
  return list.map((a, i) => `    ${i + 1}. ${a.label} 1부.${i === list.length - 1 ? '  끝.' : ''}`).join('\n');
}

/**
 * 읽은 문서(input.yaml 의 gongmun 기록)로 갈래의 초안을 만든다. 화면의 칸이 이것을 들고, 사용자가 고친다.
 * @param {'purchase'|'edu'|'trip'} kind
 * @param {object} rec 관문(src/input.js structure)을 지난 기록
 * @param {{me?: string, files?: string[]}} [ctx] files 는 읽은 파일 이름 — 첨부 목록이 된다
 * @returns {{draft: object, notes: string[]}}
 */
export function fromRecord(kind, rec, { me = '', files = [] } = {}) {
  const r = rec && typeof rec === 'object' ? rec : {};
  const notes = [];
  const krw = !r.currency || r.currency === 'KRW';
  if (!krw) notes.push(`${r.currency} 문서입니다 — 합계를 원화로 고쳐 주세요`);
  const attach = attachList(kind, r.parts, files);
  if (kind === 'edu') {
    const fee = Number.isFinite(r.total) ? r.total : Number.isFinite(r.supply) && Number.isFinite(r.vat) ? r.supply + r.vat : null;
    if (fee == null) notes.push('교육비를 읽지 못했습니다 — 직접 적어 주세요');
    const draft = {
      course: r.courseName || r.gist || '', provider: r.vendor || '', from: r.courseFrom || '', to: r.courseTo || '',
      hours: r.courseHours || '', place: r.place || '', topics: r.topics || '', fee, currency: r.currency || 'KRW', attendees: me,
      purpose: r.use || '', reason: '', account: '', attach,
    };
    return { draft: { ...draft, mode: eduModeOf(draft) }, notes };
  }
  const items = (r.items || []).map((it) => ({
    name: it.name || '', spec: it.spec || '', qty: it.qty ?? null, unit: it.unit || '', unitPrice: it.unitPrice ?? null, amount: it.amount ?? null,
  }));
  const { total, note } = totalOf(r);
  if (note) notes.push(note);
  const gist = String(r.gist || '').trim() || gistOf(items);
  return {
    draft: {
      gist, summary: summaryOf(gist), vendor: r.vendor || '', quoteDate: r.quoteDate || '',
      items, total, currency: r.currency || 'KRW', use: r.use || '', reason: '', account: '', attach,
    },
    notes,
  };
}

const blank = (v) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

/**
 * 문서를 더 넣어 다시 읽었을 때(교육 견적서 뒤에 교육 내용 캡처 등) 새로 읽은 초안을 쓰던 초안에 얹는다.
 * 사용자가 고친 칸(touched)과, 새로 읽은 값이 빈 칸은 쓰던 값을 둔다. 첨부 목록은 새로 읽은 것(모든 파일)이다.
 */
export function mergeDraft(prev, next, touched = []) {
  const out = { ...next };
  for (const [key, value] of Object.entries(prev || {})) {
    if (key === 'attach') continue;
    if (touched.includes(key) || blank(out[key])) out[key] = value;
  }
  // 구매의 요약 줄은 손대지 않았으면 (고쳤을 수도 있는) 품목 요지를 따라간다.
  if ('gist' in out && !touched.includes('summary')) out.summary = summaryOf(out.gist);
  // 교육 구분도 손대지 않았으면 (고쳤을 수도 있는) 교육장소·교육기관을 따라간다.
  if ('mode' in out && !touched.includes('mode')) out.mode = eduModeOf({ ...out, mode: '' });
  return out;
}

/** 빈 초안 — 문서를 넣지 않고 손으로 쓸 때. */
export function blankDraft(kind, { me = '' } = {}) {
  return fromRecord(kind, {}, { me }).draft;
}

/** 초안의 합계(원). 구매는 total, 교육은 fee. */
export const amountOf = (kind, draft) => (kind === 'edu' ? draft?.fee : kind === 'purchase' ? draft?.total : null);

/**
 * 한도를 넘었는가. 원화가 아니면 가리지 못한다(unknown) — 합계를 원화로 고치면 다시 본다.
 * @returns {{over: boolean, unknown: boolean, limit: number|null, amount: number|null}}
 */
export function overLimit(kind, draft) {
  const limit = KINDS[kind]?.limit ?? null;
  const amount = moneyOf(amountOf(kind, draft));
  if (!limit) return { over: false, unknown: false, limit, amount };
  if (amount == null || (draft?.currency && draft.currency !== 'KRW')) return { over: false, unknown: true, limit, amount };
  return { over: amount > limit, unknown: false, limit, amount };
}

/* ------------------------------------------------------------ 채팅으로 사전 설정 채우기 */

const TITLE_RE = /\s*(수석|책임|선임|원급|연구원|연구위원|위원|팀장|부장|본부장|소장|박사|PI|님)\.?$/i;
const PERSON_RE = /^[가-힣]{2,4}$/;
const CODE_RE = /^(?=.*\d)[A-Za-z]{1,8}[-_A-Za-z0-9]*\d[-_A-Za-z0-9]*$|^\d{4}[A-Za-z]{2}\d{3,}$/;
const HEADER_RE = /^(no\.?|순번|과제명?|과제\s*이름|과제\s*번호|번호|코드|(연구|과제)?책임자|합의자|pi|비고|기간)$/i;

/** 사람 이름만 남긴다 — "박기도 책임" → "박기도". */
const personOf = (s) => String(s ?? '').trim().replace(TITLE_RE, '').replace(TITLE_RE, '').trim();

/**
 * 붙여 넣은 글에서 사전 설정 조각을 규칙으로 읽는다 — Claude 가 닿지 않을 때(input.yaml 의 gongmunSetup 과 같은 모양).
 * 읽는 꼴: 표를 복사한 줄(탭·| 로 나뉜 과제명·과제번호·책임자), "과제: …, 책임자 ○○○", "부서장 ○○○", "참조 ○○○, ○○○", "부서 …",
 * 그리고 과제 줄 뒤의 "내용: …"(연구목표·연구내용 — 사유를 만드는 근거)·"개요: …"(본문 첫 줄). 과제로 볼 근거(번호·책임자·"과제" 표시·
 * 표의 여러 칸)가 없는 글은 과제로 받지 않는다 — 인사말이 과제가 되면 안 된다.
 * @returns {{patch: object, reply: string}}
 */
export function parseSetupLocal(text) {
  const patch = {};
  const projects = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // 과제의 내용·개요·별명·연구기간 — 바로 앞 과제에 붙는다(과제가 없으면 지금 고른 과제 몫으로 둔다).
    let m = line.match(/^(?:과제\s*)?(내용|연구\s*내용|연구\s*목표|목표|개요|별명|약칭|연구\s*기간|기간)\s*[:：=]\s*(.+)$/);
    if (m) {
      const key = { 개요: 'about', 별명: 'alias', 약칭: 'alias' }[m[1]] || (/기간$/.test(m[1]) ? 'period' : 'content');
      if (key === 'alias' || key === 'period') {
        (projects.at(-1) || patch)[key] = m[2].trim();
        continue;
      }
      const to = projects.at(-1) || patch;
      to[key] = to[key] ? `${to[key]}\n${m[2].trim()}` : m[2].trim();
      continue;
    }
    m = line.match(/^(?:부서장|팀장|결재자?)\s*[:：=]?\s*(.+)$/);
    if (m) { patch.head = personOf(m[1].split(/[,，]/)[0]); continue; }
    m = line.match(/^참조자?\s*[:：=]?\s*(.+)$/);
    if (m) { patch.refs = namesOf(m[1]).map(personOf).filter(Boolean).join(', '); continue; }
    m = line.match(/^(?:기안\s*)?부서\s*[:：=]?\s*(.+)$/);
    if (m) { patch.dept = m[1].trim(); continue; }
    const cells = line.split(/\t|\s*[|│]\s*|\s{2,}|\s*[,，;]\s*/).map((c) => c.trim()).filter(Boolean);
    if (cells.every((c) => HEADER_RE.test(c))) continue;
    const p = { name: '' };
    let labeled = false;
    for (const cell of cells) {
      const lead = cell.match(/^(?:과제\s*|연구\s*)?(?:책임자|합의자?|PI)\s*[:：=]?\s*(.+)$/i);
      if (lead) { p.lead = personOf(lead[1]); continue; }
      const code = cell.match(/^(?:과제\s*)?(?:번호|코드)\s*[:：=]?\s*(.+)$/);
      if (code) { p.code = code[1].trim(); continue; }
      const c = cell.replace(/^과제(?:명|\s*이름|\s*제목)?\s*[:：=]\s*/, '').trim();
      if (c !== cell) labeled = true;
      if (!c || HEADER_RE.test(c)) continue;
      if (!p.code && CODE_RE.test(c)) { p.code = c; continue; }
      if (!p.lead && PERSON_RE.test(personOf(c)) && c.length <= 10) { p.lead = personOf(c); continue; }
      if (c.length > p.name.length) p.name = c;
    }
    if (p.name.length >= 4 && (labeled || p.code || p.lead || cells.length > 1)) projects.push(p);
    // 과제 없이 사람만 — "합의자 박기도". 지금 고른 과제의 합의자가 된다(mergeSetup).
    else if (p.lead && !p.code && cells.length === 1) patch.lead = p.lead;
  }
  if (projects.length) patch.projects = projects.slice(0, MAX_PROJECTS);
  const leads = projects.filter((p) => p.lead).length;
  const bits = [
    projects.length ? `과제 ${Math.min(projects.length, MAX_PROJECTS)}개${leads ? '와 합의자' : ''}` : '',
    patch.lead ? '합의자' : '', patch.alias ? '과제 별명' : '', patch.period ? '연구기간' : '',
    patch.head ? '부서장' : '', patch.refs ? '참조자' : '', patch.dept ? '부서' : '',
  ].filter(Boolean);
  const over = projects.length > MAX_PROJECTS ? ` 과제는 ${MAX_PROJECTS}개까지라 나머지 ${projects.length - MAX_PROJECTS}개는 뺐습니다.` : '';
  return { patch, reply: bits.length ? `${bits.join(' · ')}를 채웠습니다.${over}` : '' };
}

const keyOf = (s) => String(s ?? '').replace(/\s/g, '').toLowerCase();
/** 사전 설정 칸의 과제 한 줄. */
export const EMPTY_ROW = Object.freeze({ name: '', alias: '', code: '', lead: '', period: '', about: '', content: '', account: '' });
/** 과제 없이 와도 지금 고른 과제 몫으로 넣는 칸 — [칸, 사람에게 부르는 이름]. */
const CURRENT_KEYS = [['lead', '합의자'], ['alias', '과제 별명'], ['period', '연구기간'], ['content', '과제 내용']];

/**
 * 채팅으로 받은 조각(input.yaml 의 gongmunSetup)을 사전 설정에 얹는다. 과제는 이름이나 번호가 같은 것을 고치고, 없으면 빈 줄에
 * 넣거나 더한다(다섯 개까지 — 넘치는 것은 skipped). 조각에 없는 칸은 그대로 둔다. 참조자는 조각의 목록으로 바꾼다.
 * 과제 없이 사람만 왔으면(patch.lead) 지금 고른 과제(current)의 합의자로 넣는다 — 고른 과제가 없으면 skipped 에 적는다.
 * @param {object[]} rows 사전 설정 칸의 과제 줄(이름을 아직 적지 않은 줄도 있다)
 * @param {{current?: string}} [opts] current 는 초안에서 고른 과제의 이름
 * @returns {{rows: object[], preset: object, done: string[], skipped: string[]}}
 */
export function mergeSetup(rows, preset, patch = {}, { current = '' } = {}) {
  const out = (Array.isArray(rows) ? rows : []).map((r) => ({ ...EMPTY_ROW, ...r }));
  const next = normalizePreset(preset);
  const done = [];
  const skipped = [];
  for (const it of Array.isArray(patch?.projects) ? patch.projects : []) {
    const name = String(it?.name ?? '').trim();
    if (!name) continue;
    const fill = {};
    for (const k of ['alias', 'code', 'lead', 'period', 'about', 'content']) if (String(it[k] ?? '').trim()) fill[k] = k === 'lead' ? personOf(it[k]) : String(it[k]).trim();
    const hit = out.find((r) => (r.name && keyOf(r.name) === keyOf(name)) || (fill.code && r.code && keyOf(r.code) === keyOf(fill.code)));
    const target = hit || out.find((r) => !String(r.name).trim()) || (out.length < MAX_PROJECTS ? out[out.push({ ...EMPTY_ROW }) - 1] : null);
    if (!target) { skipped.push(name); continue; }
    Object.assign(target, fill, { name: hit ? target.name || name : name });
    const extra = [fill.alias ? `별명 ${fill.alias}` : '', fill.period ? '연구기간' : '', fill.content ? '내용' : ''].filter(Boolean);
    done.push(`${hit ? '과제 고침' : '과제 등록'} — ${target.name}${fill.lead ? ` (합의자 ${fill.lead})` : ''}${extra.map((x) => ` · ${x}`).join('')}`);
  }
  // 과제 없이 사람·별명·연구기간·내용만 — 지금 고른 과제 몫이다.
  const row = current ? out.find((r) => keyOf(r.name) === keyOf(current)) : null;
  const unknown = '어느 과제인지 모릅니다 — 과제를 고르거나 과제명과 함께 적어 주세요';
  for (const [key, label] of CURRENT_KEYS) {
    const raw = String(patch?.[key] ?? '').trim();
    if (!raw) continue;
    const value = key === 'lead' ? personOf(raw) : raw;
    // 사람·별명은 무엇을 넣었는지 말하고, 긴 글(연구기간·내용)은 칸 이름만 말한다.
    const said = key === 'lead' || key === 'alias' ? `${label} ${value}` : label;
    if (row) { row[key] = value; done.push(`${said} — ${row.name}`); }
    else skipped.push(`${said}(${unknown})`);
  }
  if (String(patch?.dept ?? '').trim()) { next.dept = String(patch.dept).trim(); done.push(`부서 ${next.dept}`); }
  if (String(patch?.head ?? '').trim()) { next.head = personOf(patch.head); done.push(`부서장(결재자) ${next.head}`); }
  if (patch?.refs != null && String(patch.refs).trim()) { next.refs = namesOf(patch.refs).map(personOf).filter(Boolean); done.push(`참조자 ${next.refs.join(', ')}`); }
  return { rows: out, preset: normalizePreset(next), done, skipped };
}

/* ------------------------------------------------------------ 결재선 */

const same = (a, b) => !!a && !!b && String(a).replace(/\s/g, '') === String(b).replace(/\s/g, '');

/**
 * 결재선. 부서 품의라 부서장이 결재(전결)하고, 과제 예산을 쓰므로 과제책임자가 합의한다(2026-10-07 사용자 지정).
 * 합의는 마지막 자리에 둘 수 없다(전자결재 결재선 화면의 제약 — 원본 appline.py) — 그래서 기안 → 합의 → 결재 순이다.
 * 과제책임자가 기안자이거나 부서장이면 합의는 뺀다(원본 rules.py 의 resolve_internal_agreement 와 같다).
 * @returns {{steps: {role:string, name:string, why?:string}[], refs: string[], notes: string[]}}
 */
export function approvalLine({ me = '', preset = {}, project = null } = {}) {
  const p = normalizePreset(preset);
  const notes = [];
  const steps = [{ role: '기안', name: me || '나' }];
  const lead = String(project?.lead || '').trim();
  if (lead && same(lead, me)) notes.push('과제책임자가 기안자라 합의는 뺐습니다');
  else if (lead && same(lead, p.head)) notes.push('과제책임자가 부서장이라 합의는 뺐습니다');
  else if (lead) steps.push({ role: '합의', name: lead, why: '과제책임자' });
  if (p.head) steps.push({ role: '결재', name: p.head, why: '부서장' });
  return { steps, refs: p.refs.filter((n) => !steps.some((s) => same(s.name, n))), notes };
}

/** 결재선 자리를 사람에게 부르는 이름. 과제책임자는 '합의자'로 넣는다(2026-10-07 사용자 지정). 전자결재 결재선 화면의 단추는 결재·합의·참조다. */
export const ROLE_LABEL = { 기안: '기안자', 합의: '합의자', 결재: '결재자', 참조: '참조자' };

/** 결재선을 한 줄로 — 기안자 김거화 → 합의자 박기도 → 결재자 노길태 · 참조자 홍길동, 이몽룡 */
export function lineText(line) {
  const head = line.steps.map((s) => `${ROLE_LABEL[s.role] || s.role} ${s.name}`).join(' → ');
  return line.refs.length ? `${head} · ${ROLE_LABEL.참조} ${line.refs.join(', ')}` : head;
}

/* ------------------------------------------------------------ 공문 만들기 */

const span = (from, to) => {
  if (!from) return '';
  if (!to || to === from) return `${dotDate(from)} (1일)`;
  const days = Math.round((new Date(`${to}T00:00`) - new Date(`${from}T00:00`)) / 86_400_000) + 1;
  return `${dotDate(from)} ~ ${dotDate(to)} (${days}일)`;
};

/** 틀에 넣을 값. 갈래마다 다른 이름은 VARS 와 같다. */
export function varsFor(kind, draft = {}, { me = '', preset = {}, project = null, today = '' } = {}) {
  const p = normalizePreset(preset);
  const name = project?.name || '';
  const vars = {
    부서: p.dept, 기안자: me, 과제명: name, 과제별명: project?.alias || name, 과제번호: project?.code || '', 연구기간: project?.period || '',
    과제책임자: project?.lead || '',
    과제개요: project?.about || (name ? `「${name}」 과제를 수행하고 있습니다` : ''),
    계정: String(draft.account || '').trim() || project?.account || KINDS[kind]?.account || '',
    오늘: dotDate(today),
    첨부: attachBlock(draft.attach?.length ? draft.attach : attachList(kind)),
  };
  if (kind === 'purchase') {
    Object.assign(vars, {
      품목요지: draft.gist || '', 요약: draft.summary || '', 업체: draft.vendor || '', 견적일: dotDate(draft.quoteDate),
      합계: won(moneyOf(draft.total)), 용도: draft.use || '', 구매사유: draft.reason || '', 품목수: String(draft.items?.length || ''),
    });
  } else if (kind === 'edu') {
    Object.assign(vars, {
      교육구분: eduModeOf(draft),
      교육명: draft.course || '', 교육기관: draft.provider || '', 교육기간: span(draft.from, draft.to), 교육시간: draft.hours || '',
      교육장소: draft.place || '', 교육내용: draft.topics || '', 참석자: draft.attendees || me, 교육비: won(moneyOf(draft.fee)),
      교육목적: draft.purpose || '', 교육사유: draft.reason || '',
    });
  } else {
    Object.assign(vars, {
      출장지: draft.place || '', 출장기간: span(draft.from, draft.to), 출장자: draft.who || me, 출장목적: draft.purpose || '',
      예상경비: won(moneyOf(draft.cost)),
    });
  }
  return vars;
}

/** 품목 줄 — 틀의 {{#품목}} 안에서 쓴다. */
const itemRows = (items = []) => items.map((it) => ({
  품목명: it.name || '', 사양: it.spec || '', 수량: qtyText(it), 단위: it.unit || '',
  단가: won(it.unitPrice), 금액: won(it.amount),
}));

/**
 * 제목과 본문을 만든다. 비어 있는 값은 [이름] 으로 남고 missing 에 적힌다.
 * @returns {{title: string, body: string, form: string, missing: string[]}}
 */
export function compose(kind, draft, ctx = {}, tpl = templateOf(kind, null)) {
  const vars = varsFor(kind, draft, ctx);
  const lists = { 품목: itemRows(draft?.items) };
  const title = fillTemplate(tpl.title, vars, lists);
  const body = fillTemplate(tpl.body, vars, lists);
  return { title: title.text.trim(), body: body.text, form: tpl.form, missing: [...new Set([...title.missing, ...body.missing])] };
}

/**
 * 올리기 전에 채워야 할 것. 화면의 "남은 것" 줄에 적는다 — 막지는 않는다(본문은 사용자가 고칠 수 있다). 한도는 따로 막는다.
 * @returns {string[]}
 */
export function needs(kind, draft, { preset = {}, project = null, projects = [] } = {}) {
  const out = [];
  if (!projects.length) out.push('과제 등록(사전 설정)');
  else if (!project) out.push('과제 선택');
  else {
    if (!String(project.lead || '').trim()) out.push('합의자(과제책임자)');
    // 교육·출장 제목은 과제 별명으로 쓴다 — 비면 과제명이 그대로 들어가 길어진다(막지는 않는다).
    if (kind !== 'purchase' && !String(project.alias || '').trim()) out.push('과제 별명(사전 설정 — 제목)');
  }
  if (!normalizePreset(preset).head) out.push('부서장(사전 설정)');
  if (!normalizePreset(preset).dept) out.push('부서(사전 설정)');
  const d = draft || {};
  if (kind === 'purchase') {
    if (!String(d.gist || '').trim()) out.push('품목');
    if (moneyOf(d.total) == null) out.push('합계');
    if (!String(d.use || '').trim()) out.push('용도');
    if (!String(d.reason || '').trim()) out.push('구매사유');
  } else if (kind === 'edu') {
    if (!String(d.course || '').trim()) out.push('교육명');
    if (!d.from) out.push('교육기간');
    if (moneyOf(d.fee) == null) out.push('교육비');
    if (!String(d.purpose || '').trim()) out.push('교육목적');
    if (!String(d.reason || '').trim()) out.push('교육사유');
  }
  return out;
}

/* ------------------------------------------------------------ 과제 내용으로 사유 쓰기 */

/** 사유 칸과 용도(교육목적) 칸 — 갈래마다 이름이 다르다. */
export const REASON_KEYS = { purchase: { reason: 'reason', use: 'use' }, edu: { reason: 'reason', use: 'purpose' } };

/**
 * 사유를 쓰라고 Claude 에 줄 글(input.yaml 의 gongmunReason). 과제 내용이 근거이고, 품의할 것은 품목·교육이다.
 * 금액·업체는 넣지 않는다 — 사유에 쓰지 말라는 것을 굳이 보여 주지 않는다.
 */
export function reasonInput(kind, draft = {}, project = null) {
  const p = project || {};
  const what = kind === 'edu'
    ? [`교육명: ${draft.course || '?'}`, draft.provider ? `교육기관: ${draft.provider}` : '', draft.topics ? `교육 내용: ${draft.topics}` : '',
      draft.purpose ? `지금 적힌 교육목적: ${draft.purpose}` : '']
    : [...(draft.items || []).map((it) => `품목: ${it.name}${it.spec ? ` (${it.spec})` : ''}${it.qty != null ? ` × ${it.qty}${it.unit || ''}` : ''}`),
      !draft.items?.length && draft.gist ? `품목: ${draft.gist}` : '', draft.use ? `지금 적힌 용도: ${draft.use}` : ''];
  return [
    `품의 종류: ${KINDS[kind]?.title || kind}`,
    `과제명: ${p.name || '(없음)'}`,
    p.code ? `과제번호: ${p.code}` : '',
    p.about ? `과제 개요: ${p.about}` : '',
    `과제 내용:\n<<<\n${p.content || '(없음)'}\n>>>`,
    '',
    '품의할 것:',
    ...what.filter(Boolean),
  ].filter((l) => l !== '').join('\n');
}

/**
 * 써 온 사유·용도를 초안에 넣는다. 사유는 넣고(누른 사람이 원한 것이다), 용도(교육목적)는 사용자가 고치지 않았을 때만 바꾼다.
 * @param {{reason: string, use?: string|null}} data 관문을 지난 답
 * @param {{touched?: string[]}} [opts] touched 는 사용자가 고친 칸
 */
export function applyReason(kind, draft, data, { touched = [] } = {}) {
  const keys = REASON_KEYS[kind];
  if (!keys) return { ...draft };
  const out = { ...draft };
  if (String(data?.reason || '').trim()) out[keys.reason] = String(data.reason).trim();
  if (String(data?.use || '').trim() && !(touched.includes(keys.use) && String(draft?.[keys.use] || '').trim())) out[keys.use] = String(data.use).trim();
  return out;
}

/* ------------------------------------------------------------ 붙여 넣을 꼴 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * 본문을 편집기(DEXT5)에 붙여 넣을 HTML 로. 줄마다 문단이고, 앞의 빈칸은 &nbsp; 로 지킨다(들여쓰기가 공문의 꼴이다).
 * '아 래' 줄은 가운데에 둔다(원본 body.py 의 _CENTER_JS 와 같은 판정).
 */
export function bodyHtml(body) {
  const center = /(^|[\s\-─–—])아\s*래([\s\-─–—]|$)/;
  return String(body ?? '').split('\n').map((line) => {
    const lead = line.match(/^ */)[0].length;
    const inner = line.trim() ? `${'&nbsp;'.repeat(lead)}${esc(line.slice(lead))}` : '&nbsp;';
    const style = center.test(line) ? 'margin:0;text-align:center' : 'margin:0';
    return `<p style="${style}">${inner}</p>`;
  }).join('');
}

/**
 * 새 공문 창 주소. 전자결재(RealEANet)는 이미 로그인된 세션에서 DocumentView 를 바로 열면 "상신하실 수 없습니다" 로 튕긴다 —
 * 언제나 loginbyname 을 거쳐 연다(세션이 살아 있으면 성명 입력 없이 지나간다). 원본 ea_core/doc.py 의 build_entry_url.
 * DOCID 를 비우면 새 문서다.
 */
export function draftUrl(formId = DEFAULT_FORM) {
  const id = /^[A-Za-z0-9_]+$/.test(String(formId || '')) ? formId : DEFAULT_FORM;
  const doc = `/RealEANet/Main/DocumentView.aspx?FORMID=${id}&DOCID=&GROUPID=0&MDTID=0&DID=0&ISMODIFY=0&OLDDOC=&ATTYN=0`
    + '&ALERTMAIL=0&DOCCNT=0&EXEMTD=RETMTD&ACTYPE=0';
  return `${ORIGIN}/RealEANET/loginbyname.aspx?ReturnUrl=${encodeURIComponent(doc)}`;
}

/** 첨부로 저장할 파일 이름 — 견적서_업체_2026-10-07.pdf. label 은 첨부 목록의 문서 이름(교육 견적서·교육 내용 …). */
export function attachName(kind, draft, today, label = '') {
  const who = String((kind === 'edu' ? draft?.provider : draft?.vendor) || '').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 30);
  const doc = (label || KINDS[kind]?.doc || '첨부').replace(/[\\/:*?"<>|\s]+/g, '');
  return `${doc}${who ? `_${who}` : ''}_${today || ''}.pdf`.replace(/_\.pdf$/, '.pdf');
}
