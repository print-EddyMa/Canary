"""Compose the captured shots into the final 1080p frames: camera crops, captions, crossfades,
hook and end card. Usage: python compose.py [first_frame last_frame] (renders a range for review)."""
import glob, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1920, 1080
SRC_W, SRC_H = 2560, 1440
TAIL = 8
F = lambda name, size: ImageFont.truetype(f"fonts/{name}.woff", size)
SEMI, REG, MONO = "IBMPlexSans-SemiBold", "IBMPlexSans-Regular", "IBMPlexMono-Medium"
YELLOW = (255, 210, 31)

def ease(x):
    x = min(1, max(0, x)); return x * x * (3 - 2 * x)

# Shots: frames on the final timeline, camera keyframes (frame, cx, cy, zoom) in source pixels,
# captions (start, end, kicker, title, sub).
SHOTS = [
    dict(id="s1", n=90, cam=[(0, 960, 760, 1.32), (90, 1180, 735, 1.12)],
         hook=(10, 90, "Is Earth changing,", "or is it just noise?")),
    dict(id="s2", n=150, cut=True, cam=[(0, 1180, 735, 1.12), (40, 1280, 720, 1.0), (62, 1280, 720, 1.0), (100, 1600, 560, 1.333), (150, 1600, 560, 1.333)],
         caps=[(4, 66, "01 · ASK", "Ask about any variable, anywhere.", "26 NASA climate variables · 200 regions"),
               (74, 158, "02 · VERDICT", "The Arctic: +0.46 °C per decade.", "Nearly 3× the global rate · p < 0.001")]),
    dict(id="s3", n=150, cut=True, cam=[(0, 1600, 560, 1.333), (26, 1734, 640, 1.55), (150, 1734, 660, 1.56)],
         caps=[(0, 76, "03 · EVIDENCE", "Where and when it warmed.", "Latitude × time anomalies vs 1991–2020"),
               (82, 158, "03 · EVIDENCE", "How the extremes shifted.", "Area beyond +2σ: 0.1% → 5.6%")]),
    dict(id="s4", n=90, cam=[(0, 1150, 800, 1.2), (90, 1080, 850, 1.32)],
         caps=[(0, 98, "04 · SIGNAL", "Only real change rises.", "Mann-Kendall + false-discovery control")]),
    dict(id="s5", n=165, cam=[(0, 1280, 720, 1.0), (165, 1330, 710, 1.06)],
         caps=[(6, 173, "05 · LIVE", "Weather, disasters, warnings. Live.", "NASA GEOS-FP · GDACS · USGS · NWS · EONET")]),
    dict(id="s6", n=120, cam=[(0, 1280, 720, 1.0), (60, 1100, 740, 1.12), (120, 1060, 740, 1.16)],
         caps=[(6, 128, "06 · METHANE", "Super-emitters, seen from orbit.", "Carbon Mapper plume imagery · kg/h ± 1σ")]),
    dict(id="end", n=129),
]
START = []
t = 0
for s in SHOTS:
    START.append(t); t += s["n"]
TOTAL = t

def camera(keys, i):
    for (f0, *a), (f1, *b) in zip(keys, keys[1:]):
        if f0 <= i <= f1:
            k = ease((i - f0) / max(1, f1 - f0)); return [x + (y - x) * k for x, y in zip(a, b)]
    return keys[-1][1:] if i > keys[-1][0] else keys[0][1:]

def crop(img, cx, cy, z):
    cw, ch = SRC_W / z, SRC_H / z
    cx = min(max(cx, cw / 2), SRC_W - cw / 2); cy = min(max(cy, ch / 2), SRC_H - ch / 2)
    return img.resize((W, H), Image.LANCZOS, box=(cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2))

_grad = None
def band():
    global _grad
    if _grad is None:
        a = np.zeros((H, W), np.float32)
        y = np.arange(H)[:, None]
        a[:] = np.clip((y - (H - 330)) / 330, 0, 1) ** 1.4 * 0.86
        x = np.arange(W)[None, :]
        a *= np.clip(1.25 - x / W, 0.35, 1)
        _grad = Image.fromarray((a * 255).astype(np.uint8))
    return _grad

def caption(img, kicker, title, sub, alpha, rise):
    img = Image.composite(Image.new("RGB", (W, H), (6, 8, 11)), img, band().point(lambda v: int(v * alpha)))
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    x, y = 96, H - 214 + int(18 * (1 - rise))
    a = int(255 * alpha)
    d.rectangle((x, y + 6, x + 4, y + 26), fill=YELLOW + (a,))
    d.text((x + 16, y + 2), kicker, font=F(MONO, 24), fill=YELLOW + (a,))
    d.text((x, y + 40), title, font=F(SEMI, 62), fill=(242, 241, 236, a))
    d.text((x, y + 124), sub, font=F(REG, 28), fill=(178, 183, 190, a))
    img.paste(layer, (0, 0), layer)
    return img

def hook(img, top, bottom, alpha):
    dim = Image.new("RGB", (W, H), (5, 7, 10))
    img = Image.blend(img, dim, 0.45 * alpha)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    f = F(SEMI, 92)
    for k, (line, col) in enumerate([(top, (242, 241, 236)), (bottom, YELLOW)]):
        a2 = ease(alpha * 1.6 - k * 0.45)
        w = d.textlength(line, font=f)
        d.text(((W - w) / 2, H / 2 - 112 + k * 116 + int(14 * (1 - a2))), line, font=f, fill=col + (int(255 * a2),))
    img.paste(layer, (0, 0), layer)
    return img

_end = None
def endcard(i):
    global _end
    if _end is None: _end = Image.open("endcard.png").convert("RGB")
    z = 1.0 + 0.035 * (i / SHOTS[-1]["n"])
    return crop(_end, SRC_W / 2, SRC_H / 2, z)

def shot_frame(si, i):
    s = SHOTS[si]
    if s["id"] == "end": return endcard(i)
    path = f"frames/{s['id']}/{i:04d}.jpg"
    if not os.path.exists(path):
        have = sorted(glob.glob(f"frames/{s['id']}/*.jpg")); path = have[min(len(have) - 1, 0 if i < 5 else -1)]
    img = crop(Image.open(path).convert("RGB"), *camera(s["cam"], i))
    if "hook" in s:
        h0, h1, top, bottom = s["hook"]
        if h0 <= i: img = hook(img, top, bottom, ease((i - h0) / 22) * (1 - ease((i - (h1 - 8)) / 8)))
    for c0, c1, kicker, title, sub in s.get("caps", []):
        if c0 <= i <= c1:
            a = ease((i - c0) / 9) * (1 - ease((i - (c1 - 7)) / 7))
            img = caption(img, kicker, title, sub, a, ease((i - c0) / 12))
    return img

def final(f):
    si = max(k for k, s in enumerate(START) if s <= f)
    i = f - START[si]
    img = shot_frame(si, i)
    if si > 0 and i < TAIL and not SHOTS[si].get("cut"):  # crossfade from the previous shot's tail
        prev = shot_frame(si - 1, SHOTS[si - 1]["n"] + i)
        img = Image.blend(prev, img, ease((i + 1) / (TAIL + 1)))
    if f < 8: img = Image.blend(Image.new("RGB", (W, H)), img, ease(f / 8))
    if f > TOTAL - 10: img = Image.blend(img, Image.new("RGB", (W, H), (11, 14, 19)), ease((f - (TOTAL - 10)) / 10))
    return img

if __name__ == "__main__":
    os.makedirs("out", exist_ok=True)
    a, b = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (0, TOTAL - 1)
    step = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    for f in range(a, b + 1, step):
        final(f).save(f"out/{f:04d}.jpg", quality=94)
    print("frames", TOTAL, "seconds", TOTAL / 30)
