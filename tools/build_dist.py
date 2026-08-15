#!/usr/bin/env python3
"""배포용 압축 파일을 만든다.

    python3 tools/build_dist.py

dist/
├── 시후의-하루-계획표-windows.zip   # Windows 용 (파이썬만 있으면 바로 실행)
└── 시후의-하루-계획표-macos.zip     # macOS 용 (.app 번들, 실행 권한 보존)
"""

import os
import shutil
import subprocess
import sys
import zipfile

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(BASE, "dist")
APP_NAME = "시후의 하루 계획표"

# Windows 배치 파일은 CRLF + BOM 없는 UTF-8 이어야 한다.
# (BOM 이 있으면 첫 줄의 @echo off 가 깨진다)
BAT = """@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem 파이썬 런처(pyw)가 있으면 콘솔 창 없이 실행된다
where pyw >nul 2>nul && (start "" pyw -3 "app.py" & exit /b)
where pythonw >nul 2>nul && (start "" pythonw "app.py" & exit /b)
where python >nul 2>nul && (start "" python "app.py" & exit /b)

echo.
echo   Python 3 을 찾지 못했습니다.
echo.
echo   https://www.python.org/downloads/ 에서 설치해 주세요.
echo   설치 화면 맨 아래의 "Add python.exe to PATH" 를 반드시 체크해야 합니다.
echo.
pause
"""

SETUP = {
    "windows": """■ 1. 파이썬 설치 (처음 한 번만)
  https://www.python.org/downloads/ 에서 Python 3 을 받아 설치합니다.
  ★ 설치 첫 화면 맨 아래 "Add python.exe to PATH" 를 반드시 체크하세요.
    이걸 빠뜨리면 실행이 되지 않습니다.
  그 외에 따로 설치할 것은 없습니다.

■ 2. 압축 풀기
  받은 zip 파일을 오른쪽 클릭 → "압축 풀기" 를 누릅니다.
  (인터넷으로 받으셨다면, 풀기 전에 zip 파일 오른쪽 클릭 → 속성 →
   맨 아래 "차단 해제" 를 체크하고 확인을 누르면 경고창이 줄어듭니다.)

■ 3. 실행
  풀린 폴더 안의 "시후의 하루 계획표.bat" 을 더블클릭합니다.
  검은 창이 잠깐 떴다 사라지고, 기본 브라우저에 계획표가 열립니다.

  "Windows의 PC 보호" 창이 뜨면 → "추가 정보" → "실행" 을 누르세요.
  프로그램에 문제가 있는 것이 아니라, 인터넷에서 받은 파일에 뜨는 안내입니다.

■ 4. 바탕화면에 두기 (선택)
  .bat 파일 오른쪽 클릭 → "바로 가기 만들기" → 만들어진 바로 가기를
  바탕화면으로 옮기면 다음부터 편합니다.
""",
    "macos": """■ 1. 파이썬 설치 (처음 한 번만)
  https://www.python.org/downloads/ 에서 macOS 용 Python 3 을 받아
  설치합니다. 그 외에 따로 설치할 것은 없습니다.

■ 2. 압축 풀기
  받은 zip 파일을 더블클릭하면 "시후의 하루 계획표.app" 이 나옵니다.
  이 앱을 "응용 프로그램" 폴더로 옮기면 편합니다. (어디에 두어도 동작합니다)

■ 3. 첫 실행 — 차단 해제 (처음 한 번만) ★ 중요
  앱을 더블클릭하면 "Apple에서 확인할 수 없기 때문에 열 수 없습니다" 같은
  경고가 뜨고 실행되지 않습니다. Apple 개발자 등록(유료)을 하지 않은
  앱이어서 그렇습니다. 프로그램에 문제가 있는 것은 아닙니다.

  해제 방법:
   (1) 앱을 한 번 더블클릭합니다 (경고가 떠도 괜찮습니다. 확인을 누르세요)
   (2) 애플 메뉴 → 시스템 설정 → 개인 정보 보호 및 보안
   (3) 아래로 스크롤하면 "'시후의 하루 계획표'이(가) 차단되었습니다" 라는
       문구와 함께 [그래도 열기] 버튼이 있습니다. 이걸 누릅니다.
   (4) 암호를 넣고, 다시 뜨는 창에서 [열기] 를 누릅니다.
  한 번만 해두면 다음부터는 그냥 더블클릭으로 열립니다.

  ○ 터미널이 익숙하시면 아래 한 줄로 대신할 수 있습니다.
    xattr -dr com.apple.quarantine "/Applications/시후의 하루 계획표.app"
""",
}

DATA_PATH = {
    "windows": "  %APPDATA%\\시후의 하루 계획표\\\n"
               "  탐색기 주소창에 위 경로를 그대로 붙여넣으면 열립니다.",
    "macos": "  ~/Library/Application Support/시후의 하루 계획표/\n"
             "  Finder 에서 이동 메뉴 → 폴더로 이동 에 위 경로를 붙여넣으면 열립니다.",
}

MOD = {"windows": "Ctrl", "macos": "Cmd"}


def readme(os_key):
    return f"""시후의 하루 계획표
하루 계획을 원그래프로 그리고, 실제로 어떻게 보냈는지 겹쳐 기록해서
계획과 실제의 차이를 확인하는 프로그램입니다.

────────────────────────────────────────────────────────
설치
────────────────────────────────────────────────────────

{SETUP[os_key]}
────────────────────────────────────────────────────────
처음 써보기
────────────────────────────────────────────────────────

  1. 왼쪽 [계획] 원에서 활동을 하나 고르고, 원 위를 드래그하면
     그 시간만큼 색이 칠해집니다. 하루 계획을 이렇게 그립니다.
  2. 하루가 끝나면 오른쪽 [실행] 에서 [계획 복사] 를 누르고,
     실제와 달랐던 부분만 고쳐 그리세요. 이게 가장 빠릅니다.
  3. 아래 [계획 vs 실행 분석] 에서 일치율과 개선 가이드를 볼 수 있습니다.
  4. 위쪽 [주간 요약] 을 누르면 한 주 7일을 한 화면에서 비교합니다.

────────────────────────────────────────────────────────
종료하는 법  ★ 창만 닫으면 꺼지지 않습니다
────────────────────────────────────────────────────────

  화면 오른쪽 위 [종료] 버튼을 누르세요. 저장한 뒤 프로그램이 끝납니다.
  브라우저 창만 닫으면 프로그램은 계속 켜져 있습니다.
  (그래도 괜찮습니다. 다시 더블클릭하면 창이 다시 열립니다.)

────────────────────────────────────────────────────────
단축키
────────────────────────────────────────────────────────

  {MOD[os_key]} + S      지금 저장
  {MOD[os_key]} + Z      되돌리기
  {MOD[os_key]} + W      주간 요약 열기 / 닫기
  ← →            어제 / 내일 (주간 요약에서는 지난 주 / 다음 주)
  Esc            주간 요약 닫기

────────────────────────────────────────────────────────
기록이 저장되는 곳 / 백업
────────────────────────────────────────────────────────

{DATA_PATH[os_key]}

  백업하려면 이 폴더를 통째로 복사해 두세요.
  프로그램을 지워도 이 폴더의 기록은 그대로 남습니다.
  activities.json 에서 활동 이름과 색을 직접 고칠 수도 있습니다.
  ([＋ 활동] 으로 추가한 활동은 "공부" 그룹으로 들어갑니다. 생활 활동이면
   group 을 "생활" 로 바꾸세요. 원 가운데 "공부 시간" 합계 기준입니다.)

────────────────────────────────────────────────────────
잘 안 될 때
────────────────────────────────────────────────────────

  ○ 브라우저가 저절로 열리지 않을 때
    주소창에 다음을 직접 입력하세요.  http://127.0.0.1:8765

  ○ "Python 3 을 찾지 못했습니다" 가 뜰 때
    파이썬을 다시 설치하되, 설치 화면의
    "Add python.exe to PATH" 를 꼭 체크하세요. (Windows)

  ○ 더블클릭했는데 아무 일도 일어나지 않을 때
    이미 켜져 있을 수 있습니다. 브라우저 탭을 확인하거나
    주소창에 http://127.0.0.1:8765 를 입력해 보세요.

  ○ 화면이 예전 그대로일 때
    브라우저에서 새로고침({MOD[os_key]} + R) 을 누르세요.

  ○ 인터넷으로 기록이 올라가나요?
    아닙니다. 인터넷 연결 없이 동작하고, 기록은 이 컴퓨터 안에만 있습니다.
"""


def zip_windows():
    out = os.path.join(DIST, "시후의-하루-계획표-windows.zip")
    root = APP_NAME  # 압축을 풀면 이 이름의 폴더가 나온다

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{root}/{APP_NAME}.bat", BAT.replace("\n", "\r\n").encode("utf-8"))
        z.writestr(f"{root}/읽어주세요.txt",
                   readme("windows").replace("\n", "\r\n").encode("utf-8"))
        z.write(os.path.join(BASE, "app.py"), f"{root}/app.py")
        for name in sorted(os.listdir(os.path.join(BASE, "static"))):
            if name.startswith("."):
                continue
            z.write(os.path.join(BASE, "static", name), f"{root}/static/{name}")
    return out


def zip_macos():
    app = os.path.join(BASE, APP_NAME + ".app")
    if not os.path.isdir(app):
        return None
    out = os.path.join(DIST, "시후의-하루-계획표-macos.zip")
    if os.path.exists(out):
        os.remove(out)

    # 앱과 안내문을 한 폴더에 담아서 압축한다
    stage = os.path.join(DIST, "_stage", APP_NAME)
    os.makedirs(stage)
    shutil.copytree(app, os.path.join(stage, APP_NAME + ".app"), symlinks=True)
    with open(os.path.join(stage, "읽어주세요.txt"), "w", encoding="utf-8") as f:
        f.write(readme("macos"))

    # ditto 를 써야 실행 권한과 서명이 그대로 보존된다
    subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", stage, out], check=True)
    shutil.rmtree(os.path.join(DIST, "_stage"))
    return out


def main():
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)

    made = [zip_windows()]
    if sys.platform == "darwin":
        made.append(zip_macos())

    print("\n배포 파일:")
    for p in made:
        if p:
            print(f"  {os.path.basename(p)}  ({os.path.getsize(p) / 1024:.0f} KB)")
    print(f"\n{DIST}")


if __name__ == "__main__":
    sys.exit(main())
