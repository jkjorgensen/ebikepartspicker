"""Per-bike share images (img/og/<id>.jpg, 1200x630) and noindex share stubs (/b/<id>/) that carry the
bike's OG preview and forward to the builder with the build hash intact. Run after dump_snapshot.py."""
import json,os,html
from PIL import Image,ImageDraw,ImageFont,ImageFilter
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)));BASE='https://ebikepartspicker.pages.dev'
S=json.load(open(os.path.join(R,'data','seo-fit-snapshot.json')))
FT='/usr/share/fonts/truetype/sand-box/google/Space Grotesk/SpaceGrotesk-VariableFont_wght.ttf'
def font(sz,w=700):
  f=ImageFont.truetype(FT,sz)
  try: f.set_variation_by_axes([w])
  except Exception: pass
  return f
VOLT=(200,240,74);os.makedirs(os.path.join(R,'img','og'),exist_ok=True)
e=lambda s: html.escape(str(s),quote=True)
for b in S['bikes']:
  src=os.path.join(R,'img','bikes',b['id']+'-800.webp')
  if not os.path.exists(src): src=os.path.join(R,'img','bikes',b['id']+'.webp')
  W,H=1200,630; im=Image.new('RGB',(W,H),(8,9,10)); d=ImageDraw.Draw(im)
  g=Image.new('L',(W,H),0); ImageDraw.Draw(g).ellipse((560,120,1180,600),fill=70); g=g.filter(ImageFilter.GaussianBlur(90))
  im.paste(Image.new('RGB',(W,H),(40,48,20)),(0,0),g)
  if os.path.exists(src):
    bk=Image.open(src).convert('RGBA'); bk.thumbnail((720,470)); im.paste(bk,(W-bk.width-30,(H-bk.height)//2+30),bk)
  d.rounded_rectangle((60,60,104,104),10,fill=VOLT); d.polygon([(86,68),(72,86),(82,86),(78,98),(92,80),(82,80)],fill=(8,9,10))
  d.text((120,66),'ebikepartspicker',font=font(30,600),fill=(235,235,235))
  d.text((60,190),'MY BUILD',font=font(26,600),fill=VOLT)
  nm=b['name']; f=font(64); words=nm.split(); lines=[];cur=''
  for w in words:
    t=(cur+' '+w).strip()
    if d.textlength(t,font=f)>520 and cur: lines.append(cur);cur=w
    else: cur=t
  lines.append(cur); y=230
  for l in lines[:3]: d.text((60,y),l,font=f,fill=(255,255,255)); y+=74
  d.text((60,H-100),'Real parts. Real prices. Real fitment.',font=font(26,500),fill=(170,170,170))
  im.save(os.path.join(R,'img','og',b['id']+'.jpg'),quality=84,optimize=True,progressive=True)
  t=f"My {b['name']} build | eBikePartsPicker"; ds=f"See the parts, prices and fitment for this {b['name']} build. Real parts, real prices, real fitment. No sign-up."
  dd=os.path.join(R,'b',b['id']); os.makedirs(dd,exist_ok=True)
  open(os.path.join(dd,'index.html'),'w').write(f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(t)}</title><meta name="robots" content="noindex,follow"><meta name="description" content="{e(ds)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="eBikePartsPicker"><meta property="og:title" content="{e(t)}"><meta property="og:description" content="{e(ds)}"><meta property="og:url" content="{BASE}/b/{b['id']}/"><meta property="og:image" content="{BASE}/img/og/{b['id']}.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{e(t)}"><meta name="twitter:description" content="{e(ds)}"><meta name="twitter:image" content="{BASE}/img/og/{b['id']}.jpg">
<link rel="canonical" href="{BASE}/"><style>html,body{{background:#08090a;color:#ddd;font:16px system-ui;margin:0}}p{{padding:24px}}a{{color:#c8f04a}}</style>
<script>(function(){{var h=location.hash||('#'+encodeURIComponent(JSON.stringify({{b:{json.dumps(b['id'])}}})));location.replace('/'+h);}})();</script>
</head><body><p>Opening the build&hellip; <a href="/">Open eBikePartsPicker</a></p></body></html>
''')
print(len(S['bikes']),'og images + share stubs')
