#!/usr/bin/env python3
"""Reels em motion da "Rifa em prol do Alek" (D'mialo Doceria), narrado, 1080x1920.

Uso:
  python3 motion.py preview T1 T2 ...       -> quadros de conferência (prev_T.jpg)
  python3 motion.py render K N pedaco.mp4   -> renderiza o pedaço K de N (só vídeo)
"""
import io
import json
import math
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SP = "/tmp/claude-0/-home-user-claudinho/752283aa-dafe-547a-a805-d485f40485d6/scratchpad"
R = f"{SP}/rifa"
UP = "/root/.claude/uploads/752283aa-dafe-547a-a805-d485f40485d6"
IMG = "/tmp/claude-0/-home-user-claudinho/752283aa-dafe-547a-a805-d485f40485d6/images"
FD = f"{SP}/fonts_dl"
FF = "ffmpeg"
W, H, FPS = 1080, 1920, 30

# paleta D'mialo (amostrada das artes)
CREAM = (241, 230, 212)
CREAM_L = (248, 242, 230)
CARD = (250, 246, 238)
BROWN = (91, 52, 35)
TEAL = (31, 106, 138)
ORANGE = (206, 138, 90)
WHITE = (255, 255, 255)

FALAS = json.load(open(f"{R}/falas.json"))
END_HOLD = 2.6
TOTAL = round(FALAS[-1]["fim"] + END_HOLD, 2)


# ------------------------------------------------------------------ utilidades
def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def e_cubic(u):
    u = clamp(u)
    return 1 - (1 - u) ** 3


def e_back(u, s=1.9):
    u = clamp(u) - 1
    return u * u * ((s + 1) * u + s) + 1


def e_inout(u):
    u = clamp(u)
    return 0.5 - 0.5 * math.cos(math.pi * u)


_fc = {}


def fred(size, wght=650):
    key = ("fred", size, wght)
    if key not in _fc:
        f = ImageFont.truetype(f"{FD}/Fredoka.ttf", size)
        vals = []
        for ax in f.get_variation_axes():
            nm = ax.get("name")
            nm = nm.decode() if isinstance(nm, bytes) else str(nm)
            vals.append(wght if "eight" in nm.lower() else 100)
        f.set_variation_by_axes(vals)
        _fc[key] = f
    return _fc[key]


def pop(size, style="Medium"):
    key = ("pop", size, style)
    if key not in _fc:
        _fc[key] = ImageFont.truetype(f"{FD}/Poppins-{style}.ttf", size)
    return _fc[key]


def cav(size, wght=700):
    key = ("cav", size, wght)
    if key not in _fc:
        f = ImageFont.truetype(f"{FD}/Caveat.ttf", size)
        f.set_variation_by_axes([wght])
        _fc[key] = f
    return _fc[key]


def txt(text, font, color, pad=8):
    l, t, r, b = font.getbbox(text)
    im = Image.new("RGBA", (r - l + 2 * pad, b - t + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((pad - l, pad - t), text, font=font, fill=color)
    return im


def rich(parts, pad=8, gap=None):
    """Linha com trechos de fontes/cores diferentes, alinhados pela linha de base."""
    asc = max(f.getmetrics()[0] for _, f, _ in parts)
    desc = max(f.getmetrics()[1] for _, f, _ in parts)
    widths = [f.getlength(s) for s, f, _ in parts]
    im = Image.new("RGBA", (round(sum(widths)) + 2 * pad, asc + desc + 2 * pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x = pad
    for (s, f, c), w in zip(parts, widths):
        d.text((x, pad + asc), s, font=f, fill=c, anchor="ls")
        x += w
    return im.crop(im.getbbox()) if im.getbbox() else im


def ss(draw_fn, size, k=4):
    """Desenha em 4x e reduz (antisserrilhado) — para ícones e formas."""
    big = Image.new("RGBA", (size[0] * k, size[1] * k), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(big), k)
    return big.resize(size, Image.LANCZOS)


def shadowed(im, radius=26, off=12, alpha=110, blur=20, margin=40):
    """Coloca sombra suave sob uma imagem RGBA (forma pelo canal alfa)."""
    W2, H2 = im.width + 2 * margin, im.height + 2 * margin
    out = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
    sh = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
    a = im.getchannel("A").point(lambda v: v * alpha // 255)
    blk = Image.new("RGBA", im.size, (60, 35, 20, 255))
    blk.putalpha(a)
    sh.alpha_composite(blk, (margin, margin + off))
    out.alpha_composite(sh.filter(ImageFilter.GaussianBlur(blur)))
    out.alpha_composite(im, (margin, margin))
    return out


def rounded_mask(size, r):
    return ss(lambda d, k: d.rounded_rectangle((0, 0, size[0] * k - 1, size[1] * k - 1), r * k, fill=(255, 255, 255, 255)),
              size).getchannel("A")


def card_box(w, h, fill=CARD, r=34, outline=None, ow=0):
    def fn(d, k):
        d.rounded_rectangle((0, 0, w * k - 1, h * k - 1), r * k, fill=fill + (255,))
        if outline:
            d.rounded_rectangle((0, 0, w * k - 1, h * k - 1), r * k, outline=outline + (255,), width=ow * k)
    return ss(fn, (w, h))


def cover(img, w, h, focus=(0.5, 0.5)):
    iw, ih = img.size
    s = max(w / iw, h / ih)
    nw, nh = max(w, round(iw * s)), max(h, round(ih * s))
    im = img.resize((nw, nh), Image.BICUBIC)
    x = round(clamp(focus[0] * nw - w / 2, 0, nw - w))
    y = round(clamp(focus[1] * nh - h / 2, 0, nh - h))
    return im.crop((x, y, x + w, y + h))


def with_alpha(im, a):
    if a >= 0.999:
        return im
    im = im.copy()
    lut = [int(v * a) for v in range(256)]
    im.putalpha(im.getchannel("A").point(lut))
    return im


def paste(canvas, im, x, y):
    """alpha_composite tolerante a posições fora da tela."""
    x, y = int(round(x)), int(round(y))
    sx, sy = max(0, -x), max(0, -y)
    ex, ey = min(im.width, W - x), min(im.height, H - y)
    if ex <= sx or ey <= sy:
        return
    canvas.alpha_composite(im.crop((sx, sy, ex, ey)) if (sx or sy or ex < im.width or ey < im.height) else im,
                           (x + sx, y + sy))


# ------------------------------------------------------------------ ícones
def paw(size, color):
    def fn(d, k):
        s = size * k
        d.ellipse((s * 0.22, s * 0.42, s * 0.78, s * 0.92), fill=color + (255,))
        for cx, cy, rw, rh in ((0.14, 0.40, 0.11, 0.14), (0.34, 0.20, 0.11, 0.15), (0.66, 0.20, 0.11, 0.15), (0.86, 0.40, 0.11, 0.14)):
            d.ellipse(((cx - rw) * s, (cy - rh) * s, (cx + rw) * s, (cy + rh) * s), fill=color + (255,))
    return ss(fn, (size, size))


def crown(size, color):
    def fn(d, k):
        s = size * k
        d.polygon([(0.08 * s, 0.30 * s), (0.30 * s, 0.52 * s), (0.50 * s, 0.18 * s), (0.70 * s, 0.52 * s),
                   (0.92 * s, 0.30 * s), (0.84 * s, 0.78 * s), (0.16 * s, 0.78 * s)], fill=color + (255,))
        d.rounded_rectangle((0.16 * s, 0.82 * s, 0.84 * s, 0.92 * s), 0.03 * s, fill=color + (255,))
    return ss(fn, (size, size))


def heart(size, color):
    def fn(d, k):
        s = size * k
        d.ellipse((0.06 * s, 0.12 * s, 0.52 * s, 0.58 * s), fill=color + (255,))
        d.ellipse((0.48 * s, 0.12 * s, 0.94 * s, 0.58 * s), fill=color + (255,))
        d.polygon([(0.09 * s, 0.45 * s), (0.91 * s, 0.45 * s), (0.5 * s, 0.92 * s)], fill=color + (255,))
    return ss(fn, (size, size))


def circle_icon(size, bg, kind, fg=WHITE):
    def fn(d, k):
        s = size * k
        d.ellipse((0, 0, s - 1, s - 1), fill=bg + (255,))
        lw = round(0.1 * s)
        if kind == "x":
            m = 0.32 * s
            d.line((m, m, s - m, s - m), fill=fg + (255,), width=lw)
            d.line((m, s - m, s - m, m), fill=fg + (255,), width=lw)
        elif kind == "check":
            d.line((0.27 * s, 0.52 * s, 0.44 * s, 0.68 * s), fill=fg + (255,), width=lw)
            d.line((0.44 * s, 0.68 * s, 0.74 * s, 0.34 * s), fill=fg + (255,), width=lw)
        elif kind == "nodule":
            d.ellipse((0.26 * s, 0.26 * s, 0.74 * s, 0.74 * s), outline=fg + (255,), width=round(0.07 * s))
            d.ellipse((0.42 * s, 0.42 * s, 0.58 * s, 0.58 * s), fill=fg + (255,))
    return ss(fn, (size, size))


def num_circle(size, n, bg=TEAL, fg=WHITE):
    im = circle_icon(size, bg, "none")
    d = ImageDraw.Draw(im)
    d.text((size / 2, size / 2 + 2), str(n), font=fred(round(size * 0.52), 700), fill=fg, anchor="mm")
    return im


def calendar(size, color):
    def fn(d, k):
        s = size * k
        d.rounded_rectangle((0.08 * s, 0.16 * s, 0.92 * s, 0.92 * s), 0.12 * s, outline=color + (255,), width=round(0.08 * s))
        d.rectangle((0.08 * s, 0.16 * s, 0.92 * s, 0.36 * s), fill=color + (255,))
        for x in (0.3, 0.7):
            d.rounded_rectangle(((x - 0.05) * s, 0.04 * s, (x + 0.05) * s, 0.26 * s), 0.04 * s, fill=color + (255,))
        for x in (0.32, 0.5, 0.68):
            d.ellipse(((x - 0.055) * s, 0.55 * s, (x + 0.055) * s, 0.66 * s), fill=color + (255,))
    return ss(fn, (size, size))


def ticket(size, color):
    def fn(d, k):
        s = size * k
        d.rounded_rectangle((0.04 * s, 0.22 * s, 0.96 * s, 0.78 * s), 0.08 * s, outline=color + (255,), width=round(0.07 * s))
        for cy in (0.5,):
            d.ellipse((-0.06 * s, (cy - 0.1) * s, 0.14 * s, (cy + 0.1) * s), fill=(0, 0, 0, 0))
        for y in (0.36, 0.5, 0.64):
            d.rectangle((0.66 * s, (y - 0.03) * s, 0.72 * s, (y + 0.03) * s), fill=color + (255,))
    return ss(fn, (size, size))


def logo(width, white=False):
    src = Image.open(f"{R}/logo_white.png" if white else f"{R}/logo_teal.png")
    h = round(src.height * width / src.width)
    big = src.resize((width, h), Image.BICUBIC)
    a = np.asarray(big.getchannel("A")).astype(np.float32) / 255
    a = np.clip((a - 0.5) * 2.2 + 0.5, 0, 1)            # bordas mais nítidas ao ampliar
    big.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    return big


# ------------------------------------------------------------------ fontes de imagem
def load_video(path):
    probe = subprocess.run([FF, "-v", "error", "-i", path, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
                           capture_output=True, check=True).stdout
    w, h = Image.open(io.BytesIO(probe)).size
    raw = subprocess.run([FF, "-v", "error", "-i", path, "-an", "-vf",
                          "scale=in_color_matrix=bt709:in_range=tv,format=rgb24", "-f", "rawvideo", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)


class VideoCard:
    """Vídeo dentro de um cartão com moldura branca e cantos arredondados (como as fotos das artes)."""

    def __init__(self, frames, fps, src, w, h, speed=1.0, rot=0.0, focus=(0.5, 0.5), border=12, r=38, zoom=(1.0, 1.0)):
        self.f, self.fps, self.src, self.w, self.h = frames, fps, src, w, h
        self.speed, self.rot, self.focus, self.b, self.zoom = speed, rot, focus, border, zoom
        self.frame_mask = rounded_mask((w + 2 * border, h + 2 * border), r)
        self.photo_mask = rounded_mask((w, h), max(4, r - border))
        blank = Image.new("RGBA", (w + 2 * border, h + 2 * border), (0, 0, 0, 0))
        blank.paste(WHITE, (0, 0, blank.width, blank.height), self.frame_mask)
        if rot:
            blank = blank.rotate(rot, Image.BICUBIC, expand=True)
        self.base = shadowed(blank, blur=18, off=14, alpha=95)     # sombra calculada uma vez só

    def __call__(self, tl):
        i = int(clamp((self.src + tl * self.speed) * self.fps, 0, len(self.f) - 1))
        z = self.zoom[0] + (self.zoom[1] - self.zoom[0]) * clamp(tl / 6)
        img = Image.fromarray(self.f[i])
        ph = cover(img, round(self.w * z), round(self.h * z), self.focus)
        ox, oy = (ph.width - self.w) // 2, (ph.height - self.h) // 2
        ph = ph.crop((ox, oy, ox + self.w, oy + self.h))
        out = Image.new("RGBA", (self.w + 2 * self.b, self.h + 2 * self.b), (0, 0, 0, 0))
        out.paste(WHITE, (0, 0, out.width, out.height), self.frame_mask)
        out.paste(ph, (self.b, self.b), self.photo_mask)
        if self.rot:
            out = out.rotate(self.rot, Image.BICUBIC, expand=True)
        res = self.base.copy()
        res.alpha_composite(out, (40, 40))
        return res


def photo_card(img, w, h, rot=0.0, border=12, r=38, focus=(0.5, 0.5)):
    ph = cover(img, w, h, focus)
    out = Image.new("RGBA", (w + 2 * border, h + 2 * border), (0, 0, 0, 0))
    out.paste(WHITE, (0, 0, out.width, out.height), rounded_mask(out.size, r))
    out.paste(ph, (border, border), rounded_mask((w, h), r - border))
    if rot:
        out = out.rotate(rot, Image.BICUBIC, expand=True)
    return shadowed(out, blur=18, off=14, alpha=95)


# ------------------------------------------------------------------ elementos animados
class El:
    def __init__(self, src, x, y, t_in, anim="pop", dur=0.5, t_out=None, anchor=(0.5, 0.5), bob=0.0, pulse=0.0):
        self.src, self.x, self.y, self.t_in, self.anim, self.dur = src, x, y, t_in, anim, dur
        self.t_out, self.anchor, self.bob, self.pulse = t_out, anchor, bob, pulse

    def draw(self, canvas, t):
        if t < self.t_in or (self.t_out is not None and t >= self.t_out + 0.3):
            return
        tl = t - self.t_in
        u = clamp(tl / self.dur)
        img = self.src(tl) if callable(self.src) else self.src
        a, s, dx, dy = 1.0, 1.0, 0.0, 0.0
        if self.anim == "pop":
            s, a = 0.35 + 0.65 * e_back(u), clamp(u * 3)
        elif self.anim == "zoom":
            s, a = 1.7 - 0.7 * e_cubic(u), clamp(u * 2.5)
        elif self.anim == "up":
            dy, a = (1 - e_cubic(u)) * 110, clamp(u * 2.2)
        elif self.anim == "down":
            dy, a = -(1 - e_cubic(u)) * 110, clamp(u * 2.2)
        elif self.anim == "left":            # entra vindo da direita
            dx, a = (1 - e_cubic(u)) * 700, clamp(u * 2)
        elif self.anim == "right":           # entra vindo da esquerda
            dx, a = -(1 - e_cubic(u)) * 700, clamp(u * 2)
        elif self.anim == "fade":
            a = clamp(u)
        if self.bob:
            dy += self.bob * math.sin(2 * math.pi * tl / 1.6)
        if self.pulse and u >= 1:
            s *= 1 + self.pulse * (0.5 - 0.5 * math.cos(2 * math.pi * (tl - self.dur) / 1.1))
        if self.t_out is not None and t > self.t_out:
            q = clamp((t - self.t_out) / 0.3)
            a *= 1 - q
            s *= 1 - 0.1 * q
            dy -= 50 * q
        if a <= 0.003:
            return
        if abs(s - 1) > 0.002:
            img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.BICUBIC)
        img = with_alpha(img, a)
        paste(canvas, img, self.x - img.width * self.anchor[0] + dx, self.y - img.height * self.anchor[1] + dy)


def words_line(parts, cx, y, t0, stagger=0.09, anim="up", dur=0.45, t_out=None):
    """Linha centralizada em que cada palavra entra em sequência. parts = [(texto, fonte, cor)]."""
    items = []
    for s, f, c in parts:
        for wd in s.split(" "):
            if wd:
                items.append((wd, f, c))
    imgs = [txt(w, f, c, pad=6) for w, f, c in items]
    sp = [f.getlength(" ") for _, f, _ in items]
    total = sum(im.width - 12 for im in imgs) + sum(sp[:-1])
    x = cx - total / 2
    els = []
    for k, (im, s) in enumerate(zip(imgs, sp)):
        els.append(El(im, x - 6, y, t0 + k * stagger, anim, dur, t_out, anchor=(0, 0.5)))
        x += im.width - 12 + s
    return els


# ------------------------------------------------------------------ tempos da narração
def scene_start(cena):
    return next(f["ini"] for f in FALAS if f["cena"] == cena)


def kw(cena, prefix, nth=0):
    """Momento em que a palavra (prefixo) é falada dentro da cena."""
    n = 0
    for f in FALAS:
        if f["cena"] != cena:
            continue
        for w, t in f["palavras"]:
            if w.lower().strip(".,!?:;").startswith(prefix.lower()):
                if n == nth:
                    return t
                n += 1
    raise KeyError((cena, prefix))


def fala_ini(cena, nth):
    return [f for f in FALAS if f["cena"] == cena][nth]["ini"]


ORDER = []
for f in FALAS:
    if f["cena"] not in ORDER:
        ORDER.append(f["cena"])
BOUNDS = {}
for i, c in enumerate(ORDER):
    a = 0.0 if i == 0 else scene_start(c) - 0.28
    b = (scene_start(ORDER[i + 1]) - 0.28) if i + 1 < len(ORDER) else TOTAL + 1
    BOUNDS[c] = (a, b)


# ------------------------------------------------------------------ fundo
def make_bg():
    bg = Image.new("RGBA", (W, H), CREAM + (255,))
    ring = Image.new("RGBA", (W, H), CREAM_L + (0,))      # transparente na cor do anel (sem borda escura ao desfocar)
    d = ImageDraw.Draw(ring)
    d.ellipse((-560, -260, 520, 820), outline=CREAM_L + (120,), width=110)
    d.ellipse((620, 1380, 1560, 2320), outline=CREAM_L + (105,), width=90)
    bg.alpha_composite(ring.filter(ImageFilter.GaussianBlur(2)))
    return bg


BG = None
PAWS = []
PAW_IMG = None


def draw_bg(canvas, t):
    canvas.paste(BG, (0, 0))
    for (x0, y0, sp, ph, sc) in PAWS:            # patinhas bem suaves flutuando
        y = (y0 - sp * t) % (H + 200) - 100
        x = x0 + 18 * math.sin(t * 0.7 + ph)
        im = PAW_IMG[sc]
        paste(canvas, im, x - im.width / 2, y - im.height / 2)


# ------------------------------------------------------------------ cenas
SCENES = {}     # cena -> lista de El
GLOBAL = []     # elementos fora das cenas (logo do topo)


def build():
    global BG, PAWS, PAW_IMG
    BG = make_bg()
    PAW_IMG = {s: with_alpha(paw(s, (226, 208, 182)), 0.75) for s in (70, 96, 120)}
    rng = np.random.default_rng(7)
    PAWS = [(float(rng.uniform(80, 1000)), float(rng.uniform(0, H)), float(rng.uniform(18, 34)), float(rng.uniform(0, 6)),
             int(rng.choice([70, 96, 120]))) for _ in range(7)]

    vA = load_video(f"{UP}/efb45cc7-WhatsApp_Video_2026-10-12_at_20.58.16.mp4")     # no colo, se lambendo
    vB = load_video(f"{UP}/6adc1dd1-WhatsApp_Video_2026-10-12_at_20.58.21.mp4")     # hospital, olhando p/ câmera
    vD = load_video(f"{UP}/f3b4d862-WhatsApp_Video_2026-10-04_at_12.34.34.mp4")     # se arrastando (04/10)
    fpsB = len(vB) / 6.63
    basket = Image.open(f"{IMG}/9.jpg").convert("RGB")
    p12 = Image.open(f"{IMG}/12.jpg").convert("RGB")
    alek_still = Image.open(f"{SP}/still_0.4.png").convert("RGB")

    def S(c):
        return BOUNDS[c]

    # 1) abertura -------------------------------------------------------------
    a, b = S("abertura")
    to = b - 0.3
    SCENES["abertura"] = [
        El(VideoCard(vB, fpsB, 0.2, 700, 900, rot=-2.5, zoom=(1.0, 1.06)), 540, 720, a, "none", t_out=to),
        El(txt("VOCÊ JÁ CONHECE O", fred(70, 650), TEAL), 540, 1305, a, "none", t_out=to),
        El(txt("ALEK", fred(250, 700), BROWN), 500, 1500, kw("abertura", "alec") - 0.12, "zoom", 0.45, to),
        El(paw(120, TEAL), 905, 1440, kw("abertura", "alec") + 0.1, "pop", 0.5, to, bob=7),
    ]

    # 2) diagnóstico ----------------------------------------------------------
    a, b = S("diagnostico")
    to = b - 0.3
    els = words_line([("AGORA ELE TEM UM", fred(62, 600), TEAL)], 540, 300, a + 0.05, t_out=to)
    els.append(El(txt("DIAGNÓSTICO", fred(124, 700), BROWN), 540, 405, kw("diagnostico", "diagn") - 0.1, "zoom", 0.45, to))
    els.append(El(VideoCard(vA, 30, 1.0, 600, 640, rot=2, zoom=(1.0, 1.05)), 540, 860, a + 0.15, "up", 0.6, to))

    def diag_card(top, big):
        c = card_box(900, 170)
        c.alpha_composite(circle_icon(110, TEAL, "nodule"), (34, 30))
        c.alpha_composite(txt(top, pop(36, "Medium"), BROWN), (170, 22))
        c.alpha_composite(txt(big, fred(66, 700), TEAL), (166, 66))
        return shadowed(c, alpha=70)
    els.append(El(diag_card("Um nódulo no", "FÍGADO"), 540, 1335, kw("diagnostico", "nódulo") - 0.05, "left", 0.5, to))
    els.append(El(diag_card("E outro na", "COLUNA"), 540, 1535, kw("diagnostico", "outro") - 0.05, "left", 0.5, to))
    SCENES["diagnostico"] = els

    # 3) sintomas -------------------------------------------------------------
    a, b = S("sintomas")
    to = b - 0.3
    els = words_line([("POR CAUSA DISSO...", fred(60, 600), TEAL)], 540, 270, a + 0.05, t_out=to)
    els.append(El(VideoCard(vD, 30, 0.0, 600, 720, speed=0.95, rot=-2), 540, 735, a + 0.2, "pop", 0.55, to))

    def sym_row(text):
        c = card_box(900, 118)
        c.alpha_composite(circle_icon(78, TEAL, "x"), (24, 20))
        c.alpha_composite(txt(text, pop(40, "SemiBold"), BROWN), (124, 26))
        return shadowed(c, alpha=60, off=8, blur=14, margin=30)
    els.append(El(sym_row("Não consegue andar"), 540, 1205, kw("sintomas", "andar") - 0.35, "left", 0.45, to))
    els.append(El(sym_row("Não mexe o rabinho"), 540, 1345, kw("sintomas", "rabinho") - 0.45, "left", 0.45, to))
    els.append(El(sym_row("Não sustenta as patinhas de trás"), 540, 1485, kw("sintomas", "sustentar") - 0.3, "left", 0.45, to))
    els.append(El(txt("mas às vezes ainda consegue movimentá-las", cav(52, 700), TEAL), 540, 1600,
                  kw("sintomas", "mesmo") - 0.1, "up", 0.5, to))
    SCENES["sintomas"] = els

    # 4) cirurgia -------------------------------------------------------------
    a, b = S("cirurgia")
    to = b - 0.3
    els = words_line([("O ALEK VAI", fred(78, 650), TEAL)], 540, 760, a + 0.05, stagger=0.1, t_out=to)
    els += words_line([("PRECISAR DE UMA", fred(78, 650), TEAL)], 540, 860, a + 0.35, stagger=0.1, t_out=to)
    tc = kw("cirurgia", "cirurgia")
    fs = 196
    while fred(fs, 700).getlength("CIRURGIA") > 960:
        fs -= 4
    els.append(El(txt("CIRURGIA", fred(fs, 700), BROWN), 540, 1020, tc - 0.12, "zoom", 0.45, to))

    def swoosh(tl):
        p = e_cubic((tl) / 0.5)
        def fn(d, k):
            pts = [(40 + 820 * i / 40, 40 + 26 * math.sin(math.pi * i / 40) - 10 * i / 40) for i in range(41)]
            n = max(2, round(41 * p))
            d.line([(x * k, y * k) for x, y in pts[:n]], fill=TEAL + (255,), width=16 * k, joint="curve")
        return ss(fn, (900, 110))
    els.append(El(swoosh, 540, 1160, tc + 0.15, "none", 0.5, to))
    els.append(El(heart(110, ORANGE), 540, 1330, tc + 0.35, "pop", 0.5, to, pulse=0.08))
    SCENES["cirurgia"] = els

    # 5) rifa (revelação em fundo azul) ---------------------------------------
    a, b = S("rifa")
    to = b - 0.45
    els = [El(logo(560, white=True), 540, 470, a + 0.35, "pop", 0.55, to)]
    els += words_line([("RIFA EM PROL DO", fred(104, 650), CREAM_L)], 540, 790, kw("rifa", "rifa") - 0.25, stagger=0.1, t_out=to)
    els.append(El(txt("ALEK", fred(300, 700), CREAM_L), 505, 1010, kw("rifa", "alec") - 0.15, "zoom", 0.45, to))
    els.append(El(paw(150, ORANGE), 925, 925, kw("rifa", "alec") + 0.15, "pop", 0.5, to, bob=8))
    els.append(El(txt("Doce gesto, grande ajuda!", cav(84, 700), CREAM_L), 540, 1250, kw("rifa", "alec") + 0.3, "up", 0.5, to))
    SCENES["rifa"] = els

    # 6) números --------------------------------------------------------------
    a, b = S("numeros")
    to = b - 0.3
    t300, t10 = kw("numeros", "300"), kw("numeros", "10")

    def badge(tl):
        n = round(300 * e_cubic((tl - 0.15) / 1.0))
        im = ss(lambda d, k: d.ellipse((0, 0, 600 * k - 1, 600 * k - 1), fill=BROWN + (255,)), (600, 600))
        d = ImageDraw.Draw(im)
        d.text((300, 268), str(n), font=fred(230, 700), fill=CREAM_L, anchor="mm")
        d.text((300, 420), "NÚMEROS", font=fred(74, 650), fill=CREAM_L, anchor="mm")
        return im
    els = [El(badge, 540, 760, t300 - 0.25, "pop", 0.55, to)]
    tag = card_box(520, 130, fill=CREAM_L, r=40)
    tag.alpha_composite(txt("R$ 10,00 cada", fred(70, 700), BROWN), (36, 14))
    els.append(El(shadowed(tag.rotate(-7, Image.BICUBIC, expand=True), alpha=80), 720, 1085, t10 - 0.2, "left", 0.45, to))

    nums = [17, 42, 88, 103, 150, 199, 230, 271, 300, 7, 64, 125, 186, 244]
    strip = Image.new("RGBA", (len(nums) * 190, 150), (0, 0, 0, 0))
    for i, n in enumerate(nums):
        hi = n == 150
        c = card_box(170, 130, fill=TEAL if hi else CARD, r=26)
        ImageDraw.Draw(c).text((85, 67), f"{n:03d}" if not hi else "???", font=fred(62, 700), fill=WHITE if hi else BROWN, anchor="mm")
        strip.alpha_composite(c, (i * 190 + 10, 10))
    strip2 = Image.new("RGBA", (strip.width * 2, strip.height), (0, 0, 0, 0))
    strip2.alpha_composite(strip, (0, 0)); strip2.alpha_composite(strip, (strip.width, 0))

    def ticker(tl):
        off = int(tl * 160) % strip.width
        return strip2.crop((off, 0, off + W, strip.height))
    els.append(El(ticker, 540, 1330, a + 0.2, "fade", 0.4, to))
    els.append(El(txt("qual vai ser o seu?", cav(74, 700), TEAL), 540, 1490, t10 + 0.2, "up", 0.5, to))
    SCENES["numeros"] = els

    # 7) prêmios (chamada) ----------------------------------------------------
    a, b = S("premios")
    to = b - 0.3
    els = [El(txt("SÃO", fred(80, 650), TEAL), 540, 560, a + 0.05, "up", 0.4, to),
           El(crown(150, ORANGE), 540, 700, kw("premios", "dois") - 0.15, "pop", 0.45, to, bob=6),
           El(txt("2", fred(420, 700), BROWN), 540, 950, kw("premios", "dois") - 0.15, "zoom", 0.45, to)]
    els += words_line([("PRÊMIOS DELICIOSOS", fred(88, 700), BROWN)], 540, 1215, kw("premios", "prêmios") - 0.1, stagger=0.12, t_out=to)
    els.append(El(txt("São 2 chances de ganhar!", cav(76, 700), TEAL), 540, 1360, kw("premios", "delic") + 0.1, "up", 0.5, to))
    SCENES["premios"] = els

    # 8) 1º prêmio ------------------------------------------------------------
    a, b = S("premio1")
    to = b - 0.3

    def chip(label):
        f = fred(52, 650)
        wdt = round(f.getlength(label)) + 150
        c = card_box(wdt, 92, fill=TEAL, r=46)
        c.alpha_composite(crown(56, WHITE), (30, 16))
        ImageDraw.Draw(c).text((98, 46), label, font=f, fill=WHITE, anchor="lm")
        return c
    els = [El(chip("1º prêmio"), 540, 250, a + 0.05, "pop", 0.45, to),
           El(txt("Cesta especial D'mialo", fred(82, 700), BROWN), 540, 375, a + 0.25, "up", 0.45, to),
           El(photo_card(basket, 860, 860, rot=-1.5, focus=(0.5, 0.56)), 540, 910, a + 0.35, "pop", 0.6, to)]
    for k, (word, label) in enumerate([("bolos", "bolos no pote"), ("brownies", "brownies"), ("docinhos", "docinhos")]):
        f = pop(40, "SemiBold")
        wdt = round(f.getlength(label)) + 70
        c = card_box(wdt, 84, fill=CARD, r=42, outline=TEAL, ow=4)
        ImageDraw.Draw(c).text((wdt / 2, 44), label, font=f, fill=TEAL, anchor="mm")
        xs = [250, 560, 850][k]
        els.append(El(shadowed(c, alpha=60, off=6, blur=10, margin=20), xs, 1480, kw("premio1", word) - 0.15, "pop", 0.45, to))
    SCENES["premio1"] = els

    # 9) 2º prêmio ------------------------------------------------------------
    a, b = S("premio2")
    to = b - 0.3
    left = p12.crop((90, 797, 298, 1225))
    rt, rb = p12.crop((311, 797, 519, 1003)), p12.crop((311, 1018, 519, 1225))
    els = [El(chip("2º prêmio"), 540, 250, a + 0.05, "pop", 0.45, to),
           El(txt("Combo de doces D'mialo", fred(82, 700), BROWN), 540, 375, a + 0.25, "up", 0.45, to),
           El(photo_card(left, 380, 760, rot=-2), 345, 860, a + 0.35, "right", 0.55, to),
           El(photo_card(rt, 360, 360, rot=2), 745, 665, a + 0.45, "left", 0.55, to),
           El(photo_card(rb, 360, 360, rot=-1), 745, 1055, a + 0.55, "left", 0.55, to)]
    for k, (word, label) in enumerate([("bolo", "1 bolo no pote"), ("brownie", "1 brownie"), ("quatro", "4 docinhos")]):
        f = pop(40, "SemiBold")
        wdt = round(f.getlength(label)) + 70
        c = card_box(wdt, 84, fill=CARD, r=42, outline=TEAL, ow=4)
        ImageDraw.Draw(c).text((wdt / 2, 44), label, font=f, fill=TEAL, anchor="mm")
        xs = [270, 590, 870][k]
        els.append(El(shadowed(c, alpha=60, off=6, blur=10, margin=20), xs, 1400, kw("premio2", word) - 0.15, "pop", 0.45, to))
    SCENES["premio2"] = els

    # 10) como participar -----------------------------------------------------
    a, b = S("passos")
    to = b - 0.3
    els = words_line([("COMO PARTICIPAR?", fred(104, 700), BROWN)], 540, 280, a + 0.05, stagger=0.12, t_out=to)
    els.append(El(txt("Rifa em prol do Alek", cav(64, 700), TEAL), 510, 395, a + 0.4, "up", 0.45, to))
    els.append(El(paw(58, TEAL), 790, 392, a + 0.55, "pop", 0.45, to))
    steps = [("Escolha seu(s) número(s)", ["Chame a D'mialo no direct", "ou no WhatsApp."]),
             ("Faça o pagamento via Pix", ["Após a confirmação, seu", "nome vai para a lista."]),
             ("Pronto!", ["Você já está concorrendo", "e ainda ajudando o Alek."])]
    ts = [fala_ini("passos", 1), fala_ini("passos", 2), fala_ini("passos", 3)]

    def step_card(n, title, lines, active):
        c = card_box(920, 250, fill=CARD, r=34, outline=TEAL if active else None, ow=5)
        c.alpha_composite(num_circle(116, n), (36, 67))
        c.alpha_composite(txt(title, fred(54, 700), TEAL), (180, 30))
        for i, ln in enumerate(lines):
            c.alpha_composite(txt(ln, pop(36, "Regular"), BROWN), (184, 108 + i * 50))
        return shadowed(c, alpha=70)
    for k, (title, lines) in enumerate(steps):
        on, off = step_card(k + 1, title, lines, True), step_card(k + 1, title, lines, False)
        t_act_end = ts[k + 1] - 0.1 if k + 1 < 3 else to

        def src(tl, on=on, off=off, t0=ts[k] - 0.15, t1=t_act_end):
            return on if (t0 + tl) < t1 else off
        els.append(El(src, 540, 650 + k * 290, ts[k] - 0.15, "left", 0.5, to))
    bar = card_box(920, 130, fill=BROWN, r=34)
    bar.alpha_composite(ticket(72, CREAM_L), (36, 29))
    ImageDraw.Draw(bar).text((132, 66), "Cada número", font=fred(50, 600), fill=CREAM_L, anchor="lm")
    ImageDraw.Draw(bar).text((884, 66), "R$ 10,00", font=fred(78, 700), fill=CREAM_L, anchor="rm")
    els.append(El(shadowed(bar, alpha=80), 540, 1530, kw("passos", "pagamento") - 0.1, "up", 0.5, to))
    SCENES["passos"] = els

    # 11) sorteio -------------------------------------------------------------
    a, b = S("sorteio")
    to = b - 0.3
    els = [El(calendar(190, TEAL), 540, 430, a + 0.05, "pop", 0.5, to, bob=6),
           El(txt("SORTEIO", fred(150, 700), BROWN), 540, 640, kw("sorteio", "sorteio") - 0.1, "zoom", 0.45, to),
           El(rich([("pelo ", pop(46, "Medium"), BROWN), ("Instagram da D'mialo", pop(46, "Bold"), TEAL)]), 540, 770,
              kw("sorteio", "instagram") - 0.2, "up", 0.45, to)]
    t_assim = kw("sorteio", "assim")
    els.append(El(txt("assim que todos os números", pop(44, "Medium"), BROWN), 540, 900, t_assim - 0.1, "up", 0.45, to))
    els.append(El(txt("forem vendidos", pop(44, "Medium"), BROWN), 540, 960, t_assim + 0.05, "up", 0.45, to))

    def progress(tl):
        p = e_inout((tl - 0.3) / 2.6)
        im = Image.new("RGBA", (920, 260), (0, 0, 0, 0))
        im.alpha_composite(card_box(920, 260, fill=CARD, r=34), (0, 0))
        d = ImageDraw.Draw(im)
        d.text((44, 62), "Números vendidos", font=pop(38, "SemiBold"), fill=BROWN, anchor="lm")
        d.text((876, 62), f"{round(300 * p)}/300", font=fred(56, 700), fill=TEAL, anchor="rm")
        track = card_box(832, 52, fill=(232, 220, 200), r=26)
        im.alpha_composite(track, (44, 120))
        fw = max(52, round(832 * p))
        im.alpha_composite(card_box(fw, 52, fill=TEAL, r=26), (44, 120))
        if p > 0.995:
            d.text((460, 214), "Sorteio liberado!", font=cav(54, 700), fill=ORANGE, anchor="mm")
        return shadowed(im, alpha=70)
    els.append(El(progress, 540, 1210, t_assim + 0.3, "up", 0.5, to))
    SCENES["sorteio"] = els

    # 12) destino do dinheiro ---------------------------------------------------
    a, b = S("destino")
    to = b - 0.3
    els = [El(heart(130, TEAL), 540, 270, a + 0.05, "pop", 0.5, to, pulse=0.07),
           El(rich([("100% ", fred(118, 700), TEAL), ("PARA O ALEK", fred(96, 700), BROWN)]), 540, 430, kw("destino", "todo") - 0.05, "zoom", 0.45, to),
           El(VideoCard(vA, 30, 12.0, 620, 720, rot=-2, zoom=(1.0, 1.06)), 540, 935, a + 0.25, "pop", 0.55, to),
           El(txt("Todo o valor vai para a cirurgia", pop(42, "Medium"), BROWN), 540, 1415, kw("destino", "cirurgia") - 0.4, "up", 0.45, to),
           El(txt("e o tratamento do Alek.", pop(42, "Medium"), BROWN), 540, 1475, kw("destino", "cirurgia") - 0.25, "up", 0.45, to)]
    SCENES["destino"] = els

    # 13) final ---------------------------------------------------------------
    a, b = S("final")
    els = [El(logo(470), 540, 245, a + 0.05, "pop", 0.5),
           El(txt("Doce gesto, grande ajuda!", cav(88, 700), BROWN), 540, 420, a + 0.15, "up", 0.5),
           El(photo_card(alek_still, 470, 560, rot=3, focus=(0.4, 0.32)), 540, 820, a + 0.3, "pop", 0.55)]
    cta = card_box(800, 140, fill=TEAL, r=70)
    ImageDraw.Draw(cta).text((400, 72), "GARANTA SEU NÚMERO", font=fred(64, 700), fill=WHITE, anchor="mm")
    els.append(El(shadowed(cta, alpha=90), 540, 1235, kw("final", "garanta") - 0.15, "pop", 0.5, pulse=0.045))
    els.append(El(txt("Chame a D'mialo no direct ou no WhatsApp", pop(36, "Medium"), BROWN), 540, 1360, kw("final", "garanta") + 0.1, "up", 0.45))
    els.append(El(txt("300 números  ·  R$ 10,00 cada  ·  2 prêmios", pop(34, "SemiBold"), TEAL), 540, 1420, kw("final", "garanta") + 0.25, "up", 0.45))
    els.append(El(txt("Marca aquele amigo que ama doce!", cav(72, 700), BROWN), 520, 1545, kw("final", "marca") - 0.1, "up", 0.5))
    els.append(El(heart(64, ORANGE), 1000, 1540, kw("final", "marca") + 0.2, "pop", 0.45, pulse=0.1))
    SCENES["final"] = els

    # logo pequeno no topo (fora da abertura, da revelação e do final)
    GLOBAL.append(logo(250))


def logo_alpha(t):
    a_on = BOUNDS["numeros"][0] + 0.3
    a_off = BOUNDS["final"][0]
    if t < a_on or t >= a_off:
        return 0.0
    return clamp((t - a_on) / 0.4) * clamp((a_off - t) / 0.3)


def teal_radius(t):
    """Círculo azul que cobre a tela na revelação da rifa e depois se fecha."""
    a, b = BOUNDS["rifa"]
    if t < a or t >= b + 0.05:
        return 0
    rmax = 1150
    if t < a + 0.5:
        return rmax * e_cubic((t - a) / 0.5)
    if t > b - 0.45:
        return rmax * (1 - e_inout((t - (b - 0.45)) / 0.45))
    return rmax


def frame_at(t):
    canvas = Image.new("RGBA", (W, H))
    draw_bg(canvas, t)
    r = teal_radius(t)
    if r >= 1149:
        canvas.paste(TEAL + (255,), (0, 0, W, H))
    elif r > 0:
        ImageDraw.Draw(canvas).ellipse((540 - r, 960 - r, 540 + r, 960 + r), fill=TEAL + (255,))
    la = logo_alpha(t)
    if la > 0:
        lg = with_alpha(GLOBAL[0], la)
        paste(canvas, lg, 540 - lg.width / 2, 110)
    for c in ORDER:
        a, b = BOUNDS[c]
        if a - 0.05 <= t < b + 0.35:
            for el in SCENES[c]:
                el.draw(canvas, t)
    return canvas.convert("RGB")


def main():
    build()
    if sys.argv[1] == "preview":
        for ts in sys.argv[2:]:
            frame_at(float(ts)).save(f"{R}/prev_{ts}.jpg", quality=88)
        print("total", TOTAL, {c: tuple(round(x, 2) for x in BOUNDS[c]) for c in ORDER})
        return
    k, nk, out = int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    n = int(round(TOTAL * FPS))
    i0, i1 = n * k // nk, n * (k + 1) // nk
    enc = subprocess.Popen([FF, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
                            "-i", "-", "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
                            "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-level", "4.1",
                            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", out],
                           stdin=subprocess.PIPE)
    for i in range(i0, i1):
        enc.stdin.write(frame_at(i / FPS).tobytes())
    enc.stdin.close()
    enc.wait()


if __name__ == "__main__":
    main()
