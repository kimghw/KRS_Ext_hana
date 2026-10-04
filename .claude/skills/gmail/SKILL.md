---
name: gmail
description: Gmail API 시험 구현(gmail/ 폴더)의 설정·진단·조회. 인자 없으면 세 항목 점검표(클라이언트 정보·구글 동의·Gmail 연결)를 출력하고 다음 할 일을 짚어준다. 구글 콘솔 설정 안내(setup)·클라이언트 JSON 들이기(client)·구글 동의(auth)·메일 찾기(search|trip)·메일 보기(show)·첨부 내려 두기(save)·토큰 지우기(logout). 조작은 전부 gmail/cli.mjs 로 위임한다. TRIGGER when 사용자가 /gmail 호출, Gmail 에서 증빙·영수증·예약 메일을 찾아 달라, Gmail 연결이 풀렸다·다시 동의, 새 PC 에 Gmail 연결. DO NOT TRIGGER when 회사 메일(Outlook) 조회, eclass 쪽지, Teams 송부.
allowed-tools: Bash Read AskUserQuestion
argument-hint: "[status|setup|client [<파일>]|auth [--hint <메일>]|search <검색어>|trip <시작> <끝>|show <id>|save <id>|logout]"
---

# gmail — Gmail API 로 메일 읽기 (시험 구현)

확장과 따로 도는 시험 구현이다(2026-10-04 사용자 지정: "별도 폴더에 일단 구현"). 의존성 없이 Node 만 쓴다.
읽기 전용 범위(`gmail.readonly`)라 메일을 읽어도 읽음 표시가 바뀌지 않는다.

| 파일 | 하는 일 |
|:---|:---|
| `gmail/gmail.mjs` | OAuth(데스크톱 앱 + PKCE)·메일 찾기·읽기·첨부 받기. 디스크·네트워크를 직접 쥐지 않는다(주입) |
| `gmail/loopback.mjs` | 동의 뒤 돌아오는 곳(127.0.0.1 의 빈 포트) |
| `gmail/store.mjs` | 클라이언트 정보·토큰 보관 — **저장소 밖** `%USERPROFILE%\.krs-workspace\gmail` (`KRS_GMAIL_DIR` 로 바꿈) |
| `gmail/cli.mjs` | 명령줄 |
| `gmail/gmail.test.mjs` | 시험(가짜 fetch). `node gmail/gmail.test.mjs` |

호출: `node gmail/cli.mjs <인자>` (저장소 폴더에서)

## 인자 분기 (`$ARGUMENTS`)

| 인자 | 동작 |
|:---|:---|
| (없음) 또는 `status` | 세 항목 점검표 + 다음 할 일. **먼저 이것부터 돌린다** |
| `setup` | 아래 "구글 콘솔 설정"에서 남은 단계를 사용자에게 안내한다 |
| `client [<파일>]` | 구글 콘솔의 "JSON 다운로드"로 받은 파일을 들인다. 파일을 안 주면 내려받기 폴더의 가장 새 `client_secret_….json` |
| `auth [--hint <메일>]` | 동의 화면을 9333 브라우저의 새 탭(안 닿으면 기본 브라우저)에 열고 토큰을 받는다. **"허용"은 사람이 누른다** — 5분 기다린다 |
| `search <검색어> [--max N]` | Gmail 검색어(웹의 검색 칸과 같은 문법)로 찾는다. 줄 끝이 메일 ID |
| `trip <시작> <끝> [검색어]` | 그 기간(YYYY-MM-DD)에 온 메일 |
| `show <id>` | 본문(앞 3000자)과 첨부 목록 |
| `save <id> [<폴더>]` | 본문과 첨부를 파일로(기본 `gmail/out/<id>`, git 에서 뺌) |
| `logout` | 보관한 토큰을 지운다. 구글 쪽 철회는 `myaccount.google.com/permissions` |

## 구글 콘솔 설정 (한 번만)

사용자의 구글 계정(9333 브라우저에 로그인된 계정)에 프로젝트 `krs-workspace-gmail` 이 있다.

| # | 단계 | 상태 (2026-10-04) | 어디서 |
|:--|:---|:---|:---|
| 1 | 프로젝트 만들기 | 됨 (`KRS Workspace Gmail`) | — |
| 2 | Gmail API 사용 설정 | 됨 | — |
| 3 | OAuth 동의 화면 구성(앱 이름 `KRS Mail Reader`, 대상 "외부") | 됨 | — |
| 4 | OAuth 클라이언트 만들기(**데스크톱 앱**) → **JSON 다운로드** | 됨 (사용자가 만듦) | `console.cloud.google.com/auth/clients?project=krs-workspace-gmail` |
| 5 | 테스트 사용자에 본인 계정 넣기("Add users") | 됨 (사용자가 넣음) — 테스트 상태에서는 여기 없는 계정의 동의가 거절된다(`403 access_denied` — 구글이 돌아오지 않아 `auth` 가 5분 기다리다 끝난다) | `console.cloud.google.com/auth/audience?project=krs-workspace-gmail` |
| 6 | 앱 게시(테스트 → **프로덕션**) | **잠겨 있음** — 아래 | 같은 화면의 "앱 게시" |
| 7 | `client` → `auth` → `status` | 됨 (2026-10-04 19:43 동의 — 테스트 상태라 7일 뒤 다시) | 터미널 |

- **4~6 과 동의 화면의 "허용"은 Claude 가 CDP 로 대신 누르지 않는다.** 2026-10-04 에 1~3 은 CDP 로 했지만, 인증 정보 만들기와
  테스트 사용자 넣기(권한을 주는 일)에서 권한 검사가 막았다. 사용자가 직접 누르거나, 사용자가 그 동작을 허용한 뒤에만 한다.
- **"앱 게시"가 잠겨 있다(2026-10-04).** 버튼 아래에 "브랜딩 페이지에서 구성을 완료해야 합니다"가 뜬다. 버튼에 마우스를 올리면 뜨는 글이
  빠진 것을 짚는다: "유효한 앱 이름, 지원 이메일, 홈페이지 URL, 개인정보처리방침 URL이 필요합니다" — 브랜딩(`…/auth/branding`)의
  홈페이지·개인정보처리방침·승인된 도메인 칸이 비어 있다. 개발자 포럼(discuss.google.dev 392229, 2026-08)에는 그 셋을 채워 게시했다는
  답과 채워도 안 열린다는 답이 하나씩 있다(서비스 약관은 비워도 된다고 한다) — 채워 본 적은 없다.
- **게시하지 못하면 인증이 7일마다 풀린다.** 게시 상태가 "테스트"면 동의와 refresh 토큰이 7일 뒤 죽는다(구글 OAuth 문서) — `status` 가
  "인증이 풀렸습니다" 라고 하면 `auth` 를 다시 한다. "프로덕션"이면 6개월 미사용·구글 비밀번호 변경·철회 때만 죽는다.
- 보안 비밀은 만들 때만 보인다 — 4 에서 JSON 을 꼭 내려받는다. 놓쳤으면 클라이언트 화면에서 보안 비밀을 새로 더한다.
- 동의 때 "확인되지 않은 앱" 경고가 뜬다: [고급] → [KRS Mail Reader(으)로 이동] → [계속].
- 동의에서 범위가 거절되면 `…/auth/scopes?project=krs-workspace-gmail`(데이터 액세스)에 `gmail.readonly` 를 더해 본다(겪어 본 것은 아니다).

## 절차

1. **`status`** 를 돌리고 표를 그대로 보인다. 판단은 "다음 할 일"을 따른다.
2. 클라이언트 정보가 `[--]` 면 위 표의 4 를 사용자에게 안내하고, 내려받은 뒤 **`client`**. 동의가 "테스터만" 이라며 거절되면 5 를 안내한다.
3. 구글 동의가 `[--]` 거나 Gmail 연결이 "인증이 풀렸습니다" 면 **`auth`** — 사용자에게 브라우저에서 허용을 눌러 달라고 말하고 돌린다(5분 기다리므로 뒤에서 돌린다).
4. 찾을 때는 **`trip`** 이나 **`search`** 로 목록을 보고, 고른 메일을 **`show`**·**`save`**.

## 함정

- **클라이언트 JSON 과 `token.json` 은 메일함을 읽는 열쇠다.** 저장소 안에 두지 않는다. 내려받기 폴더의 `client_secret_….json` 은 들인 뒤 지워도 된다.
- **다른 PC 로 옮길 때** 는 `client.json` 만 옮기고 `auth` 를 다시 한다 — `token.json` 을 복사하지 않는다.
- 구글 비밀번호를 바꾸면 Gmail 범위의 refresh 토큰이 죽는다 — `status` 가 "인증이 풀렸습니다" 라고 하면 `auth`.
- 국내 영수증 메일은 EUC-KR 본문이 흔하다 — `readMessage` 가 조각의 글자 집합대로 읽는다.
- 본문에만 내용이 있는 메일(예약 확인서)은 `save` 가 `본문.html` 로 내려 둔다. 증빙으로 보내려면 PDF 로 바꾸는 단계가 따로 필요하다(아직 없음).
