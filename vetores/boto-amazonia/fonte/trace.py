import cv2, numpy as np, potrace
im=cv2.imread('../../images/16.jpg')
X0,Y0=765,380
crop=im[380:1640,765:1420].copy()
S=4
big=cv2.resize(crop,None,fx=S,fy=S,interpolation=cv2.INTER_CUBIC)
big=cv2.bilateralFilter(big,9,40,9)
cent={'dark':(0x4f,0x17,0x28),'dark2':(0x5e,0x16,0x2a),'edge':(0x87,0x35,0x4a),'mid':(0xa7,0x40,0x5a),'panel':(0xc9,0x5f,0x77),'light':(0xb5,0x54,0x6b)}
names=list(cent); C=np.array([cent[n][::-1] for n in names],np.float32)
flat=big.reshape(-1,3).astype(np.float32)
dist=((flat[:,None,:]-C[None])**2).sum(2)
lab=dist.argmin(1).reshape(big.shape[:2])
isdark=np.isin(lab,[names.index('dark'),names.index('dark2')])
ismid=np.isin(lab,[names.index('mid'),names.index('edge')])
# outside = dark connected to image corners
h,w=isdark.shape
n,cc=cv2.connectedComponents(isdark.astype(np.uint8))
outside=np.zeros_like(isdark)
for (y,x) in [(0,0),(0,w-1),(h-1,0),(h-1,w-1),(h//2,2),(h//2,w-3)]:
    if isdark[y,x]: outside|=(cc==cc[y,x])
inside=~outside
inside=cv2.erode(inside.astype(np.uint8),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(2*34*S//4*2+1,2*34*S//4*2+1)))>0
# art window (crop coords) exclude logo text and L/LEFT
win=np.zeros_like(inside); win[160*S:1010*S,:]=True
dark=isdark&inside&win
mid=ismid&inside&win
# extend flag bands that were cut by the generated panel edge out to the image border
mid=mid.copy()
for y in range(mid.shape[0]):
    xs=np.where(inside[y])[0]
    if len(xs)==0: continue
    xl,xr=xs.min(),xs.max()
    if mid[y,xl+3:xl+9].all(): mid[y,:xl+3]=True
    if mid[y,xr-8:xr-2].all(): mid[y,xr-2:]=True
for name,m in [('mid',mid)]:
    m=cv2.morphologyEx(m.astype(np.uint8),cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
    cv2.imwrite(f'mask_{name}.png',(m*255)[::2,::2])
    bm=potrace.Bitmap(~(m>0))
    path=bm.trace(turdsize=6*S*S,alphamax=1.0,opticurve=True,opttolerance=0.3)
    parts=[]
    for c in path:
        sp=c.start_point; parts.append(f'M{sp.x/S:.2f} {sp.y/S:.2f}')
        for seg in c.segments:
            if seg.is_corner: parts.append(f'L{seg.c.x/S:.2f} {seg.c.y/S:.2f}L{seg.end_point.x/S:.2f} {seg.end_point.y/S:.2f}')
            else: parts.append(f'C{seg.c1.x/S:.2f} {seg.c1.y/S:.2f} {seg.c2.x/S:.2f} {seg.c2.y/S:.2f} {seg.end_point.x/S:.2f} {seg.end_point.y/S:.2f}')
        parts.append('Z')
    open(f'trace_{name}.d','w').write(''.join(parts))
    print(name,len(path),sum(len(p) for p in parts))
