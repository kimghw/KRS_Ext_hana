// 확장 다시 올리기 — 디버그 포트를 연 크롬의 KRS WORKSPACE 확장을 CDP 로 리로드한다(chrome://extensions 의 ↻ 단추와 같다).
//
//   node test/cdp/reload.mjs                  # 이름이 "KRS WORKSPACE" 인 압축 해제 확장을 리로드하고, 열려 있던 사이드패널을 같은 창에 다시 연다
//   node test/cdp/reload.mjs <확장 ID>
//   node test/cdp/reload.mjs open             # 리로드 없이 사이드패널만 연다(마지막으로 쓰던 창)
//   node test/cdp/reload.mjs --open           # 리로드 뒤 패널이 닫혀 있었어도 연다
//   node test/cdp/reload.mjs --no-reopen      # 리로드만 하고 패널은 닫힌 채 둔다
//   node test/cdp/reload.mjs --if-changed     # 훅용 — 확장 소스가 지난 리로드 뒤 바뀌었을 때만 올리고, 결과를 훅 JSON(systemMessage) 한 줄로 찍는다. 항상 종료 코드 0
//
// --if-changed 는 Claude Code 의 Stop 훅(.claude/settings.local.json)이 부른다 — Claude 가 한 차례 작업을 마칠 때마다 돌아,
// 확장이 읽는 파일(test·native·tools·gmail·node_modules·*.md·package*.json 을 뺀 전부)의 가장 새 mtime 이 도장(임시 폴더의
// krs-ext-reload.stamp)보다 새로우면 리로드하고 도장을 그 mtime 으로 맞춘다. 바뀐 게 없거나 디버그 포트 크롬이 없으면 조용히 넘어간다.
//
// 하는 일: chrome://extensions 탭(없으면 잠깐 열었다 닫는다)에 붙어 chrome.developerPrivate.reload(id) 를 부른다.
// 그 길이 막히면(엣지 내장 페이지가 다를 때 등) 확장 페이지(사이드패널)에서 chrome.runtime.reload() 로 대신한다.
// 끝나면 다시 올라온 확장의 상태와, 올라오면서 난 manifest·런타임 오류를 찍는다. 크롬은 리로드해도 런타임 오류 기록을 남겨 두므로
// 전에 쌓인 오류는 먼저 찍고 비운 뒤 리로드한다 — 그래서 리로드 뒤에 보이는 건 전부 새 오류다.
//
// 사이드패널: 리로드하면 열려 있던 사이드패널은 닫힌다. chrome.sidePanel.open 은 "사용자 동작이 있어야" 하는 API 라 보통 스크립트로는 못 여는데,
// CDP 의 Runtime.evaluate 에 userGesture: true 를 주면 그 평가가 사용자 동작으로 취급된다. 그래서 확장 페이지(sidepanel.html)를 임시 탭에
// 띄워 거기서 창마다 chrome.sidePanel.open({ windowId }) 를 부르고 탭을 닫는다 — 2026-10-09 크롬 154 에서 확인.
// 이미 떠 있는 eclass 탭의 content script(home.js·people.js·afterpage.js)는 끊긴 채 남는다("Extension context invalidated"). 그 탭은 새로고침해야 새 코드가 붙는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { version, targets, newTab, closeTab, attach, PORT } from './cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEFAULT_NAME = 'KRS WORKSPACE';
/** 저장소 뿌리 — 확장이 읽는 파일들이 여기 있다. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** --if-changed 가 "마지막으로 올린 소스의 mtime" 을 남겨 두는 도장. */
const STAMP = path.join(os.tmpdir(), 'krs-ext-reload.stamp');
/** 확장이 읽지 않는 것들 — 여기만 바뀌면 리로드할 까닭이 없다. */
const NOT_EXTENSION_DIRS = new Set(['node_modules', '.git', '.claude', 'test', 'native', 'tools', 'gmail']);
const NOT_EXTENSION_FILE = /(\.md|package\.json|package-lock\.json)$/i;

/** 확장이 읽는 파일 중 가장 새 것. */
export function newestSource(root = ROOT) {
  let best = { file: null, mtimeMs: 0 };
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!NOT_EXTENSION_DIRS.has(e.name)) walk(path.join(dir, e.name)); continue; }
      if (!e.isFile() || NOT_EXTENSION_FILE.test(e.name)) continue;
      const f = path.join(dir, e.name);
      const m = fs.statSync(f).mtimeMs;
      if (m > best.mtimeMs) best = { file: path.relative(root, f), mtimeMs: m };
    }
  };
  walk(root);
  return best;
}

/** 훅이 부르는 길 — 바뀐 게 있을 때만 올리고, Claude Code 에 보일 한 줄(systemMessage)을 돌려준다. null 이면 조용히 지나간다. */
export async function reloadIfChanged({ id, open = false, reopen = true } = {}) {
  // 도장은 파일의 mtime 이 아니라 **내용**으로 읽는다 — NTFS 의 mtime 은 100ns 단위라 utimes 로 ms 단위를 쓰면 원본보다 늘 조금 앞서
  // "바뀌었다" 로 읽힌다(2026-10-09 에 실제로 겪어, 매번 리로드했다).
  let stampMs = 0;
  try { stampMs = Number(JSON.parse(fs.readFileSync(STAMP, 'utf8')).mtimeMs) || 0; } catch { /* 도장 없음 */ }
  const newest = newestSource();
  if (newest.mtimeMs <= stampMs) return null;
  try { await version(); } catch {
    return `확장 소스가 바뀌었지만(${newest.file}) 디버그 포트 ${PORT} 크롬이 없어 다시 올리지 못했습니다.`;
  }
  let r;
  try { r = await reloadExtension({ id, open, reopen }); } catch (e) { return `확장을 다시 올리지 못했습니다: ${e.message}`; }
  // 도장에는 "지금" 이 아니라 올린 소스의 mtime 을 적는다 — 그 사이에 또 고친 파일은 다음에 잡힌다.
  fs.writeFileSync(STAMP, JSON.stringify({ mtimeMs: newest.mtimeMs, file: newest.file, at: new Date().toISOString() }) + '\n');
  const problems = [r.loadError && `LOAD ERROR ${r.loadError}`, ...r.manifestErrors.map((m) => `manifest: ${m}`), ...r.runtimeErrors.map((m) => `runtime: ${m}`)].filter(Boolean);
  const panel = r.panel.opened.length ? `사이드패널 창 ${r.panel.opened.join(', ')} 에 다시 열림`
    : r.panel.error ? `사이드패널은 못 열었음(${r.panel.error})` : r.panel.was.length ? '사이드패널은 닫힌 채' : '';
  return `확장 다시 올림(${newest.file} 바뀜) — ${r.state}${problems.length ? ', ' + problems.join(' | ').slice(0, 500) : ', 오류 없음'}${panel ? '. ' + panel : ''}. 떠 있는 eclass 탭은 새로고침해야 합니다.`;
}

/** chrome://extensions 에서 보는 확장 목록(이름·상태·경로·오류). */
const infoExpr = `new Promise((r) => chrome.developerPrivate.getExtensionsInfo({}, (xs) => r(xs.map((x) => ({
  id: x.id, name: x.name, state: x.state, path: x.path || '', location: x.location, version: x.version,
  manifestErrors: (x.manifestErrors || []).map((e) => e.message),
  runtimeErrors: (x.runtimeErrors || []).map((e) => e.message + (e.source ? '  @ ' + e.source.replace(/^chrome-extension:[/][/][a-p]{32}[/]/, '') : '')),
})))))`;

/**
 * 확장 페이지를 임시 탭에 띄워 그 안에서 식을 평가한다. userGesture 로 평가하므로 chrome.sidePanel.open 처럼
 * "사용자 동작이 있어야 하는" API 를 부를 수 있다. 끝나면 탭을 닫는다.
 */
async function withExtensionPage(id, fn) {
  const tab = await newTab('about:blank');
  const c = await attach(tab);
  try {
    await c.goto(`chrome-extension://${id}/sidepanel.html`, 15000);
    const ev = async (expression) => {
      const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, 15000);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || '평가 실패');
      return r.result.value;
    };
    return await fn(ev);
  } finally {
    c.close();
    await closeTab(tab.id);
  }
}

/** 사이드패널이 떠 있는 창들의 ID. 사이드패널은 창마다 따로 열리므로 창 단위로 기억했다가 그 창에 다시 연다. */
export async function sidePanelWindows(id) {
  const ws = [];
  const panels = (await targets()).filter((x) => x.type === 'page' && x.url === `chrome-extension://${id}/sidepanel.html`);
  for (const t of panels) {
    const c = await attach(t).catch(() => null);
    if (!c) continue;
    try { ws.push(await c.evaluate('chrome.windows.getCurrent().then((w) => w.id)', 5000)); } catch { /* 닫히는 중 */ } finally { c.close(); }
  }
  return [...new Set(ws)];
}

/**
 * 사이드패널을 연다.
 * @param {string} id  확장 ID
 * @param {number[]} windowIds  열 창들. 비어 있으면 마지막으로 쓰던 창 하나.
 * @returns {Promise<number[]>} 연 창 ID
 */
export async function openSidePanel(id, windowIds = []) {
  return withExtensionPage(id, async (ev) => {
    const ids = windowIds.length ? windowIds : [await ev(`chrome.windows.getLastFocused({ windowTypes: ['normal'] }).then((w) => w.id)`)];
    const opened = [];
    for (const w of ids) {
      await ev(`chrome.sidePanel.open({ windowId: ${+w} })`);
      opened.push(+w);
    }
    return opened;
  });
}

/**
 * 확장을 다시 올린다.
 * @param {{ id?: string, name?: string, reopen?: boolean, open?: boolean, log?: (s: string) => void }} opts
 *   id 가 없으면 name 의 압축 해제 확장을 찾는다. reopen(기본 참): 열려 있던 사이드패널을 같은 창에 다시 연다. open: 닫혀 있었어도 연다.
 * @returns {Promise<{ id: string, state: string, via: string, loadError: string|null, manifestErrors: string[], runtimeErrors: string[], before: string[], panel: { was: number[], opened: number[], error: string|null } }>}
 */
export async function reloadExtension({ id, name = DEFAULT_NAME, reopen = true, open = false, log = () => {} } = {}) {
  const all = await targets();
  let page = all.find((x) => x.type === 'page' && /^chrome:\/\/extensions/.test(x.url));
  let opened = null;
  if (!page) { opened = page = await newTab('chrome://extensions/'); log('chrome://extensions 탭을 잠깐 연다'); }
  const c = await attach(page);
  let result;
  try {
    let list;
    try { list = await c.evaluate(infoExpr, 8000); } catch (e) { list = null; log(`developerPrivate 를 못 쓴다: ${e.message}`); }
    const ext = list && list.find((x) => (id ? x.id === id : x.name === name && x.location === 'UNPACKED'));
    const extId = ext ? ext.id : (id || findExtId(all, name));
    const panelWas = extId && (reopen || open) ? await sidePanelWindows(extId) : [];
    if (panelWas.length) log(`사이드패널이 창 ${panelWas.join(', ')} 에 열려 있다 — 리로드 뒤 다시 연다`);

    if (!ext) {
      // developerPrivate 가 없거나 목록에 없다 — 확장 페이지에서 chrome.runtime.reload() 로 간다.
      result = await reloadFromExtensionPage(extId, log);
    } else {
      const before = [...ext.manifestErrors, ...ext.runtimeErrors];
      log(`${ext.name} ${ext.version} (${ext.id}, ${ext.state}) ← ${ext.path}`);
      if (before.length) log(`리로드 전 남아 있던 오류 ${before.length}건: ${before.slice(0, 3).join(' | ').slice(0, 300)}`);

      // 크롬은 리로드해도 런타임 오류를 일부러 남겨 둔다(chrome://extensions 새로고침마다 기록이 지워지지 않게). 그래서 먼저 비워야
      // 리로드 뒤에 보이는 것이 전부 새 오류가 된다. 지우기 전에 위에서 찍어 두었다.
      if (before.length) {
        await c.evaluate(`new Promise((res) => chrome.developerPrivate.deleteExtensionErrors({ extensionId: ${JSON.stringify(ext.id)} }, () => res(chrome.runtime.lastError ? chrome.runtime.lastError.message : null)))`, 8000)
          .then((e) => { if (e) log(`오류 기록을 못 비웠다: ${e}`); }, (e) => log(`오류 기록을 못 비웠다: ${e.message}`));
      }

      // failQuietly: 실패해도 chrome://extensions 에 대화상자를 띄우지 않고, populateErrorForUnpacked: 대신 콜백으로 오류를 돌려준다.
      const loadError = await c.evaluate(`new Promise((res) => chrome.developerPrivate.reload(${JSON.stringify(ext.id)},
        { failQuietly: true, populateErrorForUnpacked: true },
        (e) => res(chrome.runtime.lastError ? chrome.runtime.lastError.message : (e ? (e.error + (e.path ? '  @ ' + e.path : '')) : null))))`, 30000);

      // 다시 올라올 틈을 주고 상태를 본다. 서비스워커가 뜨면서 던진 오류는 runtimeErrors 로 모인다.
      let after = null;
      for (let i = 0; i < 20; i++) {
        await sleep(500);
        const xs = await c.evaluate(infoExpr, 8000).catch(() => null);
        after = xs && xs.find((x) => x.id === ext.id);
        if (after && after.state === 'ENABLED' && i >= 3) break;   // 2초는 기다려 SW 시작 오류까지 본다
      }
      result = {
        id: ext.id, via: 'developerPrivate.reload', loadError, before,
        state: after ? after.state : '(목록에 없음)',
        manifestErrors: after ? after.manifestErrors : [],
        runtimeErrors: after ? after.runtimeErrors : [],
      };
    }

    // 사이드패널 되살리기 — 열려 있던 창마다, 또는 open 이면 마지막으로 쓰던 창에.
    result.panel = { was: panelWas, opened: [], error: null };
    const healthy = !result.loadError && !/DISABLED|목록에 없음/.test(result.state);
    if (healthy && (panelWas.length || open)) {
      try { result.panel.opened = await openSidePanel(result.id, panelWas); } catch (e) { result.panel.error = e.message; }
    }
    return result;
  } finally {
    c.close();
    if (opened) await closeTab(opened.id);
  }
}

/** 타깃 목록에서 이름 대신 쓸 확장 ID — 확장 페이지(chrome-extension://…)가 열려 있어야 잡힌다. 크롬 기본 확장(월렛·행아웃)은 뺀다. */
function findExtId(all, name) {
  const t = all.find((x) => /^chrome-extension:\/\//.test(x.url || '') && !/nmmhkkeg|nkeimhog/.test(x.url) && (x.title === name || x.type === 'page'));
  return t ? t.url.split('/')[2] : null;
}

/** 우회로 — 확장 페이지(사이드패널 등)에서 chrome.runtime.reload(). 그 페이지는 바로 죽으니 응답을 기다리지 않는다. */
async function reloadFromExtensionPage(id, log) {
  if (!id) throw new Error('확장을 찾지 못했다 — chrome://extensions 도, 열린 확장 페이지도 없다.');
  const t = (await targets()).find((x) => x.type === 'page' && x.url.startsWith(`chrome-extension://${id}/`));
  if (!t) throw new Error(`확장 ${id} 의 열린 페이지가 없다 — 사이드패널을 열어 두거나 chrome://extensions 를 열어 두세요.`);
  log(`확장 페이지에서 runtime.reload(): ${t.url}`);
  const c = await attach(t);
  c.send('Runtime.evaluate', { expression: 'chrome.runtime.reload()' }, 2000).catch(() => {});
  await sleep(300);
  c.close();
  // 서비스워커나 확장 페이지가 다시 나타나면 올라온 것이다.
  let up = false;
  for (let i = 0; i < 20 && !up; i++) {
    await sleep(500);
    up = (await targets()).some((x) => (x.url || '').startsWith(`chrome-extension://${id}/`));
  }
  return { id, via: 'runtime.reload', loadError: null, before: [], state: up ? 'ENABLED(추정 — 타깃이 다시 보임)' : '(타깃이 안 보임 — 서비스워커가 잠들었을 수 있음)', manifestErrors: [], runtimeErrors: [] };
}

if (process.argv[1] && /reload\.mjs$/.test(process.argv[1])) {
  const args = process.argv.slice(2);
  const id = args.find((a) => /^[a-p]{32}$/.test(a));
  const log = (s) => console.log('  ' + s);
  if (args.includes('--if-changed')) {
    // 훅 길 — 무슨 일이 있어도 종료 코드 0 (Stop 훅이 2 로 끝나면 Claude 가 멈추지 못한다). 할 말이 있을 때만 JSON 한 줄.
    try {
      const msg = await reloadIfChanged({ id, open: args.includes('--open'), reopen: !args.includes('--no-reopen') });
      if (msg) console.log(JSON.stringify({ systemMessage: msg }));
    } catch (e) {
      console.log(JSON.stringify({ systemMessage: `확장 리로드 훅 실패: ${e.message}` }));
    }
    process.exit(0);
  }
  try {
    if (args.includes('open')) {
      // 리로드 없이 패널만. ID 가 없으면 chrome://extensions 에서 이름으로 찾는다.
      let extId = id;
      if (!extId) {
        const page = (await targets()).find((x) => x.type === 'page' && /^chrome:\/\/extensions/.test(x.url));
        const tmp = page || await newTab('chrome://extensions/');
        const c = await attach(tmp);
        try {
          const ext = (await c.evaluate(infoExpr, 8000)).find((x) => x.name === DEFAULT_NAME && x.location === 'UNPACKED');
          extId = ext && ext.id;
        } finally { c.close(); if (!page) await closeTab(tmp.id); }
      }
      if (!extId) throw new Error(`${DEFAULT_NAME} 확장이 chrome://extensions 목록에 없다.`);
      const ws = await openSidePanel(extId);
      console.log(`사이드패널을 열었다 — 창 ${ws.join(', ')}`);
      process.exit(0);
    }
    const r = await reloadExtension({ id, open: args.includes('--open'), reopen: !args.includes('--no-reopen'), log });
    console.log(`다시 올렸다 (${r.via}) — ${r.id} ${r.state}`);
    if (r.loadError) console.log('  LOAD ERROR  ' + r.loadError);
    for (const m of r.manifestErrors) console.log('  manifest    ' + m);
    for (const m of r.runtimeErrors) console.log('  runtime     ' + m.slice(0, 400));
    if (!r.loadError && !r.manifestErrors.length && !r.runtimeErrors.length) console.log('  오류 없음');
    if (r.panel.opened.length) console.log(`  사이드패널을 창 ${r.panel.opened.join(', ')} 에 다시 열었다`);
    else if (r.panel.error) console.log(`  사이드패널을 다시 못 열었다: ${r.panel.error} — 툴바 아이콘으로 여세요`);
    else if (r.panel.was.length) console.log('  사이드패널은 닫혔다(리로드가 온전치 않아 다시 열지 않았다) — 툴바 아이콘으로 여세요');
    else console.log('  사이드패널은 열려 있지 않았다 — 열려면 node test/cdp/reload.mjs open');
    console.log('  떠 있던 eclass 탭은 새로고침해야 새 content script 가 붙습니다.');
    process.exit(r.loadError || r.manifestErrors.length ? 1 : 0);
  } catch (e) {
    console.error('실패: ' + e.message);
    process.exit(1);
  }
}
