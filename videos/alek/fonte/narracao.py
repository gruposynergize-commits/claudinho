import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
k = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
VOICE, SPEED = "pf_dora", 1.0
# (text, pause_after_seconds). Numbers written out so the voice reads them correctly.
paras = [
 ["Por favor, não pule esse vídeo.", "Nós temos apenas oito horas para tentar salvar o Alek."],
 ["O Alek é meu gatinho, tem apenas cinco anos, e está internado lutando pela vida."],
 ["Os exames mostraram um nódulo de quatro centímetros no fígado, pancreatite crônica, lipidose hepática, além de sedimentos e cristais na bexiga."],
 ["Ele precisa continuar internado e fazer novos exames.", "Mas, infelizmente, nós já não temos mais dinheiro para continuar o tratamento."],
 ["Precisamos arrecadar quatrocentos e setenta e sete reais e cinquenta centavos para os exames e internação, além de aproximadamente mil quatrocentos e cinquenta reais em outras despesas veterinárias."],
 ["É um valor muito alto para nós, mas estamos fazendo tudo que podemos para tentar salvar a vida dele."],
 ["O Alek é muito amado, é meu companheiro, e um gatinho extremamente carinhoso.", "Qualquer valor, por menor que seja, pode fazer diferença."],
 ["O Pix para ajudar é:"],
 ["um, três, sete.", "oito, seis, cinco.", "zero, oito, nove.", "um, sete."],
 ["Todo o valor será destinado às despesas veterinárias do Alek."],
 ["E, por favor, se você não puder ajudar financeiramente, compartilhe esse vídeo.", "Talvez o seu compartilhamento chegue até alguém que possa salvar o Alek."],
 ["Entre no meu perfil para acompanhar a situação de perto.", "Vou atualizando tudo por lá, conforme eu conseguir."],
 ["Por favor, nos ajude a dar uma chance para o Alek."],
]
SENT_PAUSE, PARA_PAUSE, DIGIT_PAUSE = 0.30, 0.65, 0.22
out, sr, marks = [], 24000, []
t = 0.0
def trim(a, thr=0.004):
    idx = np.where(np.abs(a) > thr)[0]
    return a[max(0, idx[0]-240): idx[-1]+480] if len(idx) else a
for pi, para in enumerate(paras):
    for si, s in enumerate(para):
        a, sr = k.create(s, voice=VOICE, speed=SPEED, lang="pt-br")
        a = trim(a)
        marks.append((round(t, 2), s))
        out.append(a); t += len(a)/sr
        last = si == len(para)-1
        p = (DIGIT_PAUSE if pi == 8 and not last else SENT_PAUSE) if not last else PARA_PAUSE
        out.append(np.zeros(int(p*sr), dtype=a.dtype)); t += p
audio = np.concatenate(out)
sf.write("narration.wav", audio, sr)
print("total", len(audio)/sr)
for m in marks: print(m)
