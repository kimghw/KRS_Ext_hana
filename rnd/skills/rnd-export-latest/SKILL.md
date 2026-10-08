---
name: rnd-export-latest
description: RND_PROJECT 아래 각 과제 폴더에서 '최신 차년도 + 최고 rev' 구조화 스냅샷(KR_{과제}.yaml)을 과제별로 1개씩 골라 대상 폴더로 복사한다(원본 보존 — 이동/삭제 아님). 최신 판별은 <과제>/<N차년도> 중 N 최대 → 그 차년도의 KR_*.yaml 중 rev 최대(파일명 _r{N}=rev N, 접미사 없음=r0). 복사 시 파일명은 rev 접미사를 떼어 KR_{과제}.yaml 로 정규화한다. 대상 폴더를 인자로 받고, 없으면 설정 export.config.yaml 의 dest, 그것도 없으면 RND_PROJECT\_export\ 로 모은다(우선순위 CLI > 설정 > 기본). 선택·복사는 export_latest.py 로 결정론적 위임. TRIGGER when 사용자가 /rnd-export-latest 호출, 과제별 최신 구조화 yaml 을 한곳(대상 폴더·기본 _export)에 복사·모으기, 최신 스냅샷만 뽑아 배포·공유·백업 요청. DO NOT TRIGGER when 구조화 추출 자체(→ /rnd-kr-extract), 이력 적재·현행 스냅샷 재생성(→ /rnd-kr-history), 인건비 재배분(→ /rnd-manpower-change), 원본 이동/삭제(이 스킬은 복사만).
when_to_use: 과제별 최신 구조화 스냅샷(KR_{과제}.yaml)을 한 폴더로 복사해 모으기(배포·공유·백업), 대상 폴더 지정 또는 설정 export.config.yaml:dest, 기본 RND_PROJECT\_export\ 로 export
allowed-tools: Read, Bash, Glob, AskUserQuestion
argument-hint: "[<대상폴더>] [--source <RND_PROJECT경로>] [--config <경로>] [--dry-run] [--no-overwrite|--overwrite] [--with-json|--no-json] [--with-meta|--no-meta] | help"
---

# rnd-export-latest — 과제별 최신 구조화 스냅샷 복사

`RND_PROJECT` 아래 여러 과제에 흩어진 **구조화 스냅샷**(`KR_{과제}.yaml`) 중, 과제별로 **가장 최신 것 1개**만 골라 지정한 대상 폴더로 **복사**한다. 원본은 건드리지 않는다(복사 후 붙여넣기 — 이동·삭제 아님). 최신 스냅샷만 한곳에 모아 배포·공유·백업하는 용도.

`rnd-kr-extract`(구조화본 생성)·`rnd-kr-history`(현행 스냅샷 `_r{N}` 재생성)가 만들어 둔 산출물을 **읽어 복사만** 한다. 스냅샷을 만들거나 고치지 않는다.

## 무엇이 '최신' 인가 — 결정론적 판별

과제 폴더 하나당 **정확히 1개**를 고른다. 판별은 두 축을 순서대로 적용:

1. **최신 차년도** — `<과제>/<N차년도>` 하위폴더 중 `N` 이 최대인 폴더(예: `1·3차년도` → `3차년도`). 차년도 폴더가 없으면 과제 폴더에 직속된 `KR_*.yaml` 을 본다.
2. **최고 rev** — 그 차년도의 `KR_*.yaml` 중 rev 가 최대인 파일. 파일명 규칙:
   - `KR_{과제}_r{N}.yaml` → **rev N** (history 가 재생성한 현행 스냅샷)
   - `KR_{과제}.yaml` (접미사 없음) → **r0** (extract 최초 스냅샷)
   - `_r{N}` 은 **접미사를 뗀 스템이 `KR_{과제폴더명}` 과 정확히 일치할 때만** rev 로 인정 — 과제 폴더명 자체가 `_r{N}` 으로 끝나는 경우(예: `과제A_r2` 의 base `KR_과제A_r2.yaml`) rev 오인·정규화 충돌을 막는다(그 파일은 r0·이름 그대로).
   - 같은 차년도에 `r0`·`_r1` 이 공존하면 **`_r1` 선택**(더 높은 rev = 더 최신 현행값).
   - rev 까지 동률인 `KR_*.yaml` 이 2개 이상이면 **파일명 오름차순 마지막 것**(스크립트의 안정 정렬 — 비정상 공존 상황에서도 선택이 결정론적).
3. **이름 정규화** — 복사 대상 파일명은 `_r{N}` 접미사를 떼어 `KR_{과제}.yaml` 로 통일. 실제 rev 는 파일 첫 줄 마커(`# [재생성 r1] …` / `# [<차년도> 최초]`)로 구분된다.

> 선택·복사는 `export_latest.py` 가 결정론적으로 수행한다(Claude 가 파일을 직접 훑어 고르지 않는다). Claude 는 스크립트를 호출하고 결과를 검증·보고한다.

## ea_meta 동반 유지 (`with_meta`, 기본 켜짐)

KR_*.yaml 을 복사하면서 **과제 운영메타** `_export/ea_meta.yaml` 도 함께 유지한다. 이 파일은 `kreclass-rnd-approval`(전자결재 스킬)이 소비하는 **①입력값** — 연구계획서·KR_*.yaml 이 주지 못하는 KRS 내부값(PMS번호·alias·회계 I/O·부서 등)을 사람이 손으로 채우는 곳이다.

이 스킬은 **채우지 않는다**. 이번 실행에서 **선택된(수출) 과제 중 ea_meta 에 아직 항목이 없는 것만 '빈칸 stub' 으로 append** 할 뿐이다. stub 은 기존 SSCB 블록과 **같은 스타일**이다 — 최상위 키는 **과제명**(과제 폴더명의 `_` → 공백)이고, 사람이 빈칸을 채운 뒤 PMS 번호가 정해지면 그 키를 `RND-NN-YYYY` 로 바꾼다(별도 id 필드 없음 — 키가 곧 id).

- **마스터 위치** = `<source>/_export/ea_meta.yaml`("_export 아래"). 이 파일이 있으면 그걸 base 로 쓴다.
- **seed(최초)** — 마스터가 아직 없으면 **대상(dest)에 있는 기존 `ea_meta.yaml` 을 seed** 로 물려받아(SSCB 등 손입력·주석 그대로) `_export` 마스터를 만든다. 둘 다 없으면 최소 헤더로 신규.
- **append-only·비파괴** — 이미 채워진 블록·주석은 **절대 수정하지 않는다**(텍스트 그대로 보존, YAML 라운드트립 안 함). 중복 판별은 각 블록의 `source:`(정규화 KR 파일명) 매칭 — 이미 있으면 건너뛴다(재실행 멱등).
- **최상위 키 = 과제명**(과제 폴더명의 `_` 를 공백으로, 따옴표 문자열). PMS 번호가 정해지면 이 키를 그 값(`RND-NN-YYYY`)으로 바꾼다 — **별도 id 필드는 없다**(SSCB 블록처럼 키가 곧 project_id).
- **stub 필드 = 행정정보만** — `alias`·`io_code`·`io_name` 를 빈칸으로 두고 `source:` 만 자동으로 채운다. **과제정보(name/ministry/agency/role/agreement/overview 등)는 넣지 않고**, 어떤 값이 yaml 에서 도출되는지 주석으로 명시한다 — KR_*.yaml(SSOT)에 이미 있기 때문(사용자 지시 2026-07-16). 값은 **사용자가 주면 입력, 없으면 빈 껍데기**. ⚠️ `io_code/io_name` 은 회계값이라 **임의생성 금지**(받은 값만).
- **PyYAML 없으면** 중복 판별 불가로 ea_meta 유지를 **생략**(경고만, 스크립트는 안 죽음). `--no-meta` 로 끌 수도 있다.
- **끄기** — 일회성 `--no-meta`, 고정은 설정 `with_meta: false`. KR_eclass 쪽으로의 이관은 `rnd-import-latest` 가 `_export` 를 통째로 가져가며 처리(이 스킬은 dest 의 기존 ea_meta 를 덮어쓰지 않는다).

## 입력 체계 (3분류)

| 분류 | 무엇 | 어디 |
|:--|:--|:--|
| **① 입력값(사용자)** | 대상 폴더(복사 목적지)·`source`·`with_json`·`no_overwrite`·`with_meta`. **CLI 인자로 그때그때** 또는 **`export.config.yaml` 설정파일로 고정** 둘 다 가능. 없으면 기본 `_export`. (ea_meta 의 빈칸은 사람이 채우는 ①입력값 — `_export/ea_meta.yaml`) | CLI 인자 · `export.config.yaml`(스킬 폴더 안 = 양식 옆, git·toolkit 제외) · `_export/ea_meta.yaml` |
| **② 도출값(시스템)** | 과제별 최신 차년도·최고 rev·선택 파일·정규화 이름 · ea_meta 빈칸 stub(수출 과제 중 미등록분 — 행정정보 필드 빈칸, `source` 만 자동) — `export_latest.py` 가 계산 | 스크립트 |
| **③ 양식·지침(스킬)** | 판별 규칙·명명 규칙·이 SKILL.md·설정 빈 양식 `export.config.tpl.yaml` | `.claude/skills/rnd-export-latest/` |

### 설정파일 `export.config.yaml` (대상 폴더 고정)

대상 폴더·옵션을 매번 인자로 주지 않도록 **YAML 설정파일**로 저장할 수 있다(선택 — 없으면 현행 동작 그대로).

- **우선순위**: **CLI 인자 > `export.config.yaml` > 내장 기본(`_export`)**. 설정에 `dest` 를 두면 인자 없이 그 폴더로 복사, CLI 로 주면 그때만 덮어씀. 불리언도 양방향 — 설정 `no_overwrite: true`/`with_json: true` 를 일회성으로 뒤집으려면 `--overwrite`/`--no-json`.
- **키**: `dest`(목적지) · `source`(스캔 루트) · `with_json` · `no_overwrite` · `with_meta`(기본 `true`). (`--dry-run` 은 일회성이라 설정에 담지 않음)
- **값 검증**: `dest`/`source` 는 문자열, `with_json`/`no_overwrite`/`with_meta` 는 YAML 불리언(`true`/`false`, **따옴표 없이**)만 허용 — 타입이 다르면 경고 후 **그 키만 무시**(스크립트는 죽지 않음. 따옴표 친 `"false"` 는 참으로 오해석되므로 거부됨).
- **상대경로 기준**: 설정의 `dest`/`source` 상대경로는 실행 cwd 가 아니라 **설정파일이 있는 폴더 기준**으로 해석 — 어디서 실행해도 같은 대상.
- **위치·탐색**: `--config <경로>` > **`<스킬폴더>/export.config.yaml`(정위치)** > `<프로젝트루트>/export.config.yaml`(구위치·하위호환 — 발견 시 스킬 폴더로 이동 안내) > `<cwd>/export.config.yaml`.
- **양식 ↔ 실값 분리(doctrine, 2026-07-02 개정)**: 주석형 빈 양식 **`export.config.tpl.yaml`(③, 스킬 안·커밋)** 을 **같은 폴더에** 복사해 실제 **`export.config.yaml`(①, 스킬 안·양식 옆)** 로 채운다 — 실값도 소속 스킬 폴더에서 관리.
- **머신별 경로라 git·toolkit 제외**: 목적지가 `D:/배포`·네트워크 드라이브 등 절대경로면 PC마다 다르므로 실제 `export.config.yaml` 은 `.gitignore` 와 `.toolignore` **모두**에 등록해 커밋·toolkit 공유 복사에서 제외(Windows↔WSL 안전). 커밋되는 건 `.tpl.yaml` 뿐. ⚠ 스킬 폴더를 덮어쓰는 작업(toolkit pull·재설치) 전에는 실값 백업.
- **안전 폴백**: PyYAML 미설치·파싱 실패·비-매핑·`--config` 명시 경로 미존재면 경고만 내고(stderr) 설정 무시(대상은 CLI/기본값으로 진행 — 스크립트가 죽지 않음).

## 실행

스크립트: `${CLAUDE_PROJECT_DIR}/.claude/skills/rnd-export-latest/export_latest.py` (Python 3).

```bash
# 기본: RND_PROJECT 스캔 → RND_PROJECT\_export\ 로 과제별 최신 yaml 복사
python "<스킬>/export_latest.py"

# 대상 폴더 지정
python "<스킬>/export_latest.py" "D:/배포/최신스냅샷"

# 미리보기(복사 안 함) — 무엇을 고르는지 먼저 확인 (권장 첫 단계)
python "<스킬>/export_latest.py" --dry-run

# 소스 루트 override / 기존 파일 보존 / json 사본 동반
python "<스킬>/export_latest.py" <대상> --source <RND_PROJECT경로> --no-overwrite --with-json

# 설정파일(export.config.yaml)에 대상 고정 → 인자 없이 그 폴더로 (CLI 인자가 있으면 그게 우선)
python "<스킬>/export_latest.py"                       # dest = 설정 dest > _export
python "<스킬>/export_latest.py" --config D:/conf/export.config.yaml

# ea_meta 동반 유지(기본 켜짐) — _export/ea_meta.yaml 에 미등록 수출 과제만 빈칸 stub 추가
python "<스킬>/export_latest.py" --dry-run             # 어떤 stub 이 추가될지 먼저 확인(권장)
python "<스킬>/export_latest.py" --no-meta             # 이번만 ea_meta 유지 생략(yaml 복사만)
```

> 설정파일 만들기: `export.config.tpl.yaml`(주석형 양식)을 **같은 스킬 폴더에** `export.config.yaml` 로 복사해 `dest` 등을 채운다. 실제 `export.config.yaml` 은 `.gitignore`·`.toolignore` 로 제외됨(머신별·toolkit 공유 제외). 상세 → §설정파일.

옵션:

| 옵션 | 뜻 | 기본 |
|:--|:--|:--|
| `<대상폴더>`(위치인자) | 복사 목적지 | 설정 `dest` > `<source>/_export` |
| `--source <경로>` | 스캔할 소스 루트 | 설정 `source` > 스킬 기준 프로젝트의 `RND_PROJECT`(없으면 cwd/RND_PROJECT) |
| `--config <경로>` | 설정파일 경로 명시 | `<스킬폴더>` > `<프로젝트루트>`(구위치) > `<cwd>` 의 `export.config.yaml` |
| `--dry-run` | 선택 결과만 출력, 복사 안 함 | off |
| `--no-overwrite` | 대상에 동일명 파일 있으면 스킵 | 설정 `no_overwrite` > off(=덮어씀) |
| `--overwrite` | 설정 `no_overwrite: true` 를 일회성으로 뒤집어 덮어쓰기 | — |
| `--with-json` | 짝이 되는 `.json` 사본도 복사 | 설정 `with_json` > off(yaml 만) |
| `--no-json` | 설정 `with_json: true` 를 일회성으로 뒤집어 yaml 만 | — |
| `--with-meta` | `_export/ea_meta.yaml` 유지 + 수출 과제 중 미등록분 빈칸 stub 추가 | 설정 `with_meta` > **on**(기본 켜짐) |
| `--no-meta` | 설정 `with_meta: true`(기본)를 일회성으로 뒤집어 ea_meta 유지 생략 | — |

**권장 흐름**: `--dry-run` 으로 과제별 선택(차년도·rev)을 먼저 확인 → 이상 없으면 실복사.

**`help` 인자**: `/rnd-export-latest help` 는 스크립트를 실행하지 않고 위 옵션 표와 §무엇이 '최신' 인가 판별 규칙을 요약 안내만 한다(스크립트 자체 도움말은 `-h`/`--help` — 위치인자 `help` 를 스크립트에 넘기면 대상 폴더명으로 해석되므로 넘기지 않는다).

## 절차

1. **소스 루트 확정**: `--source` > 설정 `source` > 스킬 기준 프로젝트의 `RND_PROJECT` > `cwd/RND_PROJECT`.
2. **대상 확정**: 위치인자 > 설정 `export.config.yaml:dest` > 기본 `<source>/_export`. (설정에 `dest` 있으면 질문 없이 그 폴더, 없고 인자도 없으면 §AskUserQuestion)
3. **dry-run 미리보기**: 먼저 `--dry-run` 으로 과제별 선택(차년도·rev·정규화 이름)을 사용자에게 보고.
4. **복사 실행**: 대상 폴더를 만들고(`mkdir -p`) 과제별 최신 yaml 을 복사. 덮어쓰기 정책은 §AskUserQuestion.
5. **검증·보고**: 복사됨/스킵/없음 집계, 대상 폴더 목록, 원본이 그대로인지(복사만 함) 확인.

## 산출물

> 이 스킬은 **원본을 읽어 복사만** 한다. 새 스냅샷을 만들지 않으며, 소스는 항상 그대로 보존된다.

| 산출물 | 생성 조건 | 후속 사용처 |
|:--|:--|:--|
| 과제별 최신 구조화본 사본 `<대상>\KR_{과제}.yaml` | **최신 차년도 폴더**(차년도 폴더가 없으면 과제 직속)에 `KR_*.yaml` 이 있을 때(과제당 1개) — 이전 차년도로 폴백하지 않음 | 최신 스냅샷 배포·공유·백업, 일괄 검토 |
| JSON 사본 `<대상>\KR_{과제}.json` | `--with-json` 이고 선택 yaml 옆에 동명 `.json` 존재 | 프로그램 연동 |
| **과제 운영메타 `<source>\_export\ea_meta.yaml`** (수출 과제 중 미등록분 빈칸 stub append) | `with_meta`(기본 on)이고 PyYAML 설치됨 · 추가할 stub 이 있거나 마스터 신규생성 시 | `kreclass-rnd-approval` 이 KR_*.yaml 과 조인해 `ea_projects.yaml` 생성(사람이 빈칸 채운 뒤) |
| 콘솔 요약(과제별 선택·복사/스킵/없음 집계 + ea_meta stub 추가/건너뜀) | 항상 | 무엇이 어느 차년도·rev 에서 복사됐는지, ea_meta 에 뭐가 추가됐는지 확인 |
| (미생성) 원본·이력·차년도 폴더 · **dest 의 기존 ea_meta.yaml** | — | 이 스킬은 소스를 **수정·이동·삭제하지 않음**. dest 기존 ea_meta 는 seed 로 **읽기만**(안 덮어씀) |

## 산출물 명명

| 속성 | 값 |
|:--|:--|
| stem 유도 | `KR_{과제}` — 선택 파일 stem 에서 `_r{N}` 접미사 제거(정규화). 예: `KR_..._차단기_개발_r1.yaml` → `KR_..._차단기_개발.yaml`. 과제명 = 과제 폴더명(이미 `_` 정규화된 값). 접미사는 뗀 결과가 `KR_{과제폴더명}` 과 일치할 때만 rev 로 인정·제거(과제명이 `_r{N}` 으로 끝나는 경우 오인 방지 — 그 파일은 이름 그대로) |
| suffix | 없음 — rev 접미사(`_r{N}`)를 **떼는 것**이 이 스킬의 정규화. 별도 접미사를 붙이지 않음. 실제 rev 는 파일 **첫 줄 마커**(`# [재생성 r1] …` / `# [<차년도> 최초]`)로 확인 |
| 확장자 | `.yaml`(정본). `--with-json` 이면 동일 stem 의 `.json` 사본도 |
| ea_meta stub 키 | `_export/ea_meta.yaml` 에 append 하는 stub 의 최상위 키 = **과제명**(과제 폴더명의 `_` → 공백, 따옴표 문자열). PMS 번호 정해지면 이 키를 `RND-NN-YYYY` 로 교체(별도 id 필드 없음 — 키가 곧 id). 필드는 **행정정보만**(`alias`·`io_code`·`io_name` 빈칸 + `source` 자동). 과제정보는 KR_*.yaml 에 있어 제외(도출값 주석으로 명시) |
| 사용자 지정 옵션 | 대상 폴더(위치인자)로 배치 위치, `--source` 로 스캔 루트, `--with-json` 으로 `.json` 동반 여부, `--no-overwrite` 로 덮어쓰기 여부, `--no-meta` 로 ea_meta 유지 끄기 |
| 충돌 처리 | 평면 배치·과제당 1개라 과제명이 곧 유일키 → 정상 구조에선 사본 파일명 충돌 없음(같은 실행에서 정규화 이름이 겹치면 stderr 경고 후 뒤 항목이 덮어씀). 대상에 **동일명 사본이 이미 있으면 덮어씀**(`--no-overwrite` 면 스킵). **대상이 소스 과제 트리 내부면 실행 자체를 거부**(exit 2, 원본 보호 — `_` 접두 예약폴더만 허용). ea_meta 는 `source:` 매칭으로 **중복 stub 을 만들지 않음**(재실행 멱등) |

## 산출물 위치

| 항목 | 규칙 |
|:--|:--|
| 기본 대상 | 인자·설정 `dest` 둘 다 없을 때 `RND_PROJECT\_export\` (소스 루트 아래 `_` 예약폴더 — 과제 폴더와 섞이지 않음). 설정 `export.config.yaml:dest` 있으면 그 폴더 |
| 설정파일 | 실값 `export.config.yaml`(**스킬 폴더 안** = 양식 옆, `.gitignore`·`.toolignore` 로 제외 — 머신별 경로·toolkit 공유 제외). 주석형 양식 `export.config.tpl.yaml`(같은 폴더, 커밋). 상세 → §설정파일 |
| 지정 대상 | 위치인자로 준 경로(절대/상대 모두). 없으면 자동 생성(`mkdir -p`) |
| 배치 | **평면** — 모든 사본을 대상 폴더 한 곳에 둔다(과제별 하위폴더 없음) |
| 소스 스캔 범위 | `RND_PROJECT\` 최상위의 과제 폴더만. `_source`·`_export` 등 `_` 접두 폴더는 제외 |
| 캐시 공유 (다른 스킬과) | 별도 캐시 없음. 소스 `KR_*.yaml` 은 `rnd-kr-extract`(구조화본)·`rnd-kr-history`(현행 `_r{N}`) 산출물을 **읽기 입력으로 공유** — 매 실행 시 소스 최신값을 다시 읽어 복사(스냅샷을 만들거나 수정하지 않음) |
| ea_meta 마스터 | `<source>\_export\ea_meta.yaml`("_export 아래" — 대상 폴더가 어디든 ea_meta 는 항상 `_export` 에 유지). 없으면 dest 의 기존 `ea_meta.yaml` 을 seed 로 물려받아 생성. dest 의 기존 ea_meta 는 **읽기만**(안 덮어씀) — KR_eclass 이관은 `rnd-import-latest` 담당 |
| 원본 보존 | 원본 `KR_*.yaml`·차년도 폴더·이력은 **그대로**. 복사만 하고 이동·삭제하지 않음. ea_meta 는 이미 채워진 블록·주석을 **건드리지 않고 빈칸 stub 만 append**(비파괴) |
| 대상=소스 트리 내부 | 대상이 소스 과제 트리 내부(과제/차년도 폴더 하위·소스 루트 직속)면 **실행 거부**(exit 2) — 정규화 사본이 r0 원본을 덮어쓰는 것을 차단. 소스 아래에 모으려면 `_export` 같은 `_` 접두 폴더만 허용 |
| 경로 오버라이드 | `--source <RND_PROJECT경로>`(스캔 루트), 위치인자(대상 폴더) |

## AskUserQuestion

| 트리거 | 질문 | 옵션 | 기본 |
|:--|:--|:--|:--|
| 대상 인자·설정 `dest` 둘 다 없음(0단계) | 어디로 복사할까요? | `RND_PROJECT\_export\(권장)` \| `다른 경로 입력` \| `export.config.yaml 에 고정 저장` | `_export` |
| 대상에 동일명 사본이 이미 있음(`--no-overwrite`/덮어쓰기 미지정) | 기존 사본을 덮어쓸까요? | `덮어쓰기(권장 — 설정이 no_overwrite:true 면 --overwrite 로 실행)` \| `기존 파일 스킵(--no-overwrite)` \| `취소` | 덮어쓰기 |
| 소스에서 과제를 0개 발견 | 소스 루트가 맞나요? | `--source 로 경로 지정` \| `취소` | (사용자 입력) |

- 비대화(스크립트 단독) 실행 시: 대상 미지정=설정 `dest` > 기본 `_export`, 덮어쓰기 정책=덮어씀(`--no-overwrite` 로 끄고, 설정이 `true` 면 `--overwrite` 로 켬). 파괴적 동작이 아니므로(복사·덮어쓰기만, 원본 불변 — 소스 트리 내부 대상은 거부) 기본값으로 진행 가능.
- **ea_meta(`with_meta`)는 질문하지 않는다** — 기본 켜짐이고 append-only·비파괴(빈칸 stub 만 추가, 채워진 값·주석 불변)라 그냥 진행. 끄려면 `--no-meta` 또는 설정 `with_meta: false`. 단 stub 을 추가/덮어쓰기 전 `--dry-run` 으로 무엇이 추가될지 먼저 보고하면 좋다.

## 자주 하는 실수

| 증상 | 원인 | 대응 |
|:--|:--|:--|
| 옛 스냅샷이 복사됨 | 최신 차년도에 rev 파일이 아직 없음(base 만) | 정상 — 그 과제는 r0 가 최신. `--dry-run` 으로 선택 근거(차년도·rev) 확인 |
| `_export` 안에 과제 폴더까지 복사됨 | `_` 예약폴더를 스캔에 포함 | 스크립트는 `_` 접두 폴더를 자동 제외. 커스텀 소스면 그 구조 확인 |
| 대상에 아무것도 안 생김 | 소스 루트 오인식 | `--source` 로 `RND_PROJECT` 명시, `--dry-run` 으로 소스 경로 확인 |
| 과제가 `[없음]` 처리됨 | 새 차년도 폴더만 만들고 아직 extract 전(최신 차년도에 KR yaml 0개) | 의도된 동작 — **이전 차년도로 폴백하지 않음**. `/rnd-kr-extract` 로 최신 차년도를 구조화한 뒤 재실행 |
| 설정 `no_overwrite: true` 인데 이번만 덮어쓰고 싶음 | 불리언은 CLI 켜기 플래그만 있던 구버전 | `--overwrite`(또는 json 은 `--no-json`)로 일회성 반전 |
| 원본이 사라짐 걱정 | — | 이 스킬은 **복사만** 함(shutil.copy2). 원본은 절대 이동·삭제되지 않으며, 대상이 소스 트리 내부면 실행 자체가 거부됨 |
| ea_meta stub 이 안 생김 | PyYAML 미설치(중복 판별 불가로 생략) 또는 `--no-meta`/설정 `with_meta:false` | PyYAML 설치 후 재실행, 또는 `with_meta` 를 켠다. 이미 모든 수출 과제가 등록됐으면 정상(추가 없음) |
| 채워둔 ea_meta 값이 지워질까 걱정 | — | append-only·비파괴 — 채워진 블록·주석은 **읽기만** 하고 빈칸 stub 만 뒤에 붙인다. dest(KR_eclass)의 기존 ea_meta 도 seed 로 읽기만 하고 덮어쓰지 않음 |
| stub 키가 과제명 그대로 남음 | stub 은 미완성 — 사람이 채워야 함 | 행정정보 빈칸을 채우고 PMS 번호가 정해지면 최상위 키를 `RND-NN-YYYY` 로 교체(`source:` 는 그대로 두면 재실행 시 중복 안 생김) |

## 체크리스트

- [ ] 소스 루트(`RND_PROJECT`)·대상 폴더 확정(대상 미지정이면 `_export`).
- [ ] `--dry-run` 으로 과제별 선택(최신 차년도·최고 rev·정규화 이름)을 먼저 보고했다.
- [ ] 실복사 후 대상 폴더 목록과 복사/스킵/없음 집계를 보고했다.
- [ ] 원본(`KR_*.yaml`·차년도 폴더·이력)이 그대로임을 확인했다(복사만, 이동·삭제 없음).
- [ ] (요청 시) `--with-json` 으로 json 사본도 함께 복사했다.
- [ ] `with_meta`(기본 on): `_export/ea_meta.yaml` 에 미등록 수출 과제만 빈칸 stub 로 추가됐고, 기존 채워진 값·주석은 그대로임을 확인했다(재실행 멱등).
