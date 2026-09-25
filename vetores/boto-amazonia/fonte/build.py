import re, math, random, pymupdf
from pdfpaths import load, drawing_d
from clip import clip_to, mask
import numpy as np
D=load('/root/.claude/uploads/ec5b85dd-db6c-5654-9386-7a7de4e5244a/e027fbc0-logo-1.pdf')
PANEL,TONE,BORDER,DARK,BG='#C95F77','#A7405A','#8A3350','#4F1728','#4A1A2B'

# ---------- text to paths (L / LEFT) ----------
def text_path(txt,x,y,size):
    d=pymupdf.open(); p=d.new_page(width=600,height=200)
    p.insert_text((0,100),txt,fontname='hebo',fontsize=size)
    s=p.get_svg_image(text_as_path=True)
    glyphs=dict(re.findall(r'<path id="([^"]+)" d="([^"]*)"',s))
    uses=re.findall(r'xlink:href="#([^"]+)" transform="matrix\(([^)]*)\)"',s)
    out=[]; xs=[]
    for gid,m in uses:
        a,b,c,dd,e,f=map(float,m.split(','))
        toks=re.findall(r'[MLHVZ]|-?\d*\.?\d+(?:e-?\d+)?',glyphs[gid])
        cmd=None; cx=cy=0; i=0
        while i<len(toks):
            t=toks[i]
            if t in 'MLHVZ':
                cmd=t; i+=1
                if t=='Z': out.append('Z'); continue
                continue
            if cmd in 'ML':
                cx,cy=float(toks[i]),float(toks[i+1]); i+=2
            elif cmd=='H': cx=float(t); i+=1
            elif cmd=='V': cy=float(t); i+=1
            X=a*cx+c*cy+e; Y=b*cx+dd*cy+f; xs.append(X)
            out.append(('M' if cmd=='M' else 'L')+f'{X:.2f} {Y-100:.2f}')
            if cmd=='M': cmd='L'
    w=max(xs)-min(xs)
    # shift so text is centered at x, baseline at y
    dpath=' '.join(out)
    return f'<path fill="{DARK}" transform="translate({x-w/2-min(xs):.2f} {y:.2f})" d="{dpath}"/>'

# ---------- traced art ----------
dark=open('trace_dark.d').read(); mid=open('trace_mid.d').read()

# ---------- slits (back) ----------
def slit(top,tip,w):
    (x0,y0),(x1,y1)=top,tip
    dx,dy=x1-x0,y1-y0; L=math.hypot(dx,dy); ux,uy=dx/L,dy/L; nx,ny=-uy,ux
    a=(x0+nx*w/2-ux*6,y0+ny*w/2-uy*6); b=(x0-nx*w/2-ux*6,y0-ny*w/2-uy*6)
    c1=(x1+nx*w*0.35-ux*L*0.25, y1+ny*w*0.35-uy*L*0.25)
    c2=(x1-nx*w*0.35-ux*L*0.25, y1-ny*w*0.35-uy*L*0.25)
    return (f'M{a[0]:.1f} {a[1]:.1f}C{a[0]+ux*L*0.5:.1f} {a[1]+uy*L*0.5:.1f} {c1[0]:.1f} {c1[1]:.1f} {x1:.1f} {y1:.1f}'
            f'C{c2[0]:.1f} {c2[1]:.1f} {b[0]+ux*L*0.5:.1f} {b[1]+uy*L*0.5:.1f} {b[0]:.1f} {b[1]:.1f}Z')

# ---------- palm water pattern ----------
def wave(x,y,L,amp,ang):
    n=3; seg=L/n; pts=[]
    ca,sa=math.cos(ang),math.sin(ang)
    def P(u,v): return (x+u*ca-v*sa, y+u*sa+v*ca)
    d='M%.1f %.1f'%P(-L/2,0)
    for k in range(n):
        u0=-L/2+k*seg; s=1 if k%2==0 else -1
        c1=P(u0+seg*0.33,-amp*s); c2=P(u0+seg*0.67,-amp*s); e=P(u0+seg,0)
        d+='C%.1f %.1f %.1f %.1f %.1f %.1f'%(*c1,*c2,*e)
    return d
def ripple(x,y,r):
    s=''
    for k,f in enumerate([1,0.62,0.28]):
        rx,ry=r*f,r*f*0.42
        s+=f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{rx:.1f}" ry="{ry:.1f}"/>'
    return s
def palm_pattern(inner):
    M=mask([(inner,'')],(120,60,640,1010)); from clip import R
    import cv2
    PM=mask([(drawing_d(D[77]),'')],(120,60,640,1010)); PM=cv2.dilate(PM.astype(np.uint8),np.ones((int(14*R),int(14*R)),np.uint8))>0; M=M&~PM
    def ok(x,y,r):
        for dx,dy in [(0,0),(r,0),(-r,0),(0,r*0.6),(0,-r*0.6),(r*0.5,0),(-r*0.5,0)]:
            X=int((x+dx-120)*R); Y=int((y+dy-60)*R)
            if not (0<=Y<M.shape[0] and 0<=X<M.shape[1] and M[Y,X]): return False
        return True
    rnd=random.Random(7)
    pads=(240,200,515,385)
    items=[]; pts=[]
    tries=0
    while len(pts)<42 and tries<40000:
        tries+=1
        x=rnd.uniform(150,610); y=rnd.uniform(95,880)
        if pads[0]<x<pads[2] and pads[1]<y<pads[3]: continue
        if not ok(x,y,48): continue
        if any(math.hypot(x-a,y-b)<64 for a,b in pts): continue
        pts.append((x,y))
    waves=[];rips=[]
    for i,(x,y) in enumerate(pts):
        if i%3==2: rips.append(ripple(x,y,rnd.uniform(16,22)))
        else: waves.append(wave(x,y,rnd.uniform(46,64),rnd.uniform(4,6),rnd.uniform(-0.12,0.12)))
    return (f'<path d="{" ".join(waves)}"/>'+''.join(rips))

def piece_palm():
    outer=drawing_d(D[1]); inner=drawing_d(D[2]); pads=drawing_d(D[77])
    return f'''<g id="palma">
  <path id="palma-borda" fill="{BORDER}" d="{outer}"/>
  <path id="palma-painel" fill="{PANEL}" d="{inner}"/>
  <g id="palma-padrao-agua" fill="none" stroke="{TONE}" stroke-width="2.4" stroke-linecap="round">{palm_pattern(inner)}</g>
  <path id="palma-almofadas" fill="{DARK}" d="{pads}"/>
  <g id="palma-marcacao">{text_path("L / LEFT",405,948,26)}</g>
</g>'''

def piece_back():
    outer=drawing_d(D[78]); inner=drawing_d(D[79])
    EO=' fill-rule="evenodd"'
    logo=''.join(f'<path d="{drawing_d(D[i])}"'+(EO if D[i].get("even_odd") else '')+'/>' for i in range(156,169))
    s=0.58; tx=781; ty=241.4
    mid_c=clip_to(mid,f'matrix({s} 0 0 {s} {tx} {ty})',inner,(740,80,1230,1000))
    slits=[slit((838,144),(849,214),16),slit((978,109),(980,184),16),slit((1114,155),(1090,175),14)]
    return f'''<g id="verso">
  <path id="verso-borda" fill="{BORDER}" d="{outer}"/>
  <path id="verso-painel" fill="{PANEL}" d="{inner}"/>
  <g id="verso-arte">
    <path id="bandeira-e-halo" fill="{TONE}" fill-rule="evenodd" d="{mid_c}"/>
    <path id="boto" fill="{DARK}" fill-rule="evenodd" transform="matrix({s} 0 0 {s} {tx} {ty})" d="{dark}"/>
  </g>
  <g id="verso-logo-crazy-fox" fill="{DARK}">{logo}</g>
  <path id="verso-fendas" fill="{DARK}" fill-rule="evenodd" d="{clip_to(" ".join(slits),"",outer,(740,80,1230,1000))}"/>
  <g id="verso-marcacao">{text_path("L / LEFT",1010,948,26)}</g>
</g>'''

MM=206/906.0   # altura do grip = 206 mm
def svg(content,vb,bg=None,title=''):
    x,y,w,h=vb
    bgr=f'<rect id="fundo" x="{x}" y="{y}" width="{w}" height="{h}" fill="{bg}"/>' if bg else ''
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<!-- CRAZY FOX · Coleção Biomas · Rosa Framboesa / Amazônia / Boto-cor-de-rosa
     Paleta: painel {PANEL} · tom {TONE} · borda {BORDER} · escuro {DARK} · fundo {BG}
     Escala: 1 unidade = {MM:.4f} mm (grip com 206 mm de altura) -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {y} {w} {h}" width="{w*MM:.2f}mm" height="{h*MM:.2f}mm">
<title>{title}</title>
{bgr}{content}
</svg>'''
P=piece_palm(); B=piece_back()
open('crazyfox-boto-palma.svg','w').write(svg(P,(122,67,510,946),title='CRAZY FOX Boto - Palma'))
open('crazyfox-boto-verso.svg','w').write(svg(B,(727,67,510,946),title='CRAZY FOX Boto - Verso'))
open('crazyfox-boto-prancha.svg','w').write(svg(P+B,(62,27,1235,1026),bg=BG,title='CRAZY FOX Boto - Palma e Verso'))
for n in ['crazyfox-boto-prancha']:
    pymupdf.open(n+'.svg')[0].get_pixmap(dpi=40).save(n+'.png')
