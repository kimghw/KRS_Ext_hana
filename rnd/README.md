# rnd — 차년도 YAML 을 뽑는 Claude Code 스킬 묶음

R&D 탭이 넣는 연구개발계획서 YAML(`KR_<과제>.yaml` · `history/*.yaml`)은 **RND 프로젝트(`E:\dev\RND`)의 Claude Code 스킬**이 만든다.
그 스킬 다섯 개를 여기 `skills/` 에 **그대로 복사해 두고**, R&D 탭 맨 아래 `차년도 YAML 뽑는 스킬` 칸에서 **zip 으로 내려받거나 쓰는 법을 복사**한다
(2026-10-08 사용자 지정 — "복사해서 쓸 수 있게 넣어 달라, 여기서 뽑겠다는 것은 아니다"). **이 확장은 YAML 을 뽑지 않는다.**

| 스킬 | 하는 일 |
|---|---|
| `rnd-kr-extract` | 연구개발계획서(PDF·HWP·공문·엑셀)에서 KR 업무만 발췌하고, `--format structured` 로 그 차년도의 연구개발 내용·예산을 `KR_<과제>.yaml` 로 구조화 |
| `rnd-kr-history` | 예산·참여연구원·과제목표의 변경이력(rev)을 `history/` 에 적재하고, 현행 스냅샷 `KR_<과제>_r{N}.yaml` 을 재생성 |
| `rnd-manpower-change` | 참여연구원이 바뀔 때 총 인건비를 고정한 재배분안(변경비교 YAML·PDF) |
| `rnd-budget-change` | 비목 사이 예산을 옮기는 변경안(변경비교 YAML·PDF) |
| `rnd-export-latest` | 과제별 최신 스냅샷을 `_export/` 한 폴더로 |

## 파일

- `skills/<스킬>/` — 원본 그대로(SKILL.md · scripts · references · profiles · templates · architecture.svg). **여기서 고치지 않는다** — RND 프로젝트에서 고치고 다시 복사한다.
  빼는 것: `__pycache__`·`*.pyc`, 사람마다 다른 실값 설정(`export.config.yaml`·`publish.config.yaml` — RND 의 `.toolignore` 와 같다), `*.tmp`·`*.bak`.
- `skills.json` — 목록(스킬 이름·요약·인자·파일·크기·복사한 날). R&D 탭이 이것을 읽어 목록을 보이고 zip 을 묶는다(`src/rndskills.js`).

## 다시 복사하기

```
node tools/rndskills.mjs sync                        # E:\dev\RND\.claude\skills 에서 다시 복사하고 목록을 만든다
node tools/rndskills.mjs sync --source <다른 경로>    # 원본이 다른 곳에 있을 때
node tools/rndskills.mjs check                       # 복사본이 원본과 다른지(다르면 1 로 끝남)
node tools/rndskills.mjs list                        # 목록
```

`npm test` 의 `test/rndskills.test.mjs` 는 복사본과 목록이 서로 맞는지만 본다(원본이 없는 PC 에서도 돈다).

## 쓰는 쪽에서

R&D 탭의 `스킬 묶음 저장 (zip)` 으로 받은 `rnd-skills_<날짜>.zip` 을 과제 작업 프로젝트의 `.claude/skills/` 에 풀면 `/rnd-kr-extract` … 다섯 스킬이 선다.
zip 맨 앞의 `README.md`(= `쓰는 법 복사` 의 글)에 차례가 있다: 계획서 구조화 → (바뀌면) 인건비·비목 변경안 → 이력 적재·현행 스냅샷 → 최신본 모으기 → 나온 YAML 을 R&D 탭에 넣기.
python 스크립트가 든 스킬(`year_slice.py`·`manpower_calc.py`·`budget_calc.py`·`export_latest.py`)은 python 3 이 있어야 한다.
