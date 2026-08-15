#!/usr/bin/env python3
"""시후의 하루 계획표 - 로컬 실행 진입점.

표준 라이브러리만 사용한다. 실행하면 127.0.0.1 로컬 서버가 뜨고
기본 브라우저가 자동으로 열린다. pywebview가 설치돼 있으면
브라우저 대신 독립 데스크톱 창으로 띄운다.

    python3 app.py
"""

import json
import os
import re
import sys
import threading
import webbrowser
from datetime import date, timedelta
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, "static")
APP_DIR_NAME = "시후의 하루 계획표"


def default_data_dir():
    """OS 별 사용자 데이터 폴더.

    macOS 는 ~/Documents 안의 서명 없는 앱이 개인정보 보호(TCC)에 막히므로
    프로젝트 폴더가 아니라 반드시 사용자 데이터 폴더에 저장해야 한다.
    Windows/Linux 도 같은 규칙을 따라 실행 위치와 무관하게 한 곳을 쓴다.
    """
    if sys.platform == "win32":
        root = os.environ.get("APPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        root = os.path.expanduser("~/Library/Application Support")
    else:
        root = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return os.path.join(root, APP_DIR_NAME)


DATA = default_data_dir()
DAYS = os.path.join(DATA, "days")
ACTIVITIES_PATH = os.path.join(DATA, "activities.json")

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_BODY = 1 << 20  # 1MB
APP_ID = "sihu-study-plan"
PORT = 8765

DEFAULT_ACTIVITIES = [
    {"id": "math", "name": "수학", "color": "#4C6FFF", "group": "공부"},
    {"id": "english", "name": "영어", "color": "#7C5CFF", "group": "공부"},
    {"id": "reading", "name": "국어/독서", "color": "#2FB6A5", "group": "공부"},
    {"id": "school", "name": "학교", "color": "#3A8DDE", "group": "공부"},
    {"id": "academy", "name": "학원/과외", "color": "#5C7CFA", "group": "공부"},
    {"id": "homework", "name": "숙제/복습", "color": "#00A3A3", "group": "공부"},
    {"id": "exercise", "name": "운동", "color": "#F2994A", "group": "활동"},
    {"id": "meal", "name": "식사", "color": "#F2C14E", "group": "생활"},
    {"id": "rest", "name": "휴식/자유", "color": "#9AA5B1", "group": "생활"},
    {"id": "play", "name": "놀이/미디어", "color": "#EB5757", "group": "생활"},
    {"id": "move", "name": "이동", "color": "#C0C7D0", "group": "생활"},
    {"id": "sleep", "name": "수면", "color": "#2E3A4B", "group": "생활"},
]


def log(msg):
    """콘솔 없이 실행될 때(Windows 의 pythonw)는 sys.stdout 이 None 이고,
    cp949 콘솔에서는 한글 출력이 실패할 수 있다. 어느 쪽이든 죽지 않게 한다."""
    try:
        if sys.stdout is not None:
            print(msg, flush=True)
    except Exception:
        pass


def ensure_data():
    os.makedirs(DAYS, exist_ok=True)
    if not os.path.exists(ACTIVITIES_PATH):
        write_json(ACTIVITIES_PATH, DEFAULT_ACTIVITIES)


def read_json(path, fallback):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return fallback


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def day_path(d):
    return os.path.join(DAYS, d + ".json")


def empty_day(d):
    return {"date": d, "plan": [], "actual": [], "memo": "", "updated_at": None}


def load_day(d):
    return read_json(day_path(d), empty_day(d))


def clean_blocks(raw):
    """신뢰할 수 없는 입력에서 유효한 블록만 추려낸다."""
    out = []
    if not isinstance(raw, list):
        return out
    for b in raw[:500]:
        if not isinstance(b, dict):
            continue
        try:
            s, e = int(b["start"]), int(b["end"])
        except (KeyError, TypeError, ValueError):
            continue
        act = b.get("activity")
        if not isinstance(act, str) or not act:
            continue
        s, e = max(0, min(1440, s)), max(0, min(1440, e))
        if e <= s:
            continue
        out.append({"start": s, "end": e, "activity": act[:40]})
    out.sort(key=lambda b: b["start"])
    return out


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC, **kwargs)

    # --- helpers -----------------------------------------------------
    def send_json(self, obj, status=HTTPStatus.OK):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None

    def end_headers(self):
        # 화면 파일을 브라우저가 캐시해 두면 프로그램을 고쳐도 예전 화면이 뜬다.
        # 매번 서버에 확인하게 한다(안 바뀌었으면 304 라 비용은 거의 없다).
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def log_message(self, *args):
        pass

    # --- routes ------------------------------------------------------
    def do_GET(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            return super().do_GET()
        q = parse_qs(parsed.query)

        if parsed.path == "/api/ping":
            return self.send_json({"app": APP_ID})

        if parsed.path == "/api/activities":
            return self.send_json(read_json(ACTIVITIES_PATH, DEFAULT_ACTIVITIES))

        if parsed.path == "/api/day":
            d = (q.get("date") or [""])[0]
            if not DATE_RE.match(d):
                return self.send_json({"error": "bad date"}, HTTPStatus.BAD_REQUEST)
            return self.send_json(load_day(d))

        if parsed.path == "/api/range":
            start = (q.get("start") or [""])[0]
            end = (q.get("end") or [""])[0]
            if not (DATE_RE.match(start) and DATE_RE.match(end)):
                return self.send_json({"error": "bad date"}, HTTPStatus.BAD_REQUEST)
            try:
                d0, d1 = date.fromisoformat(start), date.fromisoformat(end)
            except ValueError:
                return self.send_json({"error": "bad date"}, HTTPStatus.BAD_REQUEST)
            span = (d1 - d0).days
            if span < 0 or span > 61:
                return self.send_json({"error": "bad range"}, HTTPStatus.BAD_REQUEST)
            # 비어 있는 날짜도 빈 껍데기로 채워서 돌려준다
            return self.send_json(
                [load_day((d0 + timedelta(days=i)).isoformat()) for i in range(span + 1)]
            )

        if parsed.path == "/api/recent":
            d = (q.get("date") or [""])[0]
            if not DATE_RE.match(d):
                return self.send_json({"error": "bad date"}, HTTPStatus.BAD_REQUEST)
            try:
                n = max(1, min(31, int((q.get("n") or ["7"])[0])))
            except ValueError:
                n = 7
            try:
                end = date.fromisoformat(d)
            except ValueError:
                return self.send_json({"error": "bad date"}, HTTPStatus.BAD_REQUEST)
            days = []
            for i in range(n - 1, -1, -1):
                key = (end - timedelta(days=i)).isoformat()
                if os.path.exists(day_path(key)):
                    days.append(load_day(key))
            return self.send_json(days)

        return self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self):
        parsed = urlparse(self.path)
        payload = self.read_body()
        if payload is None:
            return self.send_json({"error": "bad body"}, HTTPStatus.BAD_REQUEST)

        if parsed.path == "/api/day":
            d = payload.get("date", "")
            if not isinstance(d, str) or not DATE_RE.match(d):
                return self.send_json({"error": "bad date"}, HTTPStatus.BAD_REQUEST)
            memo = payload.get("memo", "")
            record = {
                "date": d,
                "plan": clean_blocks(payload.get("plan")),
                "actual": clean_blocks(payload.get("actual")),
                "memo": memo[:2000] if isinstance(memo, str) else "",
                "updated_at": payload.get("updated_at") or None,
            }
            write_json(day_path(d), record)
            return self.send_json({"ok": True})

        if parsed.path == "/api/quit":
            self.send_json({"ok": True})
            threading.Thread(target=shutdown_soon, args=(self.server,), daemon=True).start()
            return

        if parsed.path == "/api/activities":
            if not isinstance(payload, list) or len(payload) > 100:
                return self.send_json({"error": "bad body"}, HTTPStatus.BAD_REQUEST)
            cleaned = []
            for a in payload:
                if not isinstance(a, dict):
                    continue
                aid = str(a.get("id", ""))[:40]
                name = str(a.get("name", ""))[:40]
                color = str(a.get("color", ""))[:20]
                group = str(a.get("group", "생활"))[:20]
                if aid and name:
                    cleaned.append(
                        {"id": aid, "name": name, "color": color, "group": group}
                    )
            write_json(ACTIVITIES_PATH, cleaned)
            return self.send_json({"ok": True})

        return self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)


def shutdown_soon(server):
    """UI 의 '종료' 버튼 처리. 응답이 나간 뒤 서버를 내리고 프로세스를 끝낸다."""
    import time

    time.sleep(0.4)
    try:
        server.shutdown()
    finally:
        os._exit(0)


def already_running(port):
    """이미 떠 있는 우리 서버가 있으면 True. (앱을 두 번 눌러도 창만 다시 연다)"""
    import urllib.request

    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=0.8) as r:
            return json.loads(r.read().decode("utf-8")).get("app") == APP_ID
    except Exception:
        return False


class Server(ThreadingHTTPServer):
    # Windows 의 SO_REUSEADDR 은 "이미 쓰는 포트에도 붙는" 의미라서 두 인스턴스가
    # 같은 포트를 잡을 수 있다. 그래서 Windows 에서만 끈다.
    allow_reuse_address = sys.platform != "win32"
    daemon_threads = True


def make_server(preferred=PORT):
    """가능하면 항상 같은 포트를 쓴다."""
    for port in range(preferred, preferred + 20):
        try:
            return Server(("127.0.0.1", port), Handler), port
        except OSError:
            continue
    raise SystemExit("사용 가능한 포트를 찾지 못했습니다.")


def main():
    ensure_data()
    quiet_early = "--no-open" in sys.argv

    if already_running(PORT):
        url = f"http://127.0.0.1:{PORT}/"
        log(f"  이미 실행 중입니다  →  {url}")
        if not quiet_early:
            webbrowser.open(url)
        return

    server, port = make_server()
    url = f"http://127.0.0.1:{port}/"

    log(f"  시후의 하루 계획표  →  {url}")
    log("  종료하려면 화면 오른쪽 위 '종료' 버튼 또는 Ctrl+C\n")

    quiet = "--no-open" in sys.argv

    try:  # 설치돼 있으면 독립 창, 없으면 브라우저
        if quiet:
            raise ImportError
        import webview  # type: ignore

        threading.Thread(target=server.serve_forever, daemon=True).start()
        webview.create_window("시후의 하루 계획표", url, width=1440, height=980)
        webview.start()
        return
    except ImportError:
        pass

    if not quiet:
        threading.Thread(
            target=lambda: (threading.Event().wait(0.4), webbrowser.open(url)),
            daemon=True,
        ).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("\n종료합니다.")
        server.shutdown()


if __name__ == "__main__":
    sys.exit(main())
