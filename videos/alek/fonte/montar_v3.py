#!/usr/bin/env python3
"""Vídeo de atualização do Alek (v3), sem áudio: cada trecho mostra um vídeo/foto/comprovante
com um texto na tela, corte seco para o próximo, e cartela final com Pix e Vakinha.

Uso:
  python3 build_v3.py preview            -> um quadro por trecho (v3prev_N.jpg)
  python3 build_v3.py render saida.mp4   -> vídeo completo (1080x1920, 30 fps, sem áudio)
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
VIDS = {
    "V1": f"{UP}/fc596035-WhatsApp_Video_2026-10-04_at_12.34.31.mp4",   # se arrastando (de cima)
    "V2": f"{UP}/f3b4d862-WhatsApp_Video_2026-10-04_at_12.34.34.mp4",   # se arrastando no lençol
    "V3": f"{UP}/768729ec-WhatsApp_Video_2026-10-04_at_12.34.36.mp4",   # no colo, olhando para a câmera
}
FONT = f"{SP}/Montserrat.ttf"
FF = "ffmpeg"
W, H, FPS = 1080, 1920, 30

TEAL = (50, 188, 173)
YELLOW = (255, 216, 77)
WHITE = (255, 255, 255)
PIX = "13786508917"
VAKINHA_URL = "https://www.vakinha.com.br/vaquinha/ajude-meu-gatinho-alek"

TEXT_CENTER_Y = 1250        # centro do bloco de texto (acima da área de interface do Reels/Stories)

_fonts = {}


def font(size, weight=800):
    if (size, weight) not in _fonts:
        f = ImageFont.truetype(FONT, size)
        f.set_variation_by_axes([weight])
        _fonts[(size, weight)] = f
    return _fonts[(size, weight)]


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def ease(u):
    u = clamp(u, 0.0, 1.0)
    return 0.5 - 0.5 * math.cos(math.pi * u)


def affine(img, scale, cx, cy, size=(W, H)):
    ow, oh = size
    a = 1.0 / scale
    return img.transform(size, Image.AFFINE, (a, 0, cx - a * ow / 2, 0, a, cy - a * oh / 2), resample=Image.BICUBIC)


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


def blurred_bg(img, darken=0.55, blur=40):
    bg = cover(img, W // 4, H // 4).filter(ImageFilter.GaussianBlur(blur / 4)).resize((W, H), Image.BICUBIC)
    return Image.blend(Image.new("RGB", (W, H), (8, 10, 12)), bg, 1 - darken)


def paste_card(canvas, im, x, y, radius=28):
    w, h = im.size
    sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x, y + 14, x + w, y + h + 14), radius, fill=(0, 0, 0, 150))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(22)))
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    layer.paste(im.convert("RGB"), (0, 0), rounded_mask((w, h), radius))
    canvas.alpha_composite(layer, (x, y))


# ---------------------------------------------------------------- fontes de imagem
def load_video(path):
    probe = subprocess.run([FF, "-v", "error", "-i", path, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
                           capture_output=True, check=True).stdout
    import io
    w, h = Image.open(io.BytesIO(probe)).size       # tamanho já com a rotação aplicada
    raw = subprocess.run([FF, "-v", "error", "-i", path, "-an", "-vf",
                          "scale=in_color_matrix=bt709:in_range=tv,format=rgb24", "-f", "rawvideo", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)


def photo(name):
    return ImageOps.exif_transpose(Image.open(f"{IMG}/{name}")).convert("RGB")


class Vid:
    def __init__(self, frames, src, speed=1.0, zoom=1.0, focus=(0.5, 0.5)):
        self.f, self.src, self.speed, self.zoom, self.focus = frames, src, speed, zoom, focus

    def render(self, t, dur):
        n = len(self.f)
        pos = clamp((self.src + t * self.speed) * FPS, 0, n - 1)
        i = int(pos)
        fr = pos - i
        j = min(i + 1, n - 1)
        arr = self.f[i] if fr < 0.04 or i == j else \
            (self.f[i].astype(np.float32) * (1 - fr) + self.f[j].astype(np.float32) * fr + 0.5).astype(np.uint8)
        h, w = arr.shape[:2]
        s = max(W / w, H / h) * self.zoom
        ww, wh = W / s, H / s
        cx = clamp(self.focus[0] * w, ww / 2, w - ww / 2)
        cy = clamp(self.focus[1] * h, wh / 2, h - wh / 2)
        return affine(Image.fromarray(arr), s, cx, cy)


class Still:
    def __init__(self, poster, z0=1.0, z1=1.06, focus=(0.5, 0.5)):
        self.p, self.z0, self.z1, self.focus = poster, z0, z1, focus

    def render(self, t, dur):
        z = self.z0 + (self.z1 - self.z0) * clamp(t / dur, 0, 1)
        pw, ph = self.p.size
        s = W / pw * z
        ww, wh = W / s, H / s
        cx = clamp(self.focus[0] * pw, ww / 2, pw - ww / 2)
        cy = clamp(self.focus[1] * ph, wh / 2, ph - wh / 2)
        return affine(self.p, s, cx, cy)


def doc_poster(bg_photo, doc, max_w=960, max_h=860, center_y=640, marks=()):
    """Fundo desfocado + print/comprovante em cartão (marks = retângulos a destacar, em coords do print)."""
    canvas = blurred_bg(bg_photo, darken=0.6).convert("RGBA")
    s = min(max_w / doc.width, max_h / doc.height)
    card = doc.resize((round(doc.width * s), round(doc.height * s)), Image.LANCZOS).convert("RGBA")
    d = ImageDraw.Draw(card)
    for (x0, y0, x1, y1) in marks:
        d.rounded_rectangle((x0 * s - 12, y0 * s - 8, x1 * s + 12, y1 * s + 8), 14, outline=YELLOW + (255,), width=6)
    x, y = (W - card.width) // 2, center_y - card.height // 2
    paste_card(canvas, card, x, y, radius=26)
    return canvas.convert("RGB")


def vakinha_card(raised=1377, goal=5000):
    """Cartão legível com o andamento da vakinha (mesmos números do print do site)."""
    cw, ch = 940, 430
    card = Image.new("RGB", (cw, ch), WHITE)
    d = ImageDraw.Draw(card)
    dark, gray, green = (25, 28, 32), (120, 124, 130), (98, 196, 112)
    d.text((48, 64), "VAKINHA  ·  AJUDE MEU GATINHO ALEK", font=font(28, 800), fill=TEAL, anchor="lm")
    big, small = f"R$ {raised:,}".replace(",", "."), f"de R$ {goal:,}".replace(",", ".")
    size = 104
    while font(size, 800).getlength(big) + 18 + font(round(size * 0.42), 700).getlength(small) > cw - 96:
        size -= 2
    fb, fs = font(size, 800), font(round(size * 0.42), 700)
    d.text((48, 206), big, font=fb, fill=dark, anchor="ls")
    d.text((48 + fb.getlength(big) + 18, 206), small, font=fs, fill=gray, anchor="ls")
    bx0, bx1, by = 48, cw - 48, 258
    d.rounded_rectangle((bx0, by, bx1, by + 34), 17, fill=(232, 235, 238))
    d.rounded_rectangle((bx0, by, bx0 + max(34, (bx1 - bx0) * raised / goal), by + 34), 17, fill=green)
    d.text((48, 350), "arrecadados até agora", font=font(32, 600), fill=gray, anchor="lm")
    falta = f"faltam R$ {goal - raised:,}".replace(",", ".")
    d.text((cw - 48, 350), falta, font=font(34, 800), fill=dark, anchor="rm")
    return card


def end_poster(bg_photo, face):
    canvas = blurred_bg(bg_photo, darken=0.62, blur=48).convert("RGBA")
    d = ImageDraw.Draw(canvas)
    cx, cy, r = W // 2, 330, 190
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((cx - r - 16, cy - r - 16, cx + r + 16, cy + r + 16), fill=TEAL + (170,))
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(18)))
    m = Image.new("L", (2 * r, 2 * r), 0)
    ImageDraw.Draw(m).ellipse((0, 0, 2 * r - 1, 2 * r - 1), fill=255)
    layer = Image.new("RGBA", (2 * r, 2 * r), (0, 0, 0, 0))
    layer.paste(face.resize((2 * r, 2 * r), Image.LANCZOS), (0, 0), m)
    canvas.alpha_composite(layer, (cx - r, cy - r))
    d.ellipse((cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3), outline=WHITE + (255,), width=8)
    d.text((W / 2, 612), "AJUDE O ALEK", font=font(104, 900), fill=WHITE, anchor="mm")
    d.text((W / 2, 694), "Qualquer valor faz diferença", font=font(40, 600), fill=(235, 235, 235), anchor="mm")
    x0, x1 = 80, W - 80
    boxes = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bd = ImageDraw.Draw(boxes)
    for box in ((x0, 760, x1, 1010), (x0, 1090, x1, 1400)):
        bd.rounded_rectangle(box, 34, fill=(10, 14, 18, 200), outline=TEAL + (255,), width=5)
    canvas.alpha_composite(boxes)
    d.text((W / 2, 814), "CHAVE PIX (CPF)", font=font(38, 800), fill=TEAL, anchor="mm")
    d.text((W / 2, 924), PIX, font=font(118, 800), fill=WHITE, anchor="mm")
    d.text((W / 2, 1050), "ou", font=font(38, 600), fill=(220, 220, 220), anchor="mm")
    qr = qrcode.QRCode(border=2, box_size=10, error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(VAKINHA_URL)
    qr.make(fit=True)
    q = qr.make_image(fill_color="black", back_color="white").convert("RGB").resize((250, 250), Image.NEAREST)
    qx, qy = x1 - 30 - 250, 1120
    d.rounded_rectangle((qx - 6, qy - 6, qx + 256, qy + 256), 16, fill=WHITE + (255,))
    canvas.paste(q, (qx, qy))
    tx = x0 + 44
    d.text((tx, 1160), "DOE PELA VAKINHA", font=font(36, 800), fill=TEAL, anchor="lm")
    d.text((tx, 1236), "vakinha.com.br/vaquinha/", font=font(36, 700), fill=WHITE, anchor="lm")
    d.text((tx, 1284), "ajude-meu-gatinho-alek", font=font(36, 700), fill=WHITE, anchor="lm")
    d.text((tx, 1350), "aponte a câmera no QR code", font=font(26, 600), fill=(200, 200, 200), anchor="lm")
    d.text((W / 2, 1480), "Compartilhe esse vídeo", font=font(50, 800), fill=YELLOW, anchor="mm",
           stroke_width=3, stroke_fill=(0, 0, 0))
    return canvas.convert("RGB")


# ---------------------------------------------------------------- texto na tela
def parse_markup(text):
    """Palavras como listas de trechos (texto, destaque); *...* liga/desliga o destaque sem separar a pontuação."""
    words, cur, buf, emph = [], [], "", False
    for ch in text + " ":
        if ch in "* ":
            if buf:
                cur.append((buf, emph))
                buf = ""
            if ch == "*":
                emph = not emph
            elif cur:
                words.append(cur)
                cur = []
        else:
            buf += ch
    return words


def text_block(text, size=60, max_w=860):
    """Bloco centralizado: caixa escura translúcida, texto branco e destaques (*...*) em amarelo."""
    words = parse_markup(text)
    f = font(size, 800)
    sp = f.getlength(" ")
    wl = [sum(f.getlength(t) for t, _ in runs) for runs in words]
    n = len(words)

    def width(a, b):
        return sum(wl[a:b]) + sp * (b - a - 1)

    k = max(1, math.ceil(width(0, n) / max_w))
    while True:  # divide em k linhas minimizando a linha mais longa (programação dinâmica)
        best = {(0, 0): (0.0, None)}
        for li in range(1, k + 1):
            for b in range(li, n + 1):
                cands = [(max(best[(li - 1, a)][0], width(a, b)), a) for a in range(li - 1, b) if (li - 1, a) in best]
                if cands:
                    best[(li, b)] = min(cands)
        if (k, n) in best and best[(k, n)][0] <= max_w:
            break
        k += 1
    cuts, b = [], n
    for li in range(k, 0, -1):
        a = best[(li, b)][1]
        cuts.append((a, b))
        b = a
    lines = cuts[::-1]
    lh = round(size * 1.24)
    px, py = 40, 28
    bw = round(max(width(a, b) for a, b in lines)) + 2 * px
    bh = lh * len(lines) + 2 * py - round(size * 0.18)
    img = Image.new("RGBA", (bw + 40, bh + 40), (0, 0, 0, 0))
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((20, 26, 20 + bw, 26 + bh), 30, fill=(0, 0, 0, 110))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(12)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((20, 20, 20 + bw, 20 + bh), 30, fill=(12, 14, 18, 178))
    asc = f.getmetrics()[0]
    for li, (a, b) in enumerate(lines):
        x = 20 + (bw - width(a, b)) / 2
        y = 20 + py + li * lh + asc * 0.9
        for i in range(a, b):
            xx = x
            for t, e in words[i]:
                d.text((xx, y), t, font=f, fill=YELLOW if e else WHITE, anchor="ls")
                xx += f.getlength(t)
            x += wl[i] + sp
    return img


def with_alpha(im, a):
    if a >= 0.999:
        return im
    im = im.copy()
    im.putalpha(im.getchannel("A").point(lambda v: int(v * a)))
    return im


# ---------------------------------------------------------------- roteiro
SEGS = []   # (início, fim, cena, imagem_do_texto)


def build():
    V = {k: load_video(p) for k, p in VIDS.items()}
    p4 = photo("4.jpg")
    p4_wide = cover(p4, W, H, focus=(0.58, 0.5))
    p4_close = cover(p4.crop((600, 120, 1350, 1453)), W, H)
    face = p4.crop((975 - 300, 410 - 300, 975 + 300, 410 + 300))

    r6 = photo("6.jpg").crop((0, 225, 739, 600))                      # exames de sexta: R$ 2.379,00
    r7 = photo("7.jpg").crop((0, 225, 739, 600))                      # Pix de R$ 810,00 (internação)
    name_box = (36, 166, 600, 216)                                    # nome de quem recebeu: desfocado
    r7.paste(r7.crop(name_box).filter(ImageFilter.GaussianBlur(14)), name_box[:2])
    b8 = photo("8.webp").crop((56, 48, 1062, 1248))                   # conta em aberto: falta R$ 370,00

    scenes = [
        (3.2, Vid(V["V3"], 0.0), "Uma atualização do nosso *Alek*", 74),
        (3.9, Vid(V["V1"], 0.0), "Na sexta, ele fez a *ressonância* e a *citologia*.", 60),
        (5.6, Still(p4_wide, 1.0, 1.06, (0.55, 0.45)),
         "O resultado sai na *segunda* e vai mostrar se o nódulo dele precisa de *cirurgia*.", 60),
        (4.8, Vid(V["V2"], 0.0), "Ele continua sem o movimento das *patinhas de trás* e do *rabinho*", 60),
        (3.4, Vid(V["V2"], 5.4), "e segue em tratamento para a *pancreatite*.", 60),
        (3.8, Still(doc_poster(p4, r6), 1.0, 1.03), "Os exames de sexta custaram *R$ 2.379*.", 60),
        (3.8, Still(doc_poster(p4, r7), 1.0, 1.03), "A internação e os primeiros exames: *R$ 810*.", 60),
        (5.6, Still(doc_poster(p4, b8, marks=[(40, 1090, 600, 1160)]), 1.0, 1.03),
         "E os gastos continuam: remédios, exames... ainda temos *R$ 370* em aberto na clínica.", 60),
        (4.2, Still(doc_poster(p4, vakinha_card(), max_w=940), 1.0, 1.03), "Nossa vakinha está em *R$ 1.377* de *R$ 5.000*.", 62),
        (5.6, Vid(V["V3"], 3.2), "Precisamos bater essa meta para quitar as contas e nos preparar para uma *possível cirurgia*.", 60),
        (5.4, Still(p4_close, 1.0, 1.07, (0.5, 0.4)),
         "Nos ajudem a salvar nosso *Alekinho*. Ele é um gato muito amado e querido.", 60),
        (5.5, Still(end_poster(p4, face), 1.0, 1.0), None, 0),
    ]
    t = 0.0
    for dur, scene, text, size in scenes:
        SEGS.append((t, t + dur, scene, text_block(text, size) if text else None))
        t += dur
    return t


def frame_at(T):
    for a, b, scene, txt in SEGS:
        if a <= T < b:
            break
    frame = scene.render(T - a, b - a).convert("RGBA")
    if txt is not None:
        u = 1.0 if a == 0 else ease((T - a) / 0.25)   # 1º texto já visível (miniatura do vídeo)
        frame.alpha_composite(with_alpha(txt, u), ((W - txt.width) // 2, TEXT_CENTER_Y - txt.height // 2 + round((1 - u) * 18)))
    return frame.convert("RGB")


def main():
    end = build()
    if sys.argv[1] == "preview":
        for k, (a, b, _, _) in enumerate(SEGS):
            frame_at(a + min(1.2, (b - a) / 2)).save(f"{SP}/v3prev_{k:02d}.jpg", quality=88)
        print(f"duração: {end:.1f}s")
        return
    out = sys.argv[2]
    enc = subprocess.Popen([
        FF, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
        "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-profile:v", "high", "-level", "4.1",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-an",
        "-movflags", "+faststart", out], stdin=subprocess.PIPE)
    for i in range(int(round(end * FPS))):
        enc.stdin.write(frame_at(i / FPS).tobytes())
    enc.stdin.close()
    enc.wait()
    print(f"ok: {end:.1f}s")


if __name__ == "__main__":
    main()
