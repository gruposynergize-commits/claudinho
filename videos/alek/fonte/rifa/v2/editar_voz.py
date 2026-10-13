"""Insere respiros na narração (sem cortar nada) e remapeia os tempos das falas."""
import json, numpy as np, soundfile as sf
SP = "/tmp/claude-0/-home-user-claudinho/752283aa-dafe-547a-a805-d485f40485d6/scratchpad"
v, sr = sf.read(f"{SP}/rifa2/voz.wav")
INS = [(0.0, 0.5), (1.62, 0.7), (19.20, 0.6), (23.55, 1.0), (26.75, 0.7), (61.40, 1.3)]          # (instante no áudio original, pausa extra em s) — todos em silêncios
def mapt(t):
    return t + sum(p for at, p in INS if at <= t)
parts, last = [], 0
for at, p in INS:
    i = int(at * sr); parts += [v[last:i], np.zeros(int(p * sr))]; last = i
parts.append(v[last:])
out = np.concatenate(parts)
sf.write(f"{SP}/rifa2/voz_edit.wav", out, sr)
falas = json.load(open(f"{SP}/rifa2/falas.json"))
for f in falas:
    f["ini"], f["fim"] = round(mapt(max(0, f["ini"])), 3), round(mapt(f["fim"]), 3)
    f["palavras"] = [[w, round(mapt(t), 3)] for w, t in f["palavras"]]
json.dump(falas, open(f"{SP}/rifa2/falas_edit.json", "w"), ensure_ascii=False, indent=1)
print("duração", round(len(out) / sr, 2), "| abertura", falas[0]["ini"], falas[0]["fim"], "| diagnóstico", falas[1]["ini"], "| rifa", falas[4]["ini"], "| fim", falas[-1]["fim"])
