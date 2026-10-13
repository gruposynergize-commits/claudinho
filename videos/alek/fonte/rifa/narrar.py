import json, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
import sherpa_onnx

SP = "/tmp/claude-0/-home-user-claudinho/752283aa-dafe-547a-a805-d485f40485d6/scratchpad"
k = Kokoro(f"{SP}/kokoro-v1.0.onnx", f"{SP}/voices-v1.0.bin")
d = f"{SP}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"
asr = sherpa_onnx.OfflineRecognizer.from_transducer(encoder=f"{d}/encoder.int8.onnx", decoder=f"{d}/decoder.int8.onnx",
    joiner=f"{d}/joiner.int8.onnx", tokens=f"{d}/tokens.txt", num_threads=4, model_type="nemo_transducer")

# (cena, texto falado) — grafia fonética onde a voz precisa ("Dimiálo", "dairécti", "uatsápi", "bráunis")
FALAS = [
 ("abertura",   "Você já conhece o Alek."),
 ("diagnostico","Agora, ele tem um diagnóstico: um nódulo no fígado, e outro na coluna."),
 ("sintomas",   "Por causa disso, ele não consegue andar. Não mexe o rabinho, e não consegue se sustentar nas patinhas de trás, mesmo que, às vezes, consiga movimentá-las."),
 ("cirurgia",   "O Alek vai precisar de uma cirurgia."),
 ("rifa",       "E para ajudar, a Dimiálo Doceria criou uma rifa em prol do Alek!"),
 ("numeros",    "São trezentos números, a dez reais cada."),
 ("premios",    "E são dois prêmios deliciosos!"),
 ("premio1",    "O primeiro: uma cesta especial Dimiálo, recheada de bolos no pote, bráunis e docinhos."),
 ("premio2",    "O segundo: um combo com um bolo no pote, um bráuni e quatro docinhos."),
 ("passos",     "Para participar, é fácil."),
 ("passos",     "Escolha o seu número, chamando a Dimiálo no dairécti ou no uatsápi."),
 ("passos",     "Faça o pagamento via Pix. Após a confirmação, seu nome vai para a lista."),
 ("passos",     "Pronto! Você já está concorrendo, e ainda ajudando o Alek."),
 ("sorteio",    "O sorteio será pelo Instagram da Dimiálo, assim que todos os números forem vendidos."),
 ("destino",    "E todo o valor arrecadado vai para a cirurgia e o tratamento do Alek."),
 ("final",      "Doce gesto, grande ajuda! Garanta já o seu número, e marca aquele amigo que ama doce!"),
]
SR = 24000
def trim(a, thr=0.004):
    idx = np.where(np.abs(a) > thr)[0]
    return a[max(0, idx[0] - 200): idx[-1] + 400] if len(idx) else a

out, t, falas = [np.zeros(int(0.35 * SR), np.float32)], 0.35, []
for i, (cena, txt) in enumerate(FALAS):
    a, sr = k.create(txt, voice="pf_dora", speed=1.06, lang="pt-br")
    a = trim(a).astype(np.float32)
    # tempos das palavras (reconhecimento de fala no próprio áudio gerado, 16 kHz)
    a16 = np.interp(np.arange(0, len(a), SR / 16000), np.arange(len(a)), a).astype(np.float32)
    st = asr.create_stream(); st.accept_waveform(16000, a16); asr.decode_stream(st)
    words = []
    for tok, ts in zip(st.result.tokens, st.result.timestamps):
        if tok.startswith(" ") or not words: words.append([tok.strip(), round(t + ts, 3)])
        else: words[-1][0] += tok
    falas.append(dict(cena=cena, texto=txt, ini=round(t, 3), fim=round(t + len(a) / SR, 3), palavras=words))
    out.append(a); t += len(a) / SR
    prox = FALAS[i + 1][0] if i + 1 < len(FALAS) else None
    pausa = 0.32 if prox == cena else 0.6
    out.append(np.zeros(int(pausa * SR), np.float32)); t += pausa
audio = np.concatenate(out)
sf.write(f"{SP}/rifa/narracao_raw.wav", audio, SR)
json.dump(falas, open(f"{SP}/rifa/falas.json", "w"), ensure_ascii=False, indent=1)
print("total", round(len(audio) / SR, 2))
for f in falas: print(f["cena"], f["ini"], f["fim"], " ".join(w for w, _ in f["palavras"]))
