"""A quiet ambient bed for the demo: a slow A-minor pad, soft whooshes on cuts, a chime at the end."""
import numpy as np, wave
SR = 48000
DUR = 894 / 30
t = np.arange(int(SR * DUR)) / SR
out = np.zeros_like(t)
note = lambda n: 440 * 2 ** ((n - 69) / 12)
chords = [[45, 52, 55, 59, 60], [41, 48, 52, 55, 57], [48, 55, 59, 62, 64], [43, 50, 55, 59, 62]]
seg = DUR / len(chords)
rng = np.random.default_rng(3)
for k, ch in enumerate(chords):
    t0 = k * seg
    env = np.clip((t - t0 + 0.8) / 2.2, 0, 1) * np.clip((t0 + seg + 1.6 - t) / 2.2, 0, 1)
    for m in ch:
        f = note(m)
        for det in (-0.12, 0.0, 0.11):
            ph = rng.uniform(0, 2 * np.pi)
            out += env * (np.sin(2 * np.pi * f * (1 + det / 100) * t + ph) + 0.18 * np.sin(4 * np.pi * f * t + ph)) / 18
# A slow swell over the whole piece, quiet at the very start.
out *= 0.55 + 0.45 * np.clip(t / 6, 0, 1)
# Sub pulse, like a slow heartbeat, under the live section (16-21 s).
for b in np.arange(16.0, 21.5, 0.75):
    e = np.exp(-np.clip(t - b, 0, None) * 9) * (t >= b)
    out += 0.16 * e * np.sin(2 * np.pi * 55 * t)
# Whooshes at the cuts: band-limited noise with a short swell.
noise = rng.normal(0, 1, t.size)
kernel = np.hanning(240); kernel /= kernel.sum()
soft = np.convolve(noise, kernel, mode="same")
for cut in [90, 240, 390, 480, 645, 765]:
    c = cut / 30
    e = np.exp(-((t - c) / 0.18) ** 2)
    out += 0.5 * e * soft
# End chime: a bell on A5 with its fifth.
for f, a in [(note(81), 0.22), (note(88), 0.1), (note(93), 0.05)]:
    c = 765 / 30 + 0.25
    e = np.exp(-np.clip(t - c, 0, None) * 1.6) * (t >= c)
    out += a * e * np.sin(2 * np.pi * f * (t - c))
fade = np.clip((DUR - t) / 1.2, 0, 1) * np.clip(t / 0.6, 0, 1)
out *= fade
out = out / np.abs(out).max() * 0.5
st = np.stack([out, np.roll(out, 240)], axis=1)
with wave.open("bed.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype(np.int16).tobytes())
print("ok", DUR)
