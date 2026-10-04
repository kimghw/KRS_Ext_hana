// travel-rules.yaml + ktx-fares.yaml + ktx-fares-official.yaml + air-mileage.yaml → src/travelspec.js
//
// 확장은 번들러 없는 순수 ES 모듈이라 YAML 을 읽지 못한다. 그래서 규칙과 운임·항공 마일리지 표를 JS 모듈로 옮겨 둔다.
// 네 파일 가운데 하나라도 고친 뒤에 `node tools/gen-travel.mjs` 를 돌린다. `--check` 는 쓰지 않고 어긋났는지만 본다.
//
// KTX 운임은 두 파일이다. ktx-fares-official.yaml 은 코레일 공식 운임표에서 가져온 것(tools/import-ktx-fares.py 가 쓴다 — 손대지 않는다),
// ktx-fares.yaml 은 **손으로 고치는 파일**이다 — 거기 적은 구간이 공식 표의 같은 구간을 이기고, 공식 표에 없는 구간을 더할 수도 있다.
// 구간마다 대략 소요 시간(hours)도 여기서 붙인다 — ktx-fares.yaml 의 times(이웃한 역 사이의 분)로 셈해 운임 옆에 적는다.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const RULES = new URL('../references/travel-rules.yaml', import.meta.url);
const FARES = new URL('../references/ktx-fares.yaml', import.meta.url);
const OFFICIAL = new URL('../references/ktx-fares-official.yaml', import.meta.url);
const MILEAGE = new URL('../references/air-mileage.yaml', import.meta.url);
const TARGET = new URL('../src/travelspec.js', import.meta.url);

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const isHour = (n) => Number.isInteger(n) && n >= 0 && n <= 23;
const isFare = (n) => Number.isInteger(n) && n > 0;
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
  if (!(rules.daily?.per_day > 0)) at('daily.per_day 는 0 보다 커야 합니다');
  if (rules.meals?.per_day !== 3) at('meals.per_day 는 3 입니다(아침·점심·저녁)');
  if (!isHour(rules.meals?.breakfast?.first_day_depart_hour_at_most)) at('meals.breakfast.first_day_depart_hour_at_most 는 0~23 의 시(時)입니다');
  if (!isHour(rules.meals?.dinner?.last_day_arrive_hour_at_least)) at('meals.dinner.last_day_arrive_hour_at_least 는 0~23 의 시(時)입니다');
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
    if (!Number.isFinite(m)) { at(`${r?.a}↔${r?.b}: links 로 이어지지 않아 소요 시간을 셈할 수 없습니다`); return r; }
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
    if (r.first != null && !isFare(r.first)) at(`${name}: first 는 원 단위의 정수이거나 null 입니다`);
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

/** 네 YAML(규칙 · 손으로 고치는 운임 · 공식 운임표 · 항공 마일리지 표)을 읽어 src/travelspec.js 에 들어갈 글을 만든다. */
export function render(rulesText, faresText, officialText, mileageText) {
  const rules = parse(rulesText);
  const merged = mergeFares(parse(faresText), parse(officialText));
  const timed = withHours(merged.fares);
  const fares = timed.fares;
  const mileage = parse(mileageText);
  const errors = [...checkRules(rules), ...merged.errors, ...timed.errors, ...checkFares(fares), ...checkMileage(mileage)];
  if (errors.length) throw new Error(`여비 규칙·운임표·항공 마일리지 표가 틀렸습니다:\n- ${errors.join('\n- ')}`);
  return '// 생성물 — 고치지 않는다. travel-rules.yaml·ktx-fares.yaml(·ktx-fares-official.yaml)·air-mileage.yaml 을 고치고 `node tools/gen-travel.mjs` 를 돌린다.\n'
    + `export const TRAVEL_RULES = ${JSON.stringify(rules, null, 2)};\n\n`
    + `export const KTX_FARES = ${JSON.stringify(fares, null, 2)};\n\n`
    + `export const AIR_MILEAGE = ${JSON.stringify(mileage, null, 2)};\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const next = render(fs.readFileSync(RULES, 'utf8'), fs.readFileSync(FARES, 'utf8'), fs.readFileSync(OFFICIAL, 'utf8'), fs.readFileSync(MILEAGE, 'utf8'));
  const now = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
  if (process.argv.includes('--check')) {
    if (now !== next) {
      console.error('src/travelspec.js 가 travel-rules.yaml·ktx-fares.yaml·ktx-fares-official.yaml·air-mileage.yaml 과 어긋났습니다. `node tools/gen-travel.mjs` 를 돌리세요.');
      process.exit(1);
    }
    console.log('src/travelspec.js 는 travel-rules.yaml·ktx-fares.yaml·ktx-fares-official.yaml·air-mileage.yaml 과 같습니다.');
  } else {
    fs.writeFileSync(TARGET, next);
    console.log(now === next ? '바뀐 것이 없습니다.' : 'src/travelspec.js 를 다시 만들었습니다.');
  }
}
