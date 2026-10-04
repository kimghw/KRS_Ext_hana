// Anthropic Messages API 를 직접 호출해, 말을 입력 명세(input.yaml)의 구조로 바꿔 받는다.
//
// 이 확장은 번들러가 없는 순수 ES 모듈이고 MV3 는 원격 스크립트 로딩을 막으므로
// 공식 SDK 대신 raw HTTP 로 부른다.
//
// 지시문과 스키마는 여기서 짓지 않는다. 작업 이름만 받아 src/input.js 가 명세에서 만든 것을 보낸다
// — 로컬 CLI 다리(native/host.mjs)와 같은 지시문이다.

import { systemPrompt, jsonSchema } from './input.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
// 로컬 CLI 다리(native/host.mjs 의 MODEL)와 같은 모델이다 — 빨리 답하는 쪽으로 맞췄다(2026-10-03 사용자 지정).
export const DEFAULT_MODEL = 'claude-haiku-4-5';

/** 첨부 파일 하나를 API 의 내용 블록으로 — 이미지는 image, PDF 는 document. dataUrl 의 base64 부분만 보낸다. */
export function fileBlock({ type, dataUrl }) {
  const data = String(dataUrl || '').split(',')[1] || '';
  const media = type === 'application/pdf' ? 'application/pdf' : (type || 'image/png');
  return { type: media === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type: media, data } };
}

/**
 * 명세의 작업 하나를 Claude 에게 맡긴다. 구조화 출력으로 스키마를 강제해 파싱 실패를 없앤다.
 * 돌려주는 것은 **아직 검증하지 않은** 답이다 — 부르는 쪽(llm.js)이 관문(structure)에 통과시킨다.
 *
 * @param {string} task input.yaml 의 작업 이름 (parse·attend·diagnose)
 * @param {string} input 사용자 쪽 글. 오늘 날짜 같은 맥락은 부르는 쪽이 붙여서 준다
 * @param {{apiKey: string, model?: string, files?: {name:string,type:string,dataUrl:string}[]}} opts files 는 글 앞에 붙는 첨부(출장 증빙)
 * @returns {Promise<object>}
 */
export async function callClaude(task, input, opts) {
  const { apiKey, model = DEFAULT_MODEL, files = [] } = opts;
  if (!apiKey) throw new Error('Anthropic API 키가 설정되어 있지 않습니다.');
  const content = files.length ? [...files.map(fileBlock), { type: 'text', text: input }] : input;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // 확장 페이지에서 직접 부르려면 필요하다
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system: systemPrompt(task),
      output_config: { format: { type: 'json_schema', schema: jsonSchema(task) } },
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message || '';
    } catch { /* 본문이 JSON 이 아닐 수 있다 */ }
    throw new Error(`Claude 호출 실패 (HTTP ${res.status}) ${detail}`.trim());
  }

  const body = await res.json();
  if (body.stop_reason === 'refusal') throw new Error('요청이 거부되었습니다. 다르게 적어보세요.');
  if (body.stop_reason === 'max_tokens') throw new Error('응답이 중간에 끊겼습니다.');

  const block = (body.content || []).find((b) => b.type === 'text');
  if (!block) throw new Error('응답에서 값을 읽지 못했습니다.');
  try {
    return JSON.parse(block.text);
  } catch {
    throw new Error('응답을 해석하지 못했습니다.');
  }
}
