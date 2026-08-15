#!/usr/bin/env python3
"""앱 아이콘(AppIcon.icns)을 만든다. 표준 라이브러리 + macOS 기본 도구만 사용.

    python3 tools/make_icon.py

헤더의 브랜드 마크와 같은 색 배치의 원그래프를 그린다.
"""

import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_ICNS = os.path.join(BASE, "시후의 하루 계획표.app", "Contents", "Resources", "AppIcon.icns")

SIZE = 1024
SS = 2  # 슈퍼샘플링 배수 (안티에일리어싱)

# (구간 끝 비율, RGB) — style.css 의 .brand-mark 와 동일
STOPS = [
    (0.25, (0x4C, 0x6F, 0xFF)),
    (0.45, (0x2F, 0xB6, 0xA5)),
    (0.62, (0xF2, 0xC1, 0x4E)),
    (0.78, (0xEB, 0x57, 0x57)),
    (1.00, (0x2E, 0x3A, 0x4B)),
]


def pie_color(frac):
    for edge, rgb in STOPS:
        if frac <= edge:
            return rgb
    return STOPS[-1][1]


def rounded_rect_hit(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def render(size, ss):
    n = size * ss
    inset = n * 0.055
    x0, y0, x1, y1 = inset, inset, n - inset, n - inset
    radius = (x1 - x0) * 0.225

    cx = cy = n / 2.0
    r_pie = n * 0.305
    r_hole = n * 0.108
    r_pie2, r_hole2 = r_pie * r_pie, r_hole * r_hole

    # 서브픽셀 색을 만든 뒤 ss x ss 로 평균낸다
    rows = []
    for py in range(n):
        row = []
        dy = py + 0.5 - cy
        for px in range(n):
            if not rounded_rect_hit(px + 0.5, py + 0.5, x0, y0, x1, y1, radius):
                row.append((0, 0, 0, 0))
                continue
            # 아주 옅은 세로 그라데이션 배경
            t = (py + 0.5 - y0) / (y1 - y0)
            bg = (255, int(255 - 9 * t), int(255 - 14 * t))
            dx = px + 0.5 - cx
            d2 = dx * dx + dy * dy
            if d2 <= r_hole2:
                row.append(bg + (255,))
            elif d2 <= r_pie2:
                ang = math.degrees(math.atan2(dx, -dy)) % 360.0
                row.append(pie_color(ang / 360.0) + (255,))
            else:
                row.append(bg + (255,))
        rows.append(row)

    # 다운샘플
    out = bytearray()
    inv = 1.0 / (ss * ss)
    for y in range(size):
        out.append(0)  # PNG filter: none
        for x in range(size):
            r = g = b = a = 0
            for j in range(ss):
                src = rows[y * ss + j]
                for i in range(ss):
                    pr, pg, pb, pa = src[x * ss + i]
                    r += pr * pa; g += pg * pa; b += pb * pa; a += pa
            if a:
                out += bytes((int(r / a), int(g / a), int(b / a), int(a * inv)))
            else:
                out += b"\0\0\0\0"
    return bytes(out)


def png(path, size, raw):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


ICONSET = [
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
]


def main():
    tmp = tempfile.mkdtemp()
    iconset = os.path.join(tmp, "icon.iconset")
    os.makedirs(iconset)

    print(f"{SIZE}px 렌더링 중…")
    master = os.path.join(tmp, "master.png")
    png(master, SIZE, render(SIZE, SS))

    for name, s in ICONSET:
        dst = os.path.join(iconset, name)
        if s == SIZE:
            shutil.copyfile(master, dst)
        else:
            subprocess.run(["sips", "-z", str(s), str(s), master, "--out", dst],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    os.makedirs(os.path.dirname(OUT_ICNS), exist_ok=True)
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", OUT_ICNS], check=True)
    shutil.rmtree(tmp)
    print("만들었습니다:", OUT_ICNS)


if __name__ == "__main__":
    sys.exit(main())
