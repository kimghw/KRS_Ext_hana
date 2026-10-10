// 공문 작성기(src/gmwrite.js writeGongmun) 실측 — 새 공문 창(DocumentView)에 패널이 하는 그대로 넣어 본다.
//
//   node test/cdp/gmwrite.mjs --head <부서장> --project <과제명> [--new] [--kind purchase|edu|trip|outside] [--me <이름>] [--dept <부서>]
//                             [--lead <과제책임자>] [--refs <참조자,참조자>] [--code <과제번호>] [--director <소장>] [--title <제목>] [--total <합계>] [--live]
//
// 미리: 디버그 포트(기본 9333, CDP_PORT)를 연 KRS 크롬이 eclass 에 로그인돼 있어야 한다. --new 면 새 공문 창을 직접 열고(GET) 끝나면 저장 없이 닫는다.
// 없으면 열려 있는 새 공문 창(먼저 찾은 것)에 쓴다 — 하룻밤 둔 창은 결재선 화면이 비어 쓸 수 없다(2026-10-09 실측).
// 기본은 dry — 과제(Job Id)·제목·차수·본문은 창에 들어가지만(저장은 안 된 채) 문서설정·결재선은 넣어 보고 다시 읽기만 하고 **확인·저장하지 않는다**.
// --live 는 패널과 같이 문서설정 확인·결재선 저장까지 한다(임시저장·상신은 여전히 사람 몫). 사람 이름은 인자로만 받는다(저장소에 두지 않는다).
import { targets, attach, newTab, closeTab } from './cdp.mjs';
import { writeGongmun } from '../../src/gmwrite.js';
import { writePlan } from '../../src/gongmun.js';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--') && (argv[argv.indexOf(a) + 1] ?? '--').startsWith('--')));
const args = Object.fromEntries(argv.map((a, i, all) => (a.startsWith('--') && !flags.has(a) ? [a.slice(2), all[i + 1] ?? ''] : null)).filter(Boolean));
if (!args.head || !args.project) {
  console.log('쓰는 법: node test/cdp/gmwrite.mjs --head <부서장> --project <과제명> [--new] [--kind purchase] [--me <이름>] [--dept <부서>] [--lead <과제책임자>] [--code <과제번호>] [--director <소장>] [--title <제목>] [--total <합계>] [--live]');
  process.exit(2);
}
const dry = !flags.has('--live');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kind = args.kind || 'purchase';
const project = { name: args.project, code: args.code || '', lead: args.lead || '', alias: '', rnd: { year: 1 } };
const preset = { dept: args.dept || '', head: args.head, director: args.director || '', refs: (args.refs || '').split(/[,\s]+/).filter(Boolean) };
const plan = writePlan(kind, {
  title: args.title || `[시험] ${args.project} 공문 작성 시험`,
  body: `1. 시험 — 이 글은 공문 작성기 실측${dry ? '(dry)' : ''}이 넣은 것입니다. 저장하지 말고 닫아 주세요.\n\n------------ 아   래 ------------\n\n가. 시험`,
  draft: { total: Number(args.total || 300000) },
}, { me: args.me || '', preset, project });
console.log('계획', JSON.stringify({ form: plan.form, known: plan.known, job: plan.values.job, setting: plan.setting, line: plan.line, dry }));

let opened = null;
let t = null;
if (flags.has('--new')) {
  opened = await newTab(plan.url);
  await sleep(1500);
  t = (await targets()).find((x) => x.id === opened.id);
} else {
  t = (await targets()).find((x) => x.type === 'page' && /DocumentView\.aspx/.test(x.url));
}
if (!t) {
  console.log('새 공문 창(DocumentView.aspx)이 없습니다 — 패널의 "eclass 에 공문 작성" 으로 하나 열어 두거나 --new 로 돌리세요.');
  process.exit(1);
}
console.log('창', t.url.slice(0, 100));
const p = await attach(t);
// 패널의 frameId 대신 프레임 이름으로 — 새 공문 창은 툴바·본문 틀·첨부 틀 세 프레임이다. 작성기가 툴바·본문 틀이 뜰 때까지 스스로 기다린다.
const FRAMES = { 0: 'frameToolBar', 3: 'frameDocument', 5: 'frameDocOther' };
const inFrame = (frame, func, fnArgs) => p.evaluate(
  `(() => { const w = window.frames['${frame}']; if (!w) throw new Error('no frame'); return w.eval(${JSON.stringify(`(${func.toString()})`)}).apply(null, ${JSON.stringify(fnArgs)}); })()`, 60000,
);
const api = {
  tabs: { create: async () => { throw new Error('새 창을 열지 않는다 — 열려 있는 창에 쓴다'); } },
  scripting: {
    executeScript: async ({ target, func, args: fnArgs = [] }) => {
      if (target.allFrames) return Promise.all(Object.entries(FRAMES).map(async ([id, nm]) => ({ frameId: +id, result: await inFrame(nm, func, fnArgs).catch(() => null) })));
      return [{ result: await inFrame(FRAMES[target.frameIds[0]], func, fnArgs) }];
    },
  },
};
try {
  const t0 = Date.now();
  const res = await writeGongmun(plan, { api, dry, tabId: 1, onStep: (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6), s.key.padEnd(8), s.ok, s.detail) });
  console.log('문서', res.docId);
  console.log('남은 숨은 틀', JSON.stringify(await inFrame('frameToolBar', () => [...document.querySelectorAll('iframe[data-krsws]')].map((f) => f.getAttribute('data-krsws')), [])));
  console.log('받아 적은 알림', JSON.stringify(await inFrame('frameToolBar', () => (window.__krsws || {}).said || [], [])));
  console.log('창의 알림', JSON.stringify(p.dialogs), '오류', JSON.stringify(p.errors.slice(0, 5)));
  console.log(res.steps.every((s) => s.ok) ? `모든 단계 ✓ (${dry ? 'dry — 확인·저장 안 함' : '문서설정 확인·결재선 저장함'}). 창은 저장하지 말고 닫으세요.` : `안 된 단계: ${res.steps.filter((s) => !s.ok).map((s) => s.label).join(', ')}`);
} finally {
  if (opened) { await closeTab(opened.id); console.log('새로 연 창은 저장 없이 닫았습니다.'); }
}
process.exit(0);
