// 클라이언트 정보(client.json)와 토큰(token.json)을 두는 곳.
//
// **저장소 밖**(사용자 폴더의 .krs-workspace\gmail)에 둔다 — 보안 비밀과 refresh 토큰은 메일함을 읽는 열쇠라
// 공개 저장소에 실수로라도 올라가면 안 된다. 다른 곳에 두려면 KRS_GMAIL_DIR 환경변수로 알려 준다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DIR = process.env.KRS_GMAIL_DIR || path.join(os.homedir(), '.krs-workspace', 'gmail');

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

/** 그 폴더의 보관함. 없는 파일은 null 로 답한다. */
export function store(dir = DIR) {
  const at = (name) => path.join(dir, name);
  const write = (name, obj) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(at(name), `${JSON.stringify(obj, null, 2)}\n`);
  };
  return {
    dir,
    clientPath: at('client.json'),
    tokenPath: at('token.json'),
    client: () => readJson(at('client.json')),
    saveClient: (json) => write('client.json', json),
    token: () => readJson(at('token.json')),
    saveToken: (token) => write('token.json', token),
    dropToken: () => fs.rmSync(at('token.json'), { force: true }),
  };
}

/** 구글 콘솔의 "JSON 다운로드"로 받은 파일(client_secret_….json) 가운데 가장 새것. 없으면 null. */
export function newestClientDownload(dir = path.join(os.homedir(), 'Downloads')) {
  try {
    const files = fs.readdirSync(dir).filter((f) => /^client_secret_.*\.json$/i.test(f))
      .map((f) => ({ file: path.join(dir, f), at: fs.statSync(path.join(dir, f)).mtimeMs }));
    return files.sort((a, b) => b.at - a.at)[0]?.file || null;
  } catch {
    return null;
  }
}
