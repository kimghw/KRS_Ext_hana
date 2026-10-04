// 구글 동의 뒤 돌아오는 곳 — 이 PC 의 127.0.0.1 빈 포트에서 code 를 한 번 받는다(데스크톱 앱 클라이언트의 방식).

import http from 'node:http';

const page = (msg) => `<meta charset="utf-8"><body style="font:16px sans-serif;margin:40px">${msg}</body>`;

/**
 * 돌아올 주소를 열고 기다린다.
 * @param {string} state 동의 주소에 실어 보낸 값 — 돌아온 것이 다르면 받지 않는다
 * @returns {{listening: Promise<number>, result: Promise<string>}} listening 은 열린 포트, result 는 code(거절·시간 초과면 던진다)
 */
export function waitForCode(state, { timeoutMs = 5 * 60_000 } = {}) {
  let done;
  const result = new Promise((res, rej) => { done = { res, rej }; });
  const server = http.createServer((req, reply) => {
    const q = new URL(req.url, 'http://127.0.0.1').searchParams;
    // 브라우저가 같이 부르는 것(favicon 등)은 기다림을 끝내지 않는다.
    if (!q.has('code') && !q.has('error')) { reply.writeHead(404).end(); return; }
    const ok = q.has('code') && q.get('state') === state;
    reply.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
    reply.end(page(ok ? '구글 동의를 받았습니다. 이 창은 닫아도 됩니다.' : '동의를 받지 못했습니다. 터미널을 확인해 주세요.'));
    if (ok) done.res(q.get('code'));
    else done.rej(new Error(q.has('error') ? `동의가 거절됐습니다: ${q.get('error')}` : '돌아온 state 가 다릅니다.'));
  });
  const timer = setTimeout(() => done.rej(new Error(`${Math.round(timeoutMs / 60_000)}분 안에 동의가 오지 않았습니다.`)), timeoutMs);
  const listening = new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
  const settled = result.finally(() => { clearTimeout(timer); server.close(); server.closeAllConnections(); });
  settled.catch(() => {});   // 기다리는 쪽이 아직 없을 때 거절돼도 프로세스가 죽지 않게
  return { listening, result: settled };
}
