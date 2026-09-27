#!/usr/bin/env bash
# Monta o vídeo final: vídeo original em 0.8x, repetido com crossfade (2ª passada com zoom 1.1x),
# escalado para 1080x1920, com a narração (narracao.wav) e a tarja fixa do Pix (overlay.png).
# Uso: ./montar.sh video_original.mp4 narracao.wav overlay.png saida.mp4
set -euo pipefail
V=$1; A=$2; OV=$3; OUT=$4
N=$(python3 -c "import soundfile as sf; i=sf.info('$A'); print(i.frames/i.samplerate)")
D=$(python3 -c "print(round(0.4+$N+2.0,2))"); FO=$(python3 -c "print(round($D-1.5,2))")
ffmpeg -y -i "$V" -i "$A" -loop 1 -i "$OV" -filter_complex "
[0:v]setpts=PTS/0.8,fps=30,scale=1080:1920:flags=lanczos,setsar=1,format=yuv420p,split[a][b0];
[b0]crop=iw/1.1:ih/1.1,scale=1080:1920:flags=lanczos,setsar=1[b];
[a][b]xfade=transition=fade:duration=1:offset=48.125,trim=duration=$D,setpts=PTS-STARTPTS,fade=t=out:st=$FO:d=1.5[v];
[2:v]format=rgba[ov];
[v][ov]overlay=0:0:shortest=1:format=auto,format=yuv420p[vout];
[1:a]aresample=48000,aformat=channel_layouts=stereo,adelay=400|400,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,apad,atrim=duration=$D[aout]" \
-map "[vout]" -map "[aout]" -t "$D" -c:v libx264 -preset slow -crf 19 -r 30 -c:a aac -b:a 192k -movflags +faststart "$OUT"
