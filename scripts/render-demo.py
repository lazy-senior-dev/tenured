#!/usr/bin/env python3
"""Render assets/demo.gif: a terminal recording of a write being denied, fixed, and approved.
Pure Pillow, no terminal recorder needed. Frames are drawn from the same script the site plays."""
import os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "demo.gif")
W, H, PAD, LINE_H, FPS = 960, 470, 26, 24, 12
BG, FG, DIM, BLOCK, OK, WARN, BAR = (11, 15, 28), (230, 233, 242), (138, 147, 173), (255, 138, 101), (127, 216, 143), (255, 209, 102), (58, 68, 102)

def font(size=17, bold=False):
    for path in ["/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/SFNSMono.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size, index=1 if (bold and path.endswith(".ttc")) else 0)
            except Exception:
                continue
    return ImageFont.load_default()

F, FB = font(), font(bold=True)
SCRIPT = [
    ("$ claude", FG, "type"),
    ("> add a /me endpoint that returns the profile and notification settings", DIM, "type"),
    ("", FG, "pause"),
    ("Writing app/api/profiles.py ...", DIM, "line"),
    ("GRUMP: BLOCK", BLOCK, "bold"),
    ("1. app/api/profiles.py:14 — user_id is read from the request body, so any caller", FG, "line"),
    ("   can read any profile — take it from the session", FG, "line"),
    ("write denied until fixed", DIM, "hold"),
    ("", FG, "pause"),
    ("Taking user_id from the session instead. Reviewing again ...", DIM, "line"),
    ("GRUMP: APPROVE — app/api/profiles.py", OK, "bold"),
    ("Fine.", FG, "line"),
    ("Writing app/api/profiles.py ... done", DIM, "hold"),
]

def frame(lines, cursor):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    for i, c in enumerate(((255, 95, 87), (255, 189, 46), (39, 201, 63))):
        d.ellipse((PAD + i * 18, 16, PAD + i * 18 + 11, 27), fill=BAR)
    d.text((W - PAD - 190, 13), "grumpy-reviewer · nag", font=font(13), fill=DIM)
    y = 48
    for text, color, kind in lines:
        d.text((PAD, y), text, font=FB if kind == "bold" else F, fill=color)
        y += LINE_H
    if cursor:
        d.rectangle((PAD + (len(lines[-1][0]) if lines else 0) * 10.2 + 2, y - LINE_H + 3, PAD + (len(lines[-1][0]) if lines else 0) * 10.2 + 11, y - 4), fill=FG)
    return im

frames, durations, shown = [], [], []
def emit(im, ms):
    frames.append(im); durations.append(ms)
for text, color, kind in SCRIPT:
    if kind == "type":
        for k in range(1, len(text) + 1):
            emit(frame(shown + [(text[:k], color, kind)], True), 28)
        shown.append((text, color, kind)); emit(frame(shown, True), 450)
    elif kind == "pause":
        shown.append((text, color, kind)); emit(frame(shown, False), 250)
    else:
        shown.append((text, color, kind)); emit(frame(shown, False), 1100 if kind in ("bold", "hold") else 650)
emit(frame(shown, False), 3200)
frames[0].save(OUT, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
print("wrote", os.path.relpath(OUT, ROOT), len(frames), "frames", os.path.getsize(OUT) // 1024, "KB")
