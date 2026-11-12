# SPDX-License-Identifier: GPL-3.0-or-later
# Visual documentation only. Every screen is taken from Predator VPN v2.0.5.
# A single account display label is anonymized to "Predator".
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'docs/screenshots'
OUT=ROOT/'docs/readme'
OUT.mkdir(parents=True,exist_ok=True)

def font(size,bold=False):
    folder=Path('C:/Windows/Fonts')
    for name in (['segoeuib.ttf','arialbd.ttf'] if bold else ['segoeui.ttf','arial.ttf']):
        p=folder/name
        if p.exists():return ImageFont.truetype(str(p),size)
    return ImageFont.load_default()

def anonymize_android(source,output,theme):
    image=Image.open(source).convert('RGB')
    # The only altered screenshot pixels are this account display-name field;
    # the APK-rendered interface is otherwise copied from the real device.
    assert image.size==(1080,2400),f'Unexpected Android screen: {image.size}'
    d=ImageDraw.Draw(image)
    bg=image.getpixel((860,83))
    text=(238,240,246) if theme=='dark' else (30,34,48)
    # Preserve the original avatar, arrow, layout, and every app control.
    d.rectangle((846,106,974,190),fill=bg)
    d.text((850,121),'Predator',font=font(32,True),fill=text)
    image.save(output,optimize=True)
    return image

screens={}
for theme in ('dark','light'):
    screens[theme]={}
    screens[theme]['desktop']=Image.open(SRC/f'desktop-v205-overview-{theme}.png').convert('RGB')
    safe=SRC/f'android-v205-overview-{theme}.png'
    private=ROOT/'.tools'/'readme-capture'/f'android-v205-{theme}-raw.png'
    if private.exists():
        screens[theme]['android']=anonymize_android(private,safe,theme)
    else:
        # Re-render from committed, anonymized screenshot if private APK
        # captures are unavailable on a fresh clone.
        screens[theme]['android']=Image.open(safe).convert('RGB')

def gradient_bg(w,h,dark):
    first=(9,12,20) if dark else (245,247,250)
    last=(18,23,36) if dark else (225,232,240)
    img=Image.new('RGB',(w,h))
    d=ImageDraw.Draw(img)
    for y in range(h):
        t=y/max(1,h-1)
        color=tuple(round(first[i]*(1-t)+last[i]*t) for i in range(3))
        d.line((0,y,w,y),fill=color)
    return img.convert('RGBA')

def soft_lights(canvas,dark):
    w,h=canvas.size
    overlay=Image.new('RGBA',(w,h))
    d=ImageDraw.Draw(overlay)
    d.ellipse((int(w*.53),int(h*.14),int(w*1.06),int(h*.91)),fill=(255,110,24,85 if dark else 42))
    d.ellipse((int(-w*.29),int(h*.58),int(w*.26),int(h*1.25)),fill=(255,144,56,40 if dark else 21))
    overlay=overlay.filter(ImageFilter.GaussianBlur(max(35,w//14)))
    canvas.alpha_composite(overlay)
    grid=Image.new('RGBA',(w,h))
    g=ImageDraw.Draw(grid)
    alpha=9 if dark else 12
    for x in range(0,w,112):g.line((x,0,x,h),fill=(158,171,191,alpha),width=1)
    for y in range(0,h,112):g.line((0,y,w,y),fill=(158,171,191,alpha),width=1)
    canvas.alpha_composite(grid)

def shadow(canvas,coords,radius,blur=35,strength=110):
    x1,y1,x2,y2=map(int,coords)
    layer=Image.new('RGBA',canvas.size)
    d=ImageDraw.Draw(layer)
    d.rounded_rectangle((x1,y1+18,x2,y2+24),radius=radius,fill=(0,0,0,strength))
    canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))

def framed_image(canvas,src,xywh,radius=16):
    x,y,w,h=map(int,xywh)
    # Only resize the existing screenshot. Never redraw its app controls.
    img=src.resize((w,h),Image.Resampling.LANCZOS).convert('RGBA')
    mask=Image.new('L',(w,h))
    ImageDraw.Draw(mask).rounded_rectangle((0,0,w-1,h-1),radius=radius,fill=255)
    canvas.paste(img,(x,y),mask)

def laptop(canvas,source,x,y,screen_w):
    screen_h=round(screen_w*source.height/source.width)
    pad=20
    frame=(x-pad,y-pad,x+screen_w+pad,y+screen_h+pad)
    shadow(canvas,frame,28,45,180)
    d=ImageDraw.Draw(canvas)
    d.rounded_rectangle(frame,radius=27,fill=(21,24,30),outline=(100,107,118,120),width=3)
    d.rounded_rectangle((x-5,y-5,x+screen_w+5,y+screen_h+5),radius=18,fill=(0,0,0))
    framed_image(canvas,source,(x,y,screen_w,screen_h),radius=13)
    # Hardware camera bezel and real laptop base, not app UI artwork.
    d.ellipse((x+screen_w//2-3,y-pad+6,x+screen_w//2+3,y-pad+12),fill=(78,90,105))
    by=y+screen_h+pad
    d.polygon([(x-pad-36,by),(x+screen_w+pad+36,by),
               (x+screen_w+pad+78,by+31),(x-pad-76,by+31)],
              fill=(72,79,88) if canvas.getpixel((3,3))[0]<70 else (113,122,136))
    d.rounded_rectangle((x+screen_w//2-110,by+2,x+screen_w//2+110,by+11),
                        radius=5,fill=(26,33,44))
    return by+31

def phone(canvas,source,x,y,screen_w):
    screen_h=round(screen_w*source.height/source.width)
    pad=19
    frame=(x-pad,y-pad,x+screen_w+pad,y+screen_h+pad)
    shadow(canvas,frame,49,51,190)
    d=ImageDraw.Draw(canvas)
    d.rounded_rectangle((x-pad,y-pad,x+screen_w+pad,y+screen_h+pad),
                        radius=49,fill=(15,18,24),outline=(123,131,143,180),width=4)
    d.rounded_rectangle((x-5,y-5,x+screen_w+5,y+screen_h+5),
                        radius=37,fill=(5,7,12),outline=(53,63,75),width=2)
    framed_image(canvas,source,(x,y,screen_w,screen_h),radius=33)
    # Tiny hardware front camera on bezel; never touches app content.
    d.ellipse((x+screen_w//2-4,y-pad+5,x+screen_w//2+4,y-pad+13),
              fill=(54,66,80))
    d.line((x+screen_w+pad+1,y+170,x+screen_w+pad+1,y+280),
           fill=(105,114,129),width=4)
    return y+screen_h+pad

def text_header(canvas,dark,compact):
    w,h=canvas.size
    d=ImageDraw.Draw(canvas)
    main=(246,248,251) if dark else (27,35,48)
    secondary=(170,182,203) if dark else (98,109,125)
    accent=(255,138,59) if dark else (198,83,24)
    left=76 if compact else 140
    d.text((left,66 if compact else 81),'PREDATOR VPN   /   v2.0.5',
           font=font(24 if compact else 27,True),fill=accent)
    d.text((left,119 if compact else 137),'The workspace',
           font=font(68 if compact else 77,True),fill=main)
    d.text((left,209 if compact else 240),
           'Actual desktop and Android interfaces. One familiar workspace.',
           font=font(23 if compact else 29),fill=secondary)
    d.rounded_rectangle((left,258 if compact else 302,left+125,263 if compact else 308),
                        radius=2,fill=accent)

def badge(canvas,x,y,caption,dark):
    d=ImageDraw.Draw(canvas)
    d.text((x,y),caption,font=font(22,True),
           fill=(255,145,64) if dark else (181,88,40))

def render(theme,compact=False):
    dark=theme=='dark'
    w,h=(1200,2070) if compact else (2560,1440)
    canvas=gradient_bg(w,h,dark)
    soft_lights(canvas,dark)
    text_header(canvas,dark,compact)
    desk=screens[theme]['desktop']
    mob=screens[theme]['android']
    if compact:
        badge(canvas,92,298,'DESKTOP   ·   WINDOWS',dark)
        laptop(canvas,desk,91,353,1018)
        badge(canvas,490,937,'MOBILE   ·   ANDROID',dark)
        phone(canvas,mob,375,988,420)
        d=ImageDraw.Draw(canvas)
        d.text((94,1988),'REAL UI    ·    ANONYMIZED ACCOUNT: PREDATOR',
               font=font(20,True),fill=(155,167,186) if dark else (97,110,128))
        suffix='-mobile'
    else:
        badge(canvas,149,320,'DESKTOP   ·   WINDOWS',dark)
        laptop(canvas,desk,146,363,1638)
        badge(canvas,1890,251,'MOBILE   ·   ANDROID',dark)
        phone(canvas,mob,1890,301,459)
        suffix=''
    out=OUT/f'workspace-v205-{theme}{suffix}.webp'
    canvas.convert('RGB').save(out,'WEBP',quality=94,method=6)
    print(f'{out.relative_to(ROOT)}: {w}x{h}, {out.stat().st_size} bytes')
    return out

for theme in ('dark','light'):
    for compact in (False,True):
        render(theme,compact)
print('All four mockups use v2.0.5 app screenshots; the only screenshot edit is the Android account display-name anonymization.')
