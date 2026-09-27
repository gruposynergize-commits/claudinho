#!/usr/bin/env python3
"""Monta o vídeo do Alek (v2): voz da tutora + trechos do hospital + fotos de casa
+ legendas sincronizadas + tarja fixa de doação (Pix CPF e Vakinha) + cartela final.

Uso:
  python3 build_v2.py preview T1 T2 ...   -> salva quadros de conferência (prev_T.jpg)
  python3 build_v2.py render saida.mp4    -> renderiza o vídeo completo
"""
import math
import re
import subprocess
import sys

import numpy as np
import qrcode
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

SP = "/tmp/claude-0/-home-user-claudinho/752283aa-dafe-547a-a805-d485f40485d6/scratchpad"
UP = "/root/.claude/uploads/752283aa-dafe-547a-a805-d485f40485d6"
IMG = "/tmp/claude-0/-home-user-claudinho/752283aa-dafe-547a-a805-d485f40485d6/images"
VIDEO = f"{UP}/efc31862-WhatsApp_Video_2026-09-27_at_15.11.35.mp4"
VOICE = f"{SP}/voz_final.wav"          # voz já nivelada (-14 LUFS), com silêncio até END
FONT = f"{SP}/Montserrat.ttf"
FF = "ffmpeg"

W, H, FPS = 1080, 1920, 30
END = 96.5
SW, SH = 576, 1024                      # resolução do vídeo original

TEAL = (50, 188, 173)
YELLOW = (255, 216, 77)
WHITE = (255, 255, 255)

PIX = "13786508917"
VAKINHA_URL = "https://www.vakinha.com.br/vaquinha/ajude-meu-gatinho-alek"
VAKINHA_TXT = "vakinha.com.br/vaquinha/ajude-meu-gatinho-alek"

# Tarja fixa: caixa de 940 x CARD_H, com a base em y=1600 (acima da área de legenda do Reels/TikTok)
CARD_W, CARD_H, CARD_BOTTOM, CARD_PAD = 940, 292, 1600, 44
CAPTION_BOTTOM = 1272                   # base das legendas (logo acima da tarja)


# ---------------------------------------------------------------- utilidades
_fonts = {}


def font(size, weight=800):
    key = (size, weight)
    if key not in _fonts:
        f = ImageFont.truetype(FONT, size)
        f.set_variation_by_axes([weight])
        _fonts[key] = f
    return _fonts[key]


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def ease(u):
    u = clamp(u, 0.0, 1.0)
    return 0.5 - 0.5 * math.cos(math.pi * u)


def affine(img, scale, cx, cy, mirror=False, size=(W, H)):
    """Amostra `img` com zoom `scale` centrado em (cx, cy) (coords da imagem de origem)."""
    ow, oh = size
    a = (-1.0 if mirror else 1.0) / scale
    e = 1.0 / scale
    return img.transform(size, Image.AFFINE, (a, 0, cx - a * ow / 2, 0, e, cy - e * oh / 2),
                         resample=Image.BICUBIC)


def cover(img, w, h, focus=(0.5, 0.5)):
    iw, ih = img.size
    s = max(w / iw, h / ih)
    nw, nh = max(w, round(iw * s)), max(h, round(ih * s))
    im = img.resize((nw, nh), Image.LANCZOS)
    x = round(clamp(focus[0] * nw - w / 2, 0, nw - w))
    y = round(clamp(focus[1] * nh - h / 2, 0, nh - h))
    return im.crop((x, y, x + w, y + h))


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius, fill=255)
    return m


def blurred_bg(img, darken=0.5, blur=36):
    bg = cover(img, W // 4, H // 4).filter(ImageFilter.GaussianBlur(blur / 4)).resize((W, H), Image.BICUBIC)
    return Image.blend(Image.new("RGB", (W, H), (8, 10, 12)), bg, 1 - darken)


def paste_card(canvas, im, x, y, radius=28, border=None, shadow=True):
    """Cola `im` com cantos arredondados, sombra suave e borda opcional."""
    w, h = im.size
    if shadow:
        sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle((x, y + 14, x + w, y + h + 14), radius, fill=(0, 0, 0, 150))
        canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(22)))
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    layer.paste(im.convert("RGB"), (0, 0), rounded_mask((w, h), radius))
    canvas.alpha_composite(layer, (x, y))
    if border:
        ImageDraw.Draw(canvas).rounded_rectangle((x, y, x + w - 1, y + h - 1), radius, outline=border[0], width=border[1])


def chip(canvas, text, x, y, size=30):
    f = font(size, 800)
    tw = f.getlength(text)
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((x, y, x + tw + 44, y + size + 26), (size + 26) // 2, fill=TEAL + (255,))
    d.text((x + 22, y + (size + 26) / 2), text, font=f, fill=(8, 22, 24), anchor="lm")


# ---------------------------------------------------------------- fontes de imagem
def load_video():
    cmd = [FF, "-v", "error", "-i", VIDEO, "-vf", "scale=in_color_matrix=bt709:in_range=tv,format=rgb24",
           "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, SH, SW, 3)


FRAMES = None


def src_frame(t):
    return Image.fromarray(FRAMES[clamp(int(round(t * FPS)), 0, len(FRAMES) - 1)])


def photo(n):
    return ImageOps.exif_transpose(Image.open(f"{IMG}/{n}.jpg")).convert("RGB")


# ---------------------------------------------------------------- cenas
class VideoShot:
    """Trecho do vídeo original em câmera lenta (mistura de quadros vizinhos para suavizar)."""

    def __init__(self, src, speed, lo, hi, zoom=1.0, focus=(0.5, 0.5), mirror=False, zoom_end=None):
        self.src, self.speed, self.lo, self.hi = src, speed, lo, hi
        self.zoom, self.zoom_end = zoom, zoom_end if zoom_end is not None else zoom
        self.focus, self.mirror = focus, mirror

    def render(self, t, dur):
        st = clamp(self.src + t * self.speed, self.lo, self.hi)
        pos = st * FPS
        i = int(math.floor(pos))
        fr = pos - i
        i = clamp(i, 0, len(FRAMES) - 1)
        j = clamp(i + 1, 0, len(FRAMES) - 1)
        if fr < 0.04 or i == j:
            arr = FRAMES[i]
        elif fr > 0.96:
            arr = FRAMES[j]
        else:
            arr = (FRAMES[i].astype(np.float32) * (1 - fr) + FRAMES[j].astype(np.float32) * fr + 0.5).astype(np.uint8)
        z = self.zoom + (self.zoom_end - self.zoom) * clamp(t / dur, 0, 1)
        s = W / SW * z
        ww, wh = W / s, H / s
        cx = clamp(self.focus[0] * SW, ww / 2, SW - ww / 2)
        cy = clamp(self.focus[1] * SH, wh / 2, SH - wh / 2)
        return affine(Image.fromarray(arr), s, cx, cy, self.mirror)


class StillShot:
    """Imagem parada 1080x1920 com movimento lento (Ken Burns)."""

    def __init__(self, poster, z0=1.0, z1=1.07, f0=(0.5, 0.5), f1=(0.5, 0.5)):
        self.poster, self.z0, self.z1, self.f0, self.f1 = poster, z0, z1, f0, f1

    def render(self, t, dur):
        u = clamp(t / dur, 0, 1)
        z = self.z0 + (self.z1 - self.z0) * u
        fx = self.f0[0] + (self.f1[0] - self.f0[0]) * u
        fy = self.f0[1] + (self.f1[1] - self.f0[1]) * u
        pw, ph = self.poster.size
        s = W / pw * z
        ww, wh = W / s, H / s
        cx = clamp(fx * pw, ww / 2, pw - ww / 2)
        cy = clamp(fy * ph, wh / 2, ph - wh / 2)
        return affine(self.poster, s, cx, cy)


class QuotesShot:
    """Orçamentos: cartão com a foto do documento, passeando do total de 477 para o de 1.450."""

    BOX = (90, 214, 990, 1010)          # cartão na tela (x0, y0, x1, y1)

    def __init__(self, still, pan_start, pan_end):
        self.still = still
        self.bg = blurred_bg(still, darken=0.55)
        self.pan_start, self.pan_end = pan_start, pan_end
        bw, bh = self.BOX[2] - self.BOX[0], self.BOX[3] - self.BOX[1]
        self.bw, self.bh = bw, bh
        self.mask = rounded_mask((bw, bh), 28)
        self.shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(self.shadow).rounded_rectangle((self.BOX[0], self.BOX[1] + 14, self.BOX[2], self.BOX[3] + 14),
                                                      28, fill=(0, 0, 0, 150))
        self.shadow = self.shadow.filter(ImageFilter.GaussianBlur(22))

    def render(self, t, dur):
        # janela da foto (coords do quadro 576x1024): centro e largura visível
        a = dict(cx=250, cy=455, vw=500)      # Orçamento #19507 / Total 477,84
        b = dict(cx=330, cy=660, vw=470)      # Orçamento #19508 / Total 1.450,00
        u = ease((t - self.pan_start) / (self.pan_end - self.pan_start))
        cx = a["cx"] + (b["cx"] - a["cx"]) * u
        cy = a["cy"] + (b["cy"] - a["cy"]) * u
        vw = (a["vw"] + (b["vw"] - a["vw"]) * u) * (1 - 0.03 * clamp(t / dur, 0, 1))
        s = self.bw / vw
        vh = self.bh / s
        cx = clamp(cx, vw / 2, SW - vw / 2)
        cy = clamp(cy, vh / 2, SH - vh / 2)
        crop = affine(self.still, s, cx, cy, size=(self.bw, self.bh))
        canvas = self.bg.convert("RGBA")
        canvas.alpha_composite(self.shadow)
        layer = Image.new("RGBA", (self.bw, self.bh), (0, 0, 0, 0))
        layer.paste(crop, (0, 0), self.mask)
        canvas.alpha_composite(layer, (self.BOX[0], self.BOX[1]))
        chip(canvas, "ORÇAMENTOS DO HOSPITAL", self.BOX[0], self.BOX[1] - 86)
        return canvas.convert("RGB")


# ---------------------------------------------------------------- pôsteres
def poster_photo2():
    p = photo(2)
    canvas = blurred_bg(p, darken=0.5).convert("RGBA")
    fg = p.resize((1000, round(1000 * p.height / p.width)), Image.LANCZOS)
    paste_card(canvas, fg, 40, 700 - fg.height // 2, radius=30)
    return canvas.convert("RGB")


def poster_ultrasound(still):
    canvas = blurred_bg(still, darken=0.6).convert("RGBA")
    crop = still.crop((44, 684, 528, 1002))
    fg = crop.resize((960, round(960 * crop.height / crop.width)), Image.LANCZOS)
    y = 655 - fg.height // 2
    paste_card(canvas, fg, 60, y, radius=26)
    chip(canvas, "ULTRASSOM DO ALEK", 60, y - 86)
    return canvas.convert("RGB")


def poster_end(still_a):
    canvas = blurred_bg(still_a, darken=0.62, blur=48).convert("RGBA")
    d = ImageDraw.Draw(canvas)
    # foto redonda do Alek
    face = still_a.crop((185 - 172, 172 - 172, 185 + 172, 172 + 172)).resize((380, 380), Image.LANCZOS)
    cx, cy, r = W // 2, 330, 190
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((cx - r - 16, cy - r - 16, cx + r + 16, cy + r + 16), fill=TEAL + (170,))
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(18)))
    m = Image.new("L", (380, 380), 0)
    ImageDraw.Draw(m).ellipse((0, 0, 379, 379), fill=255)
    layer = Image.new("RGBA", (380, 380), (0, 0, 0, 0))
    layer.paste(face, (0, 0), m)
    canvas.alpha_composite(layer, (cx - r, cy - r))
    d.ellipse((cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3), outline=WHITE + (255,), width=8)

    d.text((W / 2, 612), "AJUDE O ALEK", font=font(104, 900), fill=WHITE, anchor="mm")
    d.text((W / 2, 694), "Qualquer valor faz diferença", font=font(40, 600), fill=(235, 235, 235), anchor="mm")

    # caixas translúcidas (camada separada para misturar com o fundo)
    x0, x1 = 80, W - 80
    boxes = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bd = ImageDraw.Draw(boxes)
    for box in ((x0, 760, x1, 1010), (x0, 1090, x1, 1400)):
        bd.rounded_rectangle(box, 34, fill=(10, 14, 18, 200), outline=TEAL + (255,), width=5)
    canvas.alpha_composite(boxes)

    # Pix
    d.text((W / 2, 814), "CHAVE PIX (CPF)", font=font(38, 800), fill=TEAL, anchor="mm")
    d.text((W / 2, 924), PIX, font=font(118, 800), fill=WHITE, anchor="mm")

    d.text((W / 2, 1050), "ou", font=font(38, 600), fill=(220, 220, 220), anchor="mm")

    # Vakinha + QR code
    qr = qrcode.QRCode(border=2, box_size=10, error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(VAKINHA_URL)
    qr.make(fit=True)
    q = qr.make_image(fill_color="black", back_color="white").convert("RGB").resize((250, 250), Image.NEAREST)
    qx, qy = x1 - 30 - 250, 1120
    d.rounded_rectangle((qx - 6, qy - 6, qx + 256, qy + 256), 16, fill=WHITE + (255,))
    canvas.paste(q, (qx, qy))
    tx = x0 + 44
    d.text((tx, 1160), "DOE PELA VAKINHA", font=font(36, 800), fill=TEAL, anchor="lm")
    f_url = font(36, 700)
    d.text((tx, 1236), "vakinha.com.br/vaquinha/", font=f_url, fill=WHITE, anchor="lm")
    d.text((tx, 1284), "ajude-meu-gatinho-alek", font=f_url, fill=WHITE, anchor="lm")
    d.text((tx, 1350), "aponte a câmera no QR code", font=font(26, 600), fill=(200, 200, 200), anchor="lm")

    d.text((W / 2, 1480), "Compartilhe esse vídeo", font=font(50, 800), fill=YELLOW, anchor="mm",
           stroke_width=3, stroke_fill=(0, 0, 0))
    return canvas.convert("RGB")


# ---------------------------------------------------------------- legendas
CAPTIONS = [  # (início em s, texto; *...* = destaque em amarelo)
    (0.00, "Por favor, não pule esse vídeo."),
    (2.75, "Nós temos apenas *8 horas*"),
    (4.51, "para tentar salvar o Alek."),
    (6.27, "O Alek é meu gatinho, tem apenas 5 anos,"),
    (9.23, "está internado lutando pela vida."),
    (11.63, "Os exames mostraram"),
    (12.91, "*um nódulo de 4 centímetros* no fígado,"),
    (15.95, "*pancreatite crônica,*"),
    (17.79, "*lipidose hepática,*"),
    (19.55, "além de *sedimentos e cristais* na bexiga."),
    (22.91, "Ele precisa continuar internado"),
    (24.83, "e fazer novos exames,"),
    (26.43, "mas, infelizmente,"),
    (27.71, "*nós já não temos mais dinheiro*"),
    (29.63, "para continuar o tratamento."),
    (31.47, "Precisamos arrecadar"),
    (32.83, "*R$ 477,50*"),
    (37.15, "para os exames e internação,"),
    (39.39, "além de aproximadamente"),
    (40.75, "*R$ 1.450,00*"),
    (42.83, "em outras despesas veterinárias."),
    (44.91, "É um valor muito alto para nós,"),
    (46.99, "mas estamos fazendo tudo o que podemos"),
    (49.17, "para tentar salvar a vida dele."),
    (50.93, "O Alek é muito amado,"),
    (52.77, "é meu companheiro"),
    (53.65, "e um gatinho extremamente carinhoso."),
    (56.13, "*Qualquer valor,* por menor que seja,"),
    (58.69, "pode fazer diferença."),
    (60.21, "O Pix para ajudar é:"),
    (62.05, "#PIX"),
    (67.41, "Todo valor será destinado"),
    (69.09, "às despesas veterinárias do Alek."),
    (71.49, "E, por favor,"),
    (72.51, "se você não puder ajudar financeiramente,"),
    (74.99, "*compartilhe esse vídeo.*"),
    (76.43, "Talvez o seu compartilhamento"),
    (78.43, "chegue até alguém que possa salvar o Alek."),
    (81.23, "*Entre no meu perfil*"),
    (82.35, "para acompanhar a situação de perto."),
    (84.51, "Vou atualizando tudo por lá,"),
    (86.27, "conforme eu conseguir."),
    (87.71, "Por favor, nos ajude"),
    (89.15, "a dar *uma chance* para o Alek."),
]
CAPTIONS_END = 91.2


def parse_markup(text):
    out, emph = [], False
    for part in re.split(r"(\*)", text):
        if part == "*":
            emph = not emph
            continue
        out += [(w, emph) for w in part.split()]
    return out


def render_caption(text, size=64, max_w=900):
    big = text == "#PIX"
    if big:
        words, size = [(PIX, True)], 104
    else:
        words = parse_markup(text)
    f = font(size, 800)
    sp = f.getlength(" ")
    wl = [f.getlength(w) for w, _ in words]

    def width(a, b):
        return sum(wl[a:b]) + sp * (b - a - 1)

    n = len(words)
    if width(0, n) <= max_w:
        lines = [(0, n)]
    else:  # quebra em 2 linhas o mais equilibradas possível
        best = min(range(1, n), key=lambda k: max(width(0, k), width(k, n)))
        lines = [(0, best), (best, n)]
        assert max(width(0, best), width(best, n)) <= max_w + 40, text
    stroke, pad = 7, 30
    lh = round(size * 1.18)
    cw = round(max(width(a, b) for a, b in lines)) + 2 * pad
    ch = lh * len(lines) + 2 * pad
    txt = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    d = ImageDraw.Draw(txt)
    asc = f.getmetrics()[0]
    for li, (a, b) in enumerate(lines):
        x = (cw - width(a, b)) / 2
        y = pad + li * lh + asc * 0.93
        for k in range(a, b):
            w, e = words[k]
            d.text((x, y), w, font=f, fill=YELLOW if e else WHITE, anchor="ls",
                   stroke_width=stroke, stroke_fill=(0, 0, 0))
            x += wl[k] + sp
    sh = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    sh.putalpha(txt.getchannel("A").filter(ImageFilter.GaussianBlur(9)).point(lambda v: int(v * 0.55)))
    out = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    out.alpha_composite(sh, (0, 6))
    out.alpha_composite(txt)
    return out


def with_alpha(im, a):
    if a >= 0.999:
        return im
    im = im.copy()
    im.putalpha(im.getchannel("A").point(lambda v: int(v * a)))
    return im


# ---------------------------------------------------------------- tarja de doação
def render_card():
    cw, ch, p = CARD_W, CARD_H, CARD_PAD
    img = Image.new("RGBA", (cw + 2 * p, ch + 2 * p), (0, 0, 0, 0))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((p, p + 10, p + cw, p + ch + 10), 34, fill=(0, 0, 0, 130))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(16)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((p, p, p + cw, p + ch), 34, fill=(10, 14, 18, 212), outline=TEAL + (255,), width=5)
    cx = p + cw / 2
    d.text((cx, p + 46), "CHAVE PIX (CPF)", font=font(34, 800), fill=TEAL, anchor="mm")
    d.text((cx, p + 124), PIX, font=font(104, 800), fill=WHITE, anchor="mm", stroke_width=2, stroke_fill=(0, 0, 0))
    d.line((p + 70, p + 186, p + cw - 70, p + 186), fill=(255, 255, 255, 60), width=2)
    d.text((cx, p + 214), "OU DOE PELA VAKINHA", font=font(26, 800), fill=TEAL, anchor="mm")
    f_url = font(31, 700)
    assert f_url.getlength(VAKINHA_TXT) < cw - 60, f_url.getlength(VAKINHA_TXT)
    d.text((cx, p + 256), VAKINHA_TXT, font=f_url, fill=WHITE, anchor="mm")
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle((p - 6, p - 6, p + cw + 6, p + ch + 6), 40, fill=TEAL + (230,))
    glow = glow.filter(ImageFilter.GaussianBlur(16))
    return img, glow


# ---------------------------------------------------------------- linha do tempo
SHOTS = []          # (início, fim, cena)
XFADE = 0.4


def build_timeline():
    global FRAMES
    FRAMES = load_video()
    s_a, s_g = src_frame(0.40), src_frame(28.60)
    s_us, s_q = src_frame(17.90), src_frame(20.80)
    p1 = cover(photo(1).crop((0, 35, 739, 1285)), W, H, focus=(0.45, 0.5))
    p3 = cover(photo(3), W, H)
    # só os trechos nítidos do vídeo original (medidos por nitidez/movimento)
    A, D = (0.0, 1.25), (11.0, 16.0)
    G1, G2a, G2b = (23.0, 26.6), (31.4, 36.0), (34.5, 37.0)
    photo2 = poster_photo2()
    shots = [
        (0.00, 3.00, VideoShot(0.00, 0.417, *A)),
        (3.00, 6.25, VideoShot(11.00, 0.77, *D)),
        (6.25, 9.20, StillShot(photo2, 1.0, 1.06)),
        (9.20, 11.60, VideoShot(32.00, 0.75, *G2a)),
        (11.60, 22.90, StillShot(poster_ultrasound(s_us), 1.0, 1.10, (0.5, 0.35), (0.5, 0.35))),
        (22.90, 27.70, VideoShot(23.00, 0.75, *G1)),
        (27.70, 31.40, VideoShot(34.50, 0.676, *G2b)),
        (31.40, 44.90, QuotesShot(s_q, pan_start=38.9 - 31.40, pan_end=40.9 - 31.40)),
        (44.90, 50.95, VideoShot(31.50, 0.38, 31.4, 33.85, zoom=1.08, focus=(0.5, 0.4), mirror=True)),
        (50.95, 53.65, StillShot(p3, 1.02, 1.10, (0.62, 0.45), (0.66, 0.42))),
        (53.65, 56.10, StillShot(p1, 1.02, 1.10, (0.40, 0.42), (0.36, 0.40))),
        (56.10, 60.20, StillShot(cover(s_g, W, H), 1.0, 1.12, (0.5, 0.3), (0.52, 0.26))),
        (60.20, 67.40, StillShot(photo2, 1.06, 1.16, (0.5, 0.36), (0.45, 0.36))),
        (67.40, 71.50, VideoShot(23.00, 0.73, *G1, zoom=1.12, focus=(0.5, 0.4), mirror=True)),
        (71.50, 76.45, VideoShot(11.00, 0.646, 11.0, 14.2, zoom=1.12, focus=(0.5, 0.4), mirror=True)),
        (76.45, 81.20, VideoShot(34.50, 0.526, *G2b, zoom=1.10, focus=(0.5, 0.4), mirror=True)),
        (81.20, 87.70, StillShot(p3, 1.22, 1.32, (0.61, 0.57), (0.61, 0.55))),
        (87.70, 91.20, StillShot(cover(s_a, W, H), 1.0, 1.14, (0.40, 0.30), (0.36, 0.22))),
        (91.20, END, StillShot(poster_end(s_a), 1.0, 1.0)),
    ]
    SHOTS.extend(shots)


def shot_frame(k, T):
    a, b, sh = SHOTS[k]
    return sh.render(T - a, b - a)


def base_frame(T):
    for k, (a, b, _) in enumerate(SHOTS):
        if a <= T < b or k == len(SHOTS) - 1:
            break
    a, b, _ = SHOTS[k]
    xf = 0.7 if k + 1 == len(SHOTS) - 1 else XFADE   # dissolve mais longo para a cartela final
    if k + 1 < len(SHOTS) and T > b - xf / 2:
        u = (T - (b - xf / 2)) / xf
        return Image.blend(shot_frame(k, T), shot_frame(k + 1, T), ease(u))
    if k > 0:
        pa, pb, _ = SHOTS[k - 1]
        pxf = 0.7 if k == len(SHOTS) - 1 else XFADE
        if T < a + pxf / 2:
            u = (T - (a - pxf / 2)) / pxf
            return Image.blend(shot_frame(k - 1, T), shot_frame(k, T), ease(u))
    return shot_frame(k, T)


CAP_IMGS = None
CARD = None


def prepare_overlays():
    global CAP_IMGS, CARD
    CAP_IMGS = [render_caption(t) for _, t in CAPTIONS]
    CARD = render_card()


def overlay(frame, T):
    canvas = frame.convert("RGBA")
    # tarja de doação (some na cartela final)
    card, glow = CARD
    fade_out = 1 - clamp((T - 90.85) / 0.7, 0, 1)
    if fade_out > 0:
        pulse = 0.0
        if 60.1 <= T <= 67.3:   # destaque enquanto a chave Pix é falada
            env = clamp((T - 60.1) / 0.4, 0, 1) * clamp((67.3 - T) / 0.4, 0, 1)
            pulse = env * (0.55 + 0.45 * math.sin(2 * math.pi * (T - 60.1) / 1.4 - math.pi / 2))
        x = (W - card.width) // 2
        y = CARD_BOTTOM + CARD_PAD - card.height
        if pulse > 0.001:
            s = 1 + 0.045 * pulse
            layer = Image.new("RGBA", card.size, (0, 0, 0, 0))
            layer.alpha_composite(with_alpha(glow, pulse))
            layer.alpha_composite(card)
            nw, nh = round(card.width * s), round(card.height * s)
            layer = layer.resize((nw, nh), Image.BICUBIC)
            canvas.alpha_composite(with_alpha(layer, fade_out), (x - (nw - card.width) // 2, y - (nh - card.height) // 2))
        else:
            canvas.alpha_composite(with_alpha(card, fade_out), (x, y))
    # legendas
    for i, (st, _) in enumerate(CAPTIONS):
        en = CAPTIONS[i + 1][0] if i + 1 < len(CAPTIONS) else CAPTIONS_END
        if st <= T < en:
            im = CAP_IMGS[i]
            u = 1.0 if st == 0 else clamp((T - st) / 0.14, 0, 1)
            a = ease(u) * clamp((en - T) / 0.08, 0, 1)
            dy = round((1 - ease(u)) * 16)
            canvas.alpha_composite(with_alpha(im, a), ((W - im.width) // 2, CAPTION_BOTTOM - im.height + dy))
            break
    return canvas.convert("RGB")


def frame_at(T):
    return overlay(base_frame(T), T)


def main():
    build_timeline()
    prepare_overlays()
    if sys.argv[1] == "preview":
        for t in sys.argv[2:]:
            frame_at(float(t)).save(f"{SP}/prev_{t}.jpg", quality=90)
        return
    # render CHUNK NCHUNKS saida.mp4 -> só o vídeo de um pedaço (para renderizar em paralelo)
    k, nk, out = int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    n = int(round(END * FPS))
    i0, i1 = n * k // nk, n * (k + 1) // nk
    enc = subprocess.Popen([
        FF, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
        "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-profile:v", "high", "-level", "4.1",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", out], stdin=subprocess.PIPE)
    for i in range(i0, i1):
        enc.stdin.write(frame_at(i / FPS).tobytes())
    enc.stdin.close()
    enc.wait()


if __name__ == "__main__":
    main()
