import math, pymupdf, numpy as np
from pdfpaths import load, drawing_d
import clip
from clip import mask, trace
import build  # reuse text_path
V=load('/root/.claude/uploads/ec5b85dd-db6c-5654-9386-7a7de4e5244a/420e3428-crazyfox-boto-verso_3.pdf')
L=load('/root/.claude/uploads/ec5b85dd-db6c-5654-9386-7a7de4e5244a/068b66c2-logo.pdf')
BG,DARK2,TONE,PINK='#4F1728','#5E1F35','#A7405A','#C95F77'
W,H,TIP=1150,380,140   # unidades de 0,1 mm
def shape(d):
    s=d*math.hypot(TIP,H/2)/(H/2)
    xt=(W-TIP)-s+TIP*d/(H/2); r=max(40-d,6)
    return (f'M{r+d:.1f} {d}H{xt:.1f}L{W-s:.1f} {H/2}L{xt:.1f} {H-d}H{r+d:.1f}'
            f'Q{d} {H-d} {d} {H-d-r:.1f}V{r+d:.1f}Q{d} {d} {r+d:.1f} {d}Z')
outer=shape(0); inner_bg=shape(8); frame_out=shape(34); frame_in=shape(41); art=shape(41)
BOX=(-10,-10,1160,390)
def clipped(d,tf,*clips):
    m=mask([(d,f'transform="{tf}"')],BOX)
    for c in clips: m&=mask([(c,'')],BOX)
    return trace(m,BOX)
dol=drawing_d(V[3])
# ondas (padrão tom sobre tom)
w6,w5=drawing_d(V[6]),drawing_d(V[5])
import cv2
def whole(d,tf):
    m=mask([(d,f'transform="{tf}"')],BOX).astype(np.uint8)
    n,lab,st,_=cv2.connectedComponentsWithStats(m)
    keep=np.zeros_like(m,bool)
    # descarta ondas cortadas pela borda do verso (bordas retas) e fragmentos
    src=mask([(drawing_d(V[1]),f'transform="{tf}"')],BOX)
    er=cv2.erode(src.astype(np.uint8),np.ones((9,9),np.uint8))>0
    for i in range(1,n):
        comp=lab==i
        if st[i,4]<400: continue
        if (comp&~er).sum()>0: continue
        keep|=comp
    return keep
wm=np.zeros(mask([('M0 0Z','')],BOX).shape,bool)
for d,tf in [(w6,'translate(380 -135)'),(w5,'translate(470 -420)'),(w6,'translate(640 90)'),(w5,'translate(220 -390)'),(w6,'translate(90 150)')]:
    wm|=whole(d,tf)
wm&=mask([(art,'')],BOX)
waves=trace(wm,BOX)
# boto: cabeça no canto superior esquerdo, inteira dentro da moldura
s=1.30; head=clipped(dol,f'matrix({s} 0 0 {s} {48-95*s:.1f} {50-250*s:.1f})',art)
# cauda no canto inferior direito, saindo "da água"
corner='M790 200H1010V345H790Z'
t=1.15; tail=clipped(dol,f'matrix({t} 0 0 {-t} {905-290*t:.1f} {228+647*t:.1f})',art,corner)
# logo horizontal
logo=''.join(drawing_d(L[i]) for i in range(13,26))
ls=470/491; logo_g=f'<g id="logo-crazy-fox" fill="{PINK}" transform="matrix({ls:.4f} 0 0 {ls:.4f} {350-189*ls:.1f} {158-229*ls:.1f})"><path d="{logo}"/></g>'
left=build.text_path('LEFT',0,0,32).replace(build.DARK,PINK)
chev='M1040 145H1060L1095 190L1060 235H1040L1075 190Z'
svg=f'''<?xml version="1.0" encoding="UTF-8"?>
<!-- CRAZY FOX · Etiqueta do velcro · Boto / Amazônia · 115 x 38 mm (1 unidade = 0,1 mm) -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="115mm" height="38mm">
<title>CRAZY FOX Boto - Etiqueta velcro</title>
<path id="borda-externa" fill="{PINK}" d="{outer}"/>
<path id="fundo" fill="{BG}" d="{inner_bg}"/>
<path id="padrao-ondas" fill="{DARK2}" fill-rule="evenodd" d="{waves}"/>
<path id="moldura-interna" fill="{PINK}" fill-rule="evenodd" d="{frame_out} {frame_in}"/>
<path id="boto-cabeca" fill="{PINK}" fill-rule="evenodd" d="{head}"/>
<path id="boto-cauda" fill="{PINK}" fill-rule="evenodd" d="{tail}"/>
{logo_g}
<g id="left" transform="translate(955 202)">{left}</g>
<path id="chevron" fill="{PINK}" d="{chev}"/>
</svg>'''
open('crazyfox-boto-etiqueta-velcro.svg','w').write(svg)
pymupdf.open('crazyfox-boto-etiqueta-velcro.svg')[0].get_pixmap(dpi=300).save('etiqueta.png')
