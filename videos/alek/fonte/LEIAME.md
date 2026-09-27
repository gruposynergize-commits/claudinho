# Vídeo do Alek — narração + tarja Pix

- `narracao.py` — gera `narracao.wav` com voz feminina pt-BR (Kokoro TTS, voz `pf_dora`).
  Requer `pip install kokoro-onnx soundfile` e os arquivos `kokoro-v1.0.onnx` / `voices-v1.0.bin`
  (releases de github.com/thewh1teagle/kokoro-onnx, tag `model-files-v1.0`).
- `tarja_pix.py` — gera `overlay.png` (1080x1920, tarja fixa com a chave Pix). Usa a fonte Montserrat (Google Fonts).
- `montar.sh` — junta vídeo original + narração + tarja em `Alek_video_narrado.mp4`.
