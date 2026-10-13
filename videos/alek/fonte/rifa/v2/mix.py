"""Trilha original + efeitos + narração da ElevenLabs, com a música abaixando sob a voz (ducking).

Parte A (história do Alek): pad + piano suaves, Dm–Bb–F–C.
Subida (riser) -> impacto na revelação da rifa.
Parte B (rifa): marimba em colcheias, baixo, bumbo/palma/shaker leves, F–C–Dm–Bb, 100 BPM.
Gera mix_com_musica.wav e mix_sem_musica.wav (só voz + efeitos).
"""
import sys
import numpy as np
import soundfile as sf

SP = "/tmp/claude-0/-home-user-claudinho/752283aa-dafe-547a-a805-d485f40485d6/scratchpad"
sys.path.insert(0, f"{SP}/rifa2")
import motion2 as m  # noqa: E402  (só tempos/limites das cenas)

SR = 48000
TOTAL = m.TOTAL
N = int(TOTAL * SR)
T_REV = m.BOUNDS["rifa"][0]
BEAT = 60 / 100
BAR = 4 * BEAT
rng = np.random.default_rng(11)


def mtof(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def tone(f, dur, harm, decay, attack=0.005, hdecay=0.6):
    t = t_axis(dur)
    y = np.zeros_like(t)
    for h, a in harm:
        y += a * np.sin(2 * np.pi * f * h * t) * np.exp(-t * decay * (1 + hdecay * (h - 1)))
    y *= np.minimum(1, t / attack)
    y[-int(0.03 * SR):] *= np.linspace(1, 0, int(0.03 * SR))
    return y


def pad_note(f, dur, attack=0.45, release=0.6):
    t = t_axis(dur + release)
    y = np.zeros_like(t)
    for det in (-0.0018, 0.0, 0.0018):                   # três vozes levemente desafinadas (coro)
        for h in range(1, 7):
            y += (1 / h ** 1.7) * np.sin(2 * np.pi * f * (1 + det) * h * t + rng.uniform(0, 6.28))
    env = np.minimum(1, t / attack)
    rel = t > dur
    env[rel] *= np.exp(-(t[rel] - dur) / (release / 3))
    return y * env * (1 + 0.04 * np.sin(2 * np.pi * 4.5 * t)) / 3


def place(buf, sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= buf.shape[0] or i + len(sig) <= 0:
        return
    if i < 0:
        sig, i = sig[-i:], 0
    seg = sig[: buf.shape[0] - i] * gain
    buf[i:i + len(seg), 0] += seg * np.sqrt(0.5 * (1 - pan))
    buf[i:i + len(seg), 1] += seg * np.sqrt(0.5 * (1 + pan))


def kick():
    t = t_axis(0.35)
    f = 45 + 75 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11)


def noise_hit(dur, decay, bright=2):
    y = rng.standard_normal(int(dur * SR))
    for _ in range(bright):
        y = np.diff(y, prepend=0)                       # realça os agudos (passa-alta simples)
    y /= np.abs(y).max()
    return y * np.exp(-t_axis(dur) * decay)


def lowpass(x, a):
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a * (x[i] - acc)
        y[i] = acc
    return y


def reverb(buf, wet=0.22, length=1.8, rt=0.5):
    out = buf.copy()
    t = t_axis(length)
    for ch in range(2):
        ir = rng.standard_normal(len(t)) * np.exp(-t / (rt / 3))
        ir = np.convolve(ir, np.ones(24) / 24, mode="same")   # IR mais escura
        ir /= np.sqrt((ir ** 2).sum())
        nfft = 1 << int(np.ceil(np.log2(len(buf) + len(ir))))
        conv = np.fft.irfft(np.fft.rfft(buf[:, ch], nfft) * np.fft.rfft(ir, nfft), nfft)[:len(buf)]
        out[:, ch] = buf[:, ch] * (1 - wet) + conv * wet * 1.4
    return out


# ------------------------------------------------------------------ música
mus = np.zeros((N, 2))
A_CH = [[50, 53, 57, 62], [46, 53, 58, 62], [53, 57, 60, 65], [48, 52, 55, 60]]   # Dm Bb F C
B_CH = [[53, 57, 60, 65], [52, 55, 60, 64], [53, 57, 62, 65], [53, 58, 62, 65]]   # F C Dm Bb
B_ROOT = [41, 36, 38, 34]
B_ARP = [[65, 69, 72, 77], [64, 67, 72, 76], [62, 65, 69, 74], [62, 65, 70, 74]]
PIANO = [(1, 1.0), (2, 0.35), (3, 0.12), (4, 0.05)]
MARIMBA = [(1, 1.0), (4, 0.22)]

# Parte A — história: pad + piano em semínimas, bem suave
bar, t = 0, 0.0
while t < T_REV - 0.2:
    ch = A_CH[bar % 4]
    for n in ch:
        place(mus, pad_note(mtof(n), BAR), t, 0.055, pan=rng.uniform(-0.3, 0.3))
    for k, n in enumerate([ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[3] + 12]):
        if t + k * BEAT < T_REV - 0.3:
            place(mus, tone(mtof(n), 2.2, PIANO, 1.8), t + k * BEAT, 0.09, pan=0.25 * (-1) ** k)
    bar += 1
    t += BAR
# subida antes da revelação
rdur = 1.8
rt = t_axis(rdur)
riser = lowpass(rng.standard_normal(len(rt)), 0.02) * 6
riser = riser * (rt / rdur) ** 2.2 + 0.25 * np.sin(2 * np.pi * np.cumsum(180 + 520 * (rt / rdur) ** 2) / SR) * (rt / rdur) ** 2
riser /= np.abs(riser).max()
place(mus, riser, T_REV - rdur, 0.22)
# impacto na revelação
imp = kick() * 1.0
boom = np.sin(2 * np.pi * 55 * t_axis(1.2)) * np.exp(-t_axis(1.2) * 3.2)
place(mus, imp, T_REV, 0.55)
place(mus, boom, T_REV, 0.35)
place(mus, noise_hit(1.4, 3.0, bright=1) * 0.5, T_REV, 0.12)

# Parte B — rifa: marimba, baixo, bateria leve
t_end_music = TOTAL - 2.4
bar, t = 0, T_REV
while t < t_end_music:
    i = bar % 4
    for n in B_CH[i]:
        place(mus, pad_note(mtof(n), BAR), t, 0.035, pan=rng.uniform(-0.4, 0.4))
    for b in (0, 2):
        place(mus, tone(mtof(B_ROOT[i] + 12), 1.1, [(1, 1.0), (2, 0.3)], 2.2, attack=0.01), t + b * BEAT, 0.22)
        place(mus, kick(), t + b * BEAT, 0.30)
    for b in (1, 3):
        place(mus, noise_hit(0.18, 32, bright=1), t + b * BEAT, 0.06, pan=0.1)
    pat = [0, 2, 1, 3, 2, 1, 3, 2]
    for k in range(8):
        tt = t + k * BEAT / 2
        if tt >= t_end_music:
            break
        place(mus, tone(mtof(B_ARP[i][pat[k]]), 1.0, MARIMBA, 3.4, hdecay=1.2), tt, 0.10 if k % 2 == 0 else 0.075,
              pan=0.35 * (1 if k % 2 else -1))
        place(mus, noise_hit(0.06, 70, bright=2), tt + BEAT / 4, 0.025, pan=0.4)
    bar += 1
    t += BAR
# acorde final que soa até o fim
for n in [53, 57, 60, 65, 69, 72]:
    place(mus, tone(mtof(n), 2.6, MARIMBA, 1.6, hdecay=1.2), t, 0.07, pan=rng.uniform(-0.4, 0.4))
    place(mus, pad_note(mtof(n), 1.6, release=0.8), t, 0.03)
mus = reverb(mus)
fade = int(1.3 * SR)
mus[-fade:] *= np.linspace(1, 0, fade)[:, None]

# ------------------------------------------------------------------ voz
voz, sr0 = sf.read(f"{SP}/rifa2/voz_edit.wav")
voz = np.interp(np.arange(0, len(voz), sr0 / SR), np.arange(len(voz)), voz)[:N]
voz = np.pad(voz, (0, N - len(voz)))
act = np.abs(voz) > 0.02
voz *= 0.1 / np.sqrt(np.mean(voz[act] ** 2))           # RMS da fala ~ -20 dBFS

# ducking: envelope da voz suavizado
win = int(0.12 * SR)
env = np.convolve(np.abs(voz), np.ones(win) / win, mode="same")
mask = np.clip(env / 0.03, 0, 1)
mask = np.convolve(mask, np.ones(int(0.3 * SR)) / int(0.3 * SR), mode="same")
duck = 10 ** (-8.5 * mask / 20)
mus_rms = np.sqrt(np.mean(mus[int(T_REV * SR):int((TOTAL - 3) * SR)] ** 2))
mus *= 0.026 / mus_rms                                  # música ~12 dB abaixo da voz, -20 dB quando ela fala
mus *= duck[:, None]

# ------------------------------------------------------------------ efeitos
sfx = np.zeros((N, 2))


def whoosh(dur=0.45):
    t = t_axis(dur)
    x = rng.standard_normal(len(t))
    y = np.zeros_like(x)
    acc = 0.0
    for i in range(len(x)):
        c = 0.02 + 0.22 * np.sin(np.pi * i / len(x)) ** 2
        acc += c * (x[i] - acc)
        y[i] = acc
    y *= np.sin(np.pi * t / dur) ** 2
    return y / np.abs(y).max()


def blip(f0=950, f1=570, dur=0.09):
    t = t_axis(dur)
    f = f0 + (f1 - f0) * t / dur
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 45)


def ding(dur=0.8):
    t = t_axis(dur)
    return (np.sin(2 * np.pi * 1318.5 * t) + 0.45 * np.sin(2 * np.pi * 1975.5 * t)) * np.exp(-t * 5) * np.minimum(1, t / 0.004)


W = whoosh()
for c in m.ORDER[1:]:
    if c != "rifa":
        place(sfx, W, m.BOUNDS[c][0] - 0.15, 0.07, pan=0.2)
kw = m.kw
pops = [kw("abertura", "alek") - 0.1, kw("diagnostico", "diagn") - 0.08, kw("diagnostico", "nódulo"), kw("diagnostico", "outro"),
        kw("sintomas", "andar") - 0.3, kw("sintomas", "rabinho") - 0.4, kw("sintomas", "sustentar") - 0.25,
        kw("cirurgia", "cirurgia") - 0.1, kw("rifa", "alek") - 0.12, kw("numeros", "300") - 0.2,
        kw("numeros", "10") - 0.15, kw("premios", "dois") - 0.12, kw("premio1", "bolos") - 0.1, kw("premio1", "brownies") - 0.1,
        kw("premio1", "docinhos") - 0.1, kw("premio2", "bolo") - 0.1, kw("premio2", "brownie") - 0.1, kw("premio2", "quatro") - 0.1,
        m.fala_ini("passos", 1) - 0.1, m.fala_ini("passos", 2) - 0.1, m.fala_ini("passos", 3) - 0.1,
        kw("sorteio", "sorteio") - 0.08, kw("destino", "todo"), kw("final", "garanta") - 0.1]
for k, tp in enumerate(pops):
    place(sfx, blip(950 + 60 * (k % 3), 560 + 40 * (k % 3)), tp, 0.05, pan=0.15 * (-1) ** k)
# contador 0 -> 300: tiques acelerando e um "ding" no fim
c0 = kw("numeros", "300") - 0.25 + 0.15
for j in range(14):
    u = (j + 1) / 14
    tt = c0 + 1.0 * (1 - (1 - u) ** (1 / 3)) if u < 1 else c0 + 1.0
    place(sfx, blip(1800, 1700, 0.03), tt, 0.018)
place(sfx, ding(), c0 + 1.0, 0.035)
place(sfx, ding(), kw("sorteio", "assim") + 0.15 + 0.2 + 1.9, 0.035)

# ------------------------------------------------------------------ saída
for nome, mixbuf in (("mix_com_musica", voz[:, None] + mus + sfx), ("mix_sem_musica", voz[:, None] + sfx)):
    pk = np.abs(mixbuf).max()
    sf.write(f"{SP}/rifa2/{nome}.wav", mixbuf / max(pk, 1) * 0.95, SR, subtype="FLOAT")
print("ok", round(TOTAL, 2), "revelação em", round(T_REV, 2), "s")
