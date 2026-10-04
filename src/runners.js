// 예약 종류별 실행자. 회의실과 차량의 조회·예약·취소를 같은 모양으로 감싼다.
//
// 사이트와 말하는 일은 site.js(회의실)·rentcar.js(차량)가 그대로 한다. 여기는 그 둘을 한 모양으로 잇는
// 어댑터일 뿐이고, 사이트 폼의 검사(carform.js)나 취소→재예약의 되돌리기 판단(modify.js)은 옮겨 오지 않는다.
//
// 패널(sidepanel.js)은 **일을 시작할 때 실행자 하나를 집어 그 일이 끝날 때까지 그것만 쓴다.**
// 예전에는 제출은 payload 의 종류로, 취소와 재조회는 그 순간 보고 있는 탭으로 길을 골라서 한 일 안에서도
// 기준이 달랐다. 일이 도는 중에 탭을 옮겨도 다른 종류의 사이트로 새면 안 된다.
//
// 근태는 여기에 없다. 칸을 골라 예약하는 일이 아니라 신청서를 지어 올리는 일이라,
// attend.js(규칙) → hr.js(HR 화면에서 실행) → attendpanel.js(화면)로 따로 나뉘어 있다.

import { LIST_URL, SHELL_URL } from './config.js';
import { loadDay, scanDays, reserve, cancelReservation } from './site.js';
import { loadCarDay, scanCarDays, reserveCar, cancelCarReservation, CAR_LIST_URL, CAR_SHELL_URL } from './rentcar.js';

/**
 * @typedef {object} Runner
 * @property {'room'|'car'} kind
 * @property {string} noun 무엇을 다루는지(문구용)
 * @property {string} pageName 사이트 화면 이름
 * @property {string} listUrl 현황 목록 주소(구조 캡처가 읽는다)
 * @property {string} shellUrl 새 탭으로 여는 사이트 화면
 * @property {string} captureFile 구조 캡처를 저장할 파일 이름
 * @property {boolean} region 지역을 고르는가
 * @property {boolean} extend 맞닿은 내 예약에 이어붙일 수 있는가
 * @property {boolean} staleHandle 담아 둔 삭제 손잡이를 새로 읽은 화면에 써도 되는가
 * @property {(date: string, hours: object, region?: string|null) => Promise<object>} loadDay 하루치 현황(살아 있는 화면)
 * @property {(dates: string[], onProgress: Function, opts?: object) => Promise<any>} scanDays 여러 날 훑기
 * @property {(payload: object, day: object) => Promise<object>} reserve
 * @property {(record: object, day: object) => Promise<object>} cancel
 * @property {(pick: object) => object} payload 고른 칸과 입력칸의 값으로 사이트에 보낼 한 건을 짓는다
 * @property {(input: object) => {field: string, message: string} | null} missing 보내기 전에 비어 있으면 안 되는 칸
 */

/** @type {{room: Runner, car: Runner}} */
export const RUNNERS = {
  room: {
    kind: 'room',
    noun: '회의실',
    pageName: '회의실 예약',
    listUrl: LIST_URL,
    shellUrl: SHELL_URL,
    captureFile: 'meetingroom-capture.txt',
    region: true,
    extend: true,
    // 삭제 손잡이가 예약 번호(DelCheck 의 idx)라, 화면을 다시 읽어도 같은 건을 가리킨다.
    staleHandle: true,
    loadDay: (date, hours, region = null) => loadDay(date, hours, region),
    scanDays,
    reserve: (payload, day) => reserve(payload, day),
    cancel: (record, day) => cancelReservation(record, day),
    payload: ({ row, date, region, start, end, title }) => ({
      kind: 'room',
      room: row.name,
      roomValue: row.value,
      region,
      date,
      start,
      end,
      title,
    }),
    missing: ({ title }) => (title ? null : { field: 'title', message: '회의주제를 입력하세요.' }),
  },

  car: {
    kind: 'car',
    noun: '차량',
    pageName: '차량 이용',
    listUrl: CAR_LIST_URL,
    shellUrl: CAR_SHELL_URL,
    captureFile: 'rentcar-capture.txt',
    region: false,
    // 차량 신청은 행선지가 있어야 하고 여러 날에 걸칠 수 있다. 취소하고 합쳐 다시 넣는 이어붙이기는
    // 되살릴 값(행선지·원래 구간)을 다 알지 못해 지원하지 않는다.
    extend: false,
    // 삭제 손잡이가 **행 자리로 지은 버튼 이름**(RG_MAIN$ctl00$ctl06$…$BTN_DEL)이라, 그 사이 신청이 늘거나
    // 줄면 다른 건을 가리킨다. 새로 읽은 화면에서 다시 찾은 것만 쓴다.
    staleHandle: false,
    loadDay: (date, hours) => loadCarDay(date, hours),
    scanDays: scanCarDays,
    reserve: (payload) => reserveCar(payload),
    cancel: (record, day) => cancelCarReservation(record, day),
    // 차량은 회의주제 대신 **행선지가 필수**이고(사이트의 fnSaveCheck 가 그렇게 막는다),
    // 차량 자체는 폼이 아니라 주소(CARIDX)로 정해진다.
    // 차량은 여러 날에 걸칠 수 있다. 끝이 다른 날이면(근태 폼에서 넘어온 여러 날 출장) endDate 를 같이 보낸다.
    payload: ({ row, date, start, end, endDate, title, place, passenger }) => ({
      kind: 'car',
      car: row.name,
      carValue: row.value,
      room: row.name,          // 진행 표시와 '내가 넣음' 기록이 room 을 본다
      date,
      start,
      end,
      ...(endDate && endDate !== date ? { endDate } : {}),
      title,
      place,
      passenger,
      // 사이트가 예약 버튼에서 막는 차량이면 그 까닭이 따라간다 — 신청(reserveCar)이 보내지 않고 그 말을 한다.
      ...(row.blocked ? { blocked: row.blocked } : {}),
    }),
    // 사이트는 행선지를 요구하고 사용목적은 요구하지 않는다(실제 신청 폼 캡처로 확인). 사이트보다 엄격하게
    // 막으면 사이트에서는 되는 일이 이 확장에서만 안 된다. 폼의 나머지 필수 칸은 carform.js 가 폼을 열어서 본다.
    missing: ({ place }) => (place ? null : { field: 'place', message: '행선지를 입력하세요. 사이트가 반드시 요구합니다.' }),
  },
};

/** 그 종류의 실행자. 예약 종류가 아니면(근태·현황) null 이다 — 짐작으로 회의실에 보내지 않는다. */
export const runnerOf = (kind) => (Object.hasOwn(RUNNERS, kind) ? RUNNERS[kind] : null);
