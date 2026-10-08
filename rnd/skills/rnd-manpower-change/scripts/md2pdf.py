#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
md2pdf.py — 변경안 마크다운을 한글 PDF 로 변환 (rnd-manpower-change)

경로: pandoc(md → 단독 HTML, 한글 CSS 임베드) → 헤드리스 Edge/Chrome(HTML → PDF).
한글은 Malgun Gothic(맑은 고딕). Windows 11 기본 Edge/Chrome 으로 렌더 — 별도 PDF 엔진 불필요.

사용:
  python md2pdf.py <input.md> [-o <output.pdf>] [--title "제목"] [--browser <edge|chrome|경로>]
  -o 미지정 시 입력과 같은 폴더에 동일 stem .pdf.

전제: pandoc 설치(PATH), Edge 또는 Chrome 설치.
"""
import os
import sys
import shutil
import subprocess
import tempfile

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

CSS = """
@page { size: A4; margin: 16mm 14mm; }
html, body { font-family: 'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo',sans-serif;
             font-size: 11pt; color:#222; line-height:1.45; }
h1 { font-size: 19pt; border-bottom:2.5px solid #2b4b6f; padding-bottom:5px; color:#1f3a57; }
h2 { font-size: 13.5pt; margin-top:20px; border-left:5px solid #2b4b6f; padding-left:9px; color:#1f3a57; }
h3 { font-size: 12pt; margin-top:14px; }
table { border-collapse: collapse; width:100%; margin:10px 0 16px; font-size:9.7pt; }
th, td { border:1px solid #8a8a8a; padding:5px 7px; text-align:right; }
th { background:#e9eef4; text-align:center; font-weight:bold; }
td:first-child, th:first-child { text-align:left; }
tbody tr:nth-child(even) { background:#f7f9fb; }
/* §3 변경 내역 표(문서의 마지막 표): 성명·분류 별도 열·1줄, 계상률/인건비 2줄, 열너비 고정으로 너비 조절 */
table:last-of-type { table-layout: fixed; }
table:last-of-type th, table:last-of-type td { text-align:center; vertical-align:middle; }
table:last-of-type th:nth-child(1), table:last-of-type td:nth-child(1) { width:10%; white-space:nowrap; }  /* 성명 */
table:last-of-type th:nth-child(2), table:last-of-type td:nth-child(2) { width:8%;  white-space:nowrap; }  /* 분류 */
table:last-of-type th:nth-child(3), table:last-of-type td:nth-child(3) { width:27%; white-space:nowrap; }  /* 전 참여기간 */
table:last-of-type th:nth-child(4), table:last-of-type td:nth-child(4) { width:14%; }                      /* 전 계상률/인건비 */
table:last-of-type th:nth-child(5), table:last-of-type td:nth-child(5) { width:27%; white-space:nowrap; }  /* 후 참여기간 */
table:last-of-type th:nth-child(6), table:last-of-type td:nth-child(6) { width:14%; }                      /* 후 계상률/인건비 */
table:last-of-type td:first-child { text-align:center; }
strong { color:#10243a; }
ul { margin:6px 0 6px 0; }
code { background:#f0f0f0; padding:1px 4px; border-radius:3px; }
hr { border:none; border-top:1px solid #ccc; margin:14px 0; }
"""

CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]
EDGE_PATHS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def die(msg):
    print(f"[md2pdf] 오류: {msg}", file=sys.stderr)
    sys.exit(1)


def find_browser(pref=None):
    if pref and pref not in ("edge", "chrome"):
        return pref if os.path.isfile(pref) else die(f"브라우저 경로 없음: {pref}")
    order = []
    if pref == "chrome":
        order = CHROME_PATHS + EDGE_PATHS
    elif pref == "edge":
        order = EDGE_PATHS + CHROME_PATHS
    else:
        order = EDGE_PATHS + CHROME_PATHS
    for p in order:
        if os.path.isfile(p):
            return p
    for name in ("msedge", "chrome", "chromium"):
        w = shutil.which(name)
        if w:
            return w
    die("Edge/Chrome 을 찾지 못했습니다. --browser <경로> 로 지정하세요.")


def main():
    args = sys.argv[1:]
    out = None
    title = None
    browser_pref = None
    rest = []
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("-o", "--out"):
            out = args[i + 1]; i += 2
        elif a == "--title":
            title = args[i + 1]; i += 2
        elif a == "--browser":
            browser_pref = args[i + 1]; i += 2
        elif a in ("-h", "--help"):
            print(__doc__); return
        else:
            rest.append(a); i += 1
    if not rest:
        die("입력 마크다운 경로가 필요합니다.")
    md = os.path.abspath(rest[0])
    if not os.path.isfile(md):
        die(f"입력 파일 없음: {md}")
    if not out:
        out = os.path.splitext(md)[0] + ".pdf"
    out = os.path.abspath(out)
    if not title:
        title = os.path.splitext(os.path.basename(md))[0]

    pandoc = shutil.which("pandoc")
    if not pandoc:
        die("pandoc 이 필요합니다(PATH). winget install JohnMacFarlane.Pandoc")
    browser = find_browser(browser_pref)

    tmpdir = tempfile.mkdtemp(prefix="md2pdf_")
    css_path = os.path.join(tmpdir, "style.css")
    html_path = os.path.join(tmpdir, "doc.html")
    with open(css_path, "w", encoding="utf-8") as f:
        f.write(CSS)

    # 1) pandoc: md(gfm) -> 단독 HTML, CSS 임베드
    #    pagetitle 은 <head><title> 만 설정(본문에 제목 블록을 추가하지 않음) — 본문 제목 중복 방지.
    cmd_pandoc = [pandoc, md, "-f", "gfm", "-t", "html5", "-s",
                  "--metadata", f"pagetitle={title}",
                  "--embed-resources", "--css", css_path, "-o", html_path]
    r = subprocess.run(cmd_pandoc, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0 or not os.path.isfile(html_path):
        die(f"pandoc 변환 실패: {r.stderr.strip()}")

    # 2) 헤드리스 브라우저: HTML -> PDF
    #    - 격리 프로필(--user-data-dir): 실행 중인 브라우저에 붙어 안 끝나는 문제 방지
    #    - stdout/stderr=DEVNULL: capture 파이프를 자식이 물고 hang 되는 문제 방지
    #    - timeout: 안전망(파일 생기면 성공으로 간주)
    if os.path.isfile(out):
        os.remove(out)
    file_url = "file:///" + html_path.replace("\\", "/")
    profile = os.path.join(tmpdir, "profile")
    common = [f"--user-data-dir={profile}", "--no-first-run",
              "--no-default-browser-check", "--disable-extensions", "--disable-gpu"]

    def run_browser(headless_flag, no_hf):
        cmd = [browser, headless_flag] + common
        if no_hf:
            cmd.append("--no-pdf-header-footer")
        cmd += [f"--print-to-pdf={out}", file_url]
        try:
            subprocess.run(cmd, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=120)
        except subprocess.TimeoutExpired:
            pass

    run_browser("--headless=new", True)
    if not os.path.isfile(out):
        run_browser("--headless", False)   # 구버전 폴백
    if not os.path.isfile(out):
        die(f"PDF 생성 실패(browser={browser}).")

    shutil.rmtree(tmpdir, ignore_errors=True)
    print(out)


if __name__ == "__main__":
    main()
