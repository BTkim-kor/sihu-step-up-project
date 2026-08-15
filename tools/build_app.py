#!/usr/bin/env python3
"""더블클릭 실행용 macOS 앱 번들을 만든다.

    python3 tools/build_app.py

app.py / static 을 고친 뒤에는 이 스크립트를 다시 돌려야 앱에 반영된다.

왜 번들 안에 소스를 복사하나:
  ~/Documents 안에 있는 서명 없는 앱은 macOS 개인정보 보호(TCC) 때문에
  같은 폴더의 파일조차 읽지 못한다(프롬프트도 뜨지 않는다). 앱이 자기 번들
  안의 파일과 ~/Library/Application Support 만 쓰도록 하면 이 문제가 없다.
"""

import os
import plistlib
import shutil
import subprocess
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_NAME = "시후의 하루 계획표"
APP = os.path.join(BASE, APP_NAME + ".app")
CONTENTS = os.path.join(APP, "Contents")
MACOS = os.path.join(CONTENTS, "MacOS")
RES = os.path.join(CONTENTS, "Resources")

DATA = os.path.join(os.path.expanduser("~/Library/Application Support"), APP_NAME)
LEGACY = os.path.join(BASE, "data")

INFO = {
    "CFBundleName": APP_NAME,
    "CFBundleDisplayName": APP_NAME,
    "CFBundleIdentifier": "local.sihu.studyplan",
    "CFBundleExecutable": "launch",
    "CFBundleIconFile": "AppIcon",
    "CFBundlePackageType": "APPL",
    "CFBundleInfoDictionaryVersion": "6.0",
    "CFBundleShortVersionString": "1.0",
    "CFBundleVersion": "1",
    "LSMinimumSystemVersion": "10.13",
    "NSHighResolutionCapable": True,
}

LAUNCHER = r"""#!/bin/bash
# 시후의 하루 계획표 — 더블클릭 실행용 런처 (tools/build_app.py 가 생성)
set -u

RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
DATA="$HOME/Library/Application Support/시후의 하루 계획표"
mkdir -p "$DATA"

# LaunchServices 로 실행되면 PATH 가 최소라서 파이썬을 직접 찾는다
PY=""
for p in \
  /usr/local/bin/python3 \
  /opt/homebrew/bin/python3 \
  /Library/Frameworks/Python.framework/Versions/Current/bin/python3 \
  "$HOME/.pyenv/shims/python3" \
  /usr/bin/python3
do
  if [ -x "$p" ]; then PY="$p"; break; fi
done
[ -z "$PY" ] && PY="$(command -v python3 || true)"

if [ -z "$PY" ]; then
  /usr/bin/osascript -e 'display alert "시후의 하루 계획표" message "Python 3 을 찾지 못했습니다. python.org 에서 설치한 뒤 다시 실행해 주세요." as critical' >/dev/null 2>&1
  exit 1
fi

# 서버는 떼어내서 띄우고 런처는 바로 끝낸다.
# 런처가 계속 떠 있으면 macOS 가 앱을 '실행 중'으로 보고, 다시 더블클릭해도
# 창이 열리지 않는다(_LSOpenURLsWithCompletionHandler -600). 이미 서버가 떠
# 있으면 app.py 가 알아서 브라우저만 다시 연다.
nohup "$PY" "$RES/app.py" >>"$DATA/last-run.log" 2>&1 &
"""


def sync_sources():
    shutil.copyfile(os.path.join(BASE, "app.py"), os.path.join(RES, "app.py"))
    dst_static = os.path.join(RES, "static")
    if os.path.isdir(dst_static):
        shutil.rmtree(dst_static)
    shutil.copytree(os.path.join(BASE, "static"), dst_static)


def migrate_data():
    """예전에 프로젝트 폴더 안에 있던 기록을 새 위치로 옮기고 링크를 남긴다."""
    os.makedirs(os.path.join(DATA, "days"), exist_ok=True)

    if os.path.isdir(LEGACY) and not os.path.islink(LEGACY):
        moved = 0
        for rel in ["activities.json"] + [
            os.path.join("days", f) for f in os.listdir(os.path.join(LEGACY, "days"))
            if os.path.isdir(os.path.join(LEGACY, "days"))
        ]:
            src, dst = os.path.join(LEGACY, rel), os.path.join(DATA, rel)
            if os.path.exists(src) and not os.path.exists(dst):
                shutil.move(src, dst)
                moved += 1
        shutil.rmtree(LEGACY, ignore_errors=True)
        if moved:
            print(f"  기존 기록 {moved}개를 새 위치로 옮겼습니다.")

    if not os.path.exists(LEGACY):
        os.symlink(DATA, LEGACY)
        print(f"  링크: data -> {DATA}")


def main():
    for d in (MACOS, RES):
        os.makedirs(d, exist_ok=True)

    with open(os.path.join(CONTENTS, "Info.plist"), "wb") as f:
        plistlib.dump(INFO, f)

    launch = os.path.join(MACOS, "launch")
    with open(launch, "w", encoding="utf-8") as f:
        f.write(LAUNCHER)
    os.chmod(launch, 0o755)

    sync_sources()

    if not os.path.exists(os.path.join(RES, "AppIcon.icns")):
        subprocess.run([sys.executable, os.path.join(BASE, "tools", "make_icon.py")], check=True)

    migrate_data()

    # 애드혹 서명 — 없으면 "손상되었다"는 경고가 뜰 수 있다
    subprocess.run(["codesign", "--force", "--deep", "--sign", "-", APP],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["touch", APP], check=False)  # Finder 아이콘 캐시 갱신

    print("만들었습니다:", APP)


if __name__ == "__main__":
    sys.exit(main())
