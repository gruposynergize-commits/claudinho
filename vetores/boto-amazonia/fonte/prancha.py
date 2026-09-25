import pymupdf, numpy as np, cv2
from pdfpaths import load, drawing_d
from clip import mask, trace
SRC='/root/.claude/uploads/ec5b85dd-db6c-5654-9386-7a7de4e5244a/3f21ac5a-logo.pdf'
V=load('/root/.claude/uploads/ec5b85dd-db6c-5654-9386-7a7de4e5244a/420e3428-crazyfox-boto-verso_3.pdf')
E=load('/root/.claude/uploads/ec5b85dd-db6c-5654-9386-7a7de4e5244a/e027fbc0-logo-1.pdf')
DARK='#4F1728'; GREY=(0x8a/255,0x6a/255,0x72/255)
def rgb(h): return tuple(int(h[i:i+2],16)/255 for i in (1,3,5))
# --- símbolos ---
box=(30,140,380,300)
m=mask([(drawing_d(V[6]),'')],box).astype(np.uint8)
n,lab,st,_=cv2.connectedComponentsWithStats(m); big=1+np.argmax(st[1:,4])
onda=trace(lab==big,box)
box2=(90,245,340,420)
head=trace(mask([(drawing_d(V[3]),'')],box2)&mask([('M90 245H340V405H90Z','')],box2),box2)
pata=drawing_d(E[77])
def sym_pdf(d,bb):
    x0,y0,x1,y1=bb
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0} {y0} {x1-x0} {y1-y0}" width="{x1-x0}" height="{y1-y0}"><path fill="{DARK}" fill-rule="evenodd" d="{d}"/></svg>'
    return pymupdf.open('pdf',pymupdf.open(stream=svg.encode(),filetype='svg').convert_to_pdf())
def bbox_of(d):
    doc=sym_pdf(d,(0,0,1920,1080)); r=doc[0].get_drawings()[0]['rect']; return (r.x0-2,r.y0-2,r.x1+2,r.y1+2)
doc=pymupdf.open(SRC); p=doc[0]
for r in [(140,550,735,800),(140,840,830,970),(940,700,1810,965)]:
    p.add_redact_annot(pymupdf.Rect(*r))
p.apply_redactions(images=0,graphics=1,text=0)
F={'r':'inter/extras/ttf/Inter-Regular.ttf','s':'inter/extras/ttf/Inter-SemiBold.ttf','b':'inter/extras/ttf/Inter-Bold.ttf'}
for k,f in F.items(): p.insert_font(fontname='I'+k,fontfile=f)
def txt(x,y,s,size,w='r',color=DARK,center=False):
    font=pymupdf.Font(fontfile=F[w])
    if center: x-=font.text_length(s,size)/2
    p.insert_text((x,y),s,fontname='I'+w,fontsize=size,color=rgb(color) if isinstance(color,str) else color)
txt(148,585,'SISTEMA DE IDENTIDADE / IDENTITY SYSTEM',26.3,'s')
body1=['A coleção Biomas leva a CRAZY FOX para dentro da Amazônia.','O boto-cor-de-rosa, símbolo dos rios da floresta, é o animal','deste modelo; a bandeira aparece só sugerida atrás dele.']
body2=['Uma única cor, do framboesa ao vinho, sem segunda tinta.','As ondas do rio se repetem como textura tom sobre tom,','o boto marca cada peça e a pata assina a linha inteira.']
for i,l in enumerate(body1): txt(148,622+27*i,l,19.3)
for i,l in enumerate(body2): txt(148,731+27*i,l,19.3)
pal=[('IGAPÓ','#4F1728'),('MARGEM','#8A3350'),('CORRENTEZA','#A7405A'),('BOTO','#C95F77')]
for i,(nm,h) in enumerate(pal):
    x=148+171*i
    p.draw_rect(pymupdf.Rect(x,848,x+154,916),color=None,fill=rgb(h),radius=0.03)
    txt(x,939,nm,13.2,'b'); txt(x,958,h,12.3,'r',GREY)
syms=[('ONDA','textura / texture',onda,1043),('BOTO','marca / mark',head,1360),('PATA','forma / form',pata,1687)]
for nm,sub,d,cx in syms:
    bb=bbox_of(d); w,h=bb[2]-bb[0],bb[3]-bb[1]
    sc=min(260/w,150/h) if nm=='BOTO' else min(170/w,150/h)
    W,H=w*sc,h*sc
    p.show_pdf_page(pymupdf.Rect(cx-W/2,788-H/2,cx+W/2,788+H/2),sym_pdf(d,bb),0)
    txt(cx,913,nm,26.3,'s',center=True); txt(cx,950,sub,17.6,'r',GREY,center=True)
doc.save('crazyfox-boto-prancha-identidade.pdf',garbage=3,deflate=True)
open('crazyfox-boto-prancha-identidade.svg','w').write(doc[0].get_svg_image(text_as_path=True))
doc[0].get_pixmap(dpi=72).save('prancha_id.png')
