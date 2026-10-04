// 예약 종류별 실행자(src/runners.js) — 회의실과 차량이 같은 모양이고, 다른 점은 실행자에 적혀 있다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
global.DOMParser = new JSDOM('').window.DOMParser;

const { RUNNERS, runnerOf } = await import('../src/runners.js');
const { buildSaveDigest } = await import('../src/diagnose.js');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

console.log('실행자의 모양');
t('회의실과 차량은 같은 칸을 갖는다 — 패널이 종류를 가리지 않고 부를 수 있다', () => {
  const keys = (r) => Object.keys(r).sort();
  assert.deepEqual(keys(RUNNERS.car), keys(RUNNERS.room));
  for (const [kind, r] of Object.entries(RUNNERS)) {
    assert.equal(r.kind, kind);
    for (const fn of ['loadDay', 'scanDays', 'reserve', 'cancel', 'payload', 'missing']) assert.equal(typeof r[fn], 'function', `${kind}.${fn}`);
    for (const url of [r.listUrl, r.shellUrl]) assert.match(url, /^https:\/\/eclass\.krs\.co\.kr\//);
  }
  assert.notEqual(RUNNERS.room.listUrl, RUNNERS.car.listUrl);
});
t('예약 종류가 아니면 실행자가 없다 — 짐작으로 회의실에 보내지 않는다', () => {
  assert.equal(runnerOf('room'), RUNNERS.room);
  assert.equal(runnerOf('car'), RUNNERS.car);
  for (const kind of ['attend', 'mine', '', undefined, 'toString']) assert.equal(runnerOf(kind), null, String(kind));
  assert.equal(Object.hasOwn(RUNNERS, 'attend'), false);
});

console.log('종류마다 다른 것');
const pick = { row: { name: '제4회의실', value: 'R4' }, date: '2026-10-05', region: '부산', start: '09:00', end: '10:00', title: '주간회의', place: '거제', passenger: '홍길동' };
t('회의실: 지역·회의실 값·주제를 보낸다. 행선지는 보내지 않는다', () => {
  assert.deepEqual(RUNNERS.room.payload(pick),
    { kind: 'room', room: '제4회의실', roomValue: 'R4', region: '부산', date: '2026-10-05', start: '09:00', end: '10:00', title: '주간회의' });
});
t('차량: 차량 값·행선지·동승자를 보낸다. 지역은 보내지 않는다', () => {
  assert.deepEqual(RUNNERS.car.payload({ ...pick, row: { name: '아반테 (181허4309)', value: '37' } }),
    { kind: 'car', car: '아반테 (181허4309)', carValue: '37', room: '아반테 (181허4309)', date: '2026-10-05', start: '09:00', end: '10:00',
      title: '주간회의', place: '거제', passenger: '홍길동' });
});
t('차량은 여러 날에 걸칠 수 있다 — 끝이 다른 날이면 종료 날짜를 같이 보내고, 같은 날이면 보내지 않는다. 회의실은 받지 않는다', () => {
  const car = { ...pick, row: { name: '아반테 (181허4309)', value: '37' } };
  assert.equal(RUNNERS.car.payload({ ...car, endDate: '2026-10-06' }).endDate, '2026-10-06');
  assert.equal('endDate' in RUNNERS.car.payload({ ...car, endDate: '2026-10-05' }), false);
  assert.equal('endDate' in RUNNERS.car.payload({ ...car, endDate: undefined }), false);
  assert.equal('endDate' in RUNNERS.room.payload({ ...pick, endDate: '2026-10-06' }), false);
});
t('사이트가 예약 버튼에서 막는 차량이면 그 까닭이 신청에 따라간다 — 신청하는 쪽이 보내지 않고 그 말을 한다', () => {
  const row = { name: '그랜저 (62가1698)', value: '38', note: '[임원용 차량]', blocked: '차량 이용 시 지원팀에 문의 바랍니다.' };
  assert.equal(RUNNERS.car.payload({ ...pick, row }).blocked, '차량 이용 시 지원팀에 문의 바랍니다.');
  assert.equal('blocked' in RUNNERS.car.payload({ ...pick, row: { ...row, blocked: '' } }), false);
});
t('필수 칸: 회의실은 회의주제, 차량은 행선지(사용목적은 비어도 된다)', () => {
  assert.equal(RUNNERS.room.missing({ title: '회의', place: '' }), null);
  assert.equal(RUNNERS.room.missing({ title: '', place: '거제' }).field, 'title');
  assert.equal(RUNNERS.car.missing({ title: '', place: '거제' }), null);
  assert.equal(RUNNERS.car.missing({ title: '방문', place: '' }).field, 'place');
});
t('차량은 지역을 고르지 않고, 이어붙이기를 하지 않고, 담아 둔 삭제 손잡이를 쓰지 않는다', () => {
  assert.deepEqual([RUNNERS.room.region, RUNNERS.room.extend, RUNNERS.room.staleHandle], [true, true, true]);
  assert.deepEqual([RUNNERS.car.region, RUNNERS.car.extend, RUNNERS.car.staleHandle], [false, false, false]);
});

console.log('실패 요약(digest)도 종류를 따른다');
{
  const form = fs.readFileSync(new URL('./fixtures/rentcar-form-synthetic.html', import.meta.url), 'utf8');
  const payload = RUNNERS.car.payload({ ...pick, row: { name: '아반테 (181허4309)', value: '37' } });
  const fields = { TXT_PLACE: '거제', TXT_PURPOSE: '주간회의', __VIEWSTATE: 'x'.repeat(500) };
  const d = buildSaveDigest(form.replace('</body>', '<script>alert("행선지는 필수 입력 사항입니다.");</script></body>'), form, fields, payload);
  t('차량 신청은 차량의 말로 적는다 — 회의실 칸 이름으로 읽지 않는다', () => {
    assert.equal(d.대상, '차량');
    assert.deepEqual(d.보낸값, { 차량: '아반테 (181허4309)', 날짜: '2026-10-05', 종료날짜: '2026-10-05', 시작: '09:00', 종료: '10:00',
      행선지: '거제', 사용목적: '주간회의', 동승자: '홍길동' });
    assert.equal('회의실' in d.보낸값, false);
    assert.equal(d.예약표_행수, null);
  });
  t('응답에 남은 값은 보낸 칸 이름으로 읽는다 (ViewState 는 뺀다)', () => {
    assert.deepEqual(Object.keys(d.응답에_남은_폼값), ['TXT_PLACE', 'TXT_PURPOSE']);
    assert.deepEqual(d.보낸_필드이름, ['TXT_PLACE', 'TXT_PURPOSE']);
  });
  t('새로 뜬 사이트 문구는 종류와 상관없이 잡는다', () =>
    assert.ok(d.새로_나타난_스크립트.some((s) => s.includes('행선지는 필수 입력 사항입니다'))));

  const room = buildSaveDigest('<html><body></body></html>', '', {}, RUNNERS.room.payload(pick));
  t('회의실 신청은 예전 그대로다', () => {
    assert.equal(room.대상, '회의실');
    assert.equal(room.보낸값.회의실, 'R4');
  });
}

console.log(`\n통과 ${pass}건`);
