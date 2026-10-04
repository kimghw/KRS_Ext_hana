// eclass 쪽지로 보내기(src/memo.js) — 받는 사람 찾기, 임시저장 → 첨부 올리기 → 다시 저장 → 보내기의 차례와 멈추는 자리.
// 사이트는 흉내 낸다 — **실제 쪽지는 나가지 않는다.**
import assert from 'node:assert/strict';
import { memoSuggest, memoSend, memoHtml, dextAuthKey } from '../src/memo.js';
import { AuthError } from '../src/net.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const CONFIG = `win.dextuploadx5Configuration = {
  //26.01.29 테스트
  //authkey: "TEST-KEY",
  // eclass.krs.co.kr
   authkey: "LIVE-KEY",
   //authkey: "CLOUD-KEY",
  productPath: location.origin + "/intra/intranet/DEXT_X5_V4_3/",
};`;
const text = (body, type = 'text/html; charset=utf-8') => new Response(body, { status: 200, headers: { 'content-type': type } });
const json = (obj) => text(JSON.stringify(obj), 'application/json; charset=utf-8');

/** 가짜 쪽지 사이트. on 으로 주소별 답을 갈아 끼운다. */
function fakeSite(on = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace('https://eclass.krs.co.kr', '');
    const name = path.split('?')[0].split('/').pop();
    calls.push({ path, method: init.method || 'GET', body: init.body });
    if (on[name]) return on[name](init, calls);
    if (name === 'NewMessage') return text('<form id="formMain" name="formMain" method="post"></form>');
    if (name === 'GetRecipientSuggestions') return json([{ userId: 'hong', userName: '홍길동', empDegree: '책임', deptName: '회계팀', refUserId: '' }, { userId: '', userName: '빈 줄' }]);
    if (name === 'SaveDraft') return json({ isSuccess: true, dId: 771 });
    if (name === 'dextuploadx5-configuration.js') return text(CONFIG, 'application/javascript');
    if (name === 'DraftFileUp') return text('SEND:여비증빙_1.pdf|4|pdf:');
    if (name === 'SendDraft') return json({ isSuccess: true });
    throw new Error('모르는 주소 ' + path);
  };
  return calls;
}
const MEMO = { to: ['hong'], title: '[여비 증빙] A · 김거화 9/23 서울', lines: ['여비계산서 증빙을 보냅니다.', '과제·계정: A & <B>'], file: { name: '여비증빙_1.pdf', bytes: new Uint8Array([37, 80, 68, 70]), type: 'application/pdf' } };
const form = (body) => Object.fromEntries(new URLSearchParams(body));

console.log('읽기');
t('설정 파일에서 주석이 아닌 제품 열쇠를 읽는다', () => {
  assert.equal(dextAuthKey(CONFIG), 'LIVE-KEY');
  assert.equal(dextAuthKey('// authkey: "X"'), '');
});
t('본문은 줄마다 문단이고 꺾쇠는 글자로 적힌다', () => {
  assert.equal(memoHtml(['가 & <나>', '', '다']), '<p>가 &amp; &lt;나&gt;</p><p><br></p><p>다</p>');
});
await ta('받는 사람 찾기 — 쓰기 화면의 자동완성과 같은 주소, ID 가 없는 줄은 뺀다', async () => {
  const calls = fakeSite();
  assert.deepEqual(await memoSuggest(' 홍길 '), [{ id: 'hong', name: '홍길동', title: '책임', dept: '회계팀' }]);
  assert.equal(calls[0].path, `/eClassVer4/Message/GetRecipientSuggestions?query=${encodeURIComponent('홍길')}`);
  assert.deepEqual(await memoSuggest('  '), [], '빈 글이면 묻지 않는다');
  assert.equal(calls.length, 1);
});

console.log('보내기');
await ta('임시저장 → 첨부 올리기 → 첨부 정보를 얹어 다시 저장 → 보내기', async () => {
  const calls = fakeSite();
  const stages = [];
  const r = await memoSend({ ...MEMO, onStage: (s) => stages.push(s) });
  assert.deepEqual(r, { dId: '771', file: '여비증빙_1.pdf|4|pdf:' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
    'GET /eClassVer4/Message/NewMessage', 'POST /eClassVer4/Message/SaveDraft', 'GET /intra/intranet/DEXT_X5_V4_3/dextuploadx5-configuration.js',
    'POST /eClassVer4/Message/DraftFileUp?pType=SEND', 'POST /eClassVer4/Message/SaveDraft', 'POST /eClassVer4/Message/SendDraft',
  ]);
  assert.deepEqual(form(calls[1].body), { dId: '', title: MEMO.title, to: 'hong', cc: '', content: '<p>여비계산서 증빙을 보냅니다.</p><p>과제·계정: A &amp; &lt;B&gt;</p>',
    likeSingle: '0', deletedFile: '', uploadedFile: '' });
  const up = calls[3].body;
  assert.deepEqual([up.get('DEXTUploadX5_AuthKey'), up.get('DEXTUploadX5_ControlId'), up.get('DEXTUploadX5_Folder'), up.get('DEXTUploadX5_EXIFData'), up.get('DEXTUploadX5_MetaData')],
    ['LIVE-KEY', 'dext5', '', '', '']);
  assert.match(up.get('DEXTUploadX5_UniqueId'), /^DX5-\d+-0$/);
  const sent = up.get('DEXTUploadX5_FileData');
  assert.deepEqual([sent.name, sent.type, [...new Uint8Array(await sent.arrayBuffer())]], ['여비증빙_1.pdf', 'application/pdf', [37, 80, 68, 70]]);
  assert.deepEqual([form(calls[4].body).dId, form(calls[4].body).uploadedFile], ['771', '여비증빙_1.pdf|4|pdf:']);
  assert.deepEqual(form(calls[5].body), { dId: '771' });
  assert.deepEqual(stages, ['쪽지 화면을 확인하는 중...', '쪽지를 쓰는 중...', '첨부를 올리는 중 — 여비증빙_1.pdf', '쪽지를 보내는 중...']);
});
await ta('첨부가 없으면 저장하고 바로 보낸다', async () => {
  const calls = fakeSite();
  await memoSend({ ...MEMO, file: null });
  assert.deepEqual(calls.map((c) => c.path.split('/').pop()), ['NewMessage', 'SaveDraft', 'SendDraft']);
});
await ta('사이트가 첨부를 받지 않으면 보내지 않는다 — 임시 보관함에 쓰다 만 쪽지가 남았을 수 있다고 말한다', async () => {
  const calls = fakeSite({ DraftFileUp: () => text('ERROR') });
  await assert.rejects(memoSend(MEMO), /사이트가 첨부를 받지 않았습니다\. eclass 쪽지의 임시 보관함\(Drafts\)에 쓰다 만 쪽지가 남아 있을 수 있습니다/);
  assert.ok(!calls.some((c) => c.path.endsWith('/SendDraft')));
});
await ta('임시저장이나 보내기가 실패라고 답하면 던진다', async () => {
  fakeSite({ SaveDraft: () => json({ isSuccess: false }) });
  await assert.rejects(memoSend(MEMO), /쪽지를 임시저장하지 못했습니다/);
  fakeSite({ SendDraft: () => json({ isSuccess: false }) });
  await assert.rejects(memoSend(MEMO), /사이트가 쪽지를 보내지 못했다고 답했습니다/);
});
await ta('로그인이 풀렸으면 아무것도 보내지 않고 로그인하라고 한다', async () => {
  const calls = fakeSite({ NewMessage: () => text('<html><input id="tbUserId"></html>') });
  await assert.rejects(memoSend(MEMO), (err) => err instanceof AuthError);
  assert.ok(!calls.some((c) => c.method === 'POST'));
});
await ta('받는 사람이나 제목이 없으면 사이트에 가지 않는다', async () => {
  const calls = fakeSite();
  await assert.rejects(memoSend({ ...MEMO, to: [] }), /받는 사람이 없습니다/);
  await assert.rejects(memoSend({ ...MEMO, title: ' ' }), /쪽지 제목이 비어 있습니다/);
  assert.equal(calls.length, 0);
});

console.log(`\n통과 ${pass}건`);
process.exit(0);
