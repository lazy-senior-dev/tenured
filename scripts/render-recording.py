#!/usr/bin/env python3
"""Render a captured CLI run (assets/recordings/<agent>.json) as a terminal GIF.
   python3 scripts/render-recording.py assets/recordings/claude.json assets/recordings/claude.gif"""
import json, os, sys, textwrap
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
t = json.load(open(src))
W, PAD, LINE_H, MAXCOLS = 1000, 26, 22, 108
BG, FG, DIM, BLOCK, OK, WARN, BAR = (11, 15, 28), (230, 233, 242), (138, 147, 173), (255, 138, 101), (127, 216, 143), (255, 209, 102), (58, 68, 102)

def font(size=15, bold=False):
    for path in ["/System/Library/Fonts/Menlo.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]:
        if os.path.exists(path):
            try: return ImageFont.truetype(path, size, index=1 if (bold and path.endswith(".ttc")) else 0)
            except Exception: pass
    return ImageFont.load_default()
F, FB = font(), font(bold=True)

def wrap(line):
    return textwrap.wrap(line, MAXCOLS, subsequent_indent="   ") or [""]

lines = [("$ " + t["command"], FG, "type")]
for s in t["stderr"]:
    lines.append((s, DIM, "line"))
for s in t["stdout"]:
    up = s.strip().upper()
    if ":" in up and any(up.startswith(p + ":") for p in ["GRUMP", "SRE", "TENURED"]):
        color = OK if any(w in up for w in ["APPROVE", "SHIP", "NEW"]) and not any(w in up for w in ["REQUEST", "HOLD", "SEEN", "BLOCK", "PAGE", "DO_NOT"]) else BLOCK
        lines.append((s, color, "bold"))
    else:
        lines.append((s, FG, "line"))
lines.append((f"exit {t['exitCode']} · {round(t['durationMs']/1000)} s · {t['agent']}", DIM, "hold"))

flat = []
for text, color, kind in lines:
    for i, w in enumerate(wrap(text)):
        flat.append((w, color, kind if i == 0 else "cont"))
H = 60 + LINE_H * (len(flat) + 1)

def frame(shown, cursor):
    im = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(im)
    for i in range(3): d.ellipse((PAD + i * 18, 16, PAD + i * 18 + 11, 27), fill=BAR)
    d.text((W - PAD - 260, 13), f"{t['persona']} · {t['agent']} · recorded {t['recordedAt'][:10]}", font=font(12), fill=DIM)
    y = 46
    for text, color, kind in shown:
        d.text((PAD, y), text, font=FB if kind == "bold" else F, fill=color); y += LINE_H
    if cursor and shown:
        d.rectangle((PAD + len(shown[-1][0]) * 9.05 + 2, y - LINE_H + 3, PAD + len(shown[-1][0]) * 9.05 + 10, y - 4), fill=FG)
    return im

frames, durations, shown = [], [], []
def emit(im, ms): frames.append(im); durations.append(ms)
for text, color, kind in flat:
    if kind == "type":
        for k in range(1, len(text) + 1):
            emit(frame(shown + [(text[:k], color, kind)], True), 24)
        shown.append((text, color, kind)); emit(frame(shown, True), 600)
    elif kind == "bold":
        shown.append((text, color, kind)); emit(frame(shown, False), 1100)
    else:
        shown.append((text, color, kind)); emit(frame(shown, False), 260 if kind == "cont" else 520)
emit(frame(shown, False), 3500)
frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
print("wrote", out, len(frames), "frames", os.path.getsize(out) // 1024, "KB")
