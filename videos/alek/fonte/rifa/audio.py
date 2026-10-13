"""Mixa a narração com efeitos bem discretos (whoosh nas trocas de cena, pop nas revelações, ding)."""
import sys, numpy as np, soundfile as sf
R = "/tmp/claude-0/-home-user-claudinho/752283aa-dafe-547a-a805-d485f40485d6/scratchpad/rifa"
sys.path.insert(0, R)
import motion as m

SR = 48000
voz, sr0 = sf.read(f"{R}/narracao_raw.wav")
voz = np.interp(np.arange(0, len(voz), sr0 / SR), np.arange(len(voz)), voz)
n = int(m.TOTAL * SR)
mix = np.zeros(n)
voz = voz[:n]
mix[:len(voz)] += voz / (np.abs(voz).max() + 1e-9) * 0.89          # voz com pico em -1 dBFS (nivelada depois)
rng = np.random.default_rng(3)
db = lambda x: 10 ** (x / 20)

def whoosh(dur=0.42):
    k = int(dur * SR); t = np.arange(k) / SR
    x = rng.standard_normal(k); y = np.zeros(k); a = 0.0
    for i in range(k):                                   # passa-baixa com corte subindo e descendo
        c = 0.02 + 0.25 * np.sin(np.pi * i / k) ** 2
        a += c * (x[i] - a); y[i] = a
    env = np.sin(np.pi * t / dur) ** 2
    y = y * env; return y / np.abs(y).max()

def popsnd(dur=0.09):
    t = np.arange(int(dur * SR)) / SR
    f = 950 - 380 * t / dur
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 45)
    return y / np.abs(y).max()

def ding(dur=0.7):
    t = np.arange(int(dur * SR)) / SR
    y = (np.sin(2 * np.pi * 1318 * t) + 0.5 * np.sin(2 * np.pi * 1976 * t)) * np.exp(-t * 6)
    return y / np.abs(y).max()

def add(sig, at, gain_db):
    i = int(at * SR)
    if 0 <= i < n:
        seg = sig[: n - i] * db(gain_db); mix[i:i + len(seg)] += seg

W = whoosh()
for c in m.ORDER[1:]:
    add(W, m.BOUNDS[c][0] - 0.12, -30)
P = popsnd()
kw = m.kw
pops = [kw("abertura", "alec") - 0.1, kw("diagnostico", "diagn") - 0.08, kw("diagnostico", "nódulo"), kw("diagnostico", "outro"),
        kw("sintomas", "andar") - 0.3, kw("sintomas", "rabinho") - 0.4, kw("sintomas", "sustentar") - 0.25,
        kw("cirurgia", "cirurgia") - 0.1, m.BOUNDS["rifa"][0] + 0.4, kw("rifa", "alec") - 0.12, kw("numeros", "300") - 0.2,
        kw("numeros", "10") - 0.15, kw("premios", "dois") - 0.12, kw("premio1", "bolos") - 0.1, kw("premio1", "brownies") - 0.1,
        kw("premio1", "docinhos") - 0.1, kw("premio2", "bolo") - 0.1, kw("premio2", "brownie") - 0.1, kw("premio2", "quatro") - 0.1,
        m.fala_ini("passos", 1) - 0.1, m.fala_ini("passos", 2) - 0.1, m.fala_ini("passos", 3) - 0.1,
        kw("sorteio", "sorteio") - 0.08, kw("destino", "todo"), kw("final", "garanta") - 0.1]
for t in pops:
    add(P, t, -31)
D = ding()
add(D, kw("numeros", "300") - 0.25 + 0.15 + 1.0, -32)
add(D, kw("sorteio", "assim") + 0.3 + 0.3 + 2.6, -32)
sf.write(f"{R}/mix_raw.wav", mix, SR, subtype="FLOAT")
print("ok", round(n / SR, 2), "pops", len(pops))
