import pymupdf
def f(v): return ('%.2f'%v).rstrip('0').rstrip('.')
def pt(p): return f(p.x)+' '+f(p.y)
def drawing_d(dr):
    d=[]; last=None
    for it in dr['items']:
        op=it[0]
        if op=='re':
            r=it[1]; d.append(f'M{f(r.x0)} {f(r.y0)}H{f(r.x1)}V{f(r.y1)}H{f(r.x0)}Z'); last=None; continue
        if op=='qu':
            q=it[1]; d.append(f'M{pt(q.ul)}L{pt(q.ur)}L{pt(q.lr)}L{pt(q.ll)}Z'); last=None; continue
        p0=it[1]
        if last is None or abs(last.x-p0.x)>1e-3 or abs(last.y-p0.y)>1e-3:
            if d and last is not None and dr.get('closePath'): d.append('Z')
            d.append('M'+pt(p0))
        if op=='l': d.append('L'+pt(it[2])); last=it[2]
        elif op=='c': d.append('C'+pt(it[2])+' '+pt(it[3])+' '+pt(it[4])); last=it[4]
    if dr.get('closePath'): d.append('Z')
    return ''.join(d)
def load(path):
    return pymupdf.open(path)[0].get_drawings()
