#!/usr/bin/env python3
"""Render a captured gate loop (assets/recordings/gate-<agent>.json) as a GIF: the agent writes,
the review refuses with findings, the agent fixes, the review approves.
   python3 scripts/render-gate.py assets/recordings/gate-claude.json assets/recordings/gate-claude.gif"""
import json, os, sys, textwrap
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
t = json.load(open(src))
W, PAD, LINE_H, MAXCOLS = 1000, 26, 22, 104
BG, FG, DIM, BAD, OK, BAR = (11, 15, 28), (230, 233, 242), (138, 147, 173), (255, 138, 101), (127, 216, 143), (58, 68, 102)

def font(size=15, bold=False):
    for path in ["/System/Library/Fonts/Menlo.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]:
        if os.path.exists(path):
            try: return ImageFont.truetype(path, size, index=1 if (bold and path.endswith(".ttc")) else 0)
            except Exception: pass
    return ImageFont.load_default()
F, FB, FS = font(), font(bold=True), font(12)

lines = []
def add(text, color=FG, bold=False):
    for w in (textwrap.wrap(text, MAXCOLS, subsequent_indent="   ") or [""]):
        lines.append((w, color, bold))

add(t["ticket"], DIM)
add("")
approve_word = None
for s in t["steps"]:
    if s["kind"] == "write":
        add(f"$ {t['agentLabel']} writes the change  ({s['seconds']} s)", FG, True)
    elif s["kind"] == "fix":
        add(f"$ {t['agentLabel']} fixes the findings  ({s['seconds']} s)", FG, True)
    else:
        blocked = s.get("blocked")
        add(f"$ npx {t['persona']} review --staged", DIM)
        for raw in (s.get("text") or "").split("\n")[:8]:
            add(raw, BAD if blocked else OK, raw.strip().startswith(t["prefix"]))
        add("write refused" if blocked else "write allowed", BAD if blocked else OK, True)
    add("")

H = 64 + LINE_H * (len(lines) + 1)

def frame(n):
    im = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(im)
    for i in range(3): d.ellipse((PAD + i * 18, 16, PAD + i * 18 + 11, 27), fill=BAR)
    d.text((W - PAD - 300, 13), f"{t['persona']} gate · {t['agentLabel']} · recorded {t['recordedAt'][:10]}", font=FS, fill=DIM)
    y = 46
    for text, color, bold in lines[:n]:
        d.text((PAD, y), text, font=FB if bold else F, fill=color); y += LINE_H
    return im

frames, durations = [], []
for n in range(1, len(lines) + 1):
    frames.append(frame(n))
    durations.append(900 if lines[n - 1][2] else 220)
frames.append(frame(len(lines))); durations.append(2600)
frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
print(f"wrote {out} {len(frames)} frames {os.path.getsize(out)//1024} KB")
