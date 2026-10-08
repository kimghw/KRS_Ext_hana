#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
to_pending.py — 변경안 회차 폴더를 전역 _pending 검토 큐로 복사 (rnd-budget-change / rnd-manpower-change 공용)

각 스킬이 생성한 회차 폴더(out_dir = ...\\<budget_change|manpower_change>\\rev<NN>_<작성일>) 를
통째로 RND_PROJECT\\_pending\\<과제>\\<연차>_<종류>_rev<NN>_<작성일>\\ 로 복사한다.
  - 원본 보존(복사만) — out_dir 은 그대로 두고 사본만 큐에 올린다.
  - 검토·승인 대기 변경안을 과제 무관하게 한곳에 모아 훑어보기 위함(_export 관례와 짝).

경로만으로 과제·연차·종류·회차를 도출한다(out_dir 구조가 고정: RND_PROJECT\\<과제>\\<연차>\\<종류_change>\\<회차폴더>).
필요 시 --project / --year / --kind / --pending-root 로 덮어쓴다.

  python to_pending.py <out_dir> [--pending-root <dir>] [--project P] [--year Y] [--kind 비목|인건비] [--dry-run]

종류 매핑: budget_change→비목 · manpower_change→인건비.
exit: 0=복사(또는 --dry-run 경로 출력), 1=오류.
"""
import sys
import os
import shutil

# 회차 폴더의 부모 폴더명(<종류>_change) → 사람이 읽는 종류 라벨
KIND = {"budget_change": "비목", "manpower_change": "인건비"}


def fail(msg):
    print(f"[to_pending] 오류: {msg}", file=sys.stderr)
    sys.exit(1)


def _opt(args, name):
    if name in args:
        i = args.index(name)
        if i + 1 < len(args):
            return args[i + 1]
    return None


def _find_project_root(src):
    """src 조상 중 이름이 정확히 'RND_PROJECT' 인 폴더를 찾는다. 없으면 out_dir 4단계 위(레벨 동일)."""
    p = src
    while True:
        if os.path.basename(p) == "RND_PROJECT":
            return p
        parent = os.path.dirname(p)
        if parent == p:
            break
        p = parent
    # 폴백: out_dir = RND_PROJECT\<과제>\<연차>\<종류_change>\<회차> → 4단계 위가 RND_PROJECT 레벨
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(src))))


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return

    dry = "--dry-run" in args
    consumed = set()
    for n in ("--pending-root", "--project", "--year", "--kind"):
        v = _opt(args, n)
        if v is not None:
            consumed.add(v)
    pos = [a for a in args if not a.startswith("--") and a not in consumed]
    if not pos:
        fail("out_dir(회차 폴더) 경로가 필요합니다.")

    src = os.path.normpath(os.path.abspath(pos[0].rstrip("/\\")))
    if not os.path.isdir(src):
        fail(f"회차 폴더가 없습니다: {src}")

    round_name = os.path.basename(src)                          # rev01_2026-07-15
    change_dir = os.path.basename(os.path.dirname(src))          # budget_change / manpower_change
    year = _opt(args, "--year") or os.path.basename(os.path.dirname(os.path.dirname(src)))
    project = _opt(args, "--project") or os.path.basename(
        os.path.dirname(os.path.dirname(os.path.dirname(src)))
    )
    kind = _opt(args, "--kind") or KIND.get(change_dir, change_dir)

    pending_root = _opt(args, "--pending-root")
    if not pending_root:
        pending_root = os.path.join(_find_project_root(src), "_pending")

    dest = os.path.join(pending_root, project, f"{year}_{kind}_{round_name}")

    if dry:
        print(dest)
        return

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    # 같은 회차 재실행 시 스테일 파일이 남지 않도록 사본을 새로 만든다(원본 out_dir 은 건드리지 않음).
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    shutil.copytree(src, dest)
    print(dest)


if __name__ == "__main__":
    main()
