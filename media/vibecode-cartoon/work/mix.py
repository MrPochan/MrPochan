"""Сведение: голоса + синтезированные SFX + фоновая музыка -> out/mix.wav"""
import json, os, wave
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICE = os.environ.get('VOICE_DIR', f'{ROOT}/voice')
SR = 48000
TL = json.load(open(f'{VOICE}/timeline.json'))
LINES, TOTAL = TL['lines'], TL['total']
N = int(TOTAL * SR) + SR
rng = np.random.default_rng(1)

voice = np.zeros(N, np.float32)
sfx = np.zeros(N, np.float32)
music = np.zeros(N, np.float32)


def put(buf, t, a, g=1.0):
    i = int(t * SR)
    a = a[: max(0, N - i)]
    buf[i:i + len(a)] += a * g


def tt(d):
    return np.arange(int(d * SR)) / SR


def env(n, a=0.005, r=0.05):
    e = np.ones(n, np.float32)
    na, nr = int(a * SR), int(r * SR)
    e[:na] = np.linspace(0, 1, na)
    e[-nr:] *= np.linspace(1, 0, nr)
    return e


for l in LINES:
    a = np.load(f"{VOICE}/line{l['i']:02d}.npy")
    a = a / (np.abs(a).max() + 1e-6) * 0.9
    put(voice, l['start'], a)

scene_start = {}
for k, l in enumerate(LINES):
    if l['scene'] not in scene_start:
        scene_start[l['scene']] = LINES[k - 1]['start'] + LINES[k - 1]['dur'] if k else 0
by = {l['scene']: [x for x in LINES if x['scene'] == l['scene']] for l in LINES}

# whoosh на каждой смене сцены
for sc, st in scene_start.items():
    if st > 0:
        x = tt(0.35)
        w = rng.standard_normal(len(x)).astype(np.float32)
        w = np.convolve(w, np.ones(12) / 12, 'same') * np.sin(np.pi * x / x[-1]) ** 2
        put(sfx, st - 0.05, w, 0.35)

# телефонный звонок
st = scene_start['call']
for k in range(2):
    x = tt(0.55)
    r = (np.sin(2 * np.pi * 440 * x) + np.sin(2 * np.pi * 480 * x)) * (np.sin(2 * np.pi * 22 * x) > 0)
    put(sfx, st + 0.1 + k * 0.7, (r * env(len(x))).astype(np.float32), 0.18)

# клавиатура под промпт
l5 = by['prompt'][0]
t = l5['start']
while t < l5['start'] + l5['dur']:
    x = tt(0.025)
    c = rng.standard_normal(len(x)) * np.exp(-x * 250)
    c = np.diff(c, prepend=0)
    put(sfx, t, c.astype(np.float32), 0.25)
    t += rng.uniform(0.06, 0.16)

# дзынь ответа нейросети (оба раза)
for l in [by['prompt'][1], by['fail_screen'][0]]:
    x = tt(0.8)
    d = (np.sin(2 * np.pi * 1318 * x) + 0.6 * np.sin(2 * np.pi * 1760 * x)) * np.exp(-x * 6)
    put(sfx, l['start'] - 0.35, d.astype(np.float32), 0.12)

# сирена на провале
s0 = scene_start['fail_k']
s1 = by['fail_screen'][0]['start'] + by['fail_screen'][0]['dur']
x = tt(s1 - s0)
f = 750 + 300 * np.sin(2 * np.pi * 1.6 * x)
ph = 2 * np.pi * np.cumsum(f) / SR
sir = (2 / np.pi * np.arcsin(np.sin(ph))) * env(len(x), 0.05, 0.3)
put(sfx, s0, sir.astype(np.float32), 0.07)

# грустный тромбон в конце
lf = by['final2'][0]
t0 = lf['start'] + lf['dur'] + 0.15
for k, (fr, d) in enumerate([(293.7, 0.35), (277.2, 0.35), (261.6, 0.35), (246.9, 1.1)]):
    x = tt(d)
    vib = 1 + (0.012 * np.sin(2 * np.pi * 6 * x) if k == 3 else 0)
    ph = 2 * np.pi * np.cumsum(fr * vib) / SR
    tone = sum(np.sin(h * ph) / h for h in range(1, 8)) * env(len(x), 0.03, 0.12)
    put(sfx, t0 + sum(q[1] for q in [(0, .35)] * k), tone.astype(np.float32), 0.09)

# музыка: простенький лоу-фай луп, от начала до провала
bpm = 104
beat = 60 / bpm
chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]  # Am F C G
mend = scene_start['fail_k']
mf = lambda n: 440 * 2 ** ((n - 69) / 12)
t, k = 0.0, 0
while t < mend:
    ch = chords[(k // 8) % 4]
    n = ch[k % 3] + (12 if k % 4 == 3 else 0)
    x = tt(beat / 2 * 1.6)
    pl = (np.sin(2 * np.pi * mf(n) * x) + 0.3 * np.sin(4 * np.pi * mf(n) * x)) * np.exp(-x * 7)
    put(music, t, pl.astype(np.float32), 0.25)
    if k % 2 == 0:
        x = tt(beat)
        put(music, t, (np.sin(2 * np.pi * mf(ch[0] - 12) * x) * np.exp(-x * 3)).astype(np.float32), 0.35)
    if k % 4 == 0:
        x = tt(0.18)
        kick = np.sin(2 * np.pi * (50 + 90 * np.exp(-x * 30)) * x) * np.exp(-x * 18)
        put(music, t, kick.astype(np.float32), 0.6)
    if k % 2 == 1:
        x = tt(0.05)
        put(music, t, (rng.standard_normal(len(x)) * np.exp(-x * 90)).astype(np.float32) * 0.5, 0.12)
    t += beat / 2
    k += 1
fade = int(0.2 * SR)
i = int(mend * SR)
music[i - fade:i] *= np.linspace(1, 0, fade)
music[i:] = 0

# дакинг музыки под голос
ve = np.abs(voice)
win = int(0.2 * SR)
ve = np.convolve(ve, np.ones(win) / win, 'same')
duck = 1 - 0.6 * np.clip(ve / 0.05, 0, 1)
out = voice + sfx + music * 0.32 * duck
out = out[: int(TOTAL * SR)]
out = out / max(1.0, np.abs(out).max() / 0.95)
os.makedirs(f'{ROOT}/out', exist_ok=True)
pcm = (out * 32767).astype(np.int16)
with wave.open(f'{ROOT}/out/mix.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('mix ok', len(out) / SR)
