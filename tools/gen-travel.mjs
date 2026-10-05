// travel-rules.yaml + ktx-fares.yaml + ktx-fares-official.yaml + air-mileage.yaml → src/travelspec.js
//
// 확장은 번들러 없는 순수 ES 모듈이라 YAML 을 읽지 못한다. 그래서 규칙과 운임·항공 마일리지 표를 JS 모듈로 옮겨 둔다.
// 네 파일 가운데 하나라도 고친 뒤에 `node tools/gen-travel.mjs` 를 돌린다. `--check` 는 쓰지 않고 어긋났는지만 본다.
//
// KTX 운임은 두 파일이다. ktx-fares-official.yaml 은 코레일 공식 운임표에서 가져온 것(tools/import-ktx-fares.py 가 쓴다 — 손대지 않는다),
// ktx-fares.yaml 은 **손으로 고치는 파일**이다 — 거기 적은 구간이 공식 표의 같은 구간을 이기고, 공식 표에 없는 구간을 더할 수도 있다.
// 구간마다 대략 소요 시간(hours)도 여기서 붙인다 — ktx-fares.yaml 의 times(이웃한 역 사이의 분)로 셈해 운임 옆에 적는다.
//
// 같은 값으로 **사람이 읽는 검토표**(references/review.md)도 같이 쓴다 — 공식 표에 손으로 고친 것을 얹은 결과는 생성물(JSON)로만
// 볼 수 있어서, 운임·길잡이·마일리지가 맞는지 눈으로 맞춰 볼 표를 따로 낸다. 다시 만들 때는 무엇이 바뀌었는지도 말해 준다.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const RULES = new URL('../references/travel-rules.yaml', import.meta.url);
const FARES = new URL('../references/ktx-fares.yaml', import.meta.url);
const OFFICIAL = new URL('../references/ktx-fares-official.yaml', import.meta.url);
const MILEAGE = new URL('../references/air-mileage.yaml', import.meta.url);
const TARGET = new URL('../src/travelspec.js', import.meta.url);
const REVIEW = new URL('../references/review.md', import.meta.url);

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const isHour = (n) => Number.isInteger(n) && n >= 0 && n <= 23;
const isFare = (n) => Number.isInteger(n) && n > 0;
/** 정가는 100원 단위다(공식 표의 1,084개 값이 모두 그렇다) — 자릿수를 잘못 적은 값(5440)을 여기서 잡는다. */
const isRound = (n) => n % 100 === 0;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
/** 구간의 대략 소요 시간(시간 단위). */
const isHours = (n) => Number.isInteger(n) && n >= 1 && n <= 23;

/** 규칙의 모양을 본다. 틀린 규칙으로 여비계산서를 지으면 틀린 금액이 조용히 올라간다. */
export function checkRules(rules) {
  const errors = [];
  const at = (msg) => errors.push(`travel-rules.yaml: ${msg}`);
  if (!rules || typeof rules !== 'object') return ['travel-rules.yaml: 내용이 없습니다'];
  for (const key of ['day_trip', 'general']) {
    if (typeof rules.period?.[key]?.code !== 'string') at(`period.${key}.code 는 글이어야 합니다`);
  }
  if (!['I', 'O'].includes(rules.period?.day_trip?.area)) at('period.day_trip.area 는 I 또는 O 입니다');
  if (typeof rules.nation?.code !== 'string') at('nation.code 가 없습니다');
  if (!(typeof rules.daily?.per_day === 'number' && rules.daily.per_day > 0)) at('daily.per_day 는 0 보다 커야 합니다');
  if (rules.meals?.per_day !== 3) at('meals.per_day 는 3 입니다(아침·점심·저녁)');
  if (!isHour(rules.meals?.breakfast?.first_day_depart_hour_at_most)) at('meals.breakfast.first_day_depart_hour_at_most 는 0~23 의 시(時)입니다');
  if (!isHour(rules.meals?.dinner?.last_day_arrive_hour_at_least)) at('meals.dinner.last_day_arrive_hour_at_least 는 0~23 의 시(時)입니다');
  if (typeof rules.transport?.method?.code !== 'string') at('transport.method.code 가 없습니다');
  if (typeof rules.transport?.train?.currency !== 'string') at('transport.train.currency 가 없습니다');
  const choices = rules.transport?.choices;
  if (!Array.isArray(choices) || !choices.length) at('transport.choices 가 비어 있습니다');
  for (const c of choices || []) {
    if (typeof c.value !== 'string' || typeof c.label !== 'string' || typeof c.site !== 'string') at(`transport.choices: value·label·site 가 있어야 합니다(${JSON.stringify(c)})`);
  }
  if (!(choices || []).some((c) => c.value === rules.transport?.default)) at('transport.default 가 choices 에 없습니다');
  if (!['standard', 'first'].includes(rules.transport?.train?.grade)) at('transport.train.grade 는 standard 또는 first 입니다');
  for (const g of ['standard', 'first']) {
    if (typeof rules.transport?.train?.grade_labels?.[g] !== 'string') at(`transport.train.grade_labels.${g} 이 없습니다`);
  }
  const over = rules.lodging?.over_cap;
  if (!(typeof over?.approve_rate === 'number' && over.approve_rate >= 1)) at('lodging.over_cap.approve_rate 는 1 이상의 수입니다(상한액의 몇 배까지 승인으로 정산하는가)');
  if (!(typeof over?.approver === 'string' && over.approver.trim())) at('lodging.over_cap.approver 가 없습니다(누구의 승인인가)');
  return errors;
}

const pairKey = (r) => [r?.a, r?.b].sort().join('|');

/**
 * 공식 운임표(ktx-fares-official.yaml)에 손으로 고치는 파일(ktx-fares.yaml)을 얹어 확장이 쓰는 운임표 한 벌을 만든다.
 * 손으로 적은 구간이 공식 표의 같은 구간(방향은 가리지 않는다)을 **그 자리에서** 바꾸고, 공식 표에 없는 구간은 뒤에 붙는다.
 * source 는 공식 표의 것이 official, 손으로 적은 것은 적어 둔 값(없으면 manual)이다.
 * @returns {{fares: object, errors: string[]}} errors 는 한 파일 안에서 같은 구간을 두 번 적은 것
 */
export function mergeFares(fares, official) {
  const errors = [];
  const routes = [];
  const at = new Map();
  for (const r of official?.routes || []) {
    if (at.has(pairKey(r))) errors.push(`ktx-fares-official.yaml: 같은 구간이 두 번 있습니다(${r.a}↔${r.b})`);
    at.set(pairKey(r), routes.length);
    routes.push({ ...r, source: 'official' });
  }
  const mine = new Set();
  for (const r of fares?.routes || []) {
    if (mine.has(pairKey(r))) errors.push(`ktx-fares.yaml: 같은 구간이 두 번 있습니다(${r?.a}↔${r?.b})`);
    mine.add(pairKey(r));
    const row = { ...r, source: r?.source || 'manual' };
    if (at.has(pairKey(r))) routes[at.get(pairKey(r))] = row;
    else routes.push(row);
  }
  return { fares: { ...fares, basis: official?.basis ?? fares?.basis, routes }, errors };
}

/**
 * 구간마다 대략 소요 시간(hours, 시간 단위)을 운임 옆에 붙인다 — ktx-fares.yaml 의 times 로 셈한다(2026-10-03 사용자 지정:
 * 서울↔부산처럼 2시간 30분 ~ 3시간 20분이면 4시간, 가장 짧아도 1시간). 여비계산서 교통편 줄의 출발·도착 시각이 된다.
 *
 * 이웃한 역 사이의 분(links)을 이어 두 역 사이의 가장 빠른 길의 분을 얻고, 여유(margin_minutes)를 더해 시간 단위로 올린다
 * (가장 짧아도 min_hours). times.routes 에 적은 구간은 그 값이고, 구간(routes)에 hours 를 바로 적었으면 그것이 가장 먼저다.
 * 돌려주는 운임표에는 times 가 없다 — 확장은 구간의 hours 만 쓴다.
 * @returns {{fares: object, errors: string[]}} errors 는 틀린 times 와 links 로 이어지지 않는 구간
 */
export function withHours(fares) {
  const errors = [];
  const at = (msg) => errors.push(`ktx-fares.yaml: times: ${msg}`);
  const { times, ...rest } = fares || {};
  const routes = rest.routes || [];
  if (!times || typeof times !== 'object') return { fares: rest, errors: ['ktx-fares.yaml: times 가 없습니다(구간의 대략 소요 시간)'] };
  if (!isHours(times.min_hours)) at('min_hours 는 1~23 의 정수(시간)입니다');
  if (!Number.isInteger(times.margin_minutes) || times.margin_minutes < 0) at('margin_minutes 는 0 이상의 정수(분)입니다');

  // 역과 역 사이의 분 — 이웃한 역의 분에서 시작해 모든 역 쌍의 가장 빠른 길을 셈한다(역이 46곳이라 통째로 돌려도 가볍다).
  const stations = [...new Set(routes.flatMap((r) => [r?.a, r?.b]))];
  const dist = new Map(stations.map((s) => [s, new Map([[s, 0]])]));
  const minutes = (a, b) => dist.get(a)?.get(b) ?? Infinity;
  for (const link of times.links || []) {
    const [a, b, m] = Array.isArray(link) ? link : [];
    if (!dist.has(a) || !dist.has(b) || a === b) { at(`links: 운임표에 없는 역이 있습니다(${JSON.stringify(link)})`); continue; }
    if (!Number.isInteger(m) || m <= 0) { at(`links: 분은 0 보다 큰 정수입니다(${a}↔${b})`); continue; }
    if (dist.get(a).has(b)) at(`links: 같은 구간이 두 번 있습니다(${a}↔${b})`);
    dist.get(a).set(b, m);
    dist.get(b).set(a, m);
  }
  for (const k of stations) {
    for (const i of stations) {
      for (const j of stations) {
        const via = minutes(i, k) + minutes(k, j);
        if (via < minutes(i, j)) dist.get(i).set(j, via);
      }
    }
  }

  const fixed = new Map();
  for (const r of times.routes || []) {
    const name = `${r?.a}↔${r?.b}`;
    if (!routes.some((x) => pairKey(x) === pairKey(r))) { at(`routes: 운임표에 없는 구간입니다(${name})`); continue; }
    if (!isHours(r.hours)) { at(`routes: hours 는 1~23 의 정수(시간)입니다(${name})`); continue; }
    if (fixed.has(pairKey(r))) at(`routes: 같은 구간이 두 번 있습니다(${name})`);
    fixed.set(pairKey(r), r.hours);
  }

  const timed = routes.map((r) => {
    if (r?.hours != null) return r;                                   // 구간에 바로 적은 값 — 모양은 checkFares 가 본다
    if (fixed.has(pairKey(r))) return { ...r, hours: fixed.get(pairKey(r)) };
    const m = minutes(r?.a, r?.b);
    if (!Number.isFinite(m)) { at(`${r?.a}↔${r?.b}: links 로 이어지지 않아 소요 시간을 셈할 수 없습니다 — 그 구간에 hours 를 적거나 links 에 이웃한 역 사이의 분을 더하세요`); return r; }
    return { ...r, hours: Math.max(times.min_hours, Math.ceil((m + times.margin_minutes) / 60)) };
  });
  return { fares: { ...rest, routes: timed }, errors };
}

/** 운임표(두 파일을 합친 한 벌)의 모양을 본다. */
export function checkFares(fares) {
  const errors = [];
  const at = (msg) => errors.push(`ktx-fares.yaml: ${msg}`);
  if (!fares || typeof fares !== 'object') return ['ktx-fares.yaml: 내용이 없습니다'];
  if (!Array.isArray(fares.weekend_days) || fares.weekend_days.some((d) => !DAYS.includes(d))) at('weekend_days 는 요일 글자(일~토)의 목록입니다');
  if (!Array.isArray(fares.routes) || !fares.routes.length) at('routes 가 비어 있습니다');
  const seen = new Set();
  for (const r of fares.routes || []) {
    const name = `${r?.a}↔${r?.b}`;
    if (typeof r?.a !== 'string' || typeof r?.b !== 'string' || r.a === r.b) { at(`구간의 역 이름이 틀렸습니다(${name})`); continue; }
    const key = [r.a, r.b].sort().join('|');
    if (seen.has(key)) at(`같은 구간이 두 번 있습니다(${name})`);
    seen.add(key);
    if (!isFare(r.standard)) at(`${name}: standard 는 원 단위의 정수입니다`);
    else if (!isRound(r.standard)) at(`${name}: standard 가 100원 단위가 아닙니다(${r.standard}) — 자릿수를 확인하세요`);
    if (r.first != null && !isFare(r.first)) at(`${name}: first 는 원 단위의 정수이거나 null 입니다`);
    else if (r.first != null && !isRound(r.first)) at(`${name}: first 가 100원 단위가 아닙니다(${r.first}) — 자릿수를 확인하세요`);
    else if (r.first != null && isFare(r.standard) && r.first <= r.standard) at(`${name}: first(특실 ${r.first})가 standard(일반실 ${r.standard})보다 크지 않습니다`);
    if (r.weekend != null && (!isFare(r.weekend.standard) || (r.weekend.first != null && !isFare(r.weekend.first)))) at(`${name}: weekend 의 운임이 틀렸습니다`);
    if (r.hours != null && !isHours(r.hours)) at(`${name}: hours 는 1~23 의 정수(시간)입니다`);
    if (!['official', 'observed', 'manual'].includes(r.source)) at(`${name}: source 는 official·observed·manual 가운데 하나입니다`);
  }
  const stations = new Set((fares.routes || []).flatMap((r) => [r.a, r.b]));
  // 길잡이의 값은 역 하나이거나 후보 역의 목록이다(places — 가까운 역이 여럿인 도시). 공항은 역 하나다.
  for (const key of ['places', 'airports']) {
    for (const [place, value] of Object.entries(fares[key] || {})) {
      const list = key === 'places' && Array.isArray(value) ? value : [value];
      if (!list.length) at(`${key}.${place}: 후보 역이 비어 있습니다`);
      if (new Set(list).size !== list.length) at(`${key}.${place}: 같은 역을 두 번 적었습니다`);
      for (const station of list) if (!stations.has(station)) at(`${key}.${place}: 운임표에 없는 역(${station})`);
    }
  }
  if (fares.transfers != null && !Array.isArray(fares.transfers)) at('transfers 는 갈아타는 역의 목록입니다');
  for (const station of Array.isArray(fares.transfers) ? fares.transfers : []) {
    if (!stations.has(station)) at(`transfers: 운임표에 없는 역(${station})`);
  }
  return errors;
}

/**
 * 항공 마일리지 표(air-mileage.yaml)의 모양을 본다. 틀린 표로 신규 마일리지를 지으면 틀린 마일이 조용히 올라간다.
 * 구간의 공항은 airports 에 있는 이름이어야 한다 — 항공권의 글에서 공항을 찾는 길잡이가 거기 있다.
 */
export function checkMileage(mileage) {
  const errors = [];
  const at = (msg) => errors.push(`air-mileage.yaml: ${msg}`);
  if (!mileage || typeof mileage !== 'object') return ['air-mileage.yaml: 내용이 없습니다'];
  const words = (list) => Array.isArray(list) && list.every((x) => typeof x === 'string' && x.trim());
  if (mileage.source != null && typeof mileage.source !== 'string') at('source 는 출처 주소(글)입니다');
  if (mileage.checked != null && !isDate(mileage.checked)) at('checked 는 원본과 맞춰 본 날(YYYY-MM-DD)이거나 null 입니다');
  const ports = mileage.airports && typeof mileage.airports === 'object' ? mileage.airports : {};
  if (!Object.keys(ports).length) at('airports 가 비어 있습니다');
  for (const [name, p] of Object.entries(ports)) {
    if (!/^[A-Z]{3}$/.test(p?.code || '')) at(`airports.${name}.code 는 영문 대문자 세 글자입니다`);
    if (p?.also != null && !words(p.also)) at(`airports.${name}.also 는 글의 목록입니다`);
  }
  if (!words(mileage.first_seats) || !mileage.first_seats.length) at('first_seats 는 비어 있지 않은 글의 목록입니다');
  if (!Array.isArray(mileage.airlines) || !mileage.airlines.length) at('airlines 가 비어 있습니다');
  const names = new Set();
  for (const line of mileage.airlines || []) {
    const who = line?.name;
    if (typeof who !== 'string' || !who.trim()) { at('airlines: name 이 없습니다'); continue; }
    if (names.has(who)) at(`같은 항공사가 두 번 있습니다(${who})`);
    names.add(who);
    if (line.aliases != null && !words(line.aliases)) at(`${who}: aliases 는 글의 목록입니다`);
    for (const g of ['standard', 'first']) {
      if (!(Number.isFinite(line.rates?.[g]) && line.rates[g] >= 0)) at(`${who}: rates.${g} 는 0 이상의 수(%)입니다`);
    }
    if (!Array.isArray(line.routes) || !line.routes.length) at(`${who}: routes 가 비어 있습니다`);
    const seen = new Set();
    for (const r of line.routes || []) {
      const name = `${r?.a}↔${r?.b}`;
      if (!Object.hasOwn(ports, r?.a) || !Object.hasOwn(ports, r?.b) || r.a === r.b) { at(`${who}: airports 에 없는 공항이 있습니다(${name})`); continue; }
      if (seen.has(pairKey(r))) at(`${who}: 같은 구간이 두 번 있습니다(${name})`);
      seen.add(pairKey(r));
      if (!Number.isInteger(r.miles) || r.miles <= 0) at(`${who} ${name}: miles 는 0 보다 큰 정수입니다`);
    }
  }
  return errors;
}

/** 네 YAML 을 읽어 확장이 쓰는 값 한 벌을 만든다. 틀렸으면 무엇이 틀렸는지 모두 적어 던진다. */
function build(rulesText, faresText, officialText, mileageText) {
  const rules = parse(rulesText);
  const official = parse(officialText);
  const merged = mergeFares(parse(faresText), official);
  const timed = withHours(merged.fares);
  const fares = timed.fares;
  const mileage = parse(mileageText);
  const errors = [...checkRules(rules), ...merged.errors, ...timed.errors, ...checkFares(fares), ...checkMileage(mileage)];
  if (errors.length) throw new Error(`여비 규칙·운임표·항공 마일리지 표가 틀렸습니다:\n- ${errors.join('\n- ')}`);
  return { rules, fares, mileage, official };
}

/** 네 YAML(규칙 · 손으로 고치는 운임 · 공식 운임표 · 항공 마일리지 표)을 읽어 src/travelspec.js 에 들어갈 글을 만든다. */
export function render(rulesText, faresText, officialText, mileageText) {
  const { rules, fares, mileage } = build(rulesText, faresText, officialText, mileageText);
  return '// 생성물 — 고치지 않는다. travel-rules.yaml·ktx-fares.yaml(·ktx-fares-official.yaml)·air-mileage.yaml 을 고치고 `node tools/gen-travel.mjs` 를 돌린다.\n'
    + `export const TRAVEL_RULES = ${JSON.stringify(rules, null, 2)};\n\n`
    + `export const KTX_FARES = ${JSON.stringify(fares, null, 2)};\n\n`
    + `export const AIR_MILEAGE = ${JSON.stringify(mileage, null, 2)};\n`;
}

/* ------------------------------------------------------------ 사람이 읽는 검토표 */

const won = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const SOURCE_LABEL = { official: '공식 표', manual: '손으로 고침', observed: '손으로 고침(실제로 본 값)' };
/** 두 역(공항)을 가나다 순으로 — 같은 구간이 늘 같은 글이 되어 찾기(Ctrl+F)가 한 번에 된다. */
const pairName = (r) => [r.a, r.b].sort().join(' ↔ ');
const byPair = (x, y) => (pairName(x) < pairName(y) ? -1 : pairName(x) > pairName(y) ? 1 : 0);
const firstFare = (r) => (r.first == null ? '없음' : won(r.first));

/**
 * 네 YAML 로 검토표(references/review.md)의 글을 만든다 — 확장이 실제로 쓰는 값(공식 표에 손으로 고친 것을 얹고 소요 시간을 셈한 결과)을
 * 사람이 원본과 맞춰 볼 수 있게 표로 낸다. 생성물이라 손대지 않는다 — 틀린 값은 YAML 에서 고친다.
 */
export function renderReview(rulesText, faresText, officialText, mileageText) {
  const { rules, fares, mileage, official } = build(rulesText, faresText, officialText, mileageText);
  const row = (cells) => `| ${cells.join(' | ')} |`;
  const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row), ''];
  const link = (text, url) => (url ? `[${text}](${url})` : text);
  const routes = [...fares.routes].sort(byPair);
  const stations = new Set(routes.flatMap((r) => [r.a, r.b]));
  const mine = routes.filter((r) => r.source !== 'official');
  const weekend = routes.filter((r) => r.weekend);
  const choice = (value) => rules.transport.choices.find((c) => c.value === value)?.label || value;
  const airRoutes = mileage.airlines.reduce((n, line) => n + line.routes.length, 0);

  const L = [
    '<!-- 생성물 — 고치지 않는다. references 의 YAML 을 고치고 `node tools/gen-travel.mjs`(npm run gen)를 돌리면 다시 쓴다. -->',
    '# 참조 데이터 검토표',
    '',
    '확장이 **실제로 쓰는 값**이다 — 코레일 공식 운임표에 손으로 고친 것을 얹고 소요 시간을 셈한 결과이며 `src/travelspec.js` 와 같은 내용이다.',
    '원본과 맞춰 보다 틀린 값을 찾으면 이 파일이 아니라 "고치는 곳"의 YAML 을 고친다(고치는 법은 `references/README.md`).',
    '',
    '## 출처와 기준일',
    '',
    ...table(['데이터', '기준일', '출처', '가져온 날 · 맞춰 본 날', '고치는 곳'], [
      [`KTX 공식 운임 (${official.routes.length}구간)`, official.basis || '—', link('코레일 KTX 운임표(엑셀)', official.source), `${official.imported || '—'} 가져옴`,
        '고치지 않는다 — `/refdata ktx` 로 다시 가져온다'],
      [`KTX 손으로 고친 운임 (${mine.length}구간)`, '—', '적은 사람이 구간의 `note` 에 남긴다', '—', '`ktx-fares.yaml` 의 `routes`'],
      ['도시 → 역 · 갈아타는 역 · 소요 시간', '—', '조사·어림한 값(`ktx-fares.yaml` 머리말)', '—', '`ktx-fares.yaml` 의 `places`·`transfers`·`times`'],
      [`항공 마일리지 (${airRoutes}구간)`, mileage.basis || '—', link('항공사 안내', mileage.source), mileage.checked ? `${mileage.checked} 원본과 맞춰 봄` : '**아직 원본과 맞춰 보지 못함**',
        '`air-mileage.yaml`'],
      ['여비 규칙', '—', '사용자 지정 · eclass 여비계산서 화면', '—', '`travel-rules.yaml`'],
    ]),
    '## 여비 규칙',
    '',
    `- **출장기간 구분** — 당일(하루): ${rules.period.day_trip.label} · 1박 이상: ${rules.period.general.label}`,
    `- **일비** — 하루에 ${rules.daily.per_day}`,
    `- **식수** — 하루 ${rules.meals.per_day}끼. 점심은 늘, 아침은 첫날 ${rules.meals.breakfast.first_day_depart_hour_at_most}시 이하에 떠났을 때, `
      + `저녁은 마지막 날 ${rules.meals.dinner.last_day_arrive_hour_at_least}시 이상에 닿았을 때 센다`,
    `- **교통편** — ${rules.transport.choices.map((c) => `${c.label}${c.auto ? '(교통편 내역을 자동으로 넣음)' : ''}`).join(' · ')} — 기본은 ${choice(rules.transport.default)}`,
    `- **기차 좌석 등급** — ${Object.values(rules.transport.train.grade_labels).join(' · ')} — 기본은 ${rules.transport.train.grade_labels[rules.transport.train.grade]}`,
    `- **숙박비 상한액 초과** — 상한액으로 정산할지 실제 금액으로 정산할지 고른다. 상한액의 ${rules.lodging.over_cap.approve_rate}배까지는 ${rules.lodging.over_cap.approver} 승인을 받아 실제 금액으로 정산한다`
      + `(${rules.lodging.over_cap.source}${rules.lodging.over_cap.checked ? ` · 맞춰 본 날 ${rules.lodging.over_cap.checked}` : ''})`,
    '',
    '## KTX 운임',
    '',
    `- 구간 ${routes.length}개 · 역 ${stations.size}곳. 운임은 어른 편도 정가(원), 시간은 넉넉히 올려 잡은 대략 소요 시간이다.`,
    `- 주말로 치는 요일: ${fares.weekend_days.join('·')} — 주말 운임을 따로 적은 구간 ${weekend.length}개${weekend.length ? '' : '(평일·주말이 같은 값이다)'}`,
    `- 갈아타는 역: ${(fares.transfers || []).join(' · ') || '없음'}`,
    '',
    `### 손으로 고친 구간 (${mine.length})`,
    '',
    ...(mine.length
      ? table(['구간', '일반실', '특실', '시간', '출처', '메모'], mine.map((r) => [pairName(r), won(r.standard), firstFare(r), `${r.hours}시간`, SOURCE_LABEL[r.source], r.note || '']))
      : ['없다 — 운임은 모두 공식 표의 값이다.', '']),
    '### 도시 → 타는 역',
    '',
    '출장지·근무지에 적은 글에 이 말이 들어 있으면 그 역이다. 후보가 여럿이면 근무지 쪽 역에서 운임이 가장 큰 역을 고른다.',
    '',
    ...table(['글에 든 말', '타는 역'], Object.entries(fares.places || {}).map(([key, v]) => [key, [].concat(v).join(' · ')])),
    '### 공항 → 그 도시의 역',
    '',
    ...table(['공항', '역'], Object.entries(fares.airports || {}).map(([key, v]) => [key, v])),
    `### 구간 운임 (${routes.length})`,
    '',
    '두 역은 가나다 순으로 적었다(대전 ↔ 부산).',
    '',
    ...table(['구간', '일반실', '특실', '시간', ...(weekend.length ? ['주말 일반실', '주말 특실'] : []), '출처'], routes.map((r) => [
      pairName(r), won(r.standard), firstFare(r), `${r.hours}시간`,
      ...(weekend.length ? [r.weekend ? won(r.weekend.standard) : '', r.weekend?.first != null ? won(r.weekend.first) : ''] : []),
      SOURCE_LABEL[r.source],
    ])),
    '## 항공 마일리지',
    '',
    '항공권에 적립 마일리지가 적혀 있지 않을 때만 쓴다. 적립 = 구간 마일 × 좌석 등급의 적립률(마일 미만은 반올림).',
    '',
    `- 특실·비즈니스로 보는 좌석 등급의 말: ${mileage.first_seats.join(' · ')}`,
    '',
  ];
  for (const line of mileage.airlines) {
    const miles = (r, grade) => String(Math.round((r.miles * line.rates[grade]) / 100));
    L.push(`### ${line.name} (적립률 일반석 ${line.rates.standard}% · 특실 ${line.rates.first}%)`, '',
      ...table(['구간', '구간 마일', '일반석 적립', '특실 적립'], [...line.routes].sort(byPair).map((r) => [pairName(r), String(r.miles), miles(r, 'standard'), miles(r, 'first')])));
  }
  L.push('### 공항', '', ...table(['공항', '코드', '이렇게 적혀 있어도 이 공항'],
    Object.entries(mileage.airports).map(([name, p]) => [name, p.code, (p.also || []).join(' · ')])));
  return `${L.join('\n').trimEnd()}\n`;
}

/* ------------------------------------------------------------ 무엇이 바뀌었나 */

/**
 * 다시 만들 때 무엇이 바뀌었는지를 사람이 읽는 줄로 낸다 — 생성물(JSON)의 diff 를 읽지 않아도 고친 것이 뜻대로 들어갔는지 볼 수 있게.
 * 구간(KTX·항공)은 두 역으로 짝을 지어 견주고, 나머지는 값이 달라진 자리를 `파일.길: 예전 → 지금` 으로 적는다.
 * @param {{TRAVEL_RULES:object, KTX_FARES:object, AIR_MILEAGE:object}|null} prev 지금 생성물의 값(없으면 견줄 것이 없다)
 * @param {{TRAVEL_RULES:object, KTX_FARES:object, AIR_MILEAGE:object}} next 새로 만든 값
 * @returns {string[]}
 */
export function changes(prev, next) {
  if (!prev) return [];
  const out = [];
  const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const show = (v) => (v === undefined ? '(없음)' : JSON.stringify(v));
  const rest = (label, a, b) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (plain(a) && plain(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) rest(`${label}.${key}`, a[key], b[key]);
      return;
    }
    out.push(`${label}: ${show(a)} → ${show(b)}`);
  };
  const routes = (label, a, b, text) => {
    const before = new Map(a.map((r) => [pairKey(r), r]));
    const after = new Map(b.map((r) => [pairKey(r), r]));
    for (const [key, r] of after) {
      const old = before.get(key);
      if (!old) out.push(`${label} ${pairName(r)}: 새로 들어옴 — ${text(r)}`);
      else if (text(old) !== text(r)) out.push(`${label} ${pairName(r)}: ${text(old)} → ${text(r)}`);
    }
    for (const [key, r] of before) if (!after.has(key)) out.push(`${label} ${pairName(r)}: 빠짐 — ${text(r)}`);
  };
  const fare = (r) => `일반실 ${won(r.standard)} · 특실 ${firstFare(r)} · ${r.hours}시간 · ${SOURCE_LABEL[r.source] || r.source}`;

  rest('travel-rules', prev.TRAVEL_RULES, next.TRAVEL_RULES);
  const { routes: r0 = [], ...f0 } = prev.KTX_FARES || {};
  const { routes: r1 = [], ...f1 } = next.KTX_FARES || {};
  routes('KTX', r0, r1, fare);
  rest('ktx-fares', f0, f1);
  const { airlines: a0 = [], ...m0 } = prev.AIR_MILEAGE || {};
  const { airlines: a1 = [], ...m1 } = next.AIR_MILEAGE || {};
  rest('air-mileage', m0, m1);
  const lines = new Map(a0.map((line) => [line.name, line]));
  for (const line of a1) {
    const { routes: x1 = [], ...l1 } = line;
    if (!lines.has(line.name)) { out.push(`항공 마일리지: ${line.name} 새로 들어옴(구간 ${x1.length}개)`); continue; }
    const { routes: x0 = [], ...l0 } = lines.get(line.name);
    rest(`air-mileage.${line.name}`, l0, l1);
    routes(line.name, x0, x1, (r) => `${r.miles}마일`);
  }
  for (const name of lines.keys()) if (!a1.some((line) => line.name === name)) out.push(`항공 마일리지: ${name} 빠짐`);
  return out;
}

/** 바뀐 것을 다 찍으면 공식 표를 새로 가져온 날에는 수백 줄이다 — 여기까지만 찍고 나머지는 몇 줄인지만 말한다. */
const CHANGES_SHOWN = 40;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const texts = [RULES, FARES, OFFICIAL, MILEAGE].map((url) => fs.readFileSync(url, 'utf8'));
  let built;
  // 틀린 YAML 은 무엇이 틀렸는지만 말하고 끝낸다 — 고치는 사람이 볼 것은 그 줄들이지 스택이 아니다.
  try { built = build(...texts); } catch (err) { console.error(err.message); process.exit(1); }
  const files = [
    { url: TARGET, name: 'src/travelspec.js', next: render(...texts) },
    { url: REVIEW, name: 'references/review.md', next: renderReview(...texts) },
  ];
  const stale = files.filter((f) => (fs.existsSync(f.url) ? fs.readFileSync(f.url, 'utf8') : '') !== f.next);
  const sources = 'travel-rules.yaml·ktx-fares.yaml·ktx-fares-official.yaml·air-mileage.yaml';
  if (process.argv.includes('--check')) {
    if (stale.length) {
      console.error(`${stale.map((f) => f.name).join('·')} 가 ${sources} 과 어긋났습니다. \`node tools/gen-travel.mjs\` 를 돌리세요.`);
      process.exit(1);
    }
    console.log(`${files.map((f) => f.name).join('·')} 는 ${sources} 과 같습니다.`);
  } else if (!stale.length) {
    console.log('바뀐 것이 없습니다.');
  } else {
    // 쓰기 전에 지금 생성물의 값을 읽어 둔다 — 처음 만들거나 생성물이 깨져 있으면 견줄 것이 없다.
    let prev = null;
    try { prev = await import(`${TARGET.href}?prev=${Date.now()}`); } catch { /* 견줄 것이 없다 */ }
    for (const f of stale) fs.writeFileSync(f.url, f.next);
    console.log(`${stale.map((f) => f.name).join('·')} 를 다시 만들었습니다.`);
    const lines = changes(prev, { TRAVEL_RULES: built.rules, KTX_FARES: built.fares, AIR_MILEAGE: built.mileage });
    if (lines.length) console.log(`바뀐 것 ${lines.length}줄:\n- ${lines.slice(0, CHANGES_SHOWN).join('\n- ')}`);
    if (lines.length > CHANGES_SHOWN) console.log(`- … 외 ${lines.length - CHANGES_SHOWN}줄(references/review.md 에서 본다)`);
  }
}
