#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
md2pdf.py — 변경안 마크다운을 한글 PDF 로 변환 (rnd-budget-change)

경로: (pandoc 있으면 pandoc, 없으면 내장 GFM 변환) md → 단독 HTML(한글 CSS 임베드)
      → 헤드리스 Edge/Chrome(HTML → PDF).
한글은 Malgun Gothic(맑은 고딕). Windows 11 기본 Edge/Chrome 으로 렌더 — 별도 PDF 엔진 불필요.

사용:
  python md2pdf.py <input.md> [-o <output.pdf>] [--title "제목"] [--browser <edge|chrome|경로>]
  -o 미지정 시 입력과 같은 폴더에 동일 stem .pdf.

전제: Edge 또는 Chrome 설치. pandoc 은 있으면 사용, 없으면 내장 변환기로 대체
      (이 스킬이 생성하는 MD 구조: 제목·GFM 표·bullet·굵게만 지원).
"""
import os
import re
import sys
import html
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
table { border-collapse: collapse; width:100%; margin:10px 0 16px; font-size:10pt; }
th, td { border:1px solid #8a8a8a; padding:5px 8px; text-align:right; }
th { background:#e9eef4; text-align:center; font-weight:bold; }
td:first-child, th:first-child { text-align:left; }
tbody tr:nth-child(even) { background:#f7f9fb; }
/* §3 변경 내역 표(문서의 마지막 표): 비목·전·후·증감 4열, 열너비 고정 */
table:last-of-type { table-layout: fixed; }
table:last-of-type th:nth-child(1), table:last-of-type td:nth-child(1) { width:40%; text-align:left; }   /* 비목 */
table:last-of-type th:nth-child(2), table:last-of-type td:nth-child(2) { width:20%; text-align:right; }   /* 전 */
table:last-of-type th:nth-child(3), table:last-of-type td:nth-child(3) { width:20%; text-align:right; }   /* 후 */
table:last-of-type th:nth-child(4), table:last-of-type td:nth-child(4) { width:20%; text-align:right; }   /* 증감 */
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


def _inline(s):
    # **굵게** → <strong>, `코드` → <code>, 나머지는 이스케이프
    parts = re.split(r"(\*\*.+?\*\*|`[^`]+`)", s)
    out = []
    for p in parts:
        if p.startswith("**") and p.endswith("**"):
            out.append("<strong>" + html.escape(p[2:-2]) + "</strong>")
        elif p.startswith("`") and p.endswith("`"):
            out.append("<code>" + html.escape(p[1:-1]) + "</code>")
        else:
            out.append(html.escape(p))
    return "".join(out)


def md_to_html_body(md_text):
    """이 스킬이 생성하는 MD(제목·GFM 표·bullet·굵게)만 처리하는 최소 변환기(pandoc 폴백)."""
    lines = md_text.replace("\r\n", "\n").split("\n")
    out = []
    i = 0
    n = len(lines)
    while i < n:
        ln = lines[i]
        s = ln.strip()
        if not s:
            i += 1
            continue
        m = re.match(r"^(#{1,3})\s+(.*)$", s)
        if m:
            lvl = len(m.group(1))
            out.append(f"<h{lvl}>{_inline(m.group(2))}</h{lvl}>")
            i += 1
            continue
        if s.startswith("|"):  # GFM 표 블록
            tbl = []
            while i < n and lines[i].strip().startswith("|"):
                tbl.append(lines[i].strip())
                i += 1

            def cells(row):
                return [c.strip() for c in row.strip().strip("|").split("|")]

            # tbl[1] = 정렬 구분선(:--, --:, :-:)에서 열별 정렬 추출
            aligns = []
            for sep in cells(tbl[1]) if len(tbl) > 1 else []:
                l, r = sep.startswith(":"), sep.endswith(":")
                aligns.append("center" if l and r else "right" if r else "left" if l else "")

            def sty(i):
                a = aligns[i] if i < len(aligns) else ""
                return f" style='text-align:{a}'" if a else ""

            out.append("<table>")
            header = cells(tbl[0])
            out.append("<thead><tr>" + "".join(f"<th{sty(i)}>{_inline(c)}</th>"
                                                for i, c in enumerate(header)) + "</tr></thead>")
            out.append("<tbody>")
            for row in tbl[2:]:  # tbl[1] = 구분선
                out.append("<tr>" + "".join(f"<td{sty(i)}>{_inline(c)}</td>"
                                            for i, c in enumerate(cells(row))) + "</tr>")
            out.append("</tbody></table>")
            continue
        if s.startswith("- "):  # bullet 목록
            out.append("<ul>")
            while i < n and lines[i].strip().startswith("- "):
                out.append(f"<li>{_inline(lines[i].strip()[2:])}</li>")
                i += 1
            out.append("</ul>")
            continue
        if s == "---":
            out.append("<hr>")
            i += 1
            continue
        out.append(f"<p>{_inline(s)}</p>")
        i += 1
    return "\n".join(out)


def build_html_builtin(md_path, title, css):
    md_text = open(md_path, "r", encoding="utf-8").read()
    body = md_to_html_body(md_text)
    return (f"<!DOCTYPE html><html lang='ko'><head><meta charset='utf-8'>"
            f"<title>{html.escape(title)}</title><style>{css}</style></head>"
            f"<body>{body}</body></html>")


def find_browser(pref=None):
    if pref and pref not in ("edge", "chrome"):
        return pref if os.path.isfile(pref) else die(f"브라우저 경로 없음: {pref}")
    if pref == "chrome":
        order = CHROME_PATHS + EDGE_PATHS
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
    browser = find_browser(browser_pref)

    tmpdir = tempfile.mkdtemp(prefix="md2pdf_")
    css_path = os.path.join(tmpdir, "style.css")
    html_path = os.path.join(tmpdir, "doc.html")
    with open(css_path, "w", encoding="utf-8") as f:
        f.write(CSS)

    if pandoc:
        cmd_pandoc = [pandoc, md, "-f", "gfm", "-t", "html5", "-s",
                      "--metadata", f"pagetitle={title}",
                      "--embed-resources", "--css", css_path, "-o", html_path]
        r = subprocess.run(cmd_pandoc, capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0 or not os.path.isfile(html_path):
            die(f"pandoc 변환 실패: {r.stderr.strip()}")
    else:
        # pandoc 미설치 — 내장 변환기로 단독 HTML 생성
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(build_html_builtin(md, title, CSS))

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
        run_browser("--headless", False)
    if not os.path.isfile(out):
        die(f"PDF 생성 실패(browser={browser}).")

    shutil.rmtree(tmpdir, ignore_errors=True)
    print(out)


if __name__ == "__main__":
    main()
