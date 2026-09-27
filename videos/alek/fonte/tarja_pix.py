from PIL import Image, ImageDraw, ImageFont, ImageFilter
W, H = 1080, 1920
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
def font(size, weight):
    f = ImageFont.truetype("Montserrat.ttf", size)
    f.set_variation_by_axes([weight]); return f
label_f, key_f = font(40, 800), font(112, 800)
label, key = "PIX PARA AJUDAR O ALEK", "13786508917"
TEAL = (50, 188, 173, 255)
bx0, bx1, by0, by1 = 70, W - 70, 1320, 1575
# soft shadow
sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle((bx0, by0 + 8, bx1, by1 + 8), 38, fill=(0, 0, 0, 120))
img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(14)))
d = ImageDraw.Draw(img)
d.rounded_rectangle((bx0, by0, bx1, by1), 38, fill=(12, 16, 20, 205), outline=TEAL, width=5)
# label pill
lw = d.textlength(label, font=label_f)
d.text((W / 2, by0 + 62), label, font=label_f, fill=TEAL, anchor="mm")
# key
d.text((W / 2, by0 + 165), key, font=key_f, fill=(255, 255, 255, 255), anchor="mm",
       stroke_width=2, stroke_fill=(0, 0, 0, 255))
img.save("overlay.png")
print("key width", d.textlength(key, font=key_f))
