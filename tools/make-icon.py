from PIL import Image, ImageDraw, ImageFont

FONT = None
for p in ["C:/Windows/Fonts/seguisym.ttf", "C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"]:
    try:
        ImageFont.truetype(p, 40); FONT = p; break
    except Exception:
        pass
print("font:", FONT)

def make(size, path):
    S = size
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 背景（maskable のセーフゾーンを考えて全面を塗る）
    d.rounded_rectangle([0, 0, S-1, S-1], radius=int(S*0.22), fill=(15, 81, 56, 255))
    d.rounded_rectangle([int(S*0.06)]*2 + [S-int(S*0.06)]*2, radius=int(S*0.18), fill=(9, 60, 41, 255))

    # カード2枚（黒→赤の順に重ねる）
    cw, ch = int(S*0.40), int(S*0.56)
    for dx, dy, ang, col, mark in ((-0.16, 0.03, 14, (245, 245, 240), "♠"),
                                   ( 0.12, -0.03, -10, (255, 253, 247), "♥")):
        card = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        cd = ImageDraw.Draw(card)
        cd.rounded_rectangle([0, 0, cw-1, ch-1], radius=int(cw*0.16), fill=col)
        if FONT:
            f = ImageFont.truetype(FONT, int(cw*0.62))
            color = (198, 40, 40) if mark == "♥" else (32, 36, 43)
            bb = cd.textbbox((0, 0), mark, font=f)
            cd.text(((cw-(bb[2]-bb[0]))/2 - bb[0], (ch-(bb[3]-bb[1]))/2 - bb[1]), mark, font=f, fill=color)
        card = card.rotate(ang, resample=Image.BICUBIC, expand=True)
        img.alpha_composite(card, (int(S/2 - card.width/2 + S*dx), int(S/2 - card.height/2 + S*dy)))

    img.save(path)
    print("wrote", path, img.size)

for s, name in ((192, "icon-192.png"), (512, "icon-512.png"), (180, "icon-180.png")):
    make(s, name)
