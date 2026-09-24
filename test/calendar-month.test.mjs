// 달력이 이웃 달 칸을 그리는 것 때문에 생긴 회귀. 2026-09-24 실제로 겪었다.
//
//   9월 달력은 앞뒤 줄을 채우려고 10/1~10 을 이웃 달 칸(rcOtherMonth, 건수 없음)으로 같이 그린다.
//   그 칸을 "0건" 으로 읽어서
//     (1) 10월 1일 예약 10건이 "달력은 0건인데 표에서 10건" 으로 확인 불가가 됐고
//     (2) 한 달 훑기는 10/1~10 을 옮겨 보지도 않고 "예약 없음(확신)" 으로 담았다 — 내 예약에서 10월이 통째로 빠졌다.
//
// 실제 9월 페이지를 서버 흉내에 물려 세 가지를 본다.
//   - 달력에 건수가 없는 날은 지름길을 타지 않고 반드시 옮긴다
//   - 옮길 때 달력이 펼칠 달(CAL_MAIN_AD 초점일)을 같이 보낸다
//   - 서버가 초점일을 받아 10월 달력을 내려주면 그 건수로 대조하고, 9월 칸은 건수로 치지 않는다
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { scanDays, loadDay } from '../src/site.js';
import { scanCarDays } from '../src/rentcar.js';
import { parseDayCounts, parseCalendarMonth } from '../src/parse.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
globalThis.DOMParser = new JSDOM('').window.DOMParser;
globalThis.chrome = { runtime: {} }; // 탭 경유 없음 — 직접 요청만 흉내 낸다

let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const ROOM_SEPT = fixture('list-2026-09-16.html');
const CAR_SEPT = fixture('rentcar-2026-09-16.html');

const OCT1_OTHER = '<td class="rcOtherMonth" title="목요일, 10월 01, 2026" style="height:60px;width:60px;"><a href="#">1</a></td>';
const OCT1_OWN = '<td title="목요일, 10월 01, 2026" style="height:60px;width:60px;">1<br><font style=\'color:red;\'>10건</font></td>';

/** 9월 회의실 페이지를 "10월 1일로 옮긴 뒤" 모양으로. calendarFollows 면 달력도 10월을 펼친다. */
function roomOctober({ calendarFollows }) {
  let html = ROOM_SEPT.replace('class="lb_middle">2026-09-16 Wednesday', 'class="lb_middle">2026-10-01 Thursday');
  if (calendarFollows) {
    assert.ok(html.includes(OCT1_OTHER), 'fixture 의 10/1 칸 모양이 바뀌었다');
    html = html
      .replace('class="rcTitle">2026년 9월', 'class="rcTitle">2026년 10월')
      .replace(OCT1_OTHER, OCT1_OWN);
  }
  return html;
}

/** 9월 차량 페이지를 "10월 1일로 옮긴 뒤" 모양으로(달력은 9월 그대로). */
const carOctober = () =>
  CAR_SEPT.replace('style="color:Blue;">2026-09-16 ( Wednesday )', 'style="color:Blue;">2026-10-01 ( Thursday )');

/** GET 은 9월 페이지, POST 는 옮긴 뒤 페이지. 보낸 POST 본문을 모아 둔다. */
function serve(sept, afterMove) {
  const posts = [];
  globalThis.fetch = async (url, init) => {
    const method = init?.method || 'GET';
    if (method === 'POST') posts.push(new URLSearchParams(init.body));
    const html = method === 'POST' ? afterMove : sept;
    return {
      ok: true, status: 200, statusText: '', url: String(url),
      headers: { get: () => 'text/html; charset=utf-8' },
      arrayBuffer: async () => new TextEncoder().encode(html).buffer,
    };
  };
  return posts;
}

console.log('회의실: 9월 화면에서 10월 1일');
await ta('달력에 건수가 없는 날은 지름길을 타지 않고 옮긴다 — "예약 없음(확신)" 으로 담지 않는다', async () => {
  const posts = serve(ROOM_SEPT, roomOctober({ calendarFollows: false }));
  const out = await scanDays(['2026-10-01']);
  assert.ok(posts.length >= 1, '날짜를 옮기는 포스트백이 없었다');
  assert.equal(out.length, 1);
  assert.equal(out[0].reservations.length, 10, '옮긴 화면의 표를 읽어야 한다');
  assert.equal(out[0].confident, true, out[0].reason);
});
await ta('옮길 때 달력이 펼칠 달(CAL_MAIN_AD 초점일)을 선택일과 함께 보낸다', async () => {
  const posts = serve(ROOM_SEPT, roomOctober({ calendarFollows: false }));
  await scanDays(['2026-10-01']);
  const first = posts[0];
  assert.equal(first.get('__EVENTTARGET'), 'CAL_MAIN');
  assert.equal(first.get('CAL_MAIN_SD'), '[[2026,10,1]]');
  assert.equal(first.get('CAL_MAIN_AD'), '[[1980,1,1],[2099,12,30],[2026,10,1]]');
});
await ta('서버가 초점일을 받아 10월 달력을 내려주면 그 건수(10건)로 대조한다', async () => {
  serve(ROOM_SEPT, roomOctober({ calendarFollows: true }));
  const day = await loadDay('2026-10-01');
  assert.equal(day.hadDateInput, true, '화면 날짜가 10-01 이어야 한다');
  assert.equal(day.expected, 10);
  assert.equal(day.reservationsAllRegions.length, 10, '달력 건수는 전 지역 합이다');
  assert.equal(day.reservations.length, 9, '부산만 남긴다(서울 1건 제외)');
  assert.equal(day.confident, true, day.reason);
});
await ta('10월 달력을 받았을 때 9월 날짜 칸은 건수로 치지 않는다', async () => {
  const doc = new JSDOM(roomOctober({ calendarFollows: true })).window.document;
  assert.equal(parseCalendarMonth(doc), '2026-10');
  const counts = parseDayCounts(doc);
  assert.equal(counts.get('2026-10-01'), 10);
  assert.equal(counts.has('2026-09-16'), false, '제목은 10월인데 9월 칸이 섞여 들면 안 된다');
  assert.equal(counts.has('2026-10-02'), false, '아직 이웃 달 모양인 칸은 모름');
});

console.log('차량: 9월 화면에서 10월 1일');
await ta('달력에 건수가 없는 날은 옮기고, 초점일도 같이 보낸다', async () => {
  const posts = serve(CAR_SEPT, carOctober());
  const out = await scanCarDays(['2026-10-01']);
  assert.ok(posts.length >= 1, '날짜를 옮기는 포스트백이 없었다');
  assert.equal(posts[0].get('CAL_MAIN_AD'), '[[1980,1,1],[2099,12,30],[2026,10,1]]');
  assert.equal(out.length, 1);
  assert.equal(out[0].date, '2026-10-01');
});

console.log(`\n통과 ${pass}건`);
