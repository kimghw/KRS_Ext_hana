import { FORM, GRID } from './config.js';

const clean = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

const scriptsOf = (doc) =>
  [...doc.querySelectorAll('script')].map((s) => clean(s.textContent)).filter(Boolean);

/** 응답에서 폼 필드가 실제로 어떤 값으로 돌아왔는지 읽는다. */
function readField(doc, name) {
  const el = doc.getElementsByName(name)[0];
  if (!el) return null;
  if (el.tagName === 'SELECT') {
    const opt = el.querySelector('option[selected]');
    return opt ? (opt.getAttribute('value') ?? clean(opt.textContent)) : '(선택 없음)';
  }
  return el.getAttribute('value') ?? '';
}

/** 붉은 글씨 등 화면에 뜬 짧은 안내 문구. */
function noticesOf(doc) {
  const out = [];
  for (const n of doc.querySelectorAll('span, font, div, td')) {
    const style = `${n.getAttribute('style') || ''} ${n.getAttribute('class') || ''}`;
    if (!/red|error|warn|경고/i.test(style)) continue;
    const t = clean(n.textContent);
    if (t && t.length <= 120) out.push(t);
  }
  return [...new Set(out)];
}

/** ViewState 같은 덩어리는 요약에 넣지 않는다. */
const BULKY = /VIEWSTATE|EVENTVALIDATION|_TSM|ClientState/;

/** 회의실: 보낸 값과, 응답 폼에 남은 값(폼 칸 이름이 정해져 있다). */
function roomParts(doc, payload) {
  const grid = doc.getElementById(GRID.tableId);
  return {
    대상: '회의실',
    보낸값: {
      지역: payload.region,
      회의실: payload.roomValue,
      날짜: payload.date,
      시작: payload.start,
      종료: payload.end,
      회의주제: payload.title,
    },
    응답에_남은_폼값: {
      지역: readField(doc, FORM.region),
      회의실: readField(doc, FORM.room),
      날짜: readField(doc, FORM.date),
      시작시: readField(doc, FORM.startHour),
      시작분: readField(doc, FORM.startMinute),
      종료시: readField(doc, FORM.endHour),
      종료분: readField(doc, FORM.endMinute),
      회의주제: readField(doc, FORM.title),
    },
    예약표_행수: grid ? [...grid.rows].filter((r) => r.cells.length >= GRID.minCells && !r.querySelector('th')).length : null,
  };
}

/**
 * 차량: 신청 폼의 칸 이름은 화면에서 찾아낸 것이라(carform.js) 정해 둔 이름이 없다.
 * 보낸 칸 이름 그대로 응답에서 다시 읽는다. 응답이 신청 폼이 아니면 값은 null 로 남는다 — 모르는 것은 모른다고 둔다.
 */
function carParts(doc, payload, fields) {
  const sent = Object.keys(fields || {}).filter((k) => !BULKY.test(k)).slice(0, 30);
  return {
    대상: '차량',
    보낸값: {
      차량: payload.car,
      날짜: payload.date,
      종료날짜: payload.endDate || payload.date,
      시작: payload.start,
      종료: payload.end,
      행선지: payload.place,
      사용목적: payload.title,
      동승자: payload.passenger,
    },
    응답에_남은_폼값: Object.fromEntries(sent.map((name) => [name, readField(doc, name)])),
    예약표_행수: null,
  };
}

/**
 * 저장 응답에서 판단에 필요한 부분만 뽑아 작은 요약으로 만든다.
 *
 * 응답 HTML 은 130KB 가 넘는데 대부분 ViewState 와 달력이라
 * 통째로 모델에 보내면 비싸기만 하고 도움이 안 된다.
 * 제출 전 페이지와 **달라진 것**을 중심으로 추린다.
 *
 * 보낸 값과 폼 칸은 종류마다 다르다(payload.kind). 차량 신청을 회의실 칸 이름으로 읽으면 요약이 온통 비어서
 * 원인 설명이 근거 없이 지어진다.
 */
export function buildSaveDigest(html, baselineHtml, fields, payload) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = new DOMParser().parseFromString(baselineHtml || '', 'text/html');

  const had = new Set(scriptsOf(base));
  const newScripts = scriptsOf(doc).filter((t) => !had.has(t)).map((t) => t.slice(0, 400));

  const hadNotice = new Set(noticesOf(base));
  const newNotices = noticesOf(doc).filter((t) => !hadNotice.has(t));

  return {
    ...(payload.kind === 'car' ? carParts(doc, payload, fields) : roomParts(doc, payload)),
    새로_나타난_스크립트: newScripts.slice(0, 8),
    새로_나타난_안내문구: newNotices.slice(0, 10),
    보낸_필드이름: Object.keys(fields || {}).filter((k) => !BULKY.test(k)),
  };
}
