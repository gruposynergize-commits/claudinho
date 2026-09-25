import pymupdf, numpy as np, potrace
R=5.0
def mask(paths, box):
    x0,y0,x1,y1=box
    body=''.join(f'<path fill="#fff" fill-rule="evenodd" {extra} d="{d}"/>' for d,extra in paths)
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0} {y0} {x1-x0} {y1-y0}" width="{x1-x0}" height="{y1-y0}"><rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" fill="#000"/>{body}</svg>'
    pm=pymupdf.open(stream=svg.encode(),filetype='svg')[0].get_pixmap(matrix=pymupdf.Matrix(R,R),alpha=False)
    a=np.frombuffer(pm.samples,np.uint8).reshape(pm.h,pm.w,pm.n)[:,:,0]
    return a>127
def trace(m, box):
    x0,y0=box[0],box[1]
    path=potrace.Bitmap(~m).trace(turdsize=30,alphamax=1.0,opticurve=True,opttolerance=0.3)
    out=[]
    P=lambda p:f'{p.x/R+x0:.2f} {p.y/R+y0:.2f}'
    for c in path:
        out.append('M'+P(c.start_point))
        for s in c.segments:
            out.append(('L'+P(s.c)+'L'+P(s.end_point)) if s.is_corner else ('C'+P(s.c1)+' '+P(s.c2)+' '+P(s.end_point)))
        out.append('Z')
    return ''.join(out)
def clip_to(d, transform, clipd, box):
    a=mask([(d,f'transform="{transform}"')],box)
    b=mask([(clipd,'')],box)
    return trace(a&b, box)
