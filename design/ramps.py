"""Generate the Strata diverging ramps in OKLCH and print them as hex."""
import json, math, sys

def oklch_to_srgb(L, C, h):
    a, b = C * math.cos(math.radians(h)), C * math.sin(math.radians(h))
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    def enc(x):
        return 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055
    return [enc(v) for v in (r, g, bl)]

def in_gamut(rgb):
    return all(-1e-4 <= v <= 1 + 1e-4 for v in rgb)

def color(L, C, h):
    while C > 0 and not in_gamut(oklch_to_srgb(L, C, h)):
        C -= 0.002
    r, g, b = (min(1, max(0, v)) for v in oklch_to_srgb(L, C, h))
    return "#%02x%02x%02x" % tuple(round(v * 255) for v in (r, g, b))

FAMILIES = {  # pole a hue, pole b hue, max chroma
    "thermal": (250, 29, 0.17),
    "water": (62, 192, 0.13),
    "air": (305, 145, 0.15),
}
MID = {"dark": (0.31, 0.006, 250), "light": (0.95, 0.004, 250)}

def arm(mode, hue, cmax):
    out = []
    for t in (0.25, 0.5, 0.75, 1.0):
        if mode == "dark":
            L = 0.31 + 0.49 * t           # brighter as the change grows
            C = cmax * min(1.0, 0.35 + 0.8 * t)
        else:
            L = 0.95 - 0.52 * t           # darker as the change grows
            C = cmax * min(1.0, 0.3 + 0.9 * t)
        out.append(color(L, C, hue))
    return out

result = {}
for mode in ("dark", "light"):
    for fam, (ha, hb, cmax) in FAMILIES.items():
        mid = color(*MID[mode])
        result[f"{fam}-{mode}"] = list(reversed(arm(mode, ha, cmax))) + [mid] + arm(mode, hb, cmax)
json.dump(result, sys.stdout, indent=1)
