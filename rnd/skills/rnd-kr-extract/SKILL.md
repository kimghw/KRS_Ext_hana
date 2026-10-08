---
name: rnd-kr-extract
description: 연구개발 과제 입력문서(사업계획서·연구계획서 PDF·HWP(한글)·공문·엑셀)를 공통 작업 루트 RND_PROJECT 로 모아(원본은 _source 로 이동) 포맷별로 장/문서/시트별 md 로 변환한 뒤, 한국선급(KR) 업무 범위만 추출한다. 두 출력 모드 — ① markdown(무손실 발췌·결합본 KR_{과제이름}.md), ② structured(--format structured: KR "연구개발 내용(02장)+예산(08장)"만 YAML/JSON 데이터로 구조화). structured 산출 직후 /rnd-kr-history init 으로 그 차년도 history 에 r0 이력 기준선(budget·researchers·objectives)을 자동 시드(--no-history 로 끔, 이미 있으면 스킵). 무엇을 넣고 뺄지(섹션·필드 포함/제외)는 references/extract_fields.yaml 단일 출처, 값의 모양은 references/structured_output.md. 추출할 KR 업무 15개 항목·대상 장은 profiles/*.yaml 로 계층(장+항목) 설정. 작업 폴더·결합본명은 문서 표지의 과제명을 추출·확인해 짓고, 변환 중간산출물은 정리(삭제)한다. TRIGGER when 사용자가 /rnd-kr-extract 호출, 사업계획서·연구계획서·공문·엑셀·HWP에서 한국선급/KR 업무범위 추출·발췌·구조화(YAML/JSON) 요청, 기관별 발췌 파이프라인 실행. DO NOT TRIGGER when 단순 PDF→md 변환만(→ /pdf2md_by_read), KR 외 기관 발췌, KR-CON 협약 원문 스크래핑(→ scrape-krcon).
when_to_use: 사업계획서·연구계획서 PDF·HWP·공문·엑셀에서 한국선급(KR) 업무범위 추출·발췌, KR 연구개발 내용·예산만 YAML/JSON 구조화, YAML 로 발췌 항목·장 설정, 포함/제외 정책을 references 로 관리, 기관 발췌 파이프라인 실행
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, AskUserQuestion
argument-hint: "[<입력파일: pdf|hwp|공문|xlsx>] [--format markdown|structured] [--json] [--name <과제이름>] [--profile <yaml>] [--md <장별md폴더>] [--stage <차수>] [--no-move] [--keep-intermediate] [--no-history] | items | help"
---

# rnd-kr-extract — 입력문서(사업계획서·HWP·공문·엑셀)에서 한국선급(KR) 업무 범위 추출

연구개발 과제 **입력문서**(사업계획서·연구계획서 PDF · **HWP(한글)** · 공문 · 엑셀)를 **공통 작업 루트 `RND_PROJECT/` 로 모아** → **포맷별로 마크다운으로 변환** → **한국선급(KR) 업무 범위만 추출**한다. 출력은 **두 모드**:

- **markdown 모드**(기본) — KR 업무를 **무손실 발췌** → 장별 파일 + 단일 결합본(`KR_{과제이름}.md`). 어느 장·어느 항목을 뽑을지는 **YAML 프로파일**(`profiles/kr_default.yaml`)로 계층 설정.
- **structured 모드**(`--format structured`) — KR **"연구개발 내용(02장) + 예산(08장)"만 YAML/JSON 데이터**로 구조화(`KR_{과제이름}.yaml`). **무엇을 넣고 뺄지(섹션·필드 포함/제외)는 reference 단일 출처**(`references/extract_fields.yaml`), 값의 모양·예시는 `references/structured_output.md`. 프리셋 프로파일은 `profiles/kr_structured.yaml`.

추출 후 **변환 중간산출물은 정리(삭제)**한다.

> **RND_PROJECT 수집·정리(개정)**: 호출 시 ① 원본 입력을 `RND_PROJECT/_source/` 로 **이동하면서 파일명을 과제명으로 개명(move+rename → `<과제이름>.<확장자>`)**하고 ② 출력물 폴더·파일명을 **문서 표지의 과제명**(추출·확인)으로 짓고 ③ 추출 완료 후 변환 **중간산출물**(`_toc_dump.txt`·`_img_manifest.json` 등)을 **삭제**한다. `RND_PROJECT/` 는 모든 과제가 공통으로 쓰는 cwd 기준 단일 작업 루트이며, 과제별 작업물은 그 안에서 `<과제이름>` 폴더로 격리된다.

> **입력 포맷**: ① 사업계획서/연구계획서(**PDF·HWP**) ② 공문(PDF·HWP·DOCX) ③ 엑셀(.xlsx/.xls). 변환만 포맷별로 다르고(§1단계), 매핑·발췌·구조화·결합 규약은 동일하다. 장 구조가 없는 입력(공문·엑셀)은 "장" 단위가 "문서/시트" 단위로 대체된다. **HWP(한글)** 는 한컴오피스(설치 시) COM 으로 HWP→PDF 변환 후 PDF 경로 재사용(권장)하거나 `pyhwp`(`hwp5html`/`hwp5txt`)로 직접 추출한다(상세 §1단계·`references/structured_output.md`).

> 근거 절차: [spec_pdf_기관별_발췌_파이프라인.md](../../../spec/spec_pdf_기관별_발췌_파이프라인.md). 본 스킬은 그 파이프라인을 KR 전용으로 정형화하고 YAML 설정화한 것이다. 첫 적용 사례: [SSCB_1차년도_KR.md](../../../sscb/SSCB_1차년도_KR.md).

## 핵심 원칙

- **공통 루트 수집 + 과제명 네이밍 + 정리**: 모든 산출물은 cwd 기준 공통 루트 `RND_PROJECT/` 아래에 둔다. 원본 입력은 `RND_PROJECT/_source/` 로 **이동하며 파일명을 과제명으로 개명**(`<과제이름>.<확장자>`)하고, 작업 폴더·결합본명은 **문서 표지에서 추출·확인한 과제명**으로 짓는다. 추출·검증이 끝나면 변환 **중간산출물만** 삭제한다(변환본·발췌본·원본·이력은 보존).
- **무손실(lossless)**: 원문 표·수치·오타·취소선까지 그대로. 요약·의역·페이지마크·합계 신규생성 금지.
- **전체 변환 먼저, 발췌는 YAML 로**: 입력 문서는 **전체(모든 장/문서/시트)를 무손실 md 로 먼저 변환**한다 — KR 관련 장만 부분 변환하지 않는다(06장 연구실 안전관리비처럼 교차 장 항목 누락 방지). 그 다음 **YAML 프로파일이 가리키는 장·항목만** 발췌·구조화한다. 즉 **변환=전체, 발췌=YAML 기준**.
- **포맷별 변환, 발췌단위 1파일**: PDF(사업계획서·공문)는 `/pdf2md_by_read` 규약(아웃라인→목차→20p 폴백), 엑셀은 시트별 마크다운 표 변환. 어느 경우든 **장/문서/시트별 1파일**로 저장한다(파일=발췌단위=에이전트 단위가 되도록).
- **발췌는 전체 읽기 금지**: 큰 md 통째 Read 금지. **Grep 으로 줄번호 → 해당 구간만 Read(≤250행) → 작은 Write**.
- **파일 1개 = 에이전트 1개 병렬**: 동일 출력 파일을 여러 에이전트가 동시에 쓰지 않는다(무거운 장은 part 분할 후 병합).
- **YAML 단일 설정 출처**: 추출 대상·장·출력 형식은 프로파일 1곳에서만 결정한다. 본문 임의 가감 금지.
- **구조화는 reference 가 정책**: `--format structured` 의 "무엇을 넣고 뺄지"(섹션·필드 포함/제외)는 `references/extract_fields.yaml` **한 곳**에서만 정한다. 값의 키 구조(스키마)는 `references/structured_output.md`. 구조화본은 장별 무손실 발췌본을 **값으로 정규화(수치화)**한 파생물 — 모든 값은 발췌본 셀로 역추적된다.
- **KR 전용**: 추출 주체는 한국선급으로 고정. `target.aliases`/`block_markers` 로 검색어만 조정.

## 파이프라인

**입력 판별(포맷) → 수집(원본 → `RND_PROJECT/_source` 이동) → 과제명 확정(표지 추출·확인) → 전체 변환(문서의 모든 장/문서/시트를 장별 md 로 무손실 변환) → 매핑(어디에 있나) → 발췌(YAML 이 가리키는 장·KR 만) → [출력 모드 분기] → [structured: r0 이력 init 자동(`/rnd-kr-history init`, `--no-history` 로 끔)] → 정리(중간산출물 삭제) → 검증·보고 → [이후 rev 적재는 `/rnd-kr-history`]**

> **출력 모드 분기**(`output.format`):
>
> - **markdown** → 선별(전체본/발췌 혼합) → 결합(단일 파일 `KR_{과제이름}.md`).
> - **structured** → 구조화(발췌본 02·08장을 `references/extract_fields.yaml` 정책대로 YAML/JSON 으로 정규화 → `KR_{과제이름}.yaml`). §구조화 추출.
>
> 수집은 `options.move_source` 일 때만(기본 on; `--no-move` 로 끔). 정리는 `options.cleanup_intermediate` 일 때만(기본 on; `--keep-intermediate` 로 끔). **structured 스냅샷 직후 r0 이력 기준선 init 은 자동 트리거(`/rnd-kr-history init`, `--no-history` 로 끔); 이후 rev(변경) 적재·diff·뷰는 [`/rnd-kr-history`](../rnd-kr-history/SKILL.md) 소관(§6·§이력 관리).**

## 인자 분기 (`$ARGUMENTS`)

| 인자 | 동작 |
|:---|:---|
| (없음) | `AskUserQuestion` 으로 입력 파일 경로·프로파일·출력 모드·차수를 수집한 뒤 진행. |
| `<입력파일>` | 그 입력(사업계획서 PDF·HWP·공문·엑셀)으로 파이프라인 실행. 확장자로 포맷 판별(.pdf→pdf2md, **.hwp/.hwpx→HWP 변환(§1)**, .xlsx/.xls→시트 변환, 공문은 PDF면 동일). 프로파일 미지정 시 `kr_default.yaml`. |
| `--format markdown\|structured` | 출력 모드. `markdown`(기본)=무손실 발췌·결합본. `structured`=KR 연구개발 내용·예산을 YAML/JSON 으로 구조화(프로파일 `output.format` 보다 우선). `structured` 지정 시 프로파일 미지정이면 `kr_structured.yaml`. |
| `--json` | 구조화 출력을 JSON 으로도 생성(`structured.format: both` 와 동치). YAML 정본 + JSON 사본. |
| `--no-history` | structured 산출 후 **자동 r0 init 생략**(스냅샷만 만들고 `/rnd-kr-history init` 안 함). 기본은 init 수행(이미 history 있으면 자동 스킵). markdown 모드엔 무관. |
| `--profile <yaml>` | 사용할 추출 프로파일 지정. 없으면 스킬 기본 `profiles/kr_default.yaml`(structured 모드는 `kr_structured.yaml`). |
| `--md <폴더>` | **이미 변환된 장별 md 폴더**를 입력으로 받아 1단계(변환) 생략. |
| `--name <과제이름>` | 과제 이름을 직접 지정(표지 추출·확인 생략). 작업 폴더·결합본명 `KR_{과제이름}.md` 에 사용. |
| `--stage <차수>` | 차수/연차 라벨(예: `1차년도`)을 직접 지정(미지정 시 질의). |
| `--no-move` | 원본 입력을 `RND_PROJECT/_source` 로 이동하지 않고 현 위치에서 변환(`move_source` 무시). |
| `--keep-intermediate` | 변환 중간산출물 삭제(정리) 단계를 건너뜀(`cleanup_intermediate` 무시). |
| `items` / `show-items` | 추출 가능한 15개 KR 항목과 소속 장을 출력하고 종료(아래 매핑 표). |
| `help` / `-h` | 본 문서 요약을 출력하고 종료. |

## 표준 장 ↔ KR 항목 매핑 (계층 구조의 뼈대)

국가연구개발 표준 사업계획서 기준(SSCB 사례로 검증). 실제 PDF 의 장 제목은 키워드로 매칭한다(번호·별첨 순번은 문서마다 다를 수 있음).

> **장 구조가 없는 입력**(공문·엑셀)은 이 표를 강제하지 않는다. 문서/시트에서 KR 관련 내용을 직접 식별해 같은 **항목 키**(`budget`·`schedule`·`researchers` 등)로 분류하고, 매핑·발췌·결합은 동일한 규약을 따른다. 예: 예산 엑셀 → `budget`, 일정 공문 → `schedule`.

| 표준 장 | 장 제목(키워드) | 소속 KR 항목 키 |
|:---:|:---|:---|
| 00 | 개요 | `org_status` |
| 01 | 필요성 | (없음 — KR 보통 무관) |
| **02** | **목표 및 내용** | `objectives`, `perf_targets`, `outcome_kpi`, `schedule`, `deliverables` |
| 03 | 추진전략·방법·추진체계 | `org_chart` |
| 04 | 활용방안·기대효과 | `utilization` |
| 05 | 사업화 전략·계획 | `certification` |
| 06 | 안전·보안조치 이행계획 | `safety_security` |
| 07 | 연구개발기관 현황 | `researchers`, `facilities`, `org_status` |
| **08** | **연구개발비 사용계획** | `budget` |
| 별첨 | 외주용역 활용계획서 | `outsourcing` |
| 별첨 | 평가의견 수정·보완 대비표 | `eval_response` |

### KR 항목별 식별 단서 (발췌 위치 잡기)

| 키 | 항목 | 식별 단서(헤딩 경로 / 마커) |
|:---|:---|:---|
| `org_status` | 기관 지위·일반현황·협약 등재 | 공동연구개발기관 표의 KR 행 / `7-3 일반현황` / 협약 서명란(기관장) |
| `objectives` | 연차별 개발목표·개발내용(R&R) | `2-2 (N)차년도 > ① 개발목표 / ② 개발내용` 아래 `[공동연구개발기관2(한국선급)]` 블록 |
| `perf_targets` | 성능·정량목표 지표 | `2-1 성능 목표표` 및 `정량목표 평가방법` 의 `[한국선급]` 행 |
| `outcome_kpi` | 성과지표(논문 등) | `2-1 성과지표 [공동연구개발기관2(한국선급)]` 표 |
| `schedule` | 수행일정(연차별) | `2-3 수행일정` 종합/연차 표의 `KR 한국선급` 행 |
| `deliverables` | 주요 결과물 | `2-3 주요 결과물` 의 `(한국선급)` 표기 행 |
| `org_chart` | 추진체계·편성도·역할 | `3장` 기술개발팀 편성도 / 추진방법 중 KR 단계 |
| `utilization` | 활용방안·기대효과 | `4장` KR 형식승인 언급(대개 단순언급) |
| `certification` | 사업화·보유 인증기준 | `5-2` 인증기준 — 한국선급 보유 체계·발행 기준 |
| `safety_security` | 안전·보안조치 | `6-1`/`6-2` 의 `[한국선급]` 블록(규정·점검주기·사고처리) |
| `researchers` | 책임자·참여연구원 | `7-1` 책임자 / 참여연구자 명단(계상률·기간) |
| `facilities` | 시설·장비 | `7-2` 시설·장비 — 한국선급 보유분 |
| `budget` | 연구개발비 | `8-1`/`8-2`/`8-3` 한국선급 표(지원·부담, 비목, 세부) |
| `outsourcing` | 외주용역 | 별첨 외주용역 — 한국선급 **발주** 건 |
| `eval_response` | 평가의견 대비표 | 별첨 대비표 — `선급` 관련 평가의견·수정보완 |

> `org_status` 는 00·07 양쪽에 걸친다. 계획상 두 장 모두 대상이면 각 장 발췌본에 해당 부분만 넣는다.

## 프로파일(YAML) 스키마 요약

전체·주석은 [profiles/kr_default.yaml](profiles/kr_default.yaml)(markdown) · [profiles/kr_structured.yaml](profiles/kr_structured.yaml)(structured) 참조. Claude 는 이 YAML 을 **직접 읽어** 계획을 세운다.

- `target` — KR 식별자(name/abbr/aliases/block_markers). KR 고정, 검색어만 조정.
- `extract.<키>: true|false` — 위 15개 항목 on/off (**계층 하위**). structured 모드에선 "어느 장을 발췌 입력으로 쓸지"(02·08) 결정.
- `chapters.include` — `auto`(=extract 가 가리키는 장만) 또는 명시 리스트. `exclude`(강제 제외), `context_full`(발췌 대신 전체본으로 둘 장).
- `output` — `per_chapter`/`combined`/`base_dir`/`project_abbr`/`project_name`/`stage`/`combined_name`(기본 `KR_{과제이름}.md`) + **`format`**(`markdown`|`structured`).
- `output.structured`(structured 모드) — `format`(`yaml`|`json`|`both`)/`fields_policy`(포함·제외 SSOT)/`schema_doc`/`sections`/`out_name`(기본 `KR_{과제이름}.yaml`).
- 이력(`history` 블록·rev·track)은 이 프로파일에서 제거됨 — 전담 스킬 [`/rnd-kr-history`](../rnd-kr-history/SKILL.md) 소관(§이력 관리).
- `options` — `lossless`/`reuse_md_cache`/`read_max_pages`/`emit_analysis_memo`.

### references (구조화 정책·스키마)

| 파일 | 역할 |
|:---|:---|
| [references/extract_fields.yaml](references/extract_fields.yaml) | **무엇을 넣고 뺄지(SSOT)** — 섹션·필드 on/off, include/exclude, 옵션(0원 행·개인급여 마스킹). 구조화 추출은 이 파일만 보고 결정 |
| [references/structured_output.md](references/structured_output.md) | **값의 모양(스키마)·예시** — 최상위/블록별 키 구조, 이력 연계(매칭) → `/rnd-kr-history`, HWP 입력·YAML/JSON 노트 |

## 절차

### 0. 입력·프로파일 확정

1. `$ARGUMENTS` 를 §인자 분기로 해석. `items`/`help` 면 해당 출력 후 종료.
2. **출력 모드 확정**: `--format` 값 > 프로파일 `output.format` > 질의(§AskUserQuestion). `markdown`(기본) 또는 `structured`.
3. **프로파일 로드**: `--profile` 지정값, 없으면 모드별 기본 — markdown=`${CLAUDE_SKILL_DIR}/profiles/kr_default.yaml`, structured=`${CLAUDE_SKILL_DIR}/profiles/kr_structured.yaml` 을 Read. structured 면 `output.structured.fields_policy`(`references/extract_fields.yaml`)·`schema_doc`(`references/structured_output.md`)도 함께 Read.
4. **부족 입력 질의**(§AskUserQuestion):
   - 입력 파일 경로(사업계획서 PDF·HWP·공문·엑셀, 또는 `--md` 폴더)가 없으면 묻는다. **확장자로 포맷을 판별**(.pdf / .hwp·.hwpx / .xlsx·.xls / .docx)하고 `test -f`/`test -d` 로 존재 확인. **HWP 면 변환 경로(§1)**를 정한다.
   - **차년도(`output.stage`) 산출 — 현재 날짜 기준 우선, 협약일·당해연도로 교차확인**: 표지에서 **연차별 연구개발기간**(전체 + 1~4차년도 각 기간)을 추출한 뒤 **두 연차를 모두 계산**한다 — ① **오늘(currentDate)이 속하는 연차**(= 진행 중 과제의 운영상 현재 차수) ② **문서 기준 연차**(표지 "당해연도 개발기간" 표기 + 협약/서명일 + 가능하면 PDF 메타데이터 출력일이 속하는 연차). **둘이 같으면** 그대로 `output.stage` 로 쓴다. **다르면 반드시 §AskUserQuestion 으로 확인**하되, **진행 중 과제는 ① 현재 날짜 기준 연차를 기본 권장**한다 — 협약용/제출본 PDF 는 원본 연차 표기(당해연도·협약일)를 그대로 둔 채 현재 차수에 제출·활용되는 경우가 많아, 폴더는 운영 중인 현재 차수로 두는 것이 보통이다. (예: 2024.07 협약·당해연도 "1단계 1년차"로 표기된 `[2세부]` 협약용 계획서를 **2026.06 에 PDF 출력**해 처리하면 — 문서 기준은 1차년도지만 **오늘 기준은 3차년도**가 맞다. PDF 출력일·currentDate 를 함께 보라.) 사용자가 **협약 baseline 보관**을 원하면 ② 문서 기준 연차를 쓴다. 이 값이 작업 폴더 계층 **`RND_PROJECT\<과제이름>\<차년도>\`** 를 만든다(그 안에 `original\`·`<과제이름>_KR\`·`KR_*.yaml`). 협약일·연차표가 없는 입력(공문·엑셀)은 질의하거나 비워 둘 수 있다. **후속 연차 선행 추출**(같은 협약 문서로 다음 차년도를 미리 뽑는 경우, 예: SSCB 2차년도)은 `--stage <차년도>` 로 차년도를 지정하고 직전 연차 `original\` 변환본을 재사용할 수 있으며, 결과 스냅샷은 **그 차년도 행만** 담는다(§5′ 3-b).
   - `output.project_name`(과제 이름; **명확한 과제명**)이 비어 있고 `--name` 도 없으면 **문서 표지/제목 페이지의 과제명을 추출**해 제안한다(입력 PDF 1쪽 또는 변환본 첫 장의 `사업명/과제명/연구개발과제명` 라벨, 없으면 표지 제목줄). 입력 파일명 stem(예: `계쏙허2`)은 지저분할 수 있으므로 **표지 과제명을 우선**한다. 제안값을 §AskUserQuestion 으로 사용자에게 확인받아 확정한다. 공백·특수문자는 폴더·파일명에서 `_` 로 정규화. **작업 폴더 `RND_PROJECT/<과제이름>/` 과 결합본 `KR_{과제이름}.md`(또는 구조화본 `.yaml`)** 에 쓰인다.
   - `output.project_abbr` 가 비어 있으면 과제 이름의 약어에서 유도하고 사용자에게 확인(이력 등 참조용; **`base_dir` 는 `RND_PROJECT` 로 고정**이라 더 이상 base_dir 에 쓰지 않는다).
5. **수집(원본 이동)** — `options.move_source`(기본 on, `--no-move` 면 생략): `<cwd>\<output.base_dir>\<output.source_dir>\`(기본 `RND_PROJECT\_source\`)를 만들고 입력 파일(PDF·HWP·공문·엑셀)을 그 폴더로 **이동(move)하면서 파일명을 `{project_name}.<원래확장자>` 로 개명**한다(과제명은 0.4 에서 확정한 값; 공백·특수문자는 `_` 로 정규화). 이후 변환은 이동·개명된 경로를 입력으로 삼는다. `--md <폴더>`(이미 변환된 md) 입력이면 이 단계는 생략. 개명 결과 동명 파일이 `_source` 에 이미 있으면 덮어쓰기 전 확인(§AskUserQuestion).
6. **변환 범위 = 전체 / 발췌 계획 = YAML**: 1단계 변환은 **문서 전체(모든 장)**를 대상으로 한다(아래 발췌 계획과 무관하게 전 장 변환 — 교차 장 항목 누락 방지). 이어 **발췌 계획**만 YAML 로 산출: `extract` 가 true 인 항목 → §매핑 표로 소속 장 집합 도출 → `chapters.exclude` 제거 → **발췌 대상 장** 확정. 각 발췌 대상 장에 대해 "그 장에서 뽑을 항목 + 식별 단서" 목록을 만든다. **항목이 하나도 없는 장은 발췌 대상에서만 제외(전체 변환본은 보존).** 단 `chapters.context_full` 에 든 장은 `extract` 항목이 없어도(또는 `auto` 가 안 가리켜도) 발췌 대상에 합류시키되, 발췌 없이 **전체본**으로 표시한다(markdown 모드 4단계에서 변환본으로 채움). **structured 모드**는 02(연구개발내용)·08(예산) 발췌본을 구조화 입력으로 잡고, `예산.연구실안전관리비` 가 켜져 있으면 06장(안전관리비 계상) 발췌본도 함께 입력으로 잡는다(§5′).
7. 계획을 사용자에게 요약 보고(작업 루트 **`RND_PROJECT\<과제이름>\<차년도>\`**(현재 날짜 기준 산출 차년도; 문서 기준과 다르면 0.4 에서 확인), 대상 장 N개, 장별 항목, 전체본 장, **출력 모드**(markdown/structured), 출력 파일명 `KR_{과제이름}.md` 또는 `KR_{과제이름}.yaml`).

### 1. 입력 → 장/문서/시트별 md **전체** 변환 (포맷별 · 모든 장)

> **경로 약어**(이하 공통): `base_dir` = `RND_PROJECT`(cwd 기준 공통 루트) · `source_dir` = `RND_PROJECT\_source`(이동된 원본) · **`stage_dir`** = `RND_PROJECT\<과제이름>\<차년도>`(**차년도별 작업 루트** — `<차년도>` = `output.stage`, **현재 날짜 기준 산출·협약일 교차확인**; §0) · **`work_dir`** = `stage_dir\original`(장별 **전체** 변환본 + `images\`) · **`extract_dir`** = `stage_dir\<과제이름>_KR`(장별 KR 발췌본) · 결합본/구조화본 = `stage_dir\KR_<과제이름>.md`/`.yaml` · 이력 = `stage_dir\history`. `<과제이름>` = `output.work_subdir`(기본 `{project_name}`), `<차년도>` = `output.stage` 치환값. **모든 과제 산출물은 `<과제이름>\<차년도>\` 안에 격리**한다(협약 차수가 바뀌면 새 차년도 폴더).

- `options.reuse_md_cache` 이고 `work_dir` 에 변환 md 가 이미 있으면 **변환 생략**(캐시 재사용). `--md <폴더>` 지정 시도 동일.
- 아니면 **입력 포맷별로 문서 전체(모든 장/문서/시트)를** 변환하되, 어느 경우든 **발췌 단위(장/문서/시트)별 1파일**로 `work_dir\NN_<제목>.md` 에 저장한다(단일 병합본 대신 분리). **KR 관련 장만 골라 변환하지 않는다** — 전 장을 변환해 두어야 YAML 이 어느 장을 가리켜도(예: 06장 연구실 안전관리비) 발췌가 가능하다. 장 수가 많거나 한 장이 20p 초과면 `/pdf2md_by_read` 규약대로 **장 1개 = 에이전트 1개(또는 20p 청크) 병렬** 변환한다.
  - **사업계획서·공문(PDF)** → `/pdf2md_by_read "<PDF>"` 규약(아웃라인→목차→20p 폴백). 장별 1파일. 공문처럼 장 구조가 없으면 **문서 1개 = 파일 1개**(길면 페이지 단위로 분할).
  - **HWP(한글, .hwp)** → 표 보존이 관건이라 다음 우선순위로:
    1. **한컴오피스 설치 시 COM 으로 HWP→PDF 변환** 후 위 PDF 경로(`/pdf2md_by_read`) 재사용 — 표·레이아웃 보존 가장 우수. PowerShell: `$h=New-Object -ComObject HWPFrame.HwpObject; $h.Open("<hwp>"); $h.SaveAs("<pdf>","PDF"); $h.Quit()`(보안 모듈 승인 필요할 수 있음). 한컴 설치 경로 예: `C:\Program Files (x86)\Hnc\Office 2020`.
    2. **`pyhwp`**(`pip install pyhwp`) → `hwp5html --output <dir> "<hwp>"`(표를 HTML 표로 보존) 후 HTML→md, 또는 `hwp5txt`(텍스트만, 표 깨질 수 있음).
    3. 위가 모두 불가하면 사용자에게 **PDF 로 재공급** 요청(보고에 명시). 변환 후 PDF 와 동일하게 장별 1파일.
  - **HWPX(.hwpx)** → OOXML(zip) 계열. 한컴 COM 으로 PDF 변환(권장) 또는 zip 해제 후 `Contents/section*.xml` 파싱. 안 되면 PDF 재공급 요청.
  - **엑셀(.xlsx/.xls)** → **시트별 1파일**로 변환. 각 시트를 마크다운 표로(머지셀 펼침, 숨김행·빈 행 포함 원형 유지). 도구는 환경에 맞게 — python `openpyxl`/`pandas` 또는 PowerShell `Import-Excel`/Excel COM. 파일명·제목은 `NN_<시트명>.md`.
  - **공문(DOCX 등 비PDF·비HWP)** → `pandoc "<file>.docx" -t gfm`(표 GFM 보존) 등으로 추출해 단일 md. 변환 불가 포맷이면 사용자에게 PDF/엑셀로 재공급을 요청.
  - Read 1회 ≤ `options.read_max_pages`(기본 4p). 표 밀집 장/시트(연구비 등)는 단일배치 에이전트로.
  - 무손실: 요약·의역·페이지마크 금지, 표는 마크다운/HTML 그대로. 각 파일 상단 `<!-- markdownlint-disable MD033 -->`.
  - **이미지 추출(임베디드) + 링크**: 변환과 함께 **PDF 에 포함된 이미지(그림·사진·도식 raster)를 추출**해 `work_dir\images\`(= `…\<차년도>\original\images\`)에 저장하고, 각 장 md 의 `[그림: 캡션]` 자리를 마크다운 이미지 링크 `![캡션](images/<파일>)` 로 바꾼다. ★**PDF 페이지 전체를 렌더링하지 말 것**★ — `pymupdf(fitz)` `page.get_images()` 로 **임베디드 이미지를 뽑아 적절한 것만** 저장한다. 필터: ① 최소 크기(가로·세로 ≥ ~100px) ② **여러 페이지에 반복되는 장식 이미지(로고·머리말·서명 스탬프) 제외** ③ 초소형·극단 비율(구분선) 제외 ④ 동일 이미지(xref) 중복 저장 금지. 페이지별로 추출 이미지와 그 페이지 `[그림:]` 캡션을 **순서대로 1:1 대응**(이미지가 부족하면 남는 캡션은 텍스트로 둔다). 벡터 도식이라 임베디드 이미지가 없는 페이지는 `[그림: 캡션]` 텍스트로 두고 페이지 렌더로 대체하지 않는다. 파일명 예: `p{절대페이지:03d}_{n}.png`.

### 2. KR 매핑 (어느 장에 무엇이 있나)

- 기존 분석 메모(`interactive\<target.name>_챕터별_내용_분석.md`)가 있으면 **재사용**.
- 없고 `options.emit_analysis_memo` 면, **전체 변환본을** 멀티에이전트로 매핑(전 장 스캔 — KR 이 어느 장에 있는지 빠짐없이 찾는다):
  > `work_dir` 의 전체 장 md 각각에 에이전트 1개씩 붙여 "한국선급"(`target.aliases`) 관련 내용만 분석. 각 지점마다 ① 헤딩 경로 ② 유형(수행배정/단순언급) ③ 핵심 수치 요약. 없으면 "없음". 결과를 `interactive\<target.name>_챕터별_내용_분석.md` 로 종합.
- 매핑 결과로 0단계에서 세운 추출 계획의 장×항목을 검증(누락·오배치 보정).

### 3. KR 발췌 (멀티에이전트, 장 1개 = 에이전트 1개)

각 대상 장마다 에이전트 1개를 **단일 메시지에서 병렬** 기동. 프롬프트 골자:

> 원본 `work_dir\<장>.md` 에서 **한국선급(KR)** 내용만, **그중에서도 다음 항목만** 무손실 그대로 발췌해 `extract_dir\<장>.md` 로 저장:
> `{이 장의 선택된 항목 + 식별 단서}`.
> ★원본 전체를 한 번에 읽지 말 것★ — **Grep 으로 위치를 먼저 찾고(검색어: `target.aliases`/`block_markers`) 해당 구간만 Read(≤250행)**. 각 블록 위에 상위 헤딩 경로 1줄. 요약·의역·수치변경·타 기관 내용 포함 금지. 상단 `<!-- markdownlint-disable MD033 -->`, 제목·출처 1줄.

- 표가 밀집한 장(예: `budget`)은 part 로 쪼개 각 에이전트가 part 파일 작성 → PowerShell 로 병합 후 part 삭제.

> **`output.format` 에 따라 4·5 단계가 갈린다**: `markdown` 이면 아래 4(선별)·5(결합)를, `structured` 이면 4·5 대신 **5′(구조화)**를 수행한다. 둘 다 §3 발췌본(`extract_dir`)을 입력으로 쓴다(발췌본 = 무손실 정본).

### 4. 선별 (전체본/발췌 혼합) — `output.format: markdown`

- `chapters.context_full` 에 든 장(예: `00`)은 발췌본 대신 **전체본**(1단계 변환본)으로 교체.
- `output.per_chapter: false` 면 장별 발췌본은 최종 결합 후 임시로 간주(삭제).
- 원본 `work_dir` 는 보존(재발췌 대비).

### 5. 결합 (단일 파일) — `output.format: markdown`

- `output.combined` 이면 발췌본을 번호순으로 `---` 구분선으로 묶어 **과제 폴더(`work_dir`) 안**(`RND_PROJECT\<과제이름>\KR_<과제이름>.md`)에 저장. 상단에 제목·출처 1회, `markdownlint-disable` 은 맨 위 1개로 정리. 결합본·발췌본·이력을 과제 폴더 한곳에 모아 과제별 산출물을 자기완결적으로 둔다.
- 결합 파일명 = `output.combined_name` 템플릿 치환(`{project_name}`, `{target_abbr}`, `{project_abbr}`, `{stage}`). 기본값은 `KR_{project_name}.md`(= `KR_{과제이름}.md`). 과제 이름의 공백·특수문자는 `_` 로 정규화한다.
- 동명 파일이 이미 있으면 **덮어쓰기 전 사용자 확인**(§AskUserQuestion).

### 5′. 구조화 (YAML/JSON) — `output.format: structured`

발췌본(02·08장)을 `references/extract_fields.yaml` 정책대로 **데이터로 정규화**해 `RND_PROJECT\<과제이름>\<차년도>\KR_<과제이름>.yaml`(당해 차년도 행만) 로 저장한다. 상세 규약·스키마·예시는 **§구조화 추출** 및 `references/structured_output.md`. 골자:

1. **정책·스키마 로드**: `output.structured.fields_policy`(기본 `references/extract_fields.yaml`)와 `schema_doc`(`references/structured_output.md`)를 Read. `enable`/`fields.<키>` 가 켜진 섹션·블록만 대상.
2. **섹션별 1에이전트 병렬**(섹션 1개 = 에이전트 1개; `연구개발내용`·`예산`):
   > 입력은 해당 KR 발췌본(`extract_dir\02_*.md`→연구개발내용, `extract_dir\08_*.md`→예산, 그리고 `예산.연구실안전관리비` 가 켜져 있으면 `extract_dir\06_*.md`→연구실 안전관리비 계상근거·용도 + 08장 간접비세부의 금액). 정책의 `include` 만, `exclude` 는 빼고, **스키마(§structured_output) 키 구조 그대로** 값을 채운다. **연차는 키이되 당해 차년도(`output.stage`) 행만**(타 연차 계획값은 넣지 않는다 — 뒤 3-b 슬라이서가 재검증), 금액은 **수치 타입**(쉼표·`천원` 제거), 판독 불가·해당없음은 `null`. 그림 캡션·타 기관 행 제외. 결과를 섹션별 YAML 조각으로 반환.
3. **병합·저장**: `meta` + 섹션 조각을 합쳐 `KR_<과제이름>.yaml` 로 Write. **`meta.표지`**(`extract_fields.yaml` 의 `meta.표지.enable: true` 일 때)는 KR 발췌본이 아니라 **전체 변환본 `work_dir\00_*.md`(표지·요약문)** 를 직접 읽어 과제 식별정보(중앙행정기관·전문기관·사업명·과제번호·주관기관·총연구개발비 합계·KR 행)를 채운다 — KR-only 예외 블록(§structured_output `meta.표지`). `총연구개발비` 는 전 기관 합산이라 `예산.지원부담`(KR 한정)과 다른 값이니 혼동 금지. **파일 맨 앞(첫 줄)에 연차 최초 마커 주석 `# [<차년도> 최초]`**(차년도 = `output.stage`, 예: `# [1차년도 최초]`)를 둔다 — 이 구조화본이 그 **연차의 최초(r0) 기준선 스냅샷**임을 표시(기존 헤더 주석 위). 재추출로 스냅샷을 다시 만들어도 이 스킬 산출은 늘 그 연차 baseline 이라 마커는 `최초` 로 유지(변경 이력은 `/rnd-kr-history` 소관). `structured.format: json`/`both` 또는 `--json` 이면 YAML 정본을 파싱해 `KR_<과제이름>.json` 도 생성(`python -c "import yaml,json; ..."`; 정본은 YAML, 손으로 두 번 쓰지 않음; **JSON 사본엔 주석이 없어 마커는 YAML 정본에만**).
3-b. **차년도 슬라이스·검증(결정론, 2026-10-06~)**: 저장 직후 `python ${CLAUDE_SKILL_DIR}/scripts/year_slice.py <stage_dir>\KR_<과제이름>.yaml --year <차년도>` 로 **타 연차 항목을 잘라낸다**(`연차: X` 블록/한 줄 항목, 성능목표·성과지표의 `{연차: 값}` 맵 키 — YAML 주석 보존, 결과를 데이터 수준 필터와 교차검증해 다르면 쓰지 않음). 이어 `--check` 로 **타 연차 잔존 0건**을 확인한다(exit 2 면 중단·보고). 리스트 항목이 전부 타 연차였으면 `키: []` 로 남고, **당해 연차분이 원문에 없는 블록**(예: 후속 연차 개인별 인건비)은 **명시적 빈 블록**(`- 연차: <차년도>` · `참여자: []` · `소계: null` + 원문 미수록 주석)으로 둔다(블록 부재로 하류 도구가 다른 블록을 오선택하지 않게). `meta`(연차범위·연차별기간·표지)는 과제 식별정보라 그대로 두고 `meta.차년도` 는 보장한다. 상세 → §차년도 슬라이스.
4. **추적성 검증**: 모든 값이 발췌본 셀에 존재하는지(합계 신규생성·수치 변형 없음) 표본 대조. 미수록·판독불가는 보고. **이력 추적용 필드(`예산.비목별`·`예산.외주용역`·`예산.참여연구자인건비`·`연구개발내용.성능목표`)가 모두 채워졌는지** 매칭 점검(§"이력 연계(매칭)").
5. 동명 파일 존재 시 덮어쓰기 전 사용자 확인(§AskUserQuestion).
6. **이력 r0 init 자동**: 스냅샷 생성 직후, `--no-history` 가 아니면 **`/rnd-kr-history init --project <과제이름> --year <차년도>`** 를 이어서 수행해 그 차년도 `stage_dir\history\` 에 **r0 기준선(budget·researchers·objectives, 그 차년도 분)** 을 시드한다. **idempotent** — `history\` 가 이미 있으면 "이미 초기화됨" 보고 후 스킵(재추출이 r0 를 덮어쓰지 않음). init 로직·스키마는 `/rnd-kr-history` 소관. 이후 rev(변경) 적재는 `/rnd-kr-history`(변경비교 YAML 등)로 누적.

### 6. 이력 — r0 init 은 자동, 이후 rev 는 `/rnd-kr-history`

**structured 산출 직후 r0 기준선 init 은 이 스킬이 자동 트리거**(§5′-6, `--no-history` 로 끔)한다. **이후 rev(변경) 적재·diff·뷰 갱신은 전담 스킬 [`/rnd-kr-history`](../rnd-kr-history/SKILL.md)** 가 한다(구조화 스냅샷·변경비교 YAML 입력).

- **자동 init(r0)**: structured(§5′) 산출 직후 `/rnd-kr-history init --project <과제이름> --year <차년도>` 수행 — 그 차년도 `history\` 에 스냅샷의 budget·researchers·objectives 를 **r0(최초 기준선)** 로 시드(없을 때만; 이미 있으면 스킵). **markdown 모드는 스냅샷이 없어 init 안 함.**
- **이후 rev**: 변경이 생기면 `/rnd-kr-history` 로 적재(예: `rnd-manpower-change` 의 변경비교 YAML 로 r1+ 누적). **재추출(스냅샷 갱신)만으로 rev 가 자동 적재되진 않는다**(이력=델타, `/rnd-kr-history` 소관). 이미 history 가 있으면 init 은 스킵하므로 재추출이 r0 를 덮어쓰지 않는다.
- **매칭 보장**: 스냅샷이 `/rnd-kr-history` 의 `track`(budget·researchers·objectives)을 충족하도록, `references/extract_fields.yaml` 의 `예산.비목별`·`예산.외주용역`·`예산.참여연구자인건비`·`연구개발내용.성능목표` 를 **켜 둔다**(매칭 표 §"이력 연계(매칭)").
- 값의 정본은 발췌본·스냅샷이다. 값을 직접 고쳐야 하면 스냅샷부터 갱신(재실행)하고, 이력엔 델타만 남긴다(`/rnd-kr-history` 가 처리).

### 7. 정리 (중간산출물 삭제) — `options.cleanup_intermediate` 일 때만

발췌·결합(이력까지)이 **성공한 뒤에만** 변환 과정의 중간산출물을 삭제한다(실패 시 디버깅 위해 보존; `--keep-intermediate` 면 생략).

1. **삭제 대상**: `options.intermediate_globs` 의 패턴(기본 `_toc_dump.txt`·`_pagecheck.txt`·`_img_manifest.json`·`_extract_imgs.py`, 변환 폴더의 임시 `.markdownlint.jsonc`). cwd 루트와 `base_dir` 양쪽에서 매칭한다.
2. **보존 대상(삭제 금지)**: 원본 입력(`_source\`), 장별 변환본(`work_dir`), 장별 발췌본(`extract_dir`), 결합본, 이력(`history\`), 매핑 메모(`interactive\`). 글롭이 이들 폴더 안을 가리켜도 제외한다.
3. 삭제 전 대상 목록을 만들고, 매칭이 보존 대상과 겹치면 건너뛴다. PowerShell `Remove-Item`(`-Confirm:$false`)로 삭제.
4. 삭제한 파일 목록을 보고에 포함한다(무엇을 지웠는지 남긴다).

### 8. 검증·보고

- `markdownlint` 실행(프로젝트 `.markdownlint.json` 우선). 위반은 구조·포맷 범위에서 자가수정(원문 의미 불변).
- 발췌 누락 점검: 계획한 장×항목이 모두 산출됐는지, 이미지로만 있는 표(셀 수치 누락) 여부를 보고.
- 수집·정리 점검: 원본이 `_source\` 로 이동됐는지, 중간산출물이 삭제됐는지(삭제 목록), 보존 대상이 안 지워졌는지 확인.
- structured 모드: 구조화본 YAML/JSON 파싱 유효성, 발췌본↔값 추적성, **이력 추적 필드 매칭**(§"이력 연계") 충족 여부를 보고. **r0 init 결과**(시드됨 / 이미 있어 스킵 / `--no-history` 생략)도 함께 보고.
- 최종 보고: 작업 루트 `RND_PROJECT\<과제이름>\` · 대상 장 수 · 장별 항목 · 전체본 장 · 산출 파일 경로(결합본 `KR_<과제이름>.md` 또는 구조화본 `KR_<과제이름>.yaml`) · 이동된 원본 · 삭제된 중간산출물 · 캐시 재사용 여부 · 미수록 항목(이미지 표 등) · **r0 이력 init 결과**(이후 rev 는 `/rnd-kr-history`).

## 구조화 추출 (YAML/JSON) — `--format structured`

KR **"연구개발 내용(02장) + 예산(08장)"만**(예산의 `연구실안전관리비` 는 06장 안전관리비 계상근거 + 08장 간접비세부 금액) 무손실 발췌본을 **데이터로 정규화**해 `KR_<과제이름>.yaml`(필요 시 `.json`)로 낸다. 마크다운 발췌가 "원문 그대로"라면, 구조화본은 "**키·수치로 정규화한 파생물**"이다(둘은 공존 — markdown 모드와 별개 모드).

### 무엇을 넣고 뺄지 = reference 가 결정

- **포함/제외의 단일 출처는 [references/extract_fields.yaml](references/extract_fields.yaml)** 다. 섹션(`연구개발내용`/`예산`)·블록(`fields.<키>`) on/off, `include`/`exclude` 목록, 옵션(`keep_zero_rows`·`mask_personal_salary`)을 **이 파일에서만** 고친다. 본문·프롬프트에서 임의 가감하지 않는다.
- **값의 모양(스키마)은 [references/structured_output.md](references/structured_output.md)** 다. 최상위(`meta`/`연구개발내용`/`예산`)와 블록별 키 구조·예시를 규정. 에이전트는 이 스키마 그대로 채운다.
- 새 항목을 넣고 싶으면 → `extract_fields.yaml` 에 필드를 켜고(또는 추가) `structured_output.md` 에 그 키의 모양을 적는다(정책·스키마 동시 갱신).

### 정규화 규칙 (무손실 → 데이터)

- **연차는 키, 값은 당해 차년도만**(계획축): 연차 폴더 `<차년도>\` 의 스냅샷엔 **그 차년도 행만** 둔다(2026-10-06 개정). 타 연차 계획값은 그 연차 폴더 스냅샷(없으면 발췌본·`original\`)에서 본다. 같은 항목이 연차마다 값이 다른 건 정상(이력 아님).
- **수치 타입**: 금액·목표치·기간[주]는 쉼표·`천원`·단위표기를 떼고 숫자로. 0 은 `0`, 판독 불가·해당없음은 `null`.
- **KR 만**: 타 기관 행·블록, 그림 캡션(`[그림: …]`)·도식 설명은 넣지 않는다.
- **추적성**: 모든 값은 발췌본(`extract_dir`) 셀로 역추적된다. 원문에 없는 합계를 만들지 않는다(있는 합계 행만 그대로).
- **단위 일관**: 예산은 `예산.단위`(기본 천원) 하나로 통일.

### 차년도 슬라이스 — 당해 차년도 전용 스냅샷 (`scripts/year_slice.py`)

연차 폴더 하나 = 그 차년도 행만. 구조화 에이전트가 당해 연차만 채우더라도, **결정론 슬라이서로 한 번 더 자르고 검증**한다(LLM 산출의 타 연차 혼입 차단).

| 규칙 | 내용 |
|:--|:--|
| ① `연차` 키 항목 | `- 연차: X` 블록 항목·`- {연차: X, …}` 한 줄 항목 → X ≠ 당해면 항목 통째 삭제(목표·수행일정·주요결과물·지원부담·비목별·참여연구자인건비·외주용역·세부사용계획·간접비세부·연구실안전관리비.연차별금액 등 모든 리스트) |
| ② `{연차: 값}` 맵 | 성능목표 `목표치`·성과지표 `목표` 에 N차년도 키가 있으면 당해 키 없는 항목은 삭제, 있는 항목은 당해 키만 남김(타 연차·`계` 제거). 연차 키가 없는 맵(과제 통합표 `{계: 5}`)은 그대로 |
| ③ `meta` | 손대지 않음(연차범위·연차별기간·기간·표지 = 과제 식별정보). `meta.차년도` 없으면 추가 |
| ④ 주석 | 리스트 수준 주석(항목 들여쓰기 이하)은 보존, 삭제 항목 안쪽 주석은 함께 삭제. 2번째 줄에 "당해 차년도 전용" 안내 주석 |
| ⑤ 빈 결과 | 항목이 전부 타 연차였던 리스트는 `키: []`(+주석). 당해 연차분이 원문에 없는 블록은 **명시적 빈 블록**(`- 연차: <차년도>`·`참여자: []`·`소계: null`)으로 손질 |
| ⑥ 검증 | 텍스트 슬라이스 결과 == PyYAML 데이터 필터 결과(불일치면 쓰지 않음). `--check` 는 타 연차 잔존 시 exit 2 |

```text
python scripts/year_slice.py <KR_과제.yaml> [--year N차년도] [-o 출력] [--dry-run]   # 슬라이스(기본 제자리)
python scripts/year_slice.py <KR_과제.yaml> --check [--year N차년도]                 # 검증만
```

- `--year` 생략 시 `meta.차년도` → `meta.현재차년도` → 파일이 든 폴더명 순으로 결정.
- 하류 스킬은 모두 `연차 == 당해` 로 읽으므로(`/rnd-kr-history` init·재생성, `rnd-budget-change`·`rnd-manpower-change` `--year`, `rnd_web`, `/rnd-project-publish` 연차 폴더별 병합) 당해 전용 스냅샷으로 동작한다. `/rnd-project-publish` 는 연차 폴더가 없는 연차를 "미추출"로 표기한다(다른 연차 스냅샷에서 끌어오지 않음).
- **후속 연차 선행 추출**(같은 협약 문서로 다음 차년도를 미리 뽑는 경우): `--stage <차년도>` 지정, 직전 연차 `original\` 재사용 가능, 결과는 그 차년도 행만. 개인별 인건비처럼 원문이 당해연도분만 적는 표는 ⑤ 의 명시적 빈 블록.
- 지원 모양: `연차` 가 항목의 첫 키(블록) 또는 한 줄 flow 항목, `목표치`/`목표` 는 한 줄 flow 맵. 그 밖(연차가 2번째 이후 키·여러 줄 flow 맵·블록형 목표치 맵)은 텍스트 슬라이스가 못 자르고 교차검증 불일치로 **쓰지 않고 exit 1**(fail-closed) — 그때는 스냅샷 모양을 지원 모양으로 고친 뒤 재실행.
- 2026-10-06 기존 8개 스냅샷(5과제·6연차 폴더 + MW급 1차년도 `_r1`·`_r2` 재생성본)에 소급 적용 완료.

### 이력 연계(매칭) → `/rnd-kr-history`

구조화본 = 해당 `rev` 의 **현재값 전량 스냅샷**(당해 차년도 분). 이력(rev diff·적재·뷰)은 **별도 스킬 [`/rnd-kr-history`](../rnd-kr-history/SKILL.md)** 가 이 스냅샷을 입력으로 처리한다(완전 분리). r0(최초)면 스냅샷 전량을 신규 시드, 이후 개정은 스냅샷을 새 rev 로 다시 만들고 이력엔 델타만 남긴다. 즉 **구조화본(스냅샷) ↔ history(델타)** 상호보완.

**매칭 — 스냅샷이 이력 추적을 충족해야 한다**(아래 필드를 켜 둔다):

| `/rnd-kr-history` 엔티티 | 스냅샷 키 | `extract_fields.yaml` 필드 |
|:---|:---|:---|
| `budget` | `예산.비목별`(+`예산.외주용역`) | `예산.비목별`·`예산.외주용역` |
| `researchers` | `예산.참여연구자인건비` | `예산.참여연구자인건비` |
| `objectives` | `연구개발내용.성능목표` | `연구개발내용.성능목표` |

> 위 필드를 끄면 그 엔티티는 이력 추적 불가. `/rnd-kr-history` 는 스냅샷에 소스 키가 없으면 매칭 실패로 보고하고 `extract_fields.yaml` 보강을 안내한다.
> **참여율 정본**: `researchers` 의 참여율은 `/rnd-kr-history` 가 3값(연평균참여율=계상인건비/급여총액, 참여기간참여율=계상률, 월별참여율)으로 추적한다. 앞 둘은 스냅샷의 `계상률`·`계상인건비`·`급여총액` 에서 도출되고, **월별참여율은 원문에 월별 참여율 표가 있을 때만** `참여자[].월별참여율 {YYYY-MM:%}` 로 추출(정본, `options.monthly_rate`). 표가 없으면 생략 → history 가 계상률로 평탄 도출.

### YAML / JSON

- 정본은 **YAML**(주석·한글 가독성·git diff). `structured.format: json`/`both` 또는 `--json` 이면 YAML 을 파싱해 동일 데이터의 `.json` 사본 생성(손으로 두 번 쓰지 않음).

## 이력 관리 → 별도 스킬 `/rnd-kr-history`

예산·참여연구원·과제목표의 **변경이력(rev) 관리는 이 스킬에서 분리**됐다. 전담 스킬 **[`/rnd-kr-history`](../rnd-kr-history/SKILL.md)** 가 구조화 스냅샷(`KR_<과제이름>.yaml`)을 받아 처리한다(sparse hybrid · 두 시간축 분리 · append-only · 뷰 생성). 상세 스키마·매칭은 `rnd-kr-history/SKILL.md` 와 `rnd-kr-history/references/history_schema.md`.

- **이 스킬의 책임**: structured 모드로 **이력 추적을 충족하는 스냅샷**을 만들고(§"이력 연계(매칭)"의 필드를 켜 둔다), 그 직후 **r0 init 을 자동 트리거**(`--no-history` 면 생략)하는 것까지.
- **흐름**: `/rnd-kr-extract … --format structured` → `KR_<과제>.yaml` + **r0 init 자동**(`/rnd-kr-history init --project <과제> --year <차년도>`) → 변경 시 `/rnd-kr-history`(변경비교 YAML 등)로 r1+ 적재.

## 산출물

> `base_dir` = `RND_PROJECT`(cwd 기준 공통 루트) · `<과제이름>` = `output.work_subdir`(기본 `{project_name}`). 모든 산출물이 `RND_PROJECT\` 아래 모인다.

| 산출물 | 생성 조건 | 후속 사용처 |
|:---|:---|:---|
| 이동된 원본 `RND_PROJECT\_source\<과제이름>.<확장자>` | `options.move_source`(기본 on) | 변환 입력·원본 보관(과제명으로 개명; `--no-move` 면 미생성) |
| 장별 **전체** 변환본 `RND_PROJECT\<과제이름>\<차년도>\original\NN_<장>.md` | 1단계 변환(캐시 없을 때) | KR 발췌 입력·재발췌·검증 원본 |
| 추출 이미지 `…\<차년도>\original\images\p{NNN}_{n}.png` | 1단계 임베디드 이미지 추출 | 변환본 `[그림:]` 자리에 링크 |
| KR 발췌본 `RND_PROJECT\<과제이름>\<차년도>\<과제이름>_KR\NN_<장>.md` | `output.per_chapter: true` | 결합·구조화 입력·항목별 검증(무손실 정본) |
| 단일 결합본 `RND_PROJECT\<과제이름>\<차년도>\KR_<과제이름>.md` | `output.format: markdown` 이고 `output.combined: true` | 최종 제출·공유 |
| **구조화본 `RND_PROJECT\<과제이름>\<차년도>\KR_<과제이름>.yaml`** | `output.format: structured` | KR 연구개발 내용·예산 데이터 — **당해 차년도 행만**(`scripts/year_slice.py --check` 통과; 연동·집계 + `/rnd-kr-history` 입력 스냅샷) |
| **구조화본 JSON `RND_PROJECT\<과제이름>\KR_<과제이름>.json`** | `structured.format: json`/`both` 또는 `--json` | 프로그램 연동(YAML 정본의 사본) |
| 매핑 분석 메모 `interactive\<target.name>_챕터별_내용_분석.md` | `options.emit_analysis_memo` 이고 기존 메모 없을 때 | 어느 장에 무엇이 있는지(재실행 시 재사용) |
| 이력 r0 `RND_PROJECT\<과제이름>\<차년도>\history\*` | `--format structured` 이고 `--no-history` 아님 | structured 직후 **r0 init 자동**(`/rnd-kr-history init`, 이미 있으면 스킵); 이후 rev 적재·뷰는 [`/rnd-kr-history`](../rnd-kr-history/SKILL.md) |
| (삭제) 중간산출물 `_toc_dump.txt`·`_img_manifest.json` 등 | `options.cleanup_intermediate`(기본 on) | 추출·검증 성공 후 정리 — 산출물 아님(보존 대상은 §7) |

## 산출물 명명

| 속성 | 값 |
|:---|:---|
| stem 유도 | 장/시트 제목 → `NN_<제목>`(2자리 zero-pad + 키워드/시트명). 변환본의 장·시트 순서를 따른다 |
| 작업 폴더명 | `<과제이름>` = `project_name`(정규화값; **표지 과제명 추출·확인**). 그 아래 **`<차년도>`**(= `output.stage`, **현재 날짜 기준 산출**) 폴더로 차수별 격리 → `RND_PROJECT\<과제이름>\<차년도>\`. 그 안에 `original\`(전체 변환본+`images\`) · 발췌 폴더 `<과제이름>_KR\` · `KR_<과제이름>.yaml` |
| 결합본/구조화본 stem | `KR_<과제이름>` — `target_abbr`(`KR`) + `project_name`. 과제 폴더 `RND_PROJECT\<과제이름>\` 안에 둔다. markdown 모드=`.md`, structured 모드=`.yaml`(/`.json`) |
| suffix | KR 발췌 폴더 `_<target.abbr>`(예: `_KR`), 결합본/구조화본은 앞머리 `KR_` |
| 확장자 | markdown `.md` / structured `.yaml`·`.json` (UTF-8, BOM 없음) |
| 사용자 지정 옵션 | `output.combined_name`(기본 `KR_{project_name}.md`)·`output.structured.out_name`(기본 `KR_{project_name}.yaml`) 템플릿(`{target_abbr}`·`{project_abbr}`·`{stage}` 사용 가능), `output.format`(`markdown`\|`structured`), `output.work_subdir`(기본 `{project_name}`), `output.base_dir`(기본 `RND_PROJECT`)/`source_dir`/`project_name`/`project_abbr`/`stage`, `--name`·`--format`·`--json` |
| 충돌 처리 | 결합본·구조화본·발췌본·`_source` 동명 존재 시 덮어쓰기 전 `AskUserQuestion` 확인. 사용자가 거부하면 `_v2` 접미사 |

## 산출물 위치

| 속성 | 값 |
|:---|:---|
| 디렉터리 경로 | **공통 루트 `<cwd>\RND_PROJECT\`**(=`base_dir`). 원본 `RND_PROJECT\_source\` · **차년도 루트 `RND_PROJECT\<과제이름>\<차년도>\`**(현재 날짜 기준 산출·협약일 교차확인) · 전체 변환본+이미지 `…\<차년도>\original\`(+`images\`) · 발췌본 `…\<차년도>\<과제이름>_KR\` · 결합본 `…\<차년도>\KR_<과제이름>.md` · 구조화본 `…\<차년도>\KR_<과제이름>.yaml`(/`.json`) · 이력 `…\<차년도>\history\`. 모든 과제 산출물은 `<과제이름>\<차년도>\` 폴더 안에 격리 |
| 원본 보존 여부 | 원본 입력은 `_source\` 로 **이동 + 과제명으로 개명**(`<과제이름>.<확장자>`; 원위치에서 사라짐; `--no-move` 면 현 위치 유지). 장별 변환본·발췌본은 항상 보존(structured 모드도 발췌본은 무손실 정본·추적성으로 유지). 이력은 변경 항목의 `history` 에 **추가만**(과거 항목 보존). **중간산출물(`_toc_dump.txt` 등)만** 추출·검증 성공 후 삭제(§7) |
| 캐시 공유 (다른 스킬과) | `/pdf2md_by_read` 가 만든 장별 md 를 `reuse_md_cache: true` 로 재사용. HWP→PDF 변환본도 동일 캐시에 합류. 매핑 메모는 `interactive\` 공용 |
| 경로 오버라이드 (CLI 인자) | `--md <폴더>`(변환본 폴더 직접 지정), `--format markdown\|structured`(출력 모드), `--json`(JSON 사본), `--name <과제이름>`(작업 폴더·결합본명), `--profile <yaml>`(`output.*`·`structured.*` 경로 설정 포함), `--stage <차수>`, `--no-move`(이동 끔), `--keep-intermediate`(정리 끔) |

## AskUserQuestion

조용히 진행하지 않고 아래 분기에서 묻는다(인자로 이미 주어졌으면 생략).

| 트리거 | 질문 요지 | 옵션 | 기본 권장 |
|:---|:---|:---|:---|
| 입력 파일·`--md` 둘 다 없음(0단계) | 변환할 입력(사업계획서 PDF·HWP·공문·엑셀) 또는 장별 md 폴더 경로? | (자유 입력) | — |
| 출력 모드 미지정(`--format`·프로파일 둘 다 없음, 0단계) | 어떤 출력 모드로? | `markdown(무손실 발췌·결합)` \| `structured(YAML 데이터)` \| `structured + JSON 사본` | `markdown` |
| `output.project_name` 비어 있음(0단계) | 작업 폴더·결합본명 `KR_{과제이름}` 에 쓸 **과제 이름**은? | (자유 입력; **문서 표지 과제명 추출값** 제안) | 표지 과제명 |
| `_source` 에 동명 원본 존재(0단계 수집) | 이동 시 덮어쓸지, 건너뛸지? | `덮어쓰기` \| `건너뛰기(현 위치 유지)` \| `취소` | `건너뛰기` |
| HWP 입력인데 변환기 없음(1단계) | HWP→PDF 변환 방법? | `한컴 COM(설치됨)` \| `pyhwp 설치 후 추출` \| `PDF 로 재공급` | 한컴 COM |
| 문서 기준 연차 ≠ 현재 날짜 기준 연차(0단계 차년도 산출) | 문서(당해연도·협약일·PDF 출력일)는 `N차년도`인데 오늘 기준은 `M차년도` — 어느 차년도 폴더로? | `현재 날짜 기준 M차년도(권장·진행 중 과제)` \| `문서 기준 N차년도(협약 baseline)` \| (직접 입력) | 현재 날짜 기준 |
| 협약일·연차표 없음(0단계; 공문/엑셀) | 몇 차년도/차수인가? | `1차년도` \| `2차년도` \| `3차년도` \| `4차년도` \| `해당없음(공문/엑셀)` \| (Other 직접 입력) | — |
| `work_dir` 에 변환 md 캐시 발견(1단계) | 재변환할지, 기존 변환본 재사용할지? | `재사용(권장)` \| `재변환` | `재사용` |
| 프로파일 미지정 또는 확인(0단계) | 어떤 추출 프로파일로? | `kr_default(markdown,권장)` \| `kr_structured(YAML)` \| `사용자 프로파일(--profile)` \| `즉석 항목 선택(multiSelect)` | `kr_default` |
| 결합본·구조화본·발췌본 동명 파일 존재(5/5′단계) | 덮어쓸지, 새 이름으로 둘지? | `덮어쓰기` \| `_v2 로 저장` \| `취소` | `_v2 로 저장` |

> "즉석 항목 선택"을 고르면 §매핑 표의 15개 항목을 `AskUserQuestion`(multiSelect)으로 보여주고, 선택 결과로 `extract` 를 그 세션에 한해 덮어쓴다(프로파일 파일은 변경하지 않음).
>
> 이력(rev·변경사유) 관련 질의는 이 스킬에서 제거됐다 — [`/rnd-kr-history`](../rnd-kr-history/SKILL.md) 가 담당.

## DO

- **공통 루트로 모은다**: 원본 입력을 `RND_PROJECT\_source\` 로 이동하고, 모든 과제 산출물(변환본·발췌본·결합본·이력)을 과제 폴더 `RND_PROJECT\<과제이름>\` 안에 자기완결적으로 둔다.
- **과제명은 표지에서**: 작업 폴더·결합본명은 지저분한 입력 파일명 stem 대신 **문서 표지의 과제명을 추출·확인**해 짓는다(`KR_<과제이름>.md`).
- **차년도는 현재 날짜 기준 우선(협약일·당해연도로 교차확인)**: 표지의 연차별 기간표에 **①오늘(currentDate)이 속하는 연차**와 **②문서 표기(당해연도·협약/서명일·PDF 출력일)가 속하는 연차**를 모두 대조한다. 둘이 다르면 §AskUserQuestion 으로 확인하되 **진행 중 과제는 ①현재 날짜 기준 연차를 기본 권장**(협약 baseline 보관이면 ②문서 기준). 모든 산출물을 **`RND_PROJECT\<과제이름>\<차년도>\`** 아래(그 안 `original\`·`<과제이름>_KR\`·`KR_*.yaml`)에 둔다.
- **이미지는 임베디드만**: 변환 시 PDF 임베디드 이미지를 추출해 **적절한 것만**(반복 장식·초소형 제외) `original\images\` 에 저장하고 `[그림:]` 자리에 링크한다. **전체 페이지 렌더로 대체하지 않는다.**
- **끝나면 정리**: 추출·검증이 성공한 뒤 **중간산출물만**(`_toc_dump.txt`·`_img_manifest.json` 등) 삭제하고, 무엇을 지웠는지 보고한다.
- 변환은 **포맷별로**(PDF→`/pdf2md_by_read`, **HWP→한컴 COM PDF변환/pyhwp**, 엑셀→시트별, 공문→문서별) 하되 **문서 전체(모든 장)**를 **장/문서/시트별 1파일**로 저장한다(파일=발췌단위=에이전트; KR 관련 장만 부분 변환 금지). 발췌는 그 전체 변환본에서 YAML 이 가리키는 장만 뽑는다. 단일 병합본이 필요하면 5단계 결합으로 따로 만든다.
- 발췌 전 **계획(장×항목·출력 모드)을 먼저 사용자에게 보고**하고, YAML 의 `extract`/`chapters` 가 그 계획의 단일 출처임을 지킨다.
- 발췌 에이전트는 **Grep 으로 위치 → 구간만 Read → 작은 Write**. 검색어는 `target.aliases`/`block_markers` 전부.
- `context_full` 장은 발췌 대신 전체본으로 교체해 맥락을 보존한다(markdown 모드).
- **구조화(structured) 모드는 reference 가 정책**: 포함/제외는 `references/extract_fields.yaml`, 값 모양은 `references/structured_output.md` 만 따른다. 연차는 키이되 **당해 차년도 행만**(`scripts/year_slice.py --check` 통과), 금액은 수치 타입, 모든 값은 발췌본 셀로 역추적된다. 새 필드는 reference 두 곳을 함께 고친다.
- 산출 후 계획한 항목이 모두 들어갔는지, 이미지 기반 표의 수치 누락이 없는지(구조화는 발췌본↔값 추적성까지) 검증·보고한다.
- **rev 적재는 `/rnd-kr-history`, r0 init 은 자동**: 이 스킬은 rev(변경) 적재·diff·뷰를 하지 않는다. 단 structured 스냅샷이 이력 추적(budget·researchers·objectives)을 충족하도록 매칭 필드를 켜 두고, **산출 직후 `/rnd-kr-history init --project <과제> --year <차년도>` 로 r0 기준선을 자동 시드**한다(`--no-history` 로 끔, 이미 있으면 스킵). 이후 rev 는 `/rnd-kr-history`.

## DON'T

- 원문을 요약·의역·수치변경하지 않는다. 원문에 없는 합계를 만들지 않는다(필요 시 "참고치"로 표기만).
- 큰 md 를 통째로 Read 하거나 큰 발췌를 한 번에 Write 하지 않는다(소켓 끊김).
- 동일 출력 파일을 여러 에이전트가 동시에 쓰지 않는다(part 분할 후 병합).
- KR 외 기관 내용을 발췌본에 섞지 않는다. 단순 PDF→md 변환만 필요하면 `/pdf2md_by_read` 를 직접 쓴다.
- **변환을 KR 관련 장으로 한정하지 않는다**: 전체(모든 장)를 먼저 변환해야 06장 연구실 안전관리비 같은 교차 장 항목을 놓치지 않는다. 발췌만 YAML 기준으로 좁힌다(변환=전체, 발췌=YAML).
- 프로파일에 없는 항목을 임의로 추가·삭제하지 않는다(설정 단일 출처). **구조화 모드도 `references/extract_fields.yaml` 밖의 필드를 임의로 넣고 빼지 않는다.**
- **구조화본에 원문을 변형해 넣지 않는다**: 요약·반올림·합계 신규생성 금지. 연차를 합치거나(연차=키) **타 연차 행을 당해 차년도 스냅샷에 섞지** 않고, `천원` 단위를 임의 환산하지 않는다. 판독 불가는 `null` + 보고. 그림 캡션·타 기관 행은 값으로 넣지 않는다.
- **정리 단계에서 보존 대상을 지우지 않는다**: 원본(`_source\`)·변환본·발췌본·결합본·구조화본·이력·매핑 메모는 삭제 금지. 중간산출물만 지운다. 추출·검증이 실패했으면 정리하지 않는다(디버깅용 보존).
- **원본 이동을 임의로 복사로 바꾸지 않는다**: 기본은 이동(move). 보존이 필요하면 `--no-move` 를 쓰게 안내한다.
- **이력 로직(rev·diff·sparse-hybrid 적재·뷰)을 이 스킬에 다시 끌어들이지 않는다**: 그건 `/rnd-kr-history` 소관이다. 이 스킬은 추적 스냅샷을 만들고 **r0 init 만 자동 트리거**(`/rnd-kr-history init`)하는 데까지 — rev 적재는 직접 하지 않는다(스냅샷 재추출로 rev 를 자동 쌓지 않음).

## 흔한 함정

| 증상 | 원인 | 해결 |
|:---|:---|:---|
| 발췌본에 수치가 비어 있음 | 원본이 이미지로만 된 표(예: 06장 안전관리 규정) | 원본 PDF 직접 확인. 보고에 "이미지 표 — 수치 판독 불가" 명시 |
| 연구실 안전관리비 누락 | 02·08장만 부분 변환해 06장(안전관리비 계상)을 못 봄 | **전체 변환 먼저**(§1). `예산.연구실안전관리비` 는 06장 계상근거 + 08장 간접비세부 금액에서 채운다 |
| KR 인데 못 찾음 | 본문이 `선급`/`공인인증기관` 등 포괄표현만 사용 | `aliases` 에 통칭 추가하되 맥락으로 KR 확정 후 발췌(별첨 대비표 사례) |
| 별첨 장이 누락 | 아웃라인(북마크) 밖 별첨이 본문에 섞임 | 변환 후 페이지 범위로 별첨 목록 재확인(별첨9 누락 사례) |
| 합계가 원본 총액과 미세 불일치 | 원문 자체 오차 | 수치는 원본 대조 권장. 임의 보정 금지 |
| 한글 깨짐 | 콘솔/파일 인코딩 | UTF-8(BOM 없음)으로 출력. TOC 깨질 땐 파일로 덤프 후 Read |
| 엑셀 표가 어긋남 | 머지셀·숨김행·다중 헤더 행 | 시트 원형 유지(머지셀은 펼쳐 표기), 숨김행도 포함해 변환. 한 시트 여러 표는 표별로 헤딩 부여 |
| HWP 가 변환 안 됨 | pyhwp 미설치·한컴 COM 차단 | ① 한컴 COM 으로 HWP→PDF(설치 경로 `C:\Program Files (x86)\Hnc\…`) ② `pip install pyhwp` 후 `hwp5html` ③ PDF 재공급 요청(보고에 명시) |
| HWP 표가 깨짐 | `hwp5txt`(텍스트만)로 변환 | 표 보존엔 `hwp5html` 또는 한컴 COM PDF변환 사용. 표 밀집 장(예산)은 특히 PDF 경유 권장 |
| 구조화본 금액이 문자열·쉼표 포함 | 원문 `120,000 / 100%` 를 그대로 적음 | 비율·단위표기 제거하고 **수치 타입**(120000)으로. 비율(%)·각주는 exclude |
| 구조화에 타 기관·그림 캡션 섞임 | `[그림:…]`·주관기관 행을 값으로 넣음 | `extract_fields.yaml` 의 exclude 준수. KR 행/블록만, 캡션 제외 |
| 구조화 값이 발췌본과 불일치 | 발췌본 안 보고 변환본에서 바로 구조화 | 입력은 **KR 발췌본**(`extract_dir`). 모든 값은 발췌본 셀로 역추적 검증 |
| 작업 폴더명이 지저분(`계쏙허2`) | 입력 파일명 stem 을 그대로 폴더명에 씀 | 표지 과제명을 추출·확인해 `project_name` 으로 쓴다(`--name` 으로 직접 지정도 가능) |
| 원본이 사라졌다고 당황 | 기본이 이동(move)이라 원위치에서 `_source\` 로 옮김 | 정상 동작. 원위치 보존이 필요하면 `--no-move`. 이동본은 `RND_PROJECT\_source\` 에 있음 |
| 정리가 변환본까지 지움 | 글롭이 보존 폴더 안을 매칭 | 보존 대상(`_source`·변환본·발췌본·결합본·이력·메모)은 제외. 중간산출물 패턴만, cwd·base_dir 루트에서 매칭 |
| 정리됐는데 결과가 이상 | 추출 실패인데도 중간산출물 삭제 | 정리는 **추출·검증 성공 후에만**. 실패 시 `--keep-intermediate` 처럼 보존하고 디버깅 |

## 체크리스트

- [ ] `$ARGUMENTS` 를 인자 분기로 해석했다(`items`/`help` 는 출력 후 종료, `--format`/`--json` 반영).
- [ ] **출력 모드 확정**(`--format`/프로파일 `output.format`; structured 면 `kr_structured.yaml` + `references/*` 로드).
- [ ] 프로파일 YAML 을 읽어 `extract`(항목)+`chapters`(장)로 **발췌 장×항목 계획**을 세웠다(변환은 전체, 발췌만 YAML 기준 — structured 면 02·08, `연구실안전관리비` 켜지면 06 발췌 입력 추가).
- [ ] **과제명을 문서 표지에서 추출·확인**해 `project_name`(작업 폴더·결합본명)으로 확정했다(`--name` 없을 때).
- [ ] 입력 파일(포맷 판별; **HWP 는 변환 경로 확정**)/`--md`·차수·project_name·project_abbr 부족분을 `AskUserQuestion` 으로 채웠다.
- [ ] **원본을 `RND_PROJECT\_source\` 로 이동 + 과제명으로 개명**(`<과제이름>.<확장자>`)했다(`move_source`, `--no-move` 면 생략; `_source` 동명 충돌은 확인).
- [ ] 발췌 전에 계획(작업 루트·대상 장·장별 항목·전체본 장·**출력 모드**·출력명 `KR_{과제이름}.md`/`.yaml`)을 사용자에게 보고했다.
- [ ] **전체(모든 장) 변환**을 먼저 했다(포맷별·장/시트별 1파일, KR 관련 장만 부분 변환 금지). 캐시 있으면 재사용(`reuse_md_cache`). HWP 는 표 보존 경로(한컴 PDF/`hwp5html`) 사용.
- [ ] 발췌는 장 1개=에이전트 1개 병렬, Grep→구간 Read→작은 Write.
- [ ] (markdown) `context_full` 장은 전체본으로 교체했다.
- [ ] (structured) `references/extract_fields.yaml` 정책대로 섹션별 구조화 → 연차=키·**당해 차년도 행만**(`scripts/year_slice.py <스냅샷> --check` 통과, 당해분 미수록 블록은 명시적 빈 블록)·금액=수치·`null` 처리, 발췌본↔값 추적성 검증, JSON 사본(요청 시) 생성.
- [ ] (structured) **이력 매칭 필드**(`예산.비목별`·`예산.외주용역`·`예산.참여연구자인건비`·`연구개발내용.성능목표`)가 스냅샷에 채워졌는지 점검하고, **r0 init 을 자동 수행**(`/rnd-kr-history init`; `--no-history` 면 생략·이미 있으면 스킵)했다.
- [ ] 결합본·구조화본 동명 충돌 시 사용자 확인했다.
- [ ] **추출·검증 성공 후 중간산출물만 정리**했다(`cleanup_intermediate`, `--keep-intermediate` 면 생략). 보존 대상(원본·변환본·발췌본·결합본·이력·메모)은 안 지웠고, 삭제 목록을 보고했다.
- [ ] (markdown) markdownlint 통과 / (structured) YAML·JSON 파싱 유효성 통과 + 계획 항목 누락·이미지 표 수치 누락을 검증·보고했다.
