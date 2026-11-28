"""Make 192 px WebP thumbnails for part photos that have none (Nov 28 audit P1, item 1d).

Bike, category and guide pages show part photos in 72-96 px slots; build_seo.py's thumb_src()
uses img/parts/thumbs/<name>.webp when it exists. This resizes the existing real photos only
(no new images), keeps the aspect ratio and transparency, and skips thumbs that already exist.
Run before build_seo.py:  python3 scripts/make_thumbs.py
"""
import os,sys
from PIL import Image
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC=os.path.join(R,'img','parts'); DST=os.path.join(SRC,'thumbs'); os.makedirs(DST,exist_ok=True)
EXT=('.webp','.jpg','.jpeg','.png','.gif')
made=skip=fail=0
names={}
for f in sorted(os.listdir(SRC)):
  b,x=os.path.splitext(f)
  if x.lower() in EXT and os.path.isfile(os.path.join(SRC,f)):
    # prefer the .webp original when both exist (same base name -> same thumb)
    if b not in names or x.lower()=='.webp': names[b]=f
for b,f in sorted(names.items()):
  out=os.path.join(DST,b+'.webp')
  if os.path.exists(out): skip+=1; continue
  try:
    im=Image.open(os.path.join(SRC,f)); im.seek(0)
    im=im.convert('RGBA') if (im.mode in ('RGBA','LA','P') or 'transparency' in im.info) else im.convert('RGB')
    im.thumbnail((192,192),Image.LANCZOS)
    im.save(out,'WEBP',quality=80,method=4)
    made+=1
  except Exception as e:
    fail+=1; print('FAIL',f,e,file=sys.stderr)
print(f'thumbs made {made}, already had {skip}, failed {fail}')
