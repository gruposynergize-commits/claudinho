# Rifa do Alek — versão 2 (voz ElevenLabs "Roberta", trilha e efeitos)

- `alinhar.py` — tempos de cada palavra da narração da ElevenLabs (reconhecimento de fala) alinhados ao roteiro.
- `editar_voz.py` — insere respiros curtos só nos silêncios (nada da fala é cortado) e remapeia os tempos
  (`falas_edit.json`).
- `motion2.py` — mesma animação da v1, ressincronizada com a voz nova.
- `mix.py` — trilha original sintetizada (parte suave na história do Alek; subida + impacto na revelação;
  marimba/baixo/percussão leve na rifa), efeitos (whoosh, pops, tiques do contador, ding) e ducking da
  música sob a voz. Gera versões com e sem música.
