import sys, os
from PIL import Image
import numpy as np
for p in sys.argv[1:]:
    if not os.path.exists(p):
        print(f"{os.path.basename(p)}\tMISSING"); continue
    kb = os.path.getsize(p)/1024
    im = Image.open(p); im.load()
    w,h = im.size
    hsv = np.asarray(im.convert("RGB").convert("HSV"), dtype=np.float32)
    s = hsv[:,:,1]/255.0
    print(f"{os.path.basename(p)}\t{w}x{h}\t{kb:.0f}KB\tmedian_sat={np.median(s):.4f}\tmean_sat={s.mean():.4f}")
