# Architecture proof: key out the isolated ship + MacGregor (flood-fill the plain bg) and composite onto the plate.
# Proves the layered pipeline at the still stage (real compositing is a Remotion job later).
from PIL import Image, ImageDraw
import os
KIT = r"C:\Users\danie\faceless-youtube\channels\the-second-take\visual-kit"
P = os.path.join(KIT, "_proof")

def key_out(name, thresh=55):
    im = Image.open(os.path.join(P, name + ".png")).convert("RGB")
    w, h = im.size
    for seed in [(2,2),(w-3,2),(2,h-3),(w-3,h-3),(w//2,2),(w//2,h-3)]:
        try: ImageDraw.floodfill(im, seed, (255,0,255), thresh=thresh)
        except Exception: pass
    im = im.convert("RGBA")
    datas = im.getdata()
    im.putdata([(0,0,0,0) if (p[0]>230 and p[1]<40 and p[2]>230) else p for p in datas])
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im

def crop_border(im, frac=0.045):
    w, h = im.size; dx, dy = int(w*frac), int(h*frac)
    return im.crop((dx, dy, w-dx, h-dy))

plate = crop_border(Image.open(os.path.join(P, "shore_plate.png")).convert("RGBA"))
pw, ph = plate.size

def place(layer, target_h_frac=None, target_w_frac=None, cx=0.5, bottom=0.98):
    lw, lh = layer.size
    if target_h_frac: scale = (ph*target_h_frac)/lh
    else:             scale = (pw*target_w_frac)/lw
    nw, nh = max(1,int(lw*scale)), max(1,int(lh*scale))
    layer = layer.resize((nw, nh), Image.LANCZOS)
    x = int(pw*cx - nw/2); y = int(ph*bottom - nh)
    plate.alpha_composite(layer, (x, y))

ship = key_out("ship")
mac  = key_out("macgregor")

# ship out on the water (behind), smaller; MacGregor on the grass (foreground), larger
place(ship, target_w_frac=0.34, cx=0.70, bottom=0.60)
place(mac,  target_h_frac=0.60, cx=0.20, bottom=0.99)

out = os.path.join(P, "composite.png")
plate.convert("RGB").save(out, "PNG")
print("wrote", out, plate.size)
