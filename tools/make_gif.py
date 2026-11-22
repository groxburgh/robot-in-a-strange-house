"""Stitch recorded frames into docs/demo.gif.  Usage: python3 tools/make_gif.py /tmp/frames docs/demo.gif [width]"""
import sys, glob
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
width = int(sys.argv[3]) if len(sys.argv) > 3 else 640
files = sorted(glob.glob(f"{src}/f*.png"))
imgs = []
for f in files:
    im = Image.open(f).convert("RGB")
    imgs.append(im.resize((width, round(im.height * width / im.width)), Image.LANCZOS))

# One shared palette built from a strip of sample frames, so the robot's
# accent colour survives and unchanged pixels compress well between frames.
picks = [imgs[i] for i in range(0, len(imgs), max(1, len(imgs) // 8))]
band = picks[0].height // 2
strip = Image.new("RGB", (width, picks[0].height * len(picks) + band))
for k, p in enumerate(picks):
    strip.paste(p, (0, k * p.height))
# Reserve palette room for the robot's cobalt (thin lines and dots get averaged away otherwise).
strip.paste((43, 76, 255), (0, picks[0].height * len(picks), width // 2, strip.height))
strip.paste((140, 156, 250), (width // 2, picks[0].height * len(picks), width, strip.height))
palette = strip.quantize(colors=96, method=Image.Quantize.MEDIANCUT)
frames = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in imgs]
durations = [100] * len(frames)
durations[-1] = 2500  # hold the final state
frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
print(out, len(frames), "frames")
