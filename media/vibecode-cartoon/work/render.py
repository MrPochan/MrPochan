"""Мультик про вайбкодера: процедурная отрисовка Pillow -> ffmpeg."""
import json, math, random, subprocess, sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICE = os.environ.get('VOICE_DIR', f'{ROOT}/voice')
FONTS = f'{ROOT}/fonts'
OUT_PATH = sys.argv[1] if len(sys.argv) > 1 else f'{ROOT}/out/vibecoder.mp4'
PREVIEW = os.environ.get('PREVIEW')  # "t1,t2,..." -> только PNG кадры

W, H = 1440, 2560          # мир (2x)
OW, OH = 720, 1280         # выход
FPS = 30
SR = 48000

OUTL = (38, 30, 28)
LW = 9
SKIN = (241, 196, 152)
SKIN2 = (248, 216, 184)
NOSE = (234, 158, 128)
HOODIE = (112, 128, 96)
HOODIE_D = (88, 102, 74)
CAP = (58, 108, 196)
HAIR = (110, 72, 44)
HAIR2 = (72, 44, 30)
NAVY = (44, 56, 96)
NAVY_D = (32, 40, 72)
LIP = (200, 40, 60)
WOOD = (196, 148, 98)
WOOD_D = (160, 112, 70)
DARK = (28, 26, 32)

rubik = lambda s: ImageFont.truetype(f'{FONTS}/full_Rubik.ttf', int(s))
russo = lambda s: ImageFont.truetype(f'{FONTS}/full_Russo.ttf', int(s))
mono = lambda s: ImageFont.truetype('/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-ExtraBold.ttf', int(s))
monor = lambda s: ImageFont.truetype('/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Medium.ttf', int(s))

TL = json.load(open(f'{VOICE}/timeline.json'))
LINES = TL['lines']
TOTAL = TL['total']


def mix(a, b, k):
    return tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3))


def ease(x):
    x = min(1, max(0, x))
    return x * x * (3 - 2 * x)


# ---------------------------------------------------------------- lip sync
ENV = {}
for l in LINES:
    a = np.load(f"{VOICE}/line{l['i']:02d}.npy")
    hop = SR // FPS
    n = len(a) // hop + 1
    r = np.array([np.sqrt(np.mean(a[k * hop:(k + 1) * hop] ** 2) + 1e-9) for k in range(n)])
    r = r / (np.percentile(r, 92) + 1e-6)
    ENV[l['i']] = np.clip((r - 0.18) / 0.7, 0, 1)


def speaking(t, spk):
    for l in LINES:
        if l['spk'] == spk and l['start'] <= t < l['start'] + l['dur']:
            return l
    return None


def mouth(t, spk):
    l = speaking(t, spk)
    if not l:
        return 0.0
    e = ENV[l['i']]
    k = int((t - l['start']) * FPS)
    v = e[min(k, len(e) - 1)]
    return round(v * 3) / 3  # мультяшные 4 положения


def blink(t, seed=0):
    return ((t + seed) % 3.3) < 0.11


# ---------------------------------------------------------------- pen
class Pen:
    def __init__(self, d, x, y, s):
        self.d, self.x, self.y, self.s = d, x, y, s
        self.lw = max(3, int(LW * s))

    def p(self, dx, dy):
        return (self.x + dx * self.s, self.y + dy * self.s)

    def box(self, cx, cy, rx, ry):
        x0, y0 = self.p(cx - rx, cy - ry)
        x1, y1 = self.p(cx + rx, cy + ry)
        return [x0, y0, x1, y1]

    def ell(self, cx, cy, rx, ry, fill, out=True, w=None):
        self.d.ellipse(self.box(cx, cy, rx, ry), fill=fill, outline=OUTL if out else None,
                       width=(w or self.lw) if out else 0)

    def ring(self, cx, cy, rx, ry, col, w):
        self.d.ellipse(self.box(cx, cy, rx, ry), outline=col, width=int(w * self.s))

    def rrect(self, x0, y0, x1, y1, r, fill, out=True):
        self.d.rounded_rectangle([*self.p(x0, y0), *self.p(x1, y1)], radius=int(r * self.s), fill=fill,
                                 outline=OUTL if out else None, width=self.lw if out else 0)

    def poly(self, pts, fill, out=True):
        self.d.polygon([self.p(*q) for q in pts], fill=fill, outline=OUTL if out else None,
                       width=self.lw if out else 0)

    def line(self, pts, w, fill):
        self.d.line([self.p(*q) for q in pts], fill=fill, width=max(2, int(w * self.s)), joint='curve')

    def chord(self, cx, cy, rx, ry, a0, a1, fill, out=True):
        self.d.chord(self.box(cx, cy, rx, ry), a0, a1, fill=fill, outline=OUTL if out else None,
                     width=self.lw if out else 0)

    def pie(self, cx, cy, rx, ry, a0, a1, fill, out=True):
        self.d.pieslice(self.box(cx, cy, rx, ry), a0, a1, fill=fill, outline=OUTL if out else None,
                        width=self.lw if out else 0)

    def arc(self, cx, cy, rx, ry, a0, a1, w, col=OUTL):
        self.d.arc(self.box(cx, cy, rx, ry), a0, a1, fill=col, width=max(2, int(w * self.s)))

    def limb(self, pts, w, fill):
        ow = w + 2 * LW
        for q in pts:
            self.ell(q[0], q[1], ow / 2, ow / 2, OUTL, out=False)
        self.line(pts, ow, OUTL)
        for q in pts:
            self.ell(q[0], q[1], w / 2, w / 2, fill, out=False)
        self.line(pts, w, fill)

    def text(self, cx, cy, txt, font, fill, anchor='mm'):
        self.d.text(self.p(cx, cy), txt, font=font, fill=fill, anchor=anchor)


rng = random.Random(7)
STUBBLE = []
while len(STUBBLE) < 70:
    dx, dy = rng.uniform(-125, 125), rng.uniform(55, 160)
    if (dx / 132) ** 2 + ((dy - 20) / 145) ** 2 < 1 and not (abs(dx) < 55 and 70 < dy < 135):
        STUBBLE.append((dx, dy))


def hand(P, x, y, r=40, skin=SKIN):
    P.ell(x, y, r, r * 0.85, skin)


def arms(P, mode, t, skin, sleeve, side_y=210):
    if mode == 'type':
        j = math.sin(t * 28) * 7
        P.limb([(-185, side_y), (-200, 420), (-140, 540 + j)], 66, sleeve)
        P.limb([(185, side_y), (200, 420), (140, 540 - j)], 66, sleeve)
        hand(P, -140, 560 + j, 42, skin); hand(P, 140, 560 - j, 42, skin)
    elif mode == 'shrug':
        b = math.sin(t * 6) * 8
        for sg in (-1, 1):
            P.limb([(185 * sg, side_y), (330 * sg, 380), (390 * sg, 230 + b)], 66, sleeve)
            P.ell(400 * sg, 205 + b, 48, 34, skin)
            P.ell(440 * sg, 175 + b, 13, 30, skin)
    elif mode == 'hips':
        for sg in (-1, 1):
            P.limb([(185 * sg, side_y), (330 * sg, 400), (215 * sg, 540)], 66, sleeve)
            hand(P, 210 * sg, 545, 40, skin)
    elif mode == 'cross':
        P.limb([(-185, side_y), (-230, 430), (120, 420)], 70, sleeve)
        P.limb([(185, side_y), (230, 440), (-120, 445)], 70, sleeve)
        hand(P, 150, 420, 38, skin); hand(P, -150, 445, 38, skin)


def arm_front(P, mode, t, skin, sleeve):
    """руки, которые рисуются поверх головы"""
    if mode == 'phone':
        P.limb([(-185, 220), (-300, 420), (-185, 90)], 66, sleeve)
        P.rrect(-215, -40, -150, 95, 14, DARK)
        hand(P, -180, 85, 44, skin)
    elif mode == 'finger':
        b = math.sin(t * 5) * 10
        P.limb([(185, 220), (320, 340), (330, 120 + b)], 66, sleeve)
        P.rrect(314, -25 + b, 348, 90 + b, 16, skin)
        hand(P, 330, 110 + b, 46, skin)
    elif mode == 'point':  # указывает влево
        b = math.sin(t * 9) * 8
        P.limb([(-185, 220), (-320, 300 + b), (-450, 260 + b)], 66, sleeve)
        P.rrect(-580, 245 + b, -470, 275 + b, 14, skin)
        hand(P, -470, 262 + b, 46, skin)
    elif mode == 'point_r':
        b = math.sin(t * 9) * 8
        P.limb([(185, 220), (290, 300 + b), (370, 270 + b)], 66, sleeve)
        P.rrect(390, 255 + b, 470, 285 + b, 14, skin)
        hand(P, 390, 272 + b, 46, skin)
    elif mode == 'fist':
        b = abs(math.sin(t * 7)) * -40
        P.limb([(185, 220), (330, 330), (300, 160 + b)], 66, sleeve)
        hand(P, 300, 140 + b, 55, skin)


def eyes(P, mood, t, seed, sk, look=(0, 0), ex=55, ey=-15, rx=36, ry=40, lash=False):
    for sg in (-1, 1):
        cx = ex * sg
        if blink(t, seed) and mood != 'wide':
            P.arc(cx, ey, rx, ry * 0.5, 10, 170, 9)
            continue
        rr = (rx * 1.25, ry * 1.25) if mood == 'wide' else (rx, ry)
        P.ell(cx, ey, rr[0], rr[1], (255, 255, 255))
        pr = 9 if mood == 'wide' else 13
        P.ell(cx + look[0] * 10, ey + 6 + look[1] * 10, pr, pr * 1.15, DARK, out=False)
        P.ell(cx + look[0] * 10 + 4, ey + 2 + look[1] * 10, 4, 4, (255, 255, 255), out=False)
        if mood in ('lazy', 'smug'):
            P.chord(cx, ey, rr[0], rr[1], 180, 360, sk)
            P.line([(cx - rr[0], ey), (cx + rr[0], ey)], 9, OUTL)
        if mood == 'angry':
            P.poly([(cx - rx - 6 * sg * 0, ey - ry - 6), (cx + rx + 6, ey - ry - 6),
                    (cx + (rx + 6) * (-sg), ey - ry - 6), (cx - 4 * sg, ey - 4)], sk, out=False)
            P.line([(cx - (rx) * sg, ey - ry * 0.75), (cx + 2 * sg * -1 + 0, ey - 2)], 9, OUTL)
        if lash:
            for k in (-1, 0, 1):
                P.line([(cx + k * 16 + sg * 0, ey - rr[1] + 2), (cx + k * 22, ey - rr[1] - 16)], 6, OUTL)


def brows(P, mood, bx=58, by=-78, w=15, col=HAIR2):
    for sg in (-1, 1):
        if mood == 'angry':
            P.line([(bx * sg + 40 * sg, by - 12), (bx * sg - 35 * sg, by + 18)], w, col)
        elif mood == 'wide':
            P.line([(bx * sg + 38 * sg, by - 10), (bx * sg - 34 * sg, by - 22)], w, col)
        elif mood == 'smug':
            dy = -14 if sg > 0 else 4
            P.line([(bx * sg + 38 * sg, by + dy), (bx * sg - 34 * sg, by + dy - 6)], w, col)
        else:
            P.line([(bx * sg + 38 * sg, by + 4), (bx * sg - 34 * sg, by - 4)], w, col)


def gena(d, x, y, s, t, m=0.0, mood='lazy', arm='none', look=(0, 0), red=0.0, glow=None):
    P = Pen(d, x, y, s)
    sk = mix(SKIN, (232, 108, 92), red)
    if glow:
        sk = mix(sk, glow, 0.25)
    # тело
    P.rrect(-220, 120, 220, 640, 130, HOODIE)
    P.ell(0, 140, 155, 58, HOODIE_D)
    P.line([(-45, 175), (-52, 320)], 9, (240, 240, 230)); P.line([(45, 175), (52, 320)], 9, (240, 240, 230))
    P.text(0, 410, 'VIBE', russo(78 * s), (236, 232, 210))
    P.arc(0, 135, 128, 62, 0, 180, 20, (215, 52, 52))
    P.ell(-128, 140, 30, 42, (215, 52, 52)); P.ell(128, 140, 30, 42, (215, 52, 52))
    arms(P, arm, t, sk, HOODIE)
    # голова
    P.ell(-150, 15, 28, 40, sk); P.ell(150, 15, 28, 40, sk)
    P.ell(0, 0, 150, 165, sk)
    for (dx, dy) in STUBBLE:
        P.ell(dx, dy, 4, 4, mix(sk, (90, 64, 50), 0.45), out=False)
    P.ell(-88, 50, 28, 17, mix(sk, (240, 120, 120), 0.5), out=False)
    P.ell(88, 50, 28, 17, mix(sk, (240, 120, 120), 0.5), out=False)
    eyes(P, mood, t, 0.0, sk, look)
    brows(P, mood)
    P.ell(0, 42, 30, 26, mix(NOSE, (230, 70, 70), red * 0.6))
    if m < 0.1:
        if mood == 'angry':
            P.arc(0, 128, 40, 20, 200, 340, 9)
        else:
            P.arc(10, 82, 46, 26, 25, 150, 9)
    else:
        P.ell(0, 102, 32 + 12 * m, 7 + 36 * m, (120, 32, 36))
        P.chord(0, 102, 30 + 12 * m, 5 + 36 * m, 20, 160, (226, 110, 120), out=False)
    # кепка козырьком назад
    P.pie(0, -55, 160, 128, 180, 360, CAP)
    P.chord(0, -55, 46, 36, 180, 360, HAIR)
    P.line([(-158, -55), (158, -55)], 9, OUTL)
    P.ell(0, -182, 13, 9, CAP)
    # очки на кепке
    P.rrect(-118, -150, -24, -102, 20, (30, 34, 46)); P.rrect(24, -150, 118, -102, 20, (30, 34, 46))
    P.line([(-24, -128), (24, -128)], 9, OUTL)
    P.line([(-100, -140), (-80, -112)], 5, (180, 200, 230)); P.line([(42, -140), (62, -112)], 5, (180, 200, 230))
    arm_front(P, arm, t, sk, HOODIE)


def tamara(d, x, y, s, t, m=0.0, mood='normal', arm='none', look=(0, 0), legs=False, red=0.0):
    P = Pen(d, x, y, s)
    sk = mix(SKIN2, (236, 120, 104), red)
    P.ell(0, -10, 178, 190, HAIR2)          # волосы сзади
    P.ell(0, -195, 78, 62, HAIR2)           # пучок
    if legs:
        P.limb([(-75, 800), (-80, 1060)], 52, sk); P.limb([(75, 800), (80, 1060)], 52, sk)
        P.rrect(-130, 1045, -40, 1095, 22, DARK); P.rrect(40, 1045, 130, 1095, 22, DARK)
        P.rrect(-175, 560, 175, 840, 40, NAVY_D)
    P.rrect(-215, 125, 215, 640, 125, NAVY)
    P.poly([(-80, 128), (80, 128), (0, 330)], (250, 250, 250))
    P.poly([(-80, 128), (0, 330), (-130, 260)], NAVY_D)
    P.poly([(80, 128), (0, 330), (130, 260)], NAVY_D)
    for k in range(-4, 5):
        P.ell(k * 17, 150 + abs(k) ** 1.6 * -3 + 30 - abs(k) * 2, 9, 9, (250, 248, 240), w=4)
    arms(P, arm, t, sk, NAVY)
    P.ell(0, 0, 140, 160, sk)
    P.ell(-142, 55, 11, 11, (240, 196, 60)); P.ell(142, 55, 11, 11, (240, 196, 60))
    P.chord(0, -25, 150, 145, 185, 355, HAIR2)
    P.ell(-85, 52, 26, 15, mix(sk, (240, 130, 140), 0.5), out=False)
    P.ell(85, 52, 26, 15, mix(sk, (240, 130, 140), 0.5), out=False)
    eyes(P, mood, t, 1.3, sk, look, ex=55, ey=-5, rx=27, ry=31, lash=True)
    P.ring(-55, -5, 46, 44, OUTL, 8); P.ring(55, -5, 46, 44, OUTL, 8)
    P.line([(-10, -8), (10, -8)], 8, OUTL)
    brows(P, mood, bx=55, by=-70, w=11)
    P.arc(0, 45, 18, 14, 20, 160, 7)
    if m < 0.1:
        if mood == 'angry':
            P.ell(0, 100, 30, 8, LIP)
        else:
            P.chord(0, 86, 34, 20, 15, 165, LIP)
    else:
        P.ell(0, 98, 26 + 10 * m, 6 + 30 * m, (110, 28, 36))
        d.ellipse(P.box(0, 98, 28 + 10 * m, 8 + 30 * m), outline=LIP, width=int(10 * s))
    arm_front(P, arm, t, sk, NAVY)


# ---------------------------------------------------------------- props / backgrounds
def brick_wall(w, h, seed=3):
    img = Image.new('RGB', (w, h), (124, 52, 34))
    d = ImageDraw.Draw(img)
    r = random.Random(seed)
    bh, bw, gap = 74, 168, 10
    for row in range(h // bh + 2):
        off = (row % 2) * bw // 2
        for col in range(-1, w // bw + 2):
            x0, y0 = col * bw - off + gap // 2, row * bh + gap // 2
            c = r.choice([(206, 92, 52), (196, 84, 46), (214, 102, 60), (188, 78, 44), (202, 96, 58)])
            d.rounded_rectangle([x0, y0, x0 + bw - gap, y0 + bh - gap], 6, fill=c, outline=(110, 44, 30), width=4)
            if r.random() < 0.25:
                d.line([x0 + 14, y0 + 18, x0 + 40, y0 + 18], fill=mix(c, (255, 255, 255), 0.2), width=5)
    return img


def office_wall(w, h):
    img = Image.new('RGB', (w, h), (238, 232, 218))
    d = ImageDraw.Draw(img)
    d.rectangle([0, h - 90, w, h], fill=(214, 204, 186))
    P = Pen(d, 0, 0, 1)
    P.rrect(110, 140, 560, 520, 10, (250, 246, 236))
    d.line([170, 460, 270, 380, 360, 420, 500, 220], fill=(220, 60, 60), width=14, joint='curve')
    P.poly([(500, 200), (470, 250), (525, 245)], (220, 60, 60), out=False)
    d.line([170, 200, 170, 460, 520, 460], fill=OUTL, width=8)
    P.rrect(900, 160, 1340, 640, 18, (230, 236, 244))
    d.text((1120, 260), 'KPI', font=russo(90), fill=(60, 90, 160), anchor='mm')
    d.text((1120, 400), '+300%', font=rubik(70), fill=(40, 150, 80), anchor='mm')
    return img


SIGN_CACHE = {}


def sign(img, cx, cy, txt, size=1.0, ang=-2):
    key = (txt, size)
    if key not in SIGN_CACHE:
        f = russo(150 * size)
        tw = f.getbbox(txt)[2] + 140 * size
        th = 230 * size
        s = Image.new('RGBA', (int(tw + 40), int(th + 40)), (0, 0, 0, 0))
        d = ImageDraw.Draw(s)
        d.rounded_rectangle([20, 20, tw + 20, th + 20], 22, fill=(214, 176, 120), outline=OUTL, width=10)
        for k in range(1, 4):
            yy = 20 + th * k / 4
            d.line([40, yy, tw, yy + 6], fill=(190, 150, 98), width=5)
        d.ellipse([46, 46, 70, 70], fill=(120, 120, 120), outline=OUTL, width=4)
        d.ellipse([tw - 30, 46, tw - 6, 70], fill=(120, 120, 120), outline=OUTL, width=4)
        d.text(((tw + 40) / 2, (th + 40) / 2 + 8), txt, font=f, fill=(46, 34, 28), anchor='mm')
        SIGN_CACHE[key] = s.rotate(ang, resample=Image.BICUBIC, expand=True)
    s = SIGN_CACHE[key]
    img.paste(s, (int(cx - s.width / 2), int(cy - s.height / 2)), s)


def desk(d, x0, y0, x1, y1):
    P = Pen(d, 0, 0, 1)
    P.rrect(x0, y0, x1, y0 + 60, 10, WOOD)
    P.rrect(x0 + 30, y0 + 50, x1 - 30, y1, 8, WOOD_D)
    dx = x1 - 300
    P.rrect(dx, y0 + 110, x1 - 70, y0 + 260, 10, WOOD)
    P.ell((dx + x1 - 70) / 2, y0 + 185, 14, 14, (230, 190, 60))
    d.line([x0 + 90, y0 + 140, x0 + 120, y1 - 20], fill=(130, 90, 56), width=6)


def laptop_back(d, cx, by, wdt=440, hgt=290, glow=(120, 170, 255)):
    P = Pen(d, 0, 0, 1)
    d.polygon([(cx - wdt / 2 - 40, by - hgt - 30), (cx + wdt / 2 + 40, by - hgt - 30), (cx, by + 400)],
              fill=None)
    P.poly([(cx - wdt / 2, by - hgt), (cx + wdt / 2, by - hgt), (cx + wdt / 2 + 18, by), (cx - wdt / 2 - 18, by)],
           (86, 92, 108))
    P.ell(cx, by - hgt / 2, 46, 46, (246, 140, 70))
    P.text(cx, by - hgt / 2, 'AI', russo(46), (255, 255, 255))
    P.rrect(cx - wdt / 2 - 40, by - 6, cx + wdt / 2 + 40, by + 22, 8, (150, 156, 170))


def can(d, cx, by, col=(80, 200, 90)):
    P = Pen(d, 0, 0, 1)
    P.rrect(cx - 40, by - 150, cx + 40, by, 14, col)
    P.rrect(cx - 34, by - 160, cx + 34, by - 140, 6, (200, 200, 210))
    P.poly([(cx + 8, by - 125), (cx - 18, by - 70), (cx + 2, by - 70), (cx - 10, by - 25), (cx + 20, by - 85),
            (cx, by - 85)], (250, 240, 60), out=False)


def mug(d, cx, by):
    P = Pen(d, 0, 0, 1)
    P.ring(cx + 52, by - 70, 30, 34, OUTL, 22)
    P.ring(cx + 52, by - 70, 30, 34, (240, 240, 240), 10)
    P.rrect(cx - 50, by - 140, cx + 50, by, 14, (240, 240, 240))
    P.text(cx, by - 70, '</>', russo(36), (220, 60, 60))


BG = {}


def bg(name):
    if name not in BG:
        if name == 'brick':
            BG[name] = brick_wall(W, H)
        elif name == 'brick_sign':
            b = brick_wall(W, H)
            sign(b, 720, 470, 'ВАЙБ-ОФИС')
            BG[name] = b
        elif name == 'brick_sign_top':
            b = brick_wall(W, H)
            sign(b, 720, 170, 'ВАЙБ-ОФИС', 1.2)
            BG[name] = b
        elif name == 'office':
            BG[name] = office_wall(W, H)
        elif name == 'split':
            b = Image.new('RGB', (W, H))
            b.paste(office_wall(W, 1280), (0, 0))
            bw = brick_wall(W, 1280, seed=9)
            b.paste(bw, (0, 1280))
            BG[name] = b
    return BG[name].copy()


def floor(d, y):
    d.rectangle([0, y, W, H], fill=(150, 104, 70))
    for k in range(0, W, 180):
        d.line([k, y, k - 80, H], fill=(124, 84, 56), width=6)
    d.line([0, y, W, y], fill=OUTL, width=10)


# ---------------------------------------------------------------- screen UI
CODE = [
    'import { ozon } from "интернет";',
    'const bugs = 0; // ОЧЕНЬ ВАЖНО',
    'function sdelatKrasivo() {',
    '  return ozon.copy({ лучше: true });',
    '}',
    'if (bug) { не_надо(); }',
    'const money = Infinity;',
    'app.listen(localhost); // работает!',
    'db.password = "qwerty123";',
    '// TODO: разобраться что это',
    'while (true) { vibe(); }',
    'export default магия;',
]


def chat_screen(img, t, typed, reply_k, code_k, fail=False, fail_k=0.0):
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, H], fill=(52, 50, 58))
    # рамка ноутбука
    d.rounded_rectangle([60, 160, W - 60, 2060], 40, fill=(30, 30, 36), outline=OUTL, width=12)
    sx0, sy0, sx1, sy1 = 110, 210, W - 110, 2010
    d.rectangle([sx0, sy0, sx1, sy1], fill=(246, 243, 236) if not fail else (24, 24, 28))
    if not fail:
        d.rectangle([sx0, sy0, sx1, sy0 + 130], fill=(236, 230, 218))
        star(d, sx0 + 90, sy0 + 65, 36, (226, 120, 70), t)
        d.text((sx0 + 160, sy0 + 65), 'Нейросеть Pro Max', font=rubik(52), fill=(40, 40, 40), anchor='lm')
        y = sy0 + 190
        if reply_k > 0:
            # сообщение пользователя
            msg = 'сделай как озон.\nбез багов.\nОЧЕНЬ ВАЖНО!!!'
            d.rounded_rectangle([sx0 + 380, y, sx1 - 40, y + 260], 36, fill=(220, 232, 250))
            d.multiline_text((sx0 + 420, y + 30), msg, font=rubik(54), fill=(30, 30, 40), spacing=14)
            y += 310
            star(d, sx0 + 70, y + 40, 30, (226, 120, 70), t)
            rep = 'Отличная идея! Вы абсолютно правы! 🙌'
            rep = 'Отличная идея!\nВы абсолютно правы!'
            n = int(len(rep) * min(1, reply_k * 2.2))
            d.multiline_text((sx0 + 130, y), rep[:n], font=rubik(60), fill=(30, 30, 30), spacing=16)
            y += 200
            if code_k > 0:
                d.rounded_rectangle([sx0 + 40, y, sx1 - 40, sy1 - 40], 20, fill=(30, 33, 42))
                nl = int(code_k * 40)
                lines = [CODE[k % len(CODE)] for k in range(nl)]
                vis = lines[-16:]
                f = monor(38)
                for k, ln in enumerate(vis):
                    col = (130, 200, 120) if ln.strip().startswith('//') or '//' in ln else (220, 220, 230)
                    if 'ОЧЕНЬ' in ln or 'password' in ln:
                        col = (250, 200, 90)
                    d.text((sx0 + 80, y + 40 + k * 66), ln, font=f, fill=col)
        else:
            # поле ввода
            d.rounded_rectangle([sx0 + 40, sy1 - 640, sx1 - 40, sy1 - 40], 36, fill=(255, 255, 255),
                                outline=(200, 190, 175), width=6)
            full = 'сделай как озон.\nбез багов.\nОЧЕНЬ ВАЖНО!!!'
            n = int(len(full) * typed)
            txt = full[:n] + ('|' if (t * 2) % 1 < 0.5 else '')
            d.multiline_text((sx0 + 90, sy1 - 580), txt, font=rubik(84), fill=(30, 30, 30), spacing=30)
            d.text((sx0 + 90, sy1 - 760), 'Спросите что-нибудь…', font=rubik(46), fill=(150, 140, 130))
    else:
        f = mono(46)
        rows = [
            ('$ нейросеть --без-подтверждений', (200, 200, 210)),
            ('> чиню баги в продакшене...', (130, 200, 120)),
            ('> DROP DATABASE production;', (255, 90, 90)),
            ('[OK] Готово! Удалено:', (130, 200, 120)),
            ('  1 284 913 клиентов', (255, 210, 90)),
            ('', (0, 0, 0)),
            ('Токенов потрачено: 9 млн', (200, 200, 210)),
            ('Счёт: 340 000 ₽', (255, 90, 90)),
        ]
        n = int(len(rows) * min(1, fail_k * 1.6)) + 1
        for k, (ln, col) in enumerate(rows[:n]):
            d.text((sx0 + 60, sy0 + 80 + k * 90), ln, font=f, fill=col)
        if fail_k > 0.45:
            yy = sy0 + 900
            d.rounded_rectangle([sx0 + 40, yy, sx1 - 40, yy + 330], 30, fill=(246, 243, 236))
            star(d, sx0 + 120, yy + 90, 34, (226, 120, 70), t)
            d.multiline_text((sx0 + 190, yy + 40), 'Вы абсолютно правы!\nПриношу извинения 🙏'.replace(' 🙏', ''),
                             font=rubik(64), fill=(30, 30, 30), spacing=24)
    d.rounded_rectangle([0, 2040, W, 2140], 20, fill=(150, 156, 170), outline=OUTL, width=10)


def star(d, cx, cy, r, col, t):
    a0 = t * 1.5
    pts = []
    for k in range(16):
        rr = r if k % 2 == 0 else r * 0.35
        a = a0 + k * math.pi / 8
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    d.polygon(pts, fill=col)


# ---------------------------------------------------------------- subtitles
def word_times(l):
    words = l['text'].replace(' — ', ' ').split()
    wts = [len(w) + (4 if w[-1] in '.!?' else 2 if w[-1] in ',' else 0) + 2 for w in words]
    tot = sum(wts)
    t, res = l['start'] + 0.05, []
    span = l['dur'] - 0.15
    for w, k in zip(words, wts):
        dt = span * k / tot
        res.append((w, t, t + dt))
        t += dt
    return res


CHUNKS = []
for l in LINES:
    wt = word_times(l)
    cur = []
    for w in wt:
        cur.append(w)
        txt = ' '.join(x[0] for x in cur)
        if len(txt) > 14 or w[0][-1] in '.!?':
            CHUNKS.append(cur); cur = []
    if cur:
        CHUNKS.append(cur)
SUBF = rubik(40)


def subtitle(img, t, y=1050):
    ch = None
    for c in CHUNKS:
        if c[0][1] - 0.02 <= t < c[-1][2] + 0.15:
            ch = c
    if not ch:
        return
    words = [w for w, _, _ in ch]
    txt = ' '.join(words)
    tw = SUBF.getbbox(txt)[2]
    pad = 22
    tile = Image.new('RGBA', (tw + pad * 2 + 20, 90), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    d.rounded_rectangle([10, 10, tw + pad * 2 + 10, 80], 10, fill=(22, 22, 26, 235))
    x = 10 + pad
    for w, a, b in ch:
        col = (255, 196, 40) if a <= t < b + 0.08 else (255, 255, 255)
        d.text((x, 45), w, font=SUBF, fill=col, anchor='lm')
        x += SUBF.getbbox(w + ' ')[2]
    tile = tile.rotate(2, resample=Image.BICUBIC, expand=True)
    img.paste(tile, (int(OW / 2 - tile.width / 2), y), tile)


def caption(img, txt, k=1.0):
    f = rubik(34)
    tw = f.getbbox(txt)[2]
    tile = Image.new('RGBA', (tw + 60, 80), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    d.rounded_rectangle([5, 5, tw + 55, 75], 12, fill=(22, 22, 26, 240))
    d.text((tw / 2 + 30, 40), txt, font=f, fill=(255, 255, 255), anchor='mm')
    tile = tile.rotate(-2, resample=Image.BICUBIC, expand=True)
    y = int(70 - (1 - ease(k)) * 140)
    img.paste(tile, (int(OW / 2 - tile.width / 2), y), tile)


# ---------------------------------------------------------------- scenes
def scene_bounds():
    sc = []
    for l in LINES:
        if not sc or sc[-1][0] != l['scene']:
            prev_end = sc[-1][2] if sc else 0
            st = l['start'] - (l['start'] - prev_end) if sc else 0
            sc.append([l['scene'], st, l['start'] + l['dur']])
        else:
            sc[-1][2] = l['start'] + l['dur']
    # сцена начинается сразу после конца предыдущей реплики
    for k in range(1, len(sc)):
        sc[k][1] = sc[k - 1][2]
    sc[-1][2] = TOTAL
    return sc


SCENES = scene_bounds()


def line_of(scene, k=0):
    return [l for l in LINES if l['scene'] == scene][k]


def render_world(t):
    """-> (world image, zoom, cx, cy, overlays)"""
    name, s0, s1 = next(s for s in SCENES if s[1] <= t < s[2] or s is SCENES[-1])
    for s in SCENES:
        if s[1] <= t < s[2]:
            name, s0, s1 = s
    lt = t - s0
    sk = (t - s0) / max(0.01, s1 - s0)
    ov = []
    zoom, cx, cy = 1.0, W / 2, H / 2
    bob = math.sin(t * 2.2) * 6

    if name == 'intro':
        img = bg('brick_sign')
        d = ImageDraw.Draw(img)
        floor(d, 2250)
        gena(d, 720, 1260 + bob, 1.15, t, mouth(t, 'V'), 'smug' if lt > 3 else 'lazy', 'type', look=(0.3, 0.6))
        desk(d, 160, 1760, 1280, 2300)
        laptop_back(d, 720, 1770)
        can(d, 330, 1770); can(d, 420, 1770, (60, 150, 230)); mug(d, 1120, 1770)
        zoom = 1.0 + 0.4 * ease(sk)
        cx, cy = 720, 1250 + 300 * (1 - ease(sk))
    elif name == 'call':
        img = bg('split')
        d = ImageDraw.Draw(img)
        tk = mouth(t, 'K')
        tamara(d, 720, 560 + bob * 0.5, 0.95, t, tk, 'normal', 'phone', look=(-0.5, 0))
        d.rectangle([0, 1080, W, 1280], fill=WOOD_D)
        d.line([0, 1080, W, 1080], fill=OUTL, width=10)
        ring = lt < LINES[1]['start'] - s0
        gm = mouth(t, 'V')
        gena(d, 720 + (math.sin(t * 60) * 5 if ring else 0), 1880 + bob, 0.95, t, gm,
             'wide' if ring else 'smug', 'none' if ring else 'phone', look=(0.4, -0.4))
        desk(d, 200, 2330, 1240, 2560)
        laptop_back(d, 720, 2340, 380, 240)
        if ring:
            P = Pen(d, 1080, 1700, 1)
            sh = math.sin(t * 50) * 10
            P.rrect(-60 + sh, -100, 60 + sh, 100, 20, DARK)
            P.rrect(-45 + sh, -80, 45 + sh, 70, 6, (120, 200, 255), out=False)
            d.text((1080, 1520), 'ДЗЫНЬ!', font=russo(100), fill=(255, 220, 60), anchor='mm',
                   stroke_width=10, stroke_fill=OUTL)
        d.line([0, 1280, W, 1280], fill=OUTL, width=16)
        act = speaking(t, 'K')
        tgt = 1.06 if act or speaking(t, 'V') else 1.0
        zoom = tgt
        cy = 640 if act else (1920 if speaking(t, 'V') else 1280)
        if zoom == 1.0:
            cy = 1280
    elif name in ('prompt', 'fail_screen'):
        img = Image.new('RGB', (W, H))
        if name == 'prompt':
            l5, l6 = line_of('prompt', 0), line_of('prompt', 1)
            typed = ease((t - l5['start']) / (l5['dur'] * 0.9))
            reply = (t - l6['start']) / l6['dur'] if t >= l6['start'] - 0.2 else 0
            if t >= l6['start'] - 0.2:
                reply = max(0.01, reply)
            code = max(0, (t - l6['start'] - l6['dur'] * 0.45) / 1.6)
            chat_screen(img, t, typed, reply, code)
            d = ImageDraw.Draw(img)
            amazed = t >= l6['start']
            gena(d, 720, 2330 + bob, 1.5, t, mouth(t, 'V'), 'wide' if amazed else 'lazy', 'type',
                 look=(0, -1), glow=(150, 190, 255))
            zoom = 1.0 + 0.12 * ease(sk)
            cy = 1300
        else:
            l = line_of('fail_screen')
            fk = (t - s0) / max(0.1, s1 - s0)
            chat_screen(img, t, 1, 1, 0, fail=True, fail_k=fk)
            d = ImageDraw.Draw(img)
            gena(d, 720 + math.sin(t * 40) * 4, 2330, 1.5, t, 0.55, 'wide', 'none', look=(0, -1),
                 glow=(255, 120, 120))
            ov.append(('red', 0.18 + 0.14 * (math.sin(t * 12) > 0)))
            zoom = 1.05 + 0.1 * ease(sk)
            cy = 1250
    elif name == 'proud':
        img = bg('brick_sign_top')
        d = ImageDraw.Draw(img)
        gena(d, 720, 1300 + bob, 1.9, t, mouth(t, 'V'), 'smug', 'finger', look=(0.6, 0))
        zoom = 1.0 + 0.08 * ease(sk)
        cy = 1350
    elif name == 'later':
        img = bg('brick_sign')
        d = ImageDraw.Draw(img)
        floor(d, 2100)
        tk = mouth(t, 'K')
        tamara(d, 1130, 1150 + bob * 0.5, 0.92, t, tk, 'normal', 'hips', look=(-1, 0), legs=True)
        gena(d, 480, 1300 + bob, 0.95, t, mouth(t, 'V'), 'smug' if speaking(t, 'V') else 'lazy',
             'type' if not speaking(t, 'V') else 'shrug', look=(1, -0.3))
        desk(d, 60, 1760, 900, 2250)
        laptop_back(d, 480, 1770, 380, 250)
        can(d, 160, 1770); can(d, 250, 1770, (60, 150, 230)); can(d, 800, 1770, (230, 70, 70))
        ov.append(('caption', '20 минут спустя', lt / 0.4))
        if speaking(t, 'K'):
            zoom, cx, cy = 1.25, 1050, 1500
        elif speaking(t, 'V'):
            zoom, cx, cy = 1.25, 520, 1500
        else:
            zoom, cx, cy = 1.0, 720, 1280
    elif name == 'fail_k':
        img = bg('office')
        d = ImageDraw.Draw(img)
        tamara(d, 720 + math.sin(t * 30) * 4, 1300, 1.9, t, mouth(t, 'K'), 'angry', 'fist', red=0.5)
        ov.append(('red', 0.18 + 0.14 * (math.sin(t * 12) > 0)))
        zoom = 1.0 + 0.1 * ease(sk)
        cy = 1350
    elif name == 'final':
        img = bg('brick_sign')
        d = ImageDraw.Draw(img)
        floor(d, 2250)
        vk = speaking(t, 'V')
        gena(d, 1010, 1320 + bob, 1.1, t, mouth(t, 'V'), 'lazy', 'shrug' if vk else 'none',
             look=(-1, 0))
        tamara(d, 400, 1260, 1.1, t, mouth(t, 'K'), 'angry', 'point_r', look=(1, 0), red=0.4)
        if vk:
            zoom, cx, cy = 1.35, 1000, 1500
        else:
            zoom, cx, cy = 1.2, 560, 1450
    else:  # final2
        img = bg('brick_sign_top')
        d = ImageDraw.Draw(img)
        l = line_of('final2')
        endk = max(0, t - (l['start'] + l['dur']))
        gena(d, 720, 1260 + bob, 2.15, t, mouth(t, 'V'), 'angry', 'finger', look=(0, 0),
             red=min(1, lt / 1.2))
        zoom = 1.0 + 0.15 * ease(sk) + 0.25 * ease(endk / 1.5)
        cy = 1300
        if endk > 0:
            ov.append(('end', endk))
    # толчок камеры на смене сцены
    punch = 1 + 0.07 * (1 - ease(lt / 0.25))
    return img, zoom * punch, cx, cy, ov


CAM = {'z': 1.0, 'x': W / 2, 'y': H / 2, 'scene': None}


def frame(t):
    img, z, cx, cy, ov = render_world(t)
    sc = next((s[0] for s in SCENES if s[1] <= t < s[2]), SCENES[-1][0])
    if CAM['scene'] != sc:
        CAM.update(z=z, x=cx, y=cy, scene=sc)
    else:
        a = 0.12
        CAM['z'] += (z - CAM['z']) * a
        CAM['x'] += (cx - CAM['x']) * a
        CAM['y'] += (cy - CAM['y']) * a
    z, cx, cy = CAM['z'], CAM['x'], CAM['y']
    vw, vh = W / z, H / z
    x0 = min(max(0, cx - vw / 2), W - vw)
    y0 = min(max(0, cy - vh / 2), H - vh)
    out = img.resize((OW, OH), Image.BILINEAR, box=(x0, y0, x0 + vw, y0 + vh))
    for o in ov:
        if o[0] == 'red':
            out = Image.blend(out, Image.new('RGB', out.size, (230, 20, 20)), o[1])
        elif o[0] == 'caption':
            caption(out, o[1], o[2])
        elif o[0] == 'end':
            k = ease((o[1] - 0.6) / 1.0)
            if k > 0:
                out = Image.blend(out, Image.new('RGB', out.size, (0, 0, 0)), k * 0.9)
    subtitle(out, t, 20 if sc in ('prompt', 'fail_screen') else 1050)
    return out


if __name__ == '__main__':
    if PREVIEW:
        os.makedirs(f'{ROOT}/preview', exist_ok=True)
        for ts in PREVIEW.split(','):
            CAM['scene'] = None
            frame(float(ts)).save(f'{ROOT}/preview/f_{float(ts):05.1f}.png')
        sys.exit()
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    nframes = int(TOTAL * FPS)
    p = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{OW}x{OH}',
                          '-r', str(FPS), '-i', '-', '-i', f'{ROOT}/out/mix.wav', '-c:v', 'libx264', '-preset',
                          'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
                          '-shortest', '-movflags', '+faststart', OUT_PATH], stdin=subprocess.PIPE)
    for k in range(nframes):
        p.stdin.write(frame(k / FPS).tobytes())
        if k % 150 == 0:
            print(f'{k}/{nframes}', flush=True)
    p.stdin.close()
    p.wait()
    print('done', OUT_PATH)
