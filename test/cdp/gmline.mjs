// 결재선 화면 실측 — 새 공문 창(DocumentView)에서 패널이 쓰는 pageDialog(src/gmwrite.js)를 한 동작씩 돌려 상태를 찍는다.
//
//   node test/cdp/gmline.mjs <결재자 이름>          ← 열려 있는 새 공문 창(먼저 찾은 것)에서
//   node test/cdp/gmline.mjs <결재자 이름> --new    ← 새 공문 창을 직접 열고(GET) 끝나면 저장 없이 닫는다
//
// 미리: 디버그 포트(기본 9333, CDP_PORT)를 연 KRS 크롬이 eclass 에 로그인돼 있어야 한다.
// 하는 일: 결재선 화면을 숨은 틀로 열고 → 준비(기안자 줄 확인) → 이름 검색(포스트백) → 조직도에서 고르기 → 결재 단추(포스트백) → 결재선 트리 다시 읽기 → 틀 지우기.
// **저장(ibtnAppLineSave)은 누르지 않는다** — 화면 안의 결재선은 저장 전까지 문서에 남지 않는다. 저장까지 보는 시험은 사람이 창에서 한다.
// 검색·결재 단추는 그 화면의 서버 상태(세션)를 바꾸는 포스트백이다. 하룻밤 둔 창은 기안자 줄이 '[]' 로 비어 쓸 수 없다(2026-10-09 실측) — --new 로 연다.
import { targets, attach, newTab, closeTab } from './cdp.mjs';
import { injected } from '../../src/gmwrite.js';
import { writePlan } from '../../src/gongmun.js';

const argv = process.argv.slice(2);
const fresh = argv.includes('--new');
const name = argv.find((a) => !a.startsWith('--'));
if (!name) {
  console.log('쓰는 법: node test/cdp/gmline.mjs <결재자 이름> [--new]');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let opened = null;
let t = null;
if (fresh) {
  opened = await newTab(writePlan('purchase', {}, {}).url);
  await sleep(1500);
  t = (await targets()).find((x) => x.id === opened.id);
} else {
  t = (await targets()).find((x) => x.type === 'page' && /DocumentView\.aspx/.test(x.url));
}
if (!t) {
  console.log('새 공문 창(DocumentView.aspx)이 없습니다 — 패널의 "eclass 에 공문 작성" 으로 하나 열어 두거나 --new 로 돌리세요.');
  process.exit(1);
}
const p = await attach(t);
// 툴바(ShowApplineWin)가 뜰 때까지 — 새로 연 창은 loginbyname 을 지나 문서번호를 받는다.
let info = null;
for (let i = 0; i < 40; i++) {
  info = await p.evaluate(`(() => { try { const tb = window.frames['frameToolBar']; const fd = window.frames['frameDocument'];
    return { tb: !!(tb && typeof tb.ShowApplineWin === 'function'), doc: fd ? (fd.location.href.match(/DOCID=([^&]*)/) || [])[1] || '' : '', login: /loginbyname/i.test(location.pathname) }; } catch (e) { return { err: e.message }; } })()`, 10000).catch((e) => ({ err: e.message }));
  if (info && info.tb) break;
  await sleep(700);
}
console.log('창', t.url.slice(0, 100), JSON.stringify(info));
/** 툴바 프레임에서 pageDialog 한 동작 — 패널의 chrome.scripting.executeScript(world: MAIN) 와 같은 자리다. */
const call = (op, arg = null) => p.evaluate(
  `(() => { const w = window.frames['frameToolBar']; return w.eval(${JSON.stringify(`(${injected.pageDialog.toString()})`)}).apply(null, ${JSON.stringify([op, arg])}); })()`, 30000,
);
/** 숨은 틀 안을 들여다본다 — 조직도 노드 수·고른 사람·클라이언트 상태·결재선 트리·메시지. */
const look = () => p.evaluate(`(() => {
  const f = window.frames['frameToolBar'].document.querySelector('iframe[data-krsws="line"]'); if (!f) return 'no frame';
  const x = f.contentWindow.frames[0]; if (!x) return 'no inner';
  const t1 = x.$find && x.$find('RadTreeView1'); const t2 = x.$find && x.$find('RadTreeView2');
  const cs = (x.document.getElementById('RadTreeView1_ClientState') || {}).value || '';
  return { ready: x.document.readyState, t1n: t1 ? t1.get_allNodes().length : null, t1sel: t1 && t1.get_selectedNode() && t1.get_selectedNode().get_text(),
    cs: cs.slice(0, 200), t2: t2 ? t2.get_allNodes().map((n) => n.get_text()) : null, lbl: (x.document.getElementById('lblMsg') || {}).innerText }; })()`);
const until = async (fn, test, ms) => {
  const t0 = Date.now();
  let r;
  while (Date.now() - t0 < ms) { r = await fn(); if (test(r)) return r; await sleep(400); }
  return { ...r, timeout: true };
};
const say = (k, v) => console.log(k.padEnd(8), JSON.stringify(v));
try {
  if (!info || !info.tb) throw new Error('툴바가 뜨지 않았습니다');
  say('open', await call('line:open'));
  const ready = await until(() => call('line:ready'), (r) => r.ready, 25000);
  say('ready', ready);
  if (!ready.drafter || /^\[\s*\]$/.test(ready.drafter)) throw new Error('기안자 줄이 비었습니다(오래된 창) — --new 로 돌리세요');
  say('look0', await look());
  say('search', await call('line:search', name));
  await sleep(300);
  say('ready', await until(() => call('line:ready'), (r) => r.ready, 25000));
  say('look1', await look());
  say('pick', await call('line:pick', name));
  say('look2', await look());
  say('press', await call('line:press', 'btnAPP'));
  await sleep(300);
  say('ready', await until(() => call('line:ready'), (r) => r.ready, 25000));
  say('look3', await look());
  say('tree', await call('line:tree'));
} catch (err) {
  console.log('멈춤:', err.message);
} finally {
  say('close', await call('line:close').catch((e) => ({ err: e.message })));
  console.log('저장은 누르지 않았습니다. 창에 뜬 알림:', JSON.stringify(p.dialogs), '오류:', JSON.stringify(p.errors.slice(0, 5)));
  if (opened) { await closeTab(opened.id); console.log('새로 연 창은 저장 없이 닫았습니다.'); }
}
process.exit(0);
