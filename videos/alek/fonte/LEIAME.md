# Vídeo do Alek — narração + tarja Pix

- `narracao.py` — gera `narracao.wav` com voz feminina pt-BR (Kokoro TTS, voz `pf_dora`).
  Requer `pip install kokoro-onnx soundfile` e os arquivos `kokoro-v1.0.onnx` / `voices-v1.0.bin`
  (releases de github.com/thewh1teagle/kokoro-onnx, tag `model-files-v1.0`).
- `tarja_pix.py` — gera `overlay.png` (1080x1920, tarja fixa com a chave Pix). Usa a fonte Montserrat (Google Fonts).
- `montar.sh` — junta vídeo original + narração + tarja em `Alek_video_narrado.mp4`.

## Versão 2 (voz da tutora + fotos + legendas)

- `montar_v2.py` — monta `Alek_video_final.mp4` (1080x1920, 30 fps, ~1min36s):
  - voz gravada pela tutora (só nivelada para -14 LUFS e com filtro de graves, sem cortes);
  - trechos nítidos do vídeo do hospital (câmera lenta suave), cartões com o ultrassom e os orçamentos,
    fotos do Alek em casa;
  - legendas sincronizadas palavra a palavra (tempos obtidos com reconhecimento de fala Parakeet/sherpa-onnx);
  - tarja fixa com a chave Pix (CPF) e o link da Vakinha, destacada quando a chave é falada;
  - cartela final com Pix, Vakinha (com QR code) e "Compartilhe esse vídeo".
- Uso: `python3 montar_v2.py preview 12.5 40` (quadros de conferência) ou
  `python3 montar_v2.py render K N pedaco.mp4` (renderiza o pedaço K de N; depois juntar com o áudio).

## Atualização de 04/10 (sem áudio)

- `montar_v3.py` — gera `Alek_atualizacao_04-10.mp4` (1080x1920, ~55 s, sem áudio): cada trecho tem um
  vídeo/foto/comprovante com um texto na tela e corte seco para o próximo; cartela final com Pix e Vakinha.
  O nome de quem recebeu o Pix de R$ 810 aparece desfocado no comprovante.
