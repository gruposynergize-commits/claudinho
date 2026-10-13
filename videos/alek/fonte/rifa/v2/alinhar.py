"""Alinha o roteiro à narração da ElevenLabs: tempos de cada palavra -> falas.json (mesmo formato do motion)."""
import json, re, difflib, unicodedata, numpy as np, soundfile as sf, sherpa_onnx
SP = "/tmp/claude-0/-home-user-claudinho/752283aa-dafe-547a-a805-d485f40485d6/scratchpad"
d = f"{SP}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"
rec = sherpa_onnx.OfflineRecognizer.from_transducer(encoder=f"{d}/encoder.int8.onnx", decoder=f"{d}/decoder.int8.onnx",
    joiner=f"{d}/joiner.int8.onnx", tokens=f"{d}/tokens.txt", num_threads=4, model_type="nemo_transducer")
ROTEIRO = [
 ("abertura", "Você já conhece o Alek."),
 ("diagnostico", "Agora, ele tem um diagnóstico: um nódulo no fígado, e outro na coluna."),
 ("sintomas", "Por causa disso, ele não consegue andar. Não mexe o rabinho, e não consegue se sustentar nas patinhas de trás, mesmo que, às vezes, consiga movimentá-las."),
 ("cirurgia", "O Alek vai precisar de uma cirurgia."),
 ("rifa", "E para ajudar, a D'mialo Doceria criou uma rifa em prol do Alek!"),
 ("numeros", "São 300 números, a 10 reais cada."),
 ("premios", "E são dois prêmios deliciosos!"),
 ("premio1", "O primeiro: uma cesta especial D'mialo, recheada de bolos no pote, brownies e docinhos."),
 ("premio2", "O segundo: um combo com um bolo no pote, um brownie e quatro docinhos."),
 ("passos", "Para participar, é fácil."),
 ("passos", "Escolha o seu número, chamando a D'mialo no direct ou no WhatsApp."),
 ("passos", "Faça o pagamento via Pix. Após a confirmação, seu nome vai para a lista."),
 ("passos", "Pronto! Você já está concorrendo, e ainda ajudando o Alek."),
 ("sorteio", "O sorteio será pelo Instagram da D'mialo, assim que todos os números forem vendidos."),
 ("destino", "E todo o valor arrecadado vai para a cirurgia e o tratamento do Alek."),
 ("final", "Doce gesto, grande ajuda! Garanta já o seu número, e marca aquele amigo que ama doce!"),
]
def norm(w):
    w = unicodedata.normalize("NFD", w.lower()); w = "".join(c for c in w if unicodedata.category(c) != "Mn")
    w = re.sub(r"[^a-z0-9]", "", w)
    return {"alec": "alek", "trezentos": "300", "dez": "10", "dimialo": "dmialo", "demialo": "dmialo", "mialo": "dmialo"}.get(w, w)

a, sr = sf.read(f"{SP}/rifa2/voz16k.wav", dtype="float32")
hop = int(0.02 * sr)
e = np.array([np.sqrt(np.mean(a[i:i + hop] ** 2)) for i in range(0, len(a) - hop, hop)])
cuts = [0]
while cuts[-1] + int(22 * sr) < len(a):
    t = cuts[-1] + int(22 * sr); lo, hi = t // hop - 150, t // hop + 150
    cuts.append((lo + int(np.argmin(e[lo:hi]))) * hop)
cuts.append(len(a))
asr = []
for s, t in zip(cuts[:-1], cuts[1:]):
    st = rec.create_stream(); st.accept_waveform(sr, a[s:t]); rec.decode_stream(st)
    for tok, ts in zip(st.result.tokens, st.result.timestamps):
        if tok.startswith(" ") or not asr or s / sr + ts - asr[-1][1] > 0.6 and False:
            asr.append([tok.strip(), s / sr + ts])
        else:
            asr[-1][0] += tok
print("ASR:", " ".join(w for w, _ in asr))
# fim da fala de cada trecho: usa a energia para achar onde a voz para
speech = e > 0.01
def end_after(t0, t1):
    i0, i1 = int(t0 / 0.02), min(len(speech), int(t1 / 0.02))
    idx = np.where(speech[i0:i1])[0]
    return (i0 + idx[-1] + 1) * 0.02 if len(idx) else t1

sw = [(ci, w) for ci, (_, txt) in enumerate(ROTEIRO) for w in txt.split()]
A = [norm(w) for _, w in sw]; B = [norm(w) for w, _ in asr]
times = [None] * len(sw)
for blk in difflib.SequenceMatcher(None, A, B, autojunk=False).get_matching_blocks():
    for k in range(blk.size):
        times[blk.a + k] = asr[blk.b + k][1]
# palavras sem par: interpola entre vizinhas
known = [i for i, t in enumerate(times) if t is not None]
for i in range(len(times)):
    if times[i] is None:
        p = max([k for k in known if k < i], default=None); n = min([k for k in known if k > i], default=None)
        if p is not None and n is not None: times[i] = times[p] + (times[n] - times[p]) * (i - p) / (n - p)
        else: times[i] = times[p] + 0.3 * (i - p) if p is not None else times[n] - 0.3 * (n - i)
print("sem par:", [sw[i][1] for i in range(len(sw)) if i not in known])
falas = []
for ci, (cena, txt) in enumerate(ROTEIRO):
    idx = [i for i, (c, _) in enumerate(sw) if c == ci]
    ini = times[idx[0]] - 0.06
    nxt = times[idx[-1] + 1] - 0.06 if idx[-1] + 1 < len(sw) else len(a) / sr
    fim = end_after(times[idx[-1]], nxt)
    falas.append(dict(cena=cena, texto=txt, ini=round(ini, 3), fim=round(fim, 3),
                      palavras=[[sw[i][1], round(times[i], 3)] for i in idx]))
json.dump(falas, open(f"{SP}/rifa2/falas.json", "w"), ensure_ascii=False, indent=1)
for f in falas: print(f"{f['cena']:12s} {f['ini']:6.2f} {f['fim']:6.2f}  {f['texto'][:60]}")
