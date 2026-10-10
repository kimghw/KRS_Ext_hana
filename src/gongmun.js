// 공문(eclass 전자결재 품의) 작성의 순수 로직. 화면도 네트워크도 모른다 — 읽은 견적서·교육 안내문에서 무엇을 꺼내
// 어떤 틀(양식)에 넣을지, 결재선을 누구로 할지, 한도를 넘었는지만 정한다. 화면은 gongmunpanel.js 가, 문서 읽기는
// src/llm.js 의 gongmunSmart 가 한다.
//
// 원본은 krs-web-agents 의 ea_approval(연구업무추진품의 — eclass 전자결재 RealEANet 의 FORMID KR_EA_Research_Task)이다.
// 갈래(목적)마다의 이름·칸·제목·본문 틀·첨부, 폼의 칸 지도, 위임전결·문서설정은 원본처럼 레시피(recipes/gongmun — 유닛 → forms/<폼> →
// purposes/<목적>)에 두고, 생성기(tools/gen-gongmun.mjs)가 옮긴 src/gmrecipe.js 를 여기서 읽는다(2026-10-08 사용자 지정: "레시피구조로").
// 새 공문 창에 실제로 쓰는 것은 src/gmwrite.js 다 — 여기서는 무엇을 쓸지(writePlan)만 정한다.
//
// 갈래는 구매·교육·출장 셋이다(2026-10-07 사용자 지정). 셋 다 같은 문서 넣기(캡처·끌어다 놓기·붙여넣기·웹페이지 캡처)로 읽는다(2026-10-08 사용자 지정) —
// 출장은 행사·회의·학회 안내문·초청장(출장지·기간·목적)과 교통·숙박 견적서(예상경비)를 읽는다.
// 갈래마다 양식(eclass 양식·제목 틀·본문 틀)은 패널에서 보고 고친다(2026-10-07 사용자 지정 — "어떤 양식으로 할지는 거기서 보고 수정").

import { ORIGIN } from './config.js';
import { RECIPE } from './gmrecipe.js';
import { currentYear, fileLog, noteLogs, logLines, periodText, yearLabel, MAX_PROJECTS as RND_MAX_PROJECTS } from './rnd.js';

/* ------------------------------------------------------------ 저장소 키 */

export const KIND_KEY = 'gongmunKind';
export const PRESET_KEY = 'gongmunPreset';
export const PROJECTS_KEY = 'gongmunProjects';
export const TEMPLATES_KEY = 'gongmunTemplates';
export const DRAFT_KEY = 'gongmunDraft';
/** R&D 과제마다 공문에만 쓰는 값(과제 개요·계정) — normalizeRndExtra. */
export const RND_EXTRA_KEY = 'gongmunRndExtra';

/**
 * 과제 한도 — R&D 탭과 같다(열 개). 처음에는 다섯 개였는데(2026-10-07 사용자 지정) 2026-10-10 사용자 지정("꼭 5개일 필요는 없어. 가끔 연장되거나
 * 겹치는 경우 몇개 더 있더라")으로 R&D 탭의 한도(src/rnd.js 의 MAX_PROJECTS)에 맞췄다 — 공문 설정의 과제는 R&D 탭이 처음 열릴 때 그대로 가져간다.
 */
export const MAX_PROJECTS = RND_MAX_PROJECTS;

/**
 * 갈래(목적) — 레시피의 purposes/<목적>/ 이다(recipes/gongmun/research-form/forms/research_task). 차례는 manifest 의 purposes 차례다.
 * limit 는 합계 한도(원, 없으면 null), account 는 계정의 기본값이다(과제에 계정을 적어 두면 그것이 이긴다).
 * doc 은 문서 없이 쓸 때의 첨부 한 줄, ask 는 문서 넣는 곳의 말, more 는 이미 읽은 초안에 더 넣을 때의 말이고(attach_rules.yaml),
 * needDocs 는 꼭 드는 첨부다 — 본문 ※ 첨부에 늘 적고, 읽은 파일에 빠졌으면 "남은 것"과 넣는 곳의 말이 그것을 짚는다(교육 — 견적서·교육 내용).
 */
export const KIND_ORDER = [...RECIPE.order];
/** cut 은 견적서를 오리는 갈래다(레시피 purpose.yaml 에 quote_crop 이 있다 — 구매의 쇼핑몰 화면, 교육의 온라인 강의 페이지). */
export const KINDS = Object.fromEntries(KIND_ORDER.map((k) => {
  const p = RECIPE.purposes[k];
  const kind = { label: p.label, title: p.title, limit: p.limit, account: p.account, doc: p.attach.doc, ask: p.attach.ask, more: p.attach.more, cut: !!p.quote_crop };
  return [k, p.attach.need.length ? { ...kind, needDocs: p.attach.need } : kind];
}));

/**
 * 부서 구매 품의는 100만원 이하(부가세 포함 합계)만 작성한다(2026-10-07 사용자 지정 — 레시피 purchase/purpose.yaml 의 limit). 넘으면 본문을
 * 만들지 않는다 — 그보다 큰 구매는 결재선(원본 ea_rules.yaml 의 구매 구간)과 첨부(500만원 이상 비교견적서)가 달라 이 틀로 올리면 안 된다.
 */
export const PURCHASE_LIMIT = KINDS.purchase.limit;

/**
 * 외부활동 구분 — 제목과 본문의 활동구분 칸(레시피 outside/purpose.yaml 의 type 칸 options). 읽기는 이 이름 그대로 돌려준다.
 * outsideTypeOf 는 예전 읽기의 코드(lecture …)나 이름을 이 이름으로 바꾼다(모르면 빈 글).
 */
export const OUTSIDE_TYPES = [...RECIPE.purposes.outside.fields.find((f) => f.key === 'type').options];
const OUTSIDE_OF = { lecture: '강의', advisory: '자문', review: '심사·평가', talk: '발표', committee: '위원 활동', writing: '집필', other: '기타' };
export const outsideTypeOf = (code) => OUTSIDE_OF[String(code ?? '').trim()] || (OUTSIDE_TYPES.includes(code) ? code : '');

/**
 * eclass 전자결재 양식 — 레시피의 forms/<폼>/manifest.yaml. 본문을 넣는 양식만 둔다 — 구매요청서(KR_Purchase_Order)는 칸이 정해진 폼이라
 * 이 틀로 채울 수 없다. 목록에 없는 양식은 양식 ID 를 직접 적는다(그 양식은 칸 지도가 없어 새 공문 창을 열기만 한다).
 */
export const FORMS = Object.values(RECIPE.forms).map((f) => ({ id: f.id, label: f.label }));
export const DEFAULT_FORM = RECIPE.purposes[KIND_ORDER[0]].form;

/* ------------------------------------------------------------ 양식(틀) */

// 본문 틀의 들여쓰기는 원본(ea_overview.yaml·body_spec.yaml)과 같다. `{이름}` 은 값으로 바뀌고, `{이름:은}` 은 값 뒤에
// 받침에 맞는 조사(은/는·이/가·을/를·과/와·으로/로)를 붙인다. `{이름?}` 이 있는 줄은 그 값이 비면 줄째 뺀다.
// `{{#품목}} … {{/품목}}` 은 품목마다 되풀이한다. `{차례}` 는 가·나·다… 를 차례로 매긴다 — 빠진 줄은 건너뛰고 잇는다.
// `{세부차례}` 는 (1)·(2)… 를 매기고 `{차례}` 줄마다 새로 센다(원본 연구공문의 '가. 과제 개요 / 나. … 내역 / (1) …' 꼴).
// 첨부 목록(`{첨부}`)은 읽은 파일마다 무슨 문서인지로 만든다(교육이면 교육 견적서·교육 내용 — 2026-10-07 사용자 지정).
//
// 교육·출장의 제목은 "[과제 별명] 수행을 위한 [교육|온라인교육|출장] 품의" 다(2026-10-07 사용자 지정). 본문은 원본 연구공문처럼
// '가. 과제 개요'(과제명·번호·연구기간·책임자 — 공문 설정의 과제 기본 내용)를 앞에 두고 '나.' 에 품의할 내용을 적는다.
// 구매는 원본에서도 과제 개요를 빼는 lean 목적이라(body_spec.yaml 의 skip) 제목·본문을 그대로 둔다.
// 틀의 원본은 레시피의 purposes/<목적>/body_spec.yaml 이다 — 패널의 '양식' 칸에서 고친 것은 브라우저에 따로 남는다(templatePatch).
export const DEFAULT_TEMPLATES = Object.fromEntries(KIND_ORDER.map((k) => {
  const p = RECIPE.purposes[k];
  return [k, { form: p.form, title: p.template.title, body: p.template.body }];
}));

/**
 * 틀에 쓸 수 있는 이름 — 양식 칸 아래에 [적는 꼴, 뜻] 으로 보여 준다. 공통 이름(레시피 registries/vars.yaml)은 갈래마다 앞에 붙고, 갈래의 이름과
 * 목록은 body_spec.yaml 의 vars·lists 다.
 */
const COMMON_VARS = Object.entries(RECIPE.vars).map(([k, desc]) => [`{${k}}`, desc]);
const purposeVars = (p) => [
  ...Object.entries(p.vars).map(([k, v]) => [`{${k}}`, v.desc]),
  ...Object.entries(p.lists).map(([k, l]) => [`{{#${k}}} … {{/${k}}}`, `${l.desc} — 안에서 ${['번호', ...Object.keys(l.vars)].map((n) => `{${n}}`).join('·')}`]),
];
export const VARS = Object.fromEntries(KIND_ORDER.map((k) => [k, [...COMMON_VARS, ...purposeVars(RECIPE.purposes[k])]]));
/** 틀의 꾸밈 — 이름 뒤에 붙인다. */
export const VAR_MARKS = [
  ['{이름:은}', '받침에 맞춰 은/는 — 이/가·을/를·과/와·으로/로도 된다'], ['{이름?}', '값이 비면 그 줄을 뺀다'],
  ['{차례}', '가·나·다… 를 차례로 — 빠진 줄은 건너뛰고 잇는다'],
  ['{세부차례}', '(1)·(2)… 를 차례로 — {차례} 줄마다 새로 세고, 빠진 줄은 건너뛴다'],
];

/**
 * 교육 구분 — 제목의 "… 수행을 위한 교육 품의 / 온라인교육 품의"(2026-10-07 사용자 지정). 레시피 edu/purpose.yaml 의 mode 칸 options(첫째가 대면,
 * 둘째가 온라인)이고, 온라인으로 보는 말은 그 칸의 online 이다(대소문자·띄어쓰기는 보지 않는다).
 */
const EDU_MODE = RECIPE.purposes.edu?.fields.find((f) => f.key === 'mode');
export const EDU_MODES = [...(EDU_MODE?.options || ['교육', '온라인교육'])];
const squash = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
const ONLINE_WORDS = (EDU_MODE?.online || []).map(squash).filter(Boolean);

/** 교육 구분을 정한다 — 칸에 고른 것이 먼저, 없으면 교육장소·교육기관에 온라인으로 보는 말이 있으면 온라인교육. */
export function eduModeOf(draft) {
  const picked = String(draft?.mode ?? '').trim();
  if (EDU_MODES.includes(picked)) return picked;
  const text = squash(`${draft?.place ?? ''} ${draft?.provider ?? ''}`);
  return ONLINE_WORDS.some((w) => text.includes(w)) ? EDU_MODES[1] : EDU_MODES[0];
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

/* ------------------------------------------------------------ 공문 설정·과제 */

/** 이름 목록 — 쉼표·가운뎃점·줄바꿈으로 나눈다. 같은 이름은 한 번만. */
export function namesOf(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[,，·\n;]+/);
  return [...new Set(list.map((s) => String(s ?? '').trim()).filter(Boolean))].slice(0, 20);
}

/**
 * 공문 설정 — 부서(본문 첫 줄), 부서장(결재 — 위임전결의 팀장), 참조자, 소장·본부장(전결권자가 그 위일 때 결재선에 선다), 문서번호 부서
 * (문서설정의 Doc No. 코드 — 비면 레시피 settings.yaml 의 teams 표에서 부서 이름으로 찾는다). 실명은 공개 저장소(레시피)에 두지 않고 여기에만 둔다.
 */
export function normalizePreset(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    dept: text(r.dept, 100).trim(), head: text(r.head, 40).trim(), refs: namesOf(r.refs),
    director: text(r.director, 40).trim(), chief: text(r.chief, 40).trim(), docNo: text(r.docNo, 8).replace(/\D/g, ''),
  };
}

/**
 * 과제 — 이름은 반드시, 나머지(별명·번호·책임자(합의자)·연구기간·개요·내용·계정)는 있으면. MAX_PROJECTS 개까지.
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

/**
 * R&D 과제마다 공문에만 쓰는 값 — 과제 개요(본문 첫 줄)·계정. { [R&D 과제 id]: { about, account } }.
 * R&D 탭에 과제가 있으면 공문 설정의 과제는 그 과제들이다(2026-10-10 사용자 지정: "rnd 에 과제 들어가 있는거 추가하면되잖아. 그거랑 연동되어야") —
 * 과제명·별칭·번호·책임자·연구기간·연구 내용은 R&D 탭이 원본이라 공문 설정에서는 이 둘만 적는다. 과제 id 로 묶어 과제명을 고쳐도 따라간다.
 */
export function normalizeRndExtra(raw) {
  const out = {};
  for (const [id, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (!id || !v || typeof v !== 'object') continue;
    out[id] = { about: text(v.about, 300).trim().replace(/[.。]+$/, ''), account: text(v.account, 60).trim() };
  }
  return out;
}

/** 공문 설정의 과제 줄(x)이 R&D 과제(p)와 같은 과제인가 — 과제번호·과제명·별칭 가운데 하나가 같으면(공백·대소문자는 보지 않는다). */
export const sameProject = (p, x) => !!p && !!x
  && ((p.code && keyOf(x.code) === keyOf(p.code)) || keyOf(x.name) === keyOf(p.name) || (!!p.alias && keyOf(x.alias) === keyOf(p.alias)));

/** 사유를 쓰는 근거로 넘기는 R&D 연구 내용의 한도 — 다리는 입력을 2만 자에서 자른다(native/host.mjs). */
const RND_CONTENT_MAX = 6000;

/**
 * R&D 과제(src/rnd.js 의 장부 rndBook)의 연구 내용 — 품의 사유를 쓰는 근거. 오늘이 든 차년도의 연구개발 계획(계획서에서 온 개발목표·개발내용·
 * 성능목표·주요결과물·수행일정 — 그 차년도에 없으면 계획서가 있는 앞 차년도, 그것도 없으면 가장 늦은 것)과 그 차년도의 진행 기록, 과제 비고.
 * @returns {{text: string, year: number, plan: number, logs: number}} plan 은 계획을 가져온 차년도(없으면 0), logs 는 진행 기록 수
 */
export function rndContent(project, today = '') {
  const years = project?.years || {};
  const now = currentYear(project, today || undefined);
  const have = Object.keys(years).map(Number).filter((n) => fileLog(years[n], 'plan')).sort((a, b) => b - a);
  const n = have.includes(now) ? now : have.find((k) => k < now) || have[0] || 0;
  const plan = n ? fileLog(years[n], 'plan').text : '';
  const notes = noteLogs(years[now]);
  const text = [
    plan ? `[연구개발 계획 — ${yearLabel(n)}]\n${plan}` : '',
    notes.length ? `[진행 기록 — ${yearLabel(now)}]\n${logLines(notes).join('\n')}` : '',
    project?.note ? `[비고]\n${project.note}` : '',
  ].filter(Boolean).join('\n\n');
  return { text: text.slice(0, RND_CONTENT_MAX), year: now, plan: n, logs: notes.length };
}

/**
 * R&D 탭의 과제를 공문의 과제로(2026-10-08 사용자 지정: "rnd 탭에 있는 어떤 과제로 할건지 … 대상 rnd 의 연구 내용을 보고 자동으로 입력").
 * 별칭(제목)·과제번호·책임자(합의자)·연구기간(과제 개요)은 그 과제의 것이고, 과제 내용은 연구 내용(rndContent)이다. 개요·계정은 공문 설정에서
 * 그 과제 몫으로 적은 것(extra — normalizeRndExtra)이고, 적은 적이 없으면 공문 설정의 같은 과제(sameProject) 줄의 것이다. R&D 쪽에 비어 있는
 * 별칭·번호·책임자·연구기간·내용도 그 줄에서 채운다. rnd 는 화면이 보여 줄 근거의 형편(과제 id·올해 차년도·계획을 가져온 차년도·진행 기록 수)이다.
 * @param {{projects?: object[]}} book src/rnd.js 의 normalizeBook 을 지난 장부
 * @param {object[]} [preset] 공문 공문 설정의 과제(gongmunProjects)
 * @param {object} [extra] R&D 과제마다 공문에만 쓰는 값(gongmunRndExtra)
 */
export function rndProjects(book, preset = [], today = '', extra = {}) {
  const pre = normalizeProjects(preset);
  const ex = normalizeRndExtra(extra);
  return (book?.projects || []).filter((p) => p?.name).map((p) => {
    const same = pre.find((x) => sameProject(p, x));
    const own = p.id ? ex[p.id] : null;
    const got = rndContent(p, today);
    return {
      name: p.name, alias: p.alias || same?.alias || '', code: p.code || same?.code || '', lead: p.lead || same?.lead || '',
      period: periodText(p) || same?.period || '', about: own ? own.about : same?.about || '', content: got.text || same?.content || '',
      account: own ? own.account : same?.account || '',
      rnd: { id: p.id, year: got.year, plan: got.plan, logs: got.logs },
    };
  });
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
 * 초안의 칸 — 화면이 이 차례로 그린다. 원본은 레시피의 purposes/<목적>/purpose.yaml 의 fields 다.
 * type: money(원, 쉼표로 보인다)·date·choice(options 중 하나), 그 밖은 글. area 는 여러 줄, wide 는 한 줄을 다 쓴다.
 * from 은 값이 어디서 오는지(document 면 read 가 읽는 법 — 문서 읽기의 지시문이 된다), need 는 비면 '남은 것'에 뜨는 이름이다.
 * open 은 펼쳐 두는 칸이다 — 용도(교육목적)·사유만 늘 보이고, 읽은 칸은 "읽은 문서" 아래에 접혀 있다(2026-10-08 사용자 지정:
 * "이건 접힌 상태로 두고, 용도, 구매사유, 결재선.. 그리고 rnd 탭에 있는 어떤 과제로 할건지에 대해서만 펼쳐서 작성/선택").
 */
export const FIELDS = Object.fromEntries(KIND_ORDER.map((k) => [k, RECIPE.purposes[k].fields.map((f) => ({ ...f }))]));

/** 구매의 요약 줄 — "모니터 외 1건을 구매하고자". 품목 요지를 고치면 요약도 따라간다(요약을 손대지 않았을 때). */
export const summaryOf = (gist) => (String(gist ?? '').trim() ? `${josa(String(gist).trim(), '을')} 구매하고자` : '');

/* ------------------------------------------------------------ 읽은 문서 → 초안 */

const sum = (list) => list.reduce((a, b) => a + b, 0);

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

/**
 * 첨부 목록에 적는 문서 이름 — 읽은 파일의 종류(레시피 registries/reading.yaml 의 parts.kind)마다. 구매로 강의(인프런 같은 교육 상품)를 사면 강의 소개·커리큘럼
 * 화면은 강의 내용이다 — 오린 견적서와 함께 첨부한다(2026-10-08 사용자 지정: "공문에는 견적서 랑,, 강의 내용도 첨부파일로").
 * 교육의 첨부는 교육 견적서와 교육 내용 둘이다(2026-10-08 사용자 지정) — 금액이 든 문서(견적서·청구서·신청·결제 화면)는 교육 견적서, 그 밖의
 * 장(교육 안내문·커리큘럼·강의 소개)은 교육 내용이다.
 */
/** 읽기가 가린 파일 종류 → 첨부 목록의 문서 이름(레시피 attach_rules.yaml 의 parts). */
const PART_LABEL = Object.fromEntries(KIND_ORDER.map((k) => [k, RECIPE.purposes[k].attach.parts]));

/**
 * 첨부 목록 — 읽은 파일을 문서 종류로 묶는다. 교육이면 교육 견적서·교육 내용이 따로 한 줄씩이 된다(2026-10-07 사용자 지정).
 * 파일이 없으면(글을 붙여 넣었거나 손으로 쓴다) 갈래의 기본 문서(견적서) 한 줄이다. 꼭 드는 문서(KINDS.needDocs — 교육 견적서·교육 내용)는
 * 읽은 파일에 없어도 그 차례로 앞에 세운다(파일 없이) — 본문 ※ 첨부에 늘 적히고, 빠진 것은 missingDocs 가 짚는다.
 * @param {{file:string, kind:string}[]} parts 읽기가 가린 파일마다의 종류
 * @param {string[]} files 읽은 파일 이름(넣은 차례)
 * @returns {{label: string, files: string[]}[]}
 */
export function attachList(kind, parts = [], files = []) {
  const names = PART_LABEL[kind] || PART_LABEL.purchase;
  const out = (KINDS[kind]?.needDocs || []).map((d) => ({ label: d.label, files: [] }));
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
 * 꼭 드는 첨부(KINDS.needDocs) 가운데 읽은 파일에 없는 것 — 파일을 하나도 넣지 않았으면(손으로 쓰거나 글만 붙여 넣었다) 짚지 않는다.
 * @param {{label: string, files?: string[]}[]} attach 초안의 첨부 목록(attachList)
 * @returns {{label: string, more: string}[]}
 */
export function missingDocs(kind, attach = []) {
  const list = attach || [];
  if (!list.some((a) => a?.files?.length)) return [];
  return (KINDS[kind]?.needDocs || []).filter((d) => !list.find((a) => a?.label === d.label)?.files?.length);
}

/** 이미 읽은 초안에 더 넣을 때 넣는 곳의 말 — 꼭 드는 첨부가 빠졌으면 그것을 넣으라고 한다(교육 내용만 넣었으면 교육 견적서). */
export const moreLead = (kind, attach) => missingDocs(kind, attach)[0]?.more || KINDS[kind]?.more || '';

/**
 * 견적서를 오렸으면(구매 — 쇼핑몰 화면에서 가격과 그 둘레만, src/quotecut.js) 첨부는 오린 그림이 견적서로 앞에 오고, 오려 낸 화면(같은 묶음의
 * 장들 — cut.drop)은 빠진다(2026-10-08 사용자 지정). 오린 것을 껐으면(on: false — 원래 장으로) 넣은 파일 그대로다.
 * @param {{name: string, drop?: string[], on?: boolean}|null} cut
 */
export function attachWithCut(kind, parts = [], files = [], cut = null) {
  if (!cut?.on || !cut.name) return attachList(kind, parts, files);
  const drop = new Set(cut.drop || []);
  return attachList(kind, [{ file: cut.name, kind: 'quote' }, ...(parts || [])], [cut.name, ...(files || []).filter((n) => !drop.has(n))]);
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
 * 칸의 처음 값 — 레시피 purpose.yaml 의 from 대로. document 는 읽은 값(읽기의 키가 칸의 key 와 같다), me 는 내 이름,
 * 고르는 칸(choice)은 읽은 값이 없으면 options 의 첫째, 그 밖(write·setup·auto)은 빈 값이다.
 */
function startValue(f, rec, me) {
  if (f.from === 'me') return me;
  const v = f.from === 'document' ? rec[f.key] : null;
  if (f.type === 'money') return Number.isFinite(v) ? v : null;
  if (f.type === 'choice') return f.options.includes(v) ? v : f.options[0];
  return v == null ? '' : String(v);
}

/**
 * 갈래마다 칸끼리 정하는 것 — 레시피에서 from: auto 이거나, 비어 왔을 때 채우는 법을 주석에 적은 칸.
 * 구매는 품목 표·견적일(reads)을 옮기고, 합계가 비면 공급가액+부가세·품목 금액의 합으로, 품목 요지가 비면 첫 품목으로 채운다.
 * 교육은 교육비가 비면 공급가액+부가세로 채우고, 교육 구분(제목)을 교육장소·교육기관으로 정한다.
 */
const FILL = {
  purchase(d, r, notes) {
    d.items = (r.items || []).map((it) => ({
      name: it.name || '', spec: it.spec || '', qty: it.qty ?? null, unit: it.unit || '', unitPrice: it.unitPrice ?? null, amount: it.amount ?? null,
    }));
    d.quoteDate = r.quoteDate || '';
    const { total, note } = totalOf(r);
    d.total = total;
    if (note) notes.push(note);
    d.gist = d.gist.trim() || gistOf(d.items);
    d.summary = summaryOf(d.gist);
  },
  edu(d, r, notes) {
    if (d.fee == null && Number.isFinite(r.supply) && Number.isFinite(r.vat)) d.fee = r.supply + r.vat;
    if (d.fee == null) notes.push('교육비를 읽지 못했습니다 — 직접 적어 주세요');
    d.mode = eduModeOf({ ...d, mode: '' });
  },
};

/**
 * 읽은 문서(레시피가 만든 읽기 작업 gongmun.<갈래>의 답)로 갈래의 초안을 만든다. 화면의 칸이 이것을 들고, 사용자가 고친다.
 * 칸마다 어디서 오는지는 레시피 purpose.yaml 의 from 이다 — 문서에서 읽는 칸은 읽기의 키가 칸의 key 와 같다.
 * @param {'purchase'|'edu'|'trip'|'outside'} kind
 * @param {object} rec 관문(src/input.js structure)을 지난 기록
 * @param {{me?: string, files?: string[], cut?: object|null}} [ctx] files 는 읽은 파일 이름 — 첨부 목록이 된다. cut 은 오린 견적서(attachWithCut)
 * @returns {{draft: object, notes: string[]}}
 */
export function fromRecord(kind, rec, { me = '', files = [], cut = null } = {}) {
  const k = FIELDS[kind] ? kind : 'purchase';
  const r = rec && typeof rec === 'object' ? rec : {};
  const notes = [];
  if (r.currency && r.currency !== 'KRW') notes.push(`${r.currency} 문서입니다 — 합계를 원화로 고쳐 주세요`);
  const draft = Object.fromEntries(FIELDS[k].map((f) => [f.key, startValue(f, r, me)]));
  draft.currency = r.currency || 'KRW';
  draft.attach = attachWithCut(k, r.parts, files, cut);
  FILL[k]?.(draft, r, notes);
  return { draft, notes };
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

/** 초안의 합계(원) — 레시피 purpose.yaml 의 amount_field 칸. 구매는 total, 교육은 fee, 출장은 cost(예상경비), 외부활동은 없다. */
export const amountOf = (kind, draft) => {
  const key = RECIPE.purposes[kind]?.amount_field;
  return key ? draft?.[key] : null;
};

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

/* ------------------------------------------------------------ 채팅으로 공문 설정 채우기 */

const TITLE_RE = /\s*(수석|책임|선임|원급|연구원|연구위원|위원|팀장|부장|본부장|소장|박사|PI|님)\.?$/i;
const PERSON_RE = /^[가-힣]{2,4}$/;
const CODE_RE = /^(?=.*\d)[A-Za-z]{1,8}[-_A-Za-z0-9]*\d[-_A-Za-z0-9]*$|^\d{4}[A-Za-z]{2}\d{3,}$/;
const HEADER_RE = /^(no\.?|순번|과제명?|과제\s*이름|과제\s*번호|번호|코드|(연구|과제)?책임자|합의자|pi|비고|기간)$/i;

/** 사람 이름만 남긴다 — "박기도 책임" → "박기도". */
const personOf = (s) => String(s ?? '').trim().replace(TITLE_RE, '').replace(TITLE_RE, '').trim();

/**
 * 붙여 넣은 글에서 공문 설정 조각을 규칙으로 읽는다 — Claude 가 닿지 않을 때(레시피 registries/setup.yaml 의 gongmunSetup 과 같은 모양).
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
/** 공문 설정 칸의 과제 한 줄. */
export const EMPTY_ROW = Object.freeze({ name: '', alias: '', code: '', lead: '', period: '', about: '', content: '', account: '' });
/** 과제 없이 와도 지금 고른 과제 몫으로 넣는 칸 — [칸, 사람에게 부르는 이름]. */
const CURRENT_KEYS = [['lead', '합의자'], ['alias', '과제 별명'], ['period', '연구기간'], ['content', '과제 내용']];

/**
 * 채팅으로 받은 조각(레시피 registries/setup.yaml 의 gongmunSetup)을 공문 설정에 얹는다. 과제는 이름이나 번호가 같은 것을 고치고, 없으면 빈 줄에
 * 넣거나 더한다(MAX_PROJECTS 개까지 — 넘치는 것은 skipped). 조각에 없는 칸은 그대로 둔다. 참조자는 조각의 목록으로 바꾼다.
 * 과제 없이 사람만 왔으면(patch.lead) 지금 고른 과제(current)의 합의자로 넣는다 — 고른 과제가 없으면 skipped 에 적는다.
 * @param {object[]} rows 공문 설정 칸의 과제 줄(이름을 아직 적지 않은 줄도 있다)
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
 * 과제책임자가 기안자 본인이면 합의는 뺀다. 본인이 아니면 언제나 합의자다 — 부서장이 과제책임자여도 합의에 넣고 그렇다고 적는다
 * (2026-10-08 사용자 지정: "과제 책임자가 본인이 아니면 과제 책임자 합의로 들어가야 함". 원본 rules.py 의 resolve_internal_agreement 는 부서장이면 뺐다).
 *
 * 결재는 부서장(팀장)부터 위임전결의 전결권자까지 아래에서 위로 선다 — 마지막 결재자가 전결이다(delegationOf, 2026-10-08 사용자 지정
 * "위임전결도 같이 입력"). 갈래(kind)를 주지 않으면 부서장 전결이다. 공문 설정에 이름이 없는 직책은 missing 에 남는다 — 화면이 채우라고 보인다.
 * @param {{kind?: string, draft?: object, rank?: string}} [opts] rank 는 이 공문에서 고른 전결권자(비면 규정대로)
 * @returns {{steps: {role:string, name:string, why?:string}[], refs: string[], notes: string[], missing: string[], delegation: object|null}}
 */
export function approvalLine({ me = '', preset = {}, project = null, kind = '', draft = {}, rank = '' } = {}) {
  const p = normalizePreset(preset);
  const notes = [];
  const steps = [{ role: '기안', name: me || '나' }];
  const lead = String(project?.lead || '').trim();
  if (lead && same(lead, me)) notes.push('과제책임자가 기안자라 합의는 뺐습니다');
  else if (lead) {
    steps.push({ role: '합의', name: lead, why: '과제책임자' });
    if (same(lead, p.head)) notes.push('과제책임자가 부서장이라 합의와 결재가 같은 사람입니다');
  }
  const delegation = kind ? delegationOf(kind, draft, { rank }) : null;
  const missing = [];
  for (const r of RANKS.slice(0, RANKS.indexOf(delegation?.rank || RANKS[0]) + 1)) {
    const name = p[RANK_KEY[r]];
    if (name) steps.push({ role: '결재', name, why: RANK_WHY[r] || r });
    else missing.push(r);
  }
  return { steps, refs: p.refs.filter((n) => !steps.some((s) => same(s.name, n))), notes, missing, delegation };
}

/* ------------------------------------------------------------ 위임전결 */

/** 전결권자의 직책 — 아래에서 위로(레시피 registries/delegation.yaml 의 ranks). */
export const RANKS = [...RECIPE.delegation.ranks];
/** 직책 → 공문 설정의 이름 칸. 팀장은 부서장 칸이다. */
const RANK_KEY = { 팀장: 'head', 소장: 'director', 본부장: 'chief' };
/** 결재선 화면에서 직책을 부르는 이름 — 팀장은 이 확장이 처음부터 '부서장'이라 불렀다. */
export const RANK_WHY = { 팀장: '부서장' };

/**
 * 이 공문의 전결권자 — 레시피의 rule_key 가 가리키는 위임전결 규정(금액 구간·국내/해외 구분·고정)으로 정한다. rank 를 주면 그것이 이긴다(사용자가 고른 것).
 * 금액 기준인데 금액을 모르면 맨 아래 구간으로 두고 unknown 으로 알린다.
 * @returns {{rank:string, auto:string, overridden:boolean, rule:string, label:string, source:string, basis:string, unknown:boolean}|null}
 */
export function delegationOf(kind, draft = {}, { rank = '' } = {}) {
  const p = RECIPE.purposes[kind];
  const rule = p && RECIPE.delegation.rules[p.rule_key];
  if (!rule) return null;
  let auto = '';
  let basis = '';
  let unknown = false;
  if (rule.basis === 'amount') {
    const amount = moneyOf(draft?.[p.amount_field]);
    unknown = amount == null;
    auto = (unknown ? rule.steps[0] : rule.steps.find((s) => s.max == null || amount <= s.max)).approver;
    basis = unknown ? '금액 모름' : won(amount);
  } else if (rule.basis === 'division') {
    const keys = Object.keys(rule.divisions);
    basis = keys.includes(draft?.[rule.division_field]) ? draft[rule.division_field] : keys[0];
    auto = rule.divisions[basis];
  } else auto = rule.approver;
  const chosen = RANKS.includes(rank) ? rank : auto;
  return { rank: chosen, auto, overridden: chosen !== auto, rule: p.rule_key, label: rule.label, source: rule.source, basis, unknown };
}

/* ------------------------------------------------------------ 문서설정 */

const DS_KEYS = ['retention', 'docNo', 'receiver', 'scope', 'emergency', 'approvingOpen', 'drm', 'tag'];
/** 문서설정의 선택지 — 보존년한(코드 → 이름)·공개범위(이름 → 코드)·수신처(레시피 settings.yaml 의 options). */
export const SETTING_OPTIONS = RECIPE.settings.options;

/** 이 공문에서 바꾼 문서설정만 — 아는 칸·아는 값만 남긴다(패널이 초안에 담아 둔다). */
export function settingPatch(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of DS_KEYS) {
    if (!(k in r) || r[k] == null) continue;
    if (['emergency', 'approvingOpen', 'drm'].includes(k)) out[k] = !!r[k];
    else if (k === 'docNo') out[k] = String(r[k]).replace(/\D/g, '').slice(0, 8);
    else out[k] = String(r[k]).trim().slice(0, 60);
  }
  if (out.retention && !(out.retention in SETTING_OPTIONS.retention)) delete out.retention;
  if (out.scope && !(out.scope in SETTING_OPTIONS.scope)) delete out.scope;
  if (out.receiver && !SETTING_OPTIONS.receiver.includes(out.receiver)) delete out.receiver;
  return out;
}

/**
 * 문서설정 — 레시피의 defaults < 갈래의 프로파일(purpose.yaml 의 document_setting) < 이 공문에서 바꾼 것(override). 문서번호(Doc No.)는
 * 기안 팀 채번이다 — 공문 설정의 문서번호 부서, 비면 부서 이름으로 teams 표에서 찾는다(부서 칸에 '연구본부 …' 처럼 앞말이 붙어도 찾는다).
 * @returns {{profile:string, retention:string, retentionText:string, docNo:string, docNoFrom:string, receiver:string, scope:string, scopeCode:string,
 *   emergency:boolean, approvingOpen:boolean, drm:boolean, tag:string}}
 */
/**
 * 공문 설정의 부서에서 팀 이름 — 레시피 settings.yaml 의 teams 표에 있는 팀('연구본부 수소전기추진연구팀' 처럼 앞말이 붙어도 찾는다), 없으면 부서 칸의 마지막 말.
 * 문서설정의 Doc No. 찾기와, 결재선 조직도에서 이름이 같은 사람을 가르는 기준('이름[팀]' 의 팀)이 같이 쓴다.
 */
export function teamOf(preset = {}) {
  const pre = normalizePreset(preset);
  const known = Object.keys(RECIPE.settings.teams || {}).find((t) => keyOf(pre.dept).includes(keyOf(t)));
  return known || pre.dept.trim().split(/\s+/).pop() || '';
}

/**
 * 문서번호 코드(문서설정 Doc No.) 후보 — 레시피 settings.yaml 의 doc_no_options(문서설정 창 ddlDocNo 의 코드와 영문 팀 이름 전부, 2026-10-08 캡처)와
 * teams(한글 팀 이름 → 코드)로 부서 칸의 글에 맞는 코드를 찾는다(2026-10-09 사용자 지정: "부서는 내 부서를 입력하면 되고 2개면 선택하라고").
 * 코드가 적혀 있으면 그 코드가 목록에 있는지만 본다(set | unknown). 비어 있으면 부서로 찾는다 — 한글 팀 이름이 부서 글에 들어 있거나, 영문 이름이 부서 글에
 * 들어 있거나(영문으로 적었을 때), 부서 글(넉 자 이상)이 영문 이름에 들어 있으면 후보다: one | many | none, 부서도 비면 empty.
 * @returns {{state:'set'|'unknown'|'one'|'many'|'none'|'empty', code:string, name:string, matches:{code:string,name:string,team:string}[], all:{code:string,name:string,team:string}[]}}
 */
export function docNoCandidates(dept = '', docNo = '') {
  const S = RECIPE.settings;
  const koOf = Object.fromEntries(Object.entries(S.teams || {}).map(([ko, code]) => [String(code), ko]));
  const all = Object.entries(S.doc_no_options || {}).map(([code, name]) => ({ code: String(code), name: String(name), team: koOf[String(code)] || '' }));
  const code = String(docNo || '').trim();
  if (code) {
    const hit = all.find((o) => o.code === code);
    return { state: hit ? 'set' : 'unknown', code, name: hit?.name || '', matches: hit ? [hit] : [], all };
  }
  const key = keyOf(dept);
  if (!key) return { state: 'empty', code: '', name: '', matches: [], all };
  const matches = all.filter((o) => (o.team && key.includes(keyOf(o.team))) || key.includes(keyOf(o.name)) || (key.length >= 4 && keyOf(o.name).includes(key)));
  const one = matches.length === 1 ? matches[0] : null;
  return { state: one ? 'one' : matches.length ? 'many' : 'none', code: one?.code || '', name: one?.name || '', matches, all };
}

export function docSettingOf(kind, preset = {}, override = {}) {
  const S = RECIPE.settings;
  const profile = RECIPE.purposes[kind]?.document_setting || Object.keys(S.profiles)[0];
  const base = { ...S.defaults, ...(S.profiles[profile] || {}) };
  const pre = normalizePreset(preset);
  const team = Object.keys(S.teams || {}).find((t) => keyOf(pre.dept).includes(keyOf(t)));
  const auto = base.doc_no === 'team' ? (pre.docNo || (team ? String(S.teams[team]) : '')) : String(base.doc_no || '');
  const o = settingPatch(override);
  const out = {
    profile, retention: String(base.retention), docNo: auto, receiver: base.receiver, scope: base.scope,
    emergency: !!base.emergency, approvingOpen: !!base.approving_open, drm: !!base.drm, tag: String(base.tag || ''), ...o,
  };
  out.docNoFrom = o.docNo ? '이 공문' : pre.docNo ? '공문 설정' : team ? `부서(${team})` : '';
  out.retentionText = S.options.retention[out.retention] || out.retention;
  out.scopeCode = S.options.scope[out.scope] || '';
  return out;
}

/** 문서설정을 한 줄로 — 보존 10년 · Doc No. 8100 · 수신 내부결재 · 공개 결재선 */
export function settingText(s) {
  const flags = [s.emergency ? '긴급' : '', s.approvingOpen ? '진행공개' : '', s.drm ? 'DRM' : ''].filter(Boolean);
  return [`보존 ${s.retentionText}`, `Doc No. ${s.docNo || '없음'}`, `수신 ${s.receiver}`, `공개 ${s.scope}`, ...flags].join(' · ');
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

/** 틀 자리의 꼴 — 레시피 body_spec.yaml 의 show. period·qty 는 두 칸([시작, 끝]·[수량, 단위])을 받는다. */
const SHOW = {
  text: (v) => (v == null ? '' : String(v)),
  won: (v) => won(moneyOf(v)),
  date: (v) => dotDate(v),
  period: (from, to) => span(from, to),
  count: (v) => (Array.isArray(v) && v.length ? String(v.length) : ''),
  qty: (qty, unit) => (qty != null && qty !== '' ? `${Number(qty).toLocaleString('ko-KR')}${unit || ''}` : ''),
};

/** 틀 자리 하나의 값 — row 는 초안(목록 자리면 그 줄)이다. 비었고 or: me 이면 내 이름. */
const slotValue = (slot, row, me) => {
  const out = SHOW[slot.show || 'text'](...[].concat(slot.from).map((k) => row?.[k]));
  return !String(out).trim() && slot.or === 'me' ? me : out;
};

/** 틀의 목록({{#이름}} … {{/이름}})마다 줄의 값 — 레시피 body_spec.yaml 의 lists. */
const listsFor = (kind, draft = {}, me = '') => Object.fromEntries(Object.entries((RECIPE.purposes[kind] || RECIPE.purposes.purchase).lists)
  .map(([name, l]) => [name, (Array.isArray(draft?.[l.from]) ? draft[l.from] : [])
    .map((row) => Object.fromEntries(Object.entries(l.vars).map(([n, slot]) => [n, slotValue(slot, row, me)])))]));

/**
 * 틀에 넣을 값. 공통 자리(부서·과제·계정·첨부 — 레시피 registries/vars.yaml)는 여기서 채우고, 갈래의 자리는 레시피 body_spec.yaml 의 vars
 * (어느 칸을 어떤 꼴로)대로 채운다.
 */
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
  // 교육 구분(제목)은 칸이 비었거나 예전 초안이어도 교육장소·교육기관으로 정한다(eduModeOf — 고른 것이 먼저).
  const d = kind === 'edu' ? { ...draft, mode: eduModeOf(draft) } : draft;
  for (const [name, slot] of Object.entries((RECIPE.purposes[kind] || RECIPE.purposes.purchase).vars)) vars[name] = slotValue(slot, d, me);
  return vars;
}

/**
 * 제목과 본문을 만든다. 비어 있는 값은 [이름] 으로 남고 missing 에 적힌다.
 * @returns {{title: string, body: string, form: string, missing: string[]}}
 */
export function compose(kind, draft, ctx = {}, tpl = templateOf(kind, null)) {
  const vars = varsFor(kind, draft, ctx);
  const lists = listsFor(kind, draft, ctx.me);
  const title = fillTemplate(tpl.title, vars, lists);
  const body = fillTemplate(tpl.body, vars, lists);
  return { title: title.text.trim(), body: body.text, form: tpl.form, missing: [...new Set([...title.missing, ...body.missing])] };
}

/**
 * 올리기 전에 채워야 할 것. 화면의 "남은 것" 줄에 적는다 — 막지는 않는다(본문은 사용자가 고칠 수 있다). 한도는 따로 막는다.
 * @returns {string[]}
 */
export function needs(kind, draft, { preset = {}, project = null, projects = [], rank = '', setting = {} } = {}) {
  const out = [];
  if (!projects.length) out.push('과제 등록(R&D 탭)');
  else if (!project) out.push('과제 선택');
  else {
    if (!String(project.lead || '').trim()) out.push('합의자(과제책임자)');
    // 제목 틀에 {과제별명} 이 있는 갈래(교육·출장)는 과제 별명으로 쓴다 — 비면 과제명이 그대로 들어가 길어진다(막지는 않는다).
    if (DEFAULT_TEMPLATES[kind]?.title.includes('{과제별명}') && !String(project.alias || '').trim()) out.push('과제 별명(공문 설정 — 제목)');
  }
  if (!normalizePreset(preset).head) out.push('부서장(공문 설정)');
  if (!normalizePreset(preset).dept) out.push('부서(공문 설정)');
  // 전결권자가 부서장보다 위면(소장·본부장) 그 이름도 있어야 결재선을 세운다. 부서 이름으로 문서번호 부서를 찾지 못하면 적어 달라고 한다.
  for (const r of approvalLine({ preset, kind, draft, rank }).missing) if (r !== RANKS[0]) out.push(`${r}(공문 설정 — 위임전결)`);
  if (normalizePreset(preset).dept && !docSettingOf(kind, preset, setting).docNo) out.push('문서번호 부서(공문 설정)');
  // 꼭 채울 칸 — 레시피 purpose.yaml 에 need 를 적은 칸이 비면 그 이름으로. 꼭 드는 첨부(교육 — 교육 견적서·교육 내용)가 빠졌으면 그것도.
  const d = draft || {};
  for (const f of FIELDS[kind] || []) {
    if (f.need && (f.type === 'money' ? moneyOf(d[f.key]) == null : !String(d[f.key] ?? '').trim())) out.push(f.need);
  }
  for (const doc of missingDocs(kind, d.attach)) out.push(`${doc.label}(첨부)`);
  return out;
}

/* ------------------------------------------------------------ 과제 내용으로 사유 쓰기 */

/**
 * 사유 쓰기가 쓰는 칸 — 레시피 purpose.yaml 에서 write 가 있는 칸이다. 사유(from: write)는 하나이고, 용도(교육목적·출장목적·활동목적)는 문서에서
 * 읽은 칸을 다듬어 쓴다. 사유 쓰기가 없는 갈래(write 가 있는 칸이 없다)는 빠진다.
 */
const WRITES = Object.fromEntries(KIND_ORDER.map((k) => [k, FIELDS[k].filter((f) => f.write)]).filter(([, list]) => list.length));
/** 사유 칸과 용도 칸의 key — 갈래마다 이름이 다르다(구매는 use, 교육·출장·외부활동은 purpose). */
export const REASON_KEYS = Object.fromEntries(Object.entries(WRITES).map(([k, list]) => [k, {
  reason: list.find((f) => f.from === 'write').key, use: list.find((f) => f.from !== 'write')?.key,
}]));
/** 사유 칸을 사람에게 부르는 이름(그 칸의 label). */
export const REASON_LABEL = Object.fromEntries(Object.entries(WRITES).map(([k, list]) => [k, list.find((f) => f.from === 'write').label]));

/**
 * 사유를 쓰라고 Claude 에 줄 글(레시피가 만든 작업 gongmunReason.<갈래>의 입력). 과제 내용이 근거이고(R&D 탭의 과제면 연구 내용 — rndProjects),
 * 품의할 것은 레시피 purpose.yaml 의 writing.context(틀과 같은 꼴 — 금액·업체는 넣지 않는다)를 초안으로 채운 줄이다.
 * ask 는 초안의 에이전트 칸에 사용자가 적은 말이다("사유를 시험 장비 쪽으로 다시") — 있으면 지금 적힌 사유와 함께 넘겨 그 말대로 고쳐 쓰게 한다.
 */
export function reasonInput(kind, draft = {}, project = null, { ask = '' } = {}) {
  const p = project || {};
  const k = REASON_KEYS[kind] ? kind : 'purchase';
  const keys = REASON_KEYS[k];
  const said = String(ask || '').trim().slice(0, 1000);
  const context = RECIPE.purposes[k].writing.context;
  const what = fillTemplate(context, varsFor(k, draft, { project }), listsFor(k, draft)).text.split('\n');
  return [
    `품의 종류: ${KINDS[kind]?.title || kind}`,
    `과제명: ${p.name || '(없음)'}`,
    p.code ? `과제번호: ${p.code}` : '',
    p.about ? `과제 개요: ${p.about}` : '',
    `과제 내용${p.rnd ? '(R&D 탭의 연구 내용 — 연구개발 계획·진행 기록)' : ''}:\n<<<\n${p.content || '(없음)'}\n>>>`,
    '',
    '품의할 것:',
    ...what.filter((l) => l.trim()),
    ...(said ? [
      draft[keys.reason] ? `지금 적힌 ${REASON_LABEL[k]}: ${draft[keys.reason]}` : '',
      `사용자의 말:\n<<<\n${said}\n>>>`,
    ] : []),
  ].filter((l) => l !== '').join('\n');
}

/**
 * 써 온 사유·용도를 초안에 넣는다 — 답의 키는 칸의 key 다(레시피 purpose.yaml 에서 write 가 있는 칸). 사유(from: write)는 넣고(누른 사람이 원한 것이다),
 * 문서에서 읽은 칸(용도·교육목적…)은 사용자가 고치지 않았을 때만 바꾼다. 에이전트 칸에 적은 말로 쓴 것(asked)이면 그 칸도 넣는다 — 고쳐 달라고 한 사람이 원한 것이다.
 * @param {object} data 관문을 지난 답(gongmunReason.<갈래>)
 * @param {{touched?: string[], asked?: boolean}} [opts] touched 는 사용자가 고친 칸
 */
export function applyReason(kind, draft, data, { touched = [], asked = false } = {}) {
  const out = { ...draft };
  for (const f of WRITES[kind] || []) {
    const value = String(data?.[f.key] || '').trim();
    const kept = f.from !== 'write' && !asked && touched.includes(f.key) && String(draft?.[f.key] || '').trim();
    if (value && !kept) out[f.key] = value;
  }
  return out;
}

/* ------------------------------------------------------------ 붙여 넣을 꼴 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * 본문을 편집기(DEXT5)에 넣을 HTML 로. 줄마다 <div> 이고 앞의 빈칸은 &nbsp; 로 지킨다(들여쓰기가 공문의 꼴이다). 빈 줄은 <div><br></div>.
 * '아 래' 줄은 가운데에 둔다(원본 body.py 의 _CENTER_JS 와 같은 판정). 꼴은 ApprovalInPrinciple fieldfill.py 의 _plain_richtext_html 과 같다 —
 * <control>_SetHTMLBody 로 넣어 임시저장 뒤에도 그대로 남은 꼴이다(references/realeanet_dext5.md).
 */
export function bodyHtml(body) {
  const center = /(^|[\s\-─–—])아\s*래([\s\-─–—]|$)/;
  return String(body ?? '').split('\n').map((line) => {
    const lead = line.match(/^ */)[0].length;
    if (!line.trim()) return '<div><br></div>';
    const inner = `${'&nbsp;'.repeat(lead)}${esc(line.slice(lead))}`;
    return center.test(line) ? `<div style="text-align:center;">${inner}</div>` : `<div>${inner}</div>`;
  }).join('');
}

/**
 * 전자결재에 넣을 글 — 긴 줄표(—·–)는 '-' 로 바꾼다. 저장할 때 "@Resources.Message.EncodingError" 창이 뜬다(ApprovalInPrinciple 실측,
 * U+2014 — 저장은 되지만 사용자를 멈춰 세운다). 사유를 쓰는 Claude 가 줄표를 자주 쓴다.
 */
export const eclassText = (s) => String(s ?? '').replace(/[–—―]/g, '-');

/** 제목의 길이 한도 — 전자결재가 99자에서 자른다(ApprovalInPrinciple 실측). 레시피 fieldmap 의 title.max. */
export const TITLE_MAX = 99;

/**
 * 차수(년차) — R&D 탭 과제면 오늘이 든 차년도(1차년도 = 1, 단년도 과제도 1). 공문 설정의 과제만 고른 것이면 모른다(빈 글 — 그때는
 * 새 공문 창의 과제 목록이 알려 주는 차수를 쓴다, src/gmwrite.js).
 */
export const degreeOf = (project) => (project?.rnd?.year > 0 ? String(project.rnd.year) : '');

/**
 * 새 공문 창에 쓸 것 — src/gmwrite.js 가 이것만 보고 쓴다. 폼의 칸 지도(레시피 fieldmap)·값·문서설정·결재선을 한데 묶는다.
 * 레시피에 칸 지도가 없는 양식(양식 ID 를 직접 적은 것)은 fields 가 비어 있다 — 창을 열기만 한다.
 * @param {{title:string, body:string, draft:object, form?:string, setting?:object, rank?:string}} doc 화면의 제목·본문(직접 고친 것이면 그 글)과 초안
 * @param {{me?:string, preset?:object, project?:object|null}} ctx
 */
export function writePlan(kind, { title = '', body = '', draft = {}, form = DEFAULT_FORM, setting = {}, rank = '' } = {}, ctx = {}) {
  const fm = RECIPE.forms[form] || null;
  const project = ctx.project || null;
  const line = approvalLine({ ...ctx, kind, draft, rank });
  const text = eclassText(body);
  return {
    kind, form: fm ? fm.id : form, url: draftUrl(form), known: !!fm,
    anchor: fm?.anchor || '', fields: fm?.fields || {},
    values: {
      title: eclassText(title).replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX), body: text, html: bodyHtml(text),
      recipient: '', reference: '', degree: degreeOf(project),
      job: { name: project?.name || '', code: project?.code || '' },
    },
    setting: docSettingOf(kind, ctx.preset, setting),
    line: {
      approvers: line.steps.filter((s) => s.role === '결재').map((s) => s.name),
      agree: line.steps.filter((s) => s.role === '합의').map((s) => s.name),
      refs: line.refs, missing: line.missing, rank: line.delegation?.rank || RANKS[0],
      // 조직도에 이름이 같은 사람이 여럿이면 이 팀('이름[팀]')인 사람 하나만 고른다(2026-10-09 실측 — 참조자 한 명이 네 팀에 있었다).
      team: teamOf(ctx.preset),
    },
  };
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

/** 누구의 문서인가 — 레시피 attach_rules.yaml 의 who 칸(구매처·교육기관·출장지·요청 기관)의 값. 첨부 파일 이름과 읽은 문서의 머리에 붙는다. */
export const whoOf = (kind, draft) => String(draft?.[(RECIPE.purposes[kind] || RECIPE.purposes.purchase).attach.who] || '').trim();

/** 읽은 문서의 종류(docType)를 화면이 부르는 이름 — 레시피 registries/reading.yaml 의 docType names. */
export const DOC_NAMES = { ...RECIPE.docNames };

/** 첨부로 저장할 파일 이름 — 견적서_업체_2026-10-07.pdf. label 은 첨부 목록의 문서 이름(교육 견적서·교육 내용 …). */
export function attachName(kind, draft, today, label = '') {
  const who = whoOf(kind, draft).replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 30);
  const doc = (label || KINDS[kind]?.doc || '첨부').replace(/[\\/:*?"<>|\s]+/g, '');
  return `${doc}${who ? `_${who}` : ''}_${today || ''}.pdf`.replace(/_\.pdf$/, '.pdf');
}
