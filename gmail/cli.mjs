// Gmail API 시험 구현의 명령줄 — 설정 상태를 보고, 구글 동의를 받고, 메일을 찾아 읽고, 첨부를 내려 둔다.
//
//   node gmail/cli.mjs status                    세 가지(클라이언트 정보·구글 동의·Gmail 연결)를 점검하고 다음 할 일을 말한다
//   node gmail/cli.mjs client [파일]             구글 콘솔에서 받은 클라이언트 JSON 을 들인다(파일을 안 주면 내려받기 폴더의 가장 새것)
//   node gmail/cli.mjs auth [--hint 메일]        동의 화면을 열고 토큰을 받는다(브라우저에서 "허용"은 사람이 누른다)
//   node gmail/cli.mjs search "<검색어>" [--max N]   Gmail 검색어로 찾는다(웹의 검색 칸과 같은 문법)
//   node gmail/cli.mjs trip <시작> <끝> [검색어]     그 기간(YYYY-MM-DD)에 온 메일
//   node gmail/cli.mjs show <id>                 메일 하나의 본문과 첨부 목록
//   node gmail/cli.mjs save <id> [폴더]           본문과 첨부를 파일로 내려 둔다(기본 gmail/out/<id>)
//   node gmail/cli.mjs logout                    보관한 토큰을 지운다(구글 쪽 철회는 myaccount.google.com/permissions)

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { authUrl, clientOf, exchangeCode, gmailClient, periodQuery, pkce, tokenSource } from './gmail.mjs';
import { waitForCode } from './loopback.mjs';
import { newestClientDownload, store } from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CDP_PORT = +(process.env.CDP_PORT || 9333);
const box = store();

const pad = (n) => String(n).padStart(2, '0');
const localTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** 윈도우 파일 이름에 못 쓰는 글자를 바꾼다. */
const safeName = (name) => String(name).replace(/[\\/:*?"<>|]/g, '_').trim() || 'file';
const flag = (args, name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : '';
};

function mail() {
  const json = box.client();
  if (!json) throw new Error('클라이언트 정보가 없습니다 — node gmail/cli.mjs client 를 먼저 해 주세요.');
  return gmailClient({ getToken: tokenSource({ client: clientOf(json), load: box.token, save: box.saveToken }) });
}

/* ------------------------------------------------------------------ 명령 */

async function status() {
  const line = (ok, name, note) => console.log(`[${ok ? 'OK' : '--'}] ${name.padEnd(8, '　')} ${note}`);
  const json = box.client();
  let client = null;
  try { client = json && clientOf(json); } catch { /* 모양이 틀린 파일 */ }
  line(!!client, '클라이언트 정보', client ? `${box.clientPath} (${client.clientId.slice(0, 12)}…)` : `${box.clientPath} 없음`);
  const token = box.token();
  line(!!token?.refresh_token, '구글 동의', token?.refresh_token ? `${token.email || '계정 모름'} · ${localTime(token.obtained_at)} 에 동의` : '토큰 없음');
  let next = '';
  if (!client) next = '구글 콘솔에서 OAuth 클라이언트(데스크톱 앱)를 만들어 JSON 을 내려받고 → node gmail/cli.mjs client';
  else if (!token?.refresh_token) next = 'node gmail/cli.mjs auth';
  else {
    try {
      const p = await mail().profile();
      line(true, 'Gmail 연결', `${p.emailAddress} (메일 ${Number(p.messagesTotal).toLocaleString()}통)`);
    } catch (err) {
      line(false, 'Gmail 연결', err.message);
      next = err.code === 'reauth' ? 'node gmail/cli.mjs auth' : '위 오류를 확인해 주세요';
    }
  }
  console.log(next ? `\n다음 할 일: ${next}` : '\n다 됐습니다.');
}

function installClient(file) {
  const from = file || newestClientDownload();
  if (!from) throw new Error('내려받기 폴더에 client_secret_….json 이 없습니다 — 파일 경로를 알려 주세요.');
  const json = JSON.parse(fs.readFileSync(from, 'utf8'));
  const { clientId } = clientOf(json);
  box.saveClient(json);
  console.log(`클라이언트 정보를 들였습니다: ${from}\n  → ${box.clientPath} (${clientId.slice(0, 12)}…)`);
  console.log('내려받은 파일에는 보안 비밀이 들어 있습니다 — 들인 뒤에는 지워도 됩니다.');
}

/** 동의 주소를 연다 — 구글에 로그인돼 있는 9333 브라우저에 새 탭으로, 안 닿으면 기본 브라우저로. */
async function openInBrowser(url) {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT', signal: AbortSignal.timeout(4000) });
    if (res.ok) return `${CDP_PORT} 브라우저의 새 탭`;
  } catch { /* 디버그 포트가 없다 */ }
  spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
  return '기본 브라우저';
}

async function auth(args) {
  const hint = flag(args, '--hint');
  const json = box.client();
  if (!json) throw new Error('클라이언트 정보가 없습니다 — node gmail/cli.mjs client 를 먼저 해 주세요.');
  const client = clientOf(json);
  const state = crypto.randomBytes(16).toString('hex');
  const { verifier, challenge } = pkce();
  const wait = waitForCode(state);
  const redirectUri = `http://127.0.0.1:${await wait.listening}`;
  const url = authUrl({ clientId: client.clientId, redirectUri, challenge, state, loginHint: hint });
  console.log(`동의 화면을 엽니다(${await openInBrowser(url)}). 안 열리면 이 주소를 브라우저에 붙여 넣어 주세요:\n${url}\n`);
  console.log('"확인되지 않은 앱" 경고가 뜨면 [고급] → [KRS Mail Reader(으)로 이동] → [계속] 을 눌러 주세요. 기다리는 중…');
  const code = await wait.result;
  const token = await exchangeCode({ client, code, verifier, redirectUri });
  box.saveToken({ ...token, obtained_at: new Date().toISOString() });
  const p = await mail().profile();
  box.saveToken({ ...box.token(), email: p.emailAddress });
  console.log(`동의를 받았습니다: ${p.emailAddress} (메일 ${Number(p.messagesTotal).toLocaleString()}통)`);
}

function printList({ total, messages }) {
  if (!messages.length) { console.log('찾은 메일이 없습니다.'); return; }
  for (const m of messages) {
    const files = m.attachments.filter((a) => !a.inline);
    console.log(`${localTime(m.date)} | ${m.from.replace(/\s*<.*>/, '').slice(0, 24)} | ${m.subject.slice(0, 60)}${files.length ? ` | 첨부 ${files.length}` : ''} | ${m.id}`);
  }
  console.log(`\n${messages.length}통을 읽었습니다(구글의 어림 ${total}통).`);
}

async function search(args) {
  const max = Number(flag(args, '--max')) || 10;
  if (!args[0]) throw new Error('검색어를 주세요. 예: node gmail/cli.mjs search "영수증 has:attachment newer_than:30d"');
  printList(await mail().search(args.join(' '), { max }));
}

async function trip(args) {
  const max = Number(flag(args, '--max')) || 20;
  const [from, to, ...extra] = args;
  if (!from) throw new Error('기간을 주세요. 예: node gmail/cli.mjs trip 2026-09-09 2026-09-10');
  const q = periodQuery(from, to, extra.join(' '));
  console.log(`검색어: ${q}\n`);
  printList(await mail().search(q, { max }));
}

async function show(args) {
  if (!args[0]) throw new Error('메일 ID 를 주세요(search 가 줄 끝에 보여 줍니다).');
  const m = await mail().message(args[0]);
  console.log(`제목: ${m.subject}\n보낸 사람: ${m.from}\n받는 사람: ${m.to}\n받은 때: ${localTime(m.date)}`);
  for (const a of m.attachments) console.log(`첨부${a.inline ? '(본문 그림)' : ''}: ${a.name} (${a.type}, ${a.size.toLocaleString()}바이트)`);
  const text = m.text || m.html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  console.log(`\n${text.trim().slice(0, 3000)}`);
}

async function save(args) {
  if (!args[0]) throw new Error('메일 ID 를 주세요.');
  const g = mail();
  const m = await g.message(args[0]);
  const dir = path.resolve(args[1] || path.join(HERE, 'out', m.id));
  fs.mkdirSync(dir, { recursive: true });
  const put = (name, data) => { fs.writeFileSync(path.join(dir, name), data); console.log(path.join(dir, name)); };
  if (m.html) put('본문.html', m.html);
  else if (m.text) put('본문.txt', m.text);
  for (const a of m.attachments.filter((x) => !x.inline)) put(safeName(a.name), await g.attachment(m.id, a));
}

const COMMANDS = {
  status, client: (a) => installClient(a[0]), auth, search, trip, show, save,
  logout: () => { box.dropToken(); console.log('보관한 토큰을 지웠습니다.'); },
};

const [cmd = 'status', ...args] = process.argv.slice(2);
try {
  if (!COMMANDS[cmd]) throw new Error(`모르는 명령입니다: ${cmd} (status|client|auth|search|trip|show|save|logout)`);
  await COMMANDS[cmd](args);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
