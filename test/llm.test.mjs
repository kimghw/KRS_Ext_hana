// 백엔드 선택: 로컬 CLI → API 키 → 규칙 해석 순으로 내려가는지 확인한다.
import assert from 'node:assert/strict';

const TODAY = '2026-09-16';
let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const CLI_FILTER = { summary: 'CLI 해석', dateFrom: '2026-09-20', dateTo: '2026-09-20', hourFrom: 8, hourTo: 12, minSeats: 10, minHours: null, region: null };
const CLI_DIAGNOSIS = { verdict: 'rejected', siteMessage: '이미 예약된 시간입니다', cause: '같은 시간에 다른 예약이 있습니다.', fix: '' };

/**
 * chrome.runtime.sendNativeMessage 와 fetch 를 상황별로 흉내낸다.
 * native 에 객체를 주면 CLI 가 그것을 답으로 돌려준다(명세와 다른 답을 흉내 낼 때 쓴다).
 */
function setup({ native, api }) {
  globalThis.chrome = {
    runtime: {
      sendNativeMessage: async (_host, msg) => {
        if (native === 'absent') throw new Error('호스트를 찾을 수 없습니다');
        if (msg.task === 'ping') return { ok: true, pong: true };
        if (native === 'error') return { ok: false, error: 'CLI 오류' };
        if (native && typeof native === 'object') return { ok: true, costUsd: 0.01, data: native };
        return { ok: true, costUsd: 0.01, data: msg.task === 'diagnose' ? CLI_DIAGNOSIS : CLI_FILTER };
      },
    },
  };
  globalThis.fetch = async () => {
    if (api === 'error') return { ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) };
    return {
      ok: true,
      json: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ summary: 'API 해석', dateFrom: '2026-09-21', dateTo: '2026-09-21', hourFrom: 9, hourTo: 18, minSeats: null, minHours: null, region: null }) }],
      }),
    };
  };
}

const load = async () => import(`../src/llm.js?b=${Math.random()}`);

console.log('해석 백엔드 선택');

await ta('CLI 가 되면 CLI 를 쓴다', async () => {
  setup({ native: 'ok', api: 'ok' });
  const { parseSmart } = await load();
  const r = await parseSmart('9월 20일 8시~12시 10명', { apiKey: 'sk-x', today: TODAY, useNative: true });
  assert.equal(r.via, 'cli');
  assert.equal(r.filter.summary, 'CLI 해석');
});

await ta('CLI 가 실패하면 API 키로 내려간다', async () => {
  setup({ native: 'error', api: 'ok' });
  const { parseSmart } = await load();
  const r = await parseSmart('아무거나', { apiKey: 'sk-x', today: TODAY, useNative: true });
  assert.equal(r.via, 'api');
  assert.ok(r.note.includes('로컬 CLI 실패'), r.note);
});

await ta('둘 다 실패하면 규칙으로 내려간다', async () => {
  setup({ native: 'error', api: 'error' });
  const { parseSmart } = await load();
  const r = await parseSmart('내일 오후 10명', { apiKey: 'sk-x', today: TODAY, useNative: true });
  assert.equal(r.via, 'local');
  assert.equal(r.filter.dateFrom, '2026-09-17');
  assert.equal(r.filter.minSeats, 10);
});

await ta('설정이 아무것도 없으면 바로 규칙을 쓴다', async () => {
  setup({ native: 'absent', api: 'error' });
  const { parseSmart } = await load();
  const r = await parseSmart('9/22 오전 부산', { apiKey: '', today: TODAY, useNative: false });
  assert.equal(r.via, 'local');
  assert.equal(r.filter.region, '부산');
});

await ta('CLI 를 끄면 API 를 쓴다', async () => {
  setup({ native: 'ok', api: 'ok' });
  const { parseSmart } = await load();
  const r = await parseSmart('아무거나', { apiKey: 'sk-x', today: TODAY, useNative: false });
  assert.equal(r.via, 'api');
});

console.log('CLI 연결 확인');
await ta('호스트가 있으면 ok', async () => {
  setup({ native: 'ok', api: 'ok' });
  const { nativeProbe } = await load();
  assert.deepEqual(await nativeProbe(), { ok: true, error: '' });
});
await ta('호스트가 없으면 ok 가 아니고, 브라우저가 댄 까닭을 같이 준다 (예외를 밖으로 던지지 않는다)', async () => {
  setup({ native: 'absent', api: 'ok' });
  const { nativeProbe } = await load();
  assert.deepEqual(await nativeProbe(), { ok: false, error: '호스트를 찾을 수 없습니다' });
});

console.log('실패 원인 분석 백엔드');
await ta('CLI 로 분석한다', async () => {
  setup({ native: 'ok', api: 'ok' });
  const { diagnoseSmart } = await load();
  const r = await diagnoseSmart({ 보낸값: {} }, { apiKey: 'sk-x', useNative: true });
  assert.equal(r.via, 'cli');
});
await ta('둘 다 안 되면 null 을 주고 조용히 넘어간다', async () => {
  setup({ native: 'absent', api: 'error' });
  const { diagnoseSmart } = await load();
  assert.equal(await diagnoseSmart({}, { apiKey: '', useNative: false }), null);
});
await ta('설명의 모양이 명세와 다르면 보여 주지 않는다 (조회 조건 모양의 답은 진단이 아니다)', async () => {
  setup({ native: CLI_FILTER, api: 'error' });
  const { diagnoseSmart } = await load();
  assert.equal(await diagnoseSmart({ 보낸값: {} }, { apiKey: 'sk-x', useNative: true }), null);
});
await ta('빈 문구는 null 로 온다', async () => {
  setup({ native: 'ok', api: 'ok' });
  const { diagnoseSmart } = await load();
  const r = await diagnoseSmart({ 보낸값: {} }, { apiKey: '', useNative: true });
  assert.deepEqual(r.result, { verdict: 'rejected', siteMessage: '이미 예약된 시간입니다', cause: '같은 시간에 다른 예약이 있습니다.', fix: null });
});

console.log('입력 명세의 관문 — 구조가 틀린 답은 실행자에 가지 않는다');
await ta('CLI 의 답이 명세와 다르면 그 길은 실패로 치고 API 로 내려간다', async () => {
  setup({ native: { ...CLI_FILTER, dateFrom: '9월 20일' }, api: 'ok' });
  const { parseSmart } = await load();
  const r = await parseSmart('아무거나', { apiKey: 'sk-x', today: TODAY, useNative: true });
  assert.equal(r.via, 'api');
  assert.equal(r.note, '로컬 CLI 실패(답이 입력 명세와 다릅니다 — dateFrom 값(9월 20일)이 틀렸습니다)');
});
await ta('끝이 시작보다 앞선 조건도 받지 않는다 — 규칙 해석까지 내려간다', async () => {
  setup({ native: { ...CLI_FILTER, hourFrom: 14, hourTo: 14 }, api: 'error' });
  const { parseSmart } = await load();
  const r = await parseSmart('내일 오후', { apiKey: 'sk-x', today: TODAY, useNative: true });
  assert.equal(r.via, 'local');
  assert.deepEqual([r.filter.hourFrom, r.filter.hourTo], [12, 18]);
  assert.match(r.note, /종료 시가 시작 시보다 늦어야 합니다/);
});
await ta('명세에 없는 키는 버리고, 문자로 온 수는 수로 바꾼다', async () => {
  setup({ native: { ...CLI_FILTER, hourFrom: '8', run: 'reserve', url: 'https://example.org' }, api: 'ok' });
  const { parseSmart } = await load();
  const r = await parseSmart('아무거나', { apiKey: '', today: TODAY, useNative: true });
  assert.equal(r.via, 'cli');
  assert.deepEqual(Object.keys(r.filter).sort(), ['dateFrom', 'dateTo', 'hourFrom', 'hourTo', 'minHours', 'minSeats', 'region', 'summary']);
  assert.equal(r.filter.hourFrom, 8);
});
await ta('필수가 아닌 칸이 틀리면 그 칸만 비우고 무엇을 뺐는지 알린다', async () => {
  setup({ native: { ...CLI_FILTER, region: '대전' }, api: 'ok' });
  const { parseSmart } = await load();
  const r = await parseSmart('대전 회의실', { apiKey: '', today: TODAY, useNative: true });
  assert.equal(r.via, 'cli');
  assert.equal(r.filter.region, null);
  assert.equal(r.note, '지역 값(대전)은 받을 수 없어 뺐습니다');
});
await ta('차량은 좌석 수·지역 조건을 받지 않는다 — 비우고 알린다 (종류는 화면이 정한다)', async () => {
  setup({ native: { ...CLI_FILTER, region: '부산' }, api: 'ok' });
  const { parseSmart } = await load();
  const r = await parseSmart('부산 10명 차량', { apiKey: '', today: TODAY, useNative: true, kind: 'car' });
  assert.deepEqual([r.filter.minSeats, r.filter.region], [null, null]);
  assert.match(r.note, /차량은 좌석 수를 알 수 없어 인원 조건은 뺐습니다/);
  assert.match(r.note, /차량은 지역을 가리지 않아 지역 조건은 뺐습니다/);
});
await ta('규칙 해석도 같은 관문을 지난다 — 기본값으로 돌았는지는 따로 알려 준다', async () => {
  setup({ native: 'absent', api: 'error' });
  const { parseSmart } = await load();
  const r = await parseSmart('회의실 좀', { apiKey: '', today: TODAY, useNative: false });
  assert.equal(r.via, 'local');
  assert.equal(r.guessed, true);
  assert.equal('guessed' in r.filter, false);
});

console.log('근태 폼 말로 채우기');
{
  const sent = [];
  /** 근태 채우기는 attend 작업으로 간다. 다리와 API 가 무엇을 받았는지 적어 둔다. */
  const setupAttend = ({ native, api }) => {
    globalThis.chrome = {
      runtime: {
        sendNativeMessage: async (_host, msg) => {
          sent.push(msg);
          if (native === 'error') return { ok: false, error: 'CLI 오류' };
          return { ok: true, costUsd: 0.002, data: { kind: 'out', dateFrom: '2026-09-17', start: '14:00', end: '16:00', place: '부산시청', purpose: null, reply: '외근으로 채웠습니다. 목적이 비어 있습니다.' } };
        },
      },
    };
    globalThis.fetch = async (_url, init) => {
      sent.push(JSON.parse(init.body));
      if (api === 'error') return { ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) };
      return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ kind: 'trip', dateFrom: '2026-09-21', reply: 'API 가 채움' }) }] }) };
    };
  };
  const form = { kind: 'out', dateFrom: TODAY, place: '', purpose: '', file: { name: 'a.pdf', dataUrl: 'data:application/pdf;base64,SECRET' } };

  await ta('CLI 가 되면 attend 작업으로 보내고, 답을 그대로 돌려준다', async () => {
    setupAttend({ native: 'ok', api: 'ok' });
    const { fillAttendSmart } = await load();
    const r = await fillAttendSmart('내일 2시부터 4시까지 부산시청 외근', { apiKey: 'sk-x', today: TODAY, useNative: true, form, history: [{ who: 'me', text: '외근 올릴게' }] });
    assert.equal(r.via, 'cli');
    assert.equal(r.patch.place, '부산시청');
    assert.match(r.reply, /목적이 비어/);
    const msg = sent.at(-1);
    assert.equal(msg.task, 'attend');
    assert.match(msg.input, /오늘은 2026-09-16 \(수요일\)/);
    assert.match(msg.input, /지금 폼: \{"kind":"out"/);
    assert.match(msg.input, /사용자: 외근 올릴게/);
    assert.match(msg.input, /새 요청: 내일 2시부터 4시까지 부산시청 외근/);
  });
  await ta('첨부파일 내용은 Claude 에게 보내지 않는다', async () => {
    assert.ok(!sent.at(-1).input.includes('SECRET'));
    assert.match(sent.at(-1).input, /"file":"\(첨부 있음\)"/);
  });
  await ta('CLI 가 실패하면 API 키로 내려가고, 구조화 출력으로 묻는다', async () => {
    setupAttend({ native: 'error', api: 'ok' });
    const { fillAttendSmart } = await load();
    const r = await fillAttendSmart('출장', { apiKey: 'sk-x', today: TODAY, useNative: true, form });
    assert.equal(r.via, 'api');
    assert.equal(r.patch.kind, 'trip');
    assert.ok(r.note.includes('로컬 CLI 실패'), r.note);
    const body = sent.at(-1);
    assert.equal(body.output_config.format.type, 'json_schema');
    assert.ok(body.output_config.format.schema.required.includes('reply'));
    // 2026-10-05 사용자 지정: "모두 opus 5.5로 변경해줘" — 다리와 같은 모델·같은 깊이다. Opus 5.5 가 400 으로 받지 않는 칸
    // (temperature·thinking 끄기/토큰 상한·억지 tool_choice·미리 적은 assistant 글)은 보내지 않고, 생각까지 드는 답의 한도는 넉넉히 준다.
    assert.deepEqual([body.model, body.output_config.effort, body.max_tokens], ['claude-opus-5-5', 'low', 16000]);
    assert.deepEqual(['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice'].filter((k) => k in body), []);
    assert.deepEqual(body.messages.map((m) => m.role), ['user']);
  });
  await ta('틀린 값은 폼에 얹지 않고 무엇을 뺐는지 알린다 — 달력에 없는 날, 없는 갈래', async () => {
    globalThis.chrome = { runtime: { sendNativeMessage: async () => ({ ok: true, data: { kind: 'leave', sub: 'XX', dateFrom: '2026-02-30', start: '9:00', reply: '휴가로 채웠습니다.', fn: 'apprRequest' } }) } };
    const { fillAttendSmart } = await load();
    const r = await fillAttendSmart('2월 30일 휴가', { apiKey: '', today: TODAY, useNative: true, form });
    assert.deepEqual(r.patch, { kind: 'leave', start: '09:00' });
    assert.equal(r.reply, '휴가로 채웠습니다.');
    assert.ok(r.note.includes('종류 안의 갈래 값(XX)은 받을 수 없어 뺐습니다'), r.note);
    assert.ok(r.note.includes('날짜 값(2026-02-30)은 받을 수 없어 뺐습니다'), r.note);
  });
  await ta('말하지 않은 칸(null)은 조각에 들어가지 않는다 — null 은 지우기가 아니다', async () => {
    globalThis.chrome = { runtime: { sendNativeMessage: async () => ({ ok: true, data: { kind: null, sub: null, start: null, end: '17:00', place: null, purpose: null, reply: '종료 시각을 채웠습니다.' } }) } };
    const { fillAttendSmart } = await load();
    const r = await fillAttendSmart('5시까지로', { apiKey: '', today: TODAY, useNative: true, form });
    assert.deepEqual(r.patch, { end: '17:00' });
  });
  await ta('둘 다 안 되면 규칙으로 종류·날짜·시각만 읽는다', async () => {
    setupAttend({ native: 'error', api: 'error' });
    const { fillAttendSmart } = await load();
    const r = await fillAttendSmart('내일 2시부터 4시까지 부산시청 외근', { apiKey: 'sk-x', today: TODAY, useNative: true, form });
    assert.equal(r.via, 'local');
    assert.deepEqual(r.patch, { kind: 'out', sub: 'OD', dateFrom: '2026-09-17', start: '14:00', end: '16:00' });
    assert.match(r.note, /로컬 CLI 실패.*API 실패/);
  });
}

console.log('출장 증빙 읽기 — 파일을 같이 보낸다(규칙 해석은 없다)');
await ta('API 로 보낼 때 이미지는 image, PDF 는 document 블록으로 글 앞에 붙고, 명세(receipt)를 지난 기록이 돌아온다', async () => {
  setup({ native: 'absent', api: 'ok' });
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
      docType: 'lodging_receipt', vendor: '부산호텔', bizNo: '123-45-67890', payDate: '2026-09-10', checkIn: '2026-09-09', checkOut: '2026-09-10', nights: 1,
      total: 143000, supply: 130000, vat: 13000, currency: 'KRW', corporateCard: null, airline: null, flightNo: null, flightDate: null, depPlace: null, arrPlace: null,
      depTime: null, arrTime: null, seatClass: null, mileage: null, passenger: '김거화', extra: '조식 포함', summary: '부산호텔 1박 영수증',
    }) }] }) };
  };
  const { receiptSmart } = await load();
  const png = { name: 'r.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' };
  const r = await receiptSmart(png, { trip: { from: '2026-09-09', to: '2026-09-10', location: '고양' }, me: '김거화' }, { apiKey: 'sk-x', useNative: false });
  assert.equal(r.via, 'api');
  assert.deepEqual([r.record.docType, r.record.vendor, r.record.total, r.record.nights, r.record.extra], ['lodging_receipt', '부산호텔', 143000, 1, '조식 포함']);
  const content = sent[0].messages[0].content;
  assert.deepEqual(content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
  assert.match(content[1].text, /출장 정보: 2026-09-09 ~ 2026-09-10 · 출장지 고양 · 출장자 김거화/);
  assert.match(content[1].text, /파일 이름: r\.png/);
  await receiptSmart({ name: 'r.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,BBBB' }, { trip: {} }, { apiKey: 'sk-x' });
  assert.deepEqual(sent[1].messages[0].content[0], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BBBB' } });
});
await ta('로컬 CLI 로 보낼 때는 파일이 files 로 같이 간다. 둘 다 안 되면 던진다', async () => {
  const got = [];
  globalThis.chrome = { runtime: { sendNativeMessage: async (_h, msg) => { got.push(msg); return { ok: true, costUsd: 0.01, data: { docType: 'flight_ticket', airline: '대한항공', summary: '항공권' } }; } } };
  const { receiptSmart } = await load();
  const file = { name: 't.png', type: 'image/png', dataUrl: 'data:image/png;base64,CCCC' };
  const r = await receiptSmart(file, { trip: {} }, { useNative: true });
  assert.equal(r.via, 'cli');
  assert.deepEqual([r.record.docType, r.record.airline, r.record.total], ['flight_ticket', '대한항공', null]);
  assert.deepEqual(got[0].files, [file]);
  setup({ native: 'absent', api: 'error' });
  const { receiptSmart: again } = await load();
  await assert.rejects(again(file, { trip: {} }, { apiKey: 'sk-x', useNative: true }), /증빙을 읽지 못했습니다/);
});

console.log(`\n통과 ${pass}건`);
