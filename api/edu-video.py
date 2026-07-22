# ABOUT WALL ART — Educational Video · ONLINE engine (Vercel Python function).
# Actions (POST JSON):
#   { action:"edu-make-video", folderId, handle } -> { jobId, srt }   (long: download->transcribe->align->bake->upload->submit render)
#   { action:"edu-video-status", jobId }           -> { step } or { done:true, videoUrl }
#   { action:"edu-thumbnail", folderId, handle }    -> { ok, thumbUrl }   (bake the title card -> Drive -> public link)
# Env vars needed on Vercel: ASSEMBLYAI_KEY, RENDERLY_KEY, EDU_DRIVE_URL (the Apps Script /exec url).
# Reads the saved script from GitHub raw (public repo). Fonts/logo from repo assets/edu-video.

import os, re, io, json, time, base64, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1920, 1080, 30
ASSETS = os.path.join(os.path.dirname(__file__), "..", "assets", "edu-video")
LEMON = os.path.join(ASSETS, "LEMONMILK-Light.otf")
LATO  = os.path.join(ASSETS, "Lato-Regular.ttf")
LOGO  = os.path.join(ASSETS, "logo-circle.png")
# Fixed ending-card backgrounds (same for every video) — bundled, NOT taken from the video folder.
OUTRO_BG = {1: os.path.join(ASSETS, "outro1.png"), 2: os.path.join(ASSETS, "outro2.png"),
            3: os.path.join(ASSETS, "outro3.png"), 4: os.path.join(ASSETS, "outro4.jpg")}
REPO_RAW = "https://raw.githubusercontent.com/aboutwallart/seo-tools/main/data/edu-video-%s.json"

def http(url, method="GET", headers=None, data=None, timeout=120):
    r = urllib.request.Request(url, method=method, headers=headers or {}, data=data)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        body = ""
        try: body = e.read().decode("utf-8", "ignore")[:300]
        except Exception: pass
        svc = ("Renderly" if "renderly" in url else "AssemblyAI" if "assemblyai" in url
               else "ElevenLabs" if "elevenlabs" in url else "Google Drive" if "google" in url else "the service")
        if e.code in (401, 402, 429) or re.search(r"credit|quota|insufficient|payment|balance|limit", body, re.I):
            raise RuntimeError("❌ Couldn't finish — your %s credits/quota look used up (error %d). Top up %s and try again." % (svc, e.code, svc))
        raise RuntimeError("%s error %d: %s" % (svc, e.code, body))

# ---------- Drive ----------
def drive_list(folder_id):
    url = os.environ["EDU_DRIVE_URL"]
    body = json.dumps({"action": "list", "folderId": folder_id}).encode()
    d = json.loads(http(url, "POST", {"Content-Type": "application/json"}, body))
    if not d.get("ok"): raise RuntimeError("Drive list failed: " + str(d.get("error")))
    return d["files"]
def drive_download(file_id):
    return http("https://drive.google.com/uc?export=download&id=" + file_id)
def photo_for(files, k):
    # Match a photo by its LEADING NUMBER (03.png, 03-earthy-room.png, 3.jpg … all = photo 3),
    # so any extra text Shopify AI appends after the number doesn't break the lookup (no renaming needed).
    for f in files:
        low = f["name"].lower()
        if not (low.endswith(".png") or low.endswith(".jpg") or low.endswith(".jpeg") or low.endswith(".webp")): continue
        m = re.match(r"0*(\d+)", f["name"])
        if m and int(m.group(1)) == k: return f
    return None

# ---------- transcribe + align ----------
def transcribe(mp3_bytes, key):
    h = {"authorization": key}
    up = json.loads(http("https://api.assemblyai.com/v2/upload", "POST", h, mp3_bytes))["upload_url"]
    tid = json.loads(http("https://api.assemblyai.com/v2/transcript", "POST",
          {**h, "content-type": "application/json"},
          json.dumps({"audio_url": up, "language_code": "en_uk"}).encode()))["id"]
    while True:
        d = json.loads(http("https://api.assemblyai.com/v2/transcript/" + tid, "GET", h))
        if d["status"] == "completed": return d["words"]
        if d["status"] == "error": raise RuntimeError(d.get("error"))
        time.sleep(5)
CANON = {"colour":"color","colours":"colors","favourite":"favorite","favourites":"favorites","vs":"versus","grey":"gray","cosy":"cozy","travelled":"traveled","metre":"meter"}
def clean(t):
    # Strip ElevenLabs [audio tags] (voice cues for the mp3 only) so they never show in the
    # on-screen captions / subtitles and never break the word-timing match. Also turn ALL-CAPS
    # emphasis words (voice cues too) back to normal case so captions aren't shouty.
    t = re.sub(r"\[[^\]]*\]", "", t or "")
    t = re.sub(r"[A-Za-z][A-Za-z']*", lambda m: m.group(0).lower() if (len(m.group(0)) >= 2 and m.group(0).isupper()) else m.group(0), t)
    return re.sub(r"\s+", " ", t).strip()
def toks(t):
    t = t.lower().replace("’", "'")
    return [CANON.get(w, w) for w in re.split(r"[^a-z0-9']+", re.sub(r"[-–—/]", " ", t)) if w]
def align(words, lines):
    stream = []
    for w in words:
        for tk in toks(w["text"]): stream.append((tk, w["start"], w["end"]))
    S = [x[0] for x in stream]
    def find(tk, frm):
        for L in (5,4,3,2):
            key = tk[:L]
            if len(key) < L: continue
            for i in range(frm, len(S)-L+1):
                if sum(1 for a,b in zip(S[i:i+L], key) if a==b) >= L-1: return i
        return None
    ptr, st = 0, []
    for txt in lines:
        idx = find(toks(txt), ptr); st.append(idx)
        if idx is not None: ptr = idx+1
    ae = words[-1]["end"]; out = []
    for j in range(len(lines)):
        si = st[j]; s0 = stream[si][1] if si is not None else (out[-1]["end_ms"] if out else 0)
        nxt = next((stream[st[k]][1] for k in range(j+1, len(lines)) if st[k] is not None), None)
        out.append({"start_ms": s0, "end_ms": nxt if nxt is not None else ae})
    return out

# ---------- bake ----------
def F(p, s): return ImageFont.truetype(p, s)
def cover(im):
    im = im.convert("RGB"); iw, ih = im.size; s = max(W/iw, H/ih)
    nw, nh = int(iw*s), int(ih*s); im = im.resize((nw, nh), Image.LANCZOS)
    x, y = (nw-W)//2, (nh-H)//2; return im.crop((x, y, x+W, y+H))
def contain_white(im):
    c = Image.new("RGB", (W, H), "white"); im = im.convert("RGB"); iw, ih = im.size
    s = min((W-200)/iw, (H-160)/ih); nw, nh = int(iw*s), int(ih*s)
    c.paste(im.resize((nw, nh), Image.LANCZOS), ((W-nw)//2, (H-nh)//2)); return c
def is_white_bg(im):
    # True when the image sits on a WHITE background (e.g. a blog infographic) — sampled at 8 edge points.
    # Such images are shown WHOLE (contained), never cropped, so titles/captions are kept.
    im = im.convert("RGB"); iw, ih = im.size
    if iw < 4 or ih < 4: return False
    pts = [(1,1),(iw-2,1),(1,ih-2),(iw-2,ih-2),(iw//2,1),(iw//2,ih-2),(1,ih//2),(iw-2,ih//2)]
    white = 0
    for x,y in pts:
        r,g,b = im.getpixel((x,y))
        if r>232 and g>232 and b>232: white += 1
    return white >= 6
def add_logo(b, size=150, m=55):
    lg = Image.open(LOGO).convert("RGBA").resize((size, size), Image.LANCZOS); b.paste(lg, (W-size-m, m), lg)
def wrap(d, t, f, mw):
    L, c = [], ""
    for w in t.split():
        x = (c+" "+w).strip()
        if d.textlength(x, font=f) <= mw: c = x
        else:
            if c: L.append(c)
            c = w
    if c: L.append(c)
    return L
def caption_box(b, text, font=None, bottom=70, padx=24, pady=14, radius=18, mw=W-360):
    if font is None: font = F(LATO, 46)
    d = ImageDraw.Draw(b); L = wrap(d, text, font, mw)
    asc, desc = font.getmetrics(); bh = asc+desc+2*pady; adv = bh-radius*2
    total = bh + (len(L)-1)*adv; yy = H-bottom-total; boxes = []
    for ln in L:
        bw = d.textlength(ln, font=font)+2*padx; x = (W-bw)//2
        boxes.append((x, yy, x+bw, yy+bh, ln)); yy += adv
    for (x0,y0,x1,y1,ln) in boxes: d.rounded_rectangle([x0,y0,x1,y1], radius=radius, fill=(0,0,0))
    for (x0,y0,x1,y1,ln) in boxes: d.text((W//2, y0+pady), ln, font=font, fill="white", anchor="ma")
def openimg(path): return Image.open(path)
def bake_all(indir, edu, outdir):
    os.makedirs(outdir, exist_ok=True)
    def P(name): return os.path.join(indir, name)
    def img(k):
        p = P("%02d.png" % k);
        return p if os.path.exists(p) else P("%02d.jpg" % k)
    n = len(edu["scenes"])
    b = cover(openimg(img(1))); d = ImageDraw.Draw(b); barh = 240
    d.rectangle([0, H-barh, W, H], fill=(0,0,0)); f = F(LEMON, 66)
    L = wrap(d, clean(edu["videoTitle"]).upper(), f, W-300); asc, desc = f.getmetrics(); lh = int((asc+desc)*1.05)
    ty = H-barh//2-(len(L)*lh)//2
    for ln in L: d.text((W//2, ty), ln, font=f, fill="white", anchor="ma"); ty += lh
    add_logo(b); b.save(os.path.join(outdir, "frame_00.png"))
    for i in range(1, n+1):
        _k = (edu["scenes"][i-1].get("kind") or "photo")
        _im = openimg(img(i+1))
        # infographics AND any white-background image are shown WHOLE (contain) so titles/edges/captions are never cropped; photos cover-fill
        b = contain_white(_im) if (_k == "infographic" or (_k == "photo" and is_white_bg(_im))) else cover(_im)
        caption_box(b, clean(edu["scenes"][i-1]["text"])); add_logo(b); b.save(os.path.join(outdir, "frame_%02d.png" % i))
    o1, o2, o3, o4, o5 = n+1, n+2, n+3, n+4, n+5
    b = cover(openimg(OUTRO_BG[1])); d = ImageDraw.Draw(b); f = F(LEMON, 62)
    x = 1000; L = wrap(d, clean(edu["outro"][0]).upper(), f, W-x-90); asc, desc = f.getmetrics(); lh = int((asc+desc)*1.1)
    y = H//2-(len(L)*lh)//2
    for ln in L: d.text((x, y), ln, font=f, fill="white", anchor="la"); y += lh
    add_logo(b); b.save(os.path.join(outdir, "frame_%02d.png" % o1))
    b = contain_white(openimg(OUTRO_BG[2])); caption_box(b, clean(edu["outro"][1])); add_logo(b); b.save(os.path.join(outdir, "frame_%02d.png" % o2))
    b = contain_white(openimg(OUTRO_BG[3])); caption_box(b, clean(edu["outro"][2])); add_logo(b); b.save(os.path.join(outdir, "frame_%02d.png" % o3))
    b = cover(openimg(OUTRO_BG[4])); caption_box(b, clean(edu["outro"][3])); add_logo(b); b.save(os.path.join(outdir, "frame_%02d.png" % o4))
    b = Image.new("RGB", (W, H), (0,0,0)); d = ImageDraw.Draw(b)
    lg = Image.open(LOGO).convert("RGBA").resize((200,200), Image.LANCZOS); b.paste(lg, ((W-200)//2, 120), lg)
    f = F(LEMON, 96)
    d.text((W//2, 420), "HAPPY", font=f, fill="white", anchor="ma")
    d.text((W//2, 540), "DECORATING!", font=f, fill="white", anchor="ma")
    d.text((W//2, 840), "aboutwallart.com", font=F(LATO, 44), fill="white", anchor="ma")
    b.save(os.path.join(outdir, "frame_%02d.png" % o5))
    return o5 + 1

def scene_lines(edu): return [clean(edu["videoTitle"])] + [clean(s["text"]) for s in edu["scenes"]] + [clean(o) for o in edu["outro"]]

# ---------- Renderly ----------
def rl_upload(path, ct, key):
    d = json.loads(http("https://renderly.video/api/v1/uploads", "POST",
        {"Authorization": "Bearer "+key, "content-type": "application/json"},
        json.dumps({"contentType": ct}).encode()))["data"]
    http(d["uploadUrl"], "PUT", {"Content-Type": ct}, open(path, "rb").read())
    return d["fileUrl"]
def build_recipe(urls, audio, timing):
    b = [0]*(len(urls)+1)
    for i in range(1, len(urls)): b[i] = round(timing[i]["start_ms"]/1000*FPS)
    b[len(urls)] = round(timing[-1]["end_ms"]/1000*FPS); T = b[len(urls)]; ov = []; rid = 0
    for i in range(len(urls)):
        ov.append({"id": rid, "type": "image", "src": urls[i], "from": b[i], "durationInFrames": b[i+1]-b[i],
                   "row": 0, "top": 0, "left": 0, "width": W, "height": H,
                   "styles": {"objectFit": "cover", "animation": {"enter": "fade", "enterDuration": 0.4}}}); rid += 1
    ov.append({"id": rid, "type": "sound", "src": audio, "from": 0, "durationInFrames": T,
               "row": 9, "top": 0, "left": 0, "width": 0, "height": 0, "startFromSound": 0, "styles": {"volume": 1}})
    return {"width": W, "height": H, "fps": FPS, "durationInFrames": T,
            "inputProps": {"durationInFrames": T, "width": W, "height": H, "fps": FPS, "backgroundColor": "#000000", "overlays": ov}}
def srt_text(timing, lines):
    def ts(ms):
        ms = int(ms); return "%02d:%02d:%02d,%03d" % (ms//3600000, (ms%3600000)//60000, (ms%60000)//1000, ms%1000)
    out = []
    for i, (t, ln) in enumerate(zip(timing, lines), 1):
        out += [str(i), "%s --> %s" % (ts(t["start_ms"]), ts(t["end_ms"])), ln.strip(), ""]
    return "\n".join(out)
def srt_data_uri(timing, lines):
    return "data:text/plain;base64," + base64.b64encode(srt_text(timing, lines).encode()).decode()
def drive_upload(folder_id, name, mime, data):
    # upload a (small) file into a Drive folder via the Apps Script helper
    url = os.environ["EDU_DRIVE_URL"]
    body = json.dumps({"action": "upload", "folderId": folder_id, "name": name, "mime": mime, "dataBase64": base64.b64encode(data).decode()}).encode()
    return json.loads(http(url, "POST", {"Content-Type": "application/json"}, body))

# ---------- pipeline ----------
def make_video(folder_id, handle):
    akey = os.environ["ASSEMBLYAI_KEY"]; rkey = os.environ["RENDERLY_KEY"]
    edu = json.loads(http((REPO_RAW % handle) + "?_=" + str(int(time.time()))))  # cache-buster: always read the LATEST saved script (raw.githubusercontent is CDN-cached)
    files = drive_list(folder_id)
    byname = {f["name"]: f for f in files}
    indir = "/tmp/edu_in"; os.makedirs(indir, exist_ok=True)
    mp3 = next((f for f in files if f["name"].lower().endswith(".mp3")), None)
    if not mp3: raise RuntimeError("No .mp3 voiceover found in the folder")
    mp3_bytes = drive_download(mp3["id"])
    # download photos: 01 = title/scene 1, then 02..n+1 = the content scenes (one image per line, no repeats).
    # Ending cards are built-in (not from the folder).
    n = len(edu["scenes"])
    for k in range(1, n + 2):
        f = photo_for(files, k)
        if not f: raise RuntimeError("Photo %02d is missing from the folder — this video needs %d photos (01..%02d)." % (k, n + 1, n + 1))
        ext = "png" if f["name"].lower().endswith("png") else "jpg"
        open(os.path.join(indir, "%02d.%s" % (k, ext)), "wb").write(drive_download(f["id"]))
    words = transcribe(mp3_bytes, akey)
    lines = scene_lines(edu); timing = align(words, lines)
    total = bake_all(indir, edu, "/tmp/edu_scenes")
    audio_url = rl_upload_bytes(mp3_bytes, "audio/mpeg", rkey)
    urls = [rl_upload(os.path.join("/tmp/edu_scenes", "frame_%02d.png" % i), "image/png", rkey) for i in range(total)]
    recipe = build_recipe(urls, audio_url, timing)
    job = json.loads(http("https://renderly.video/api/v1/renders", "POST",
        {"Authorization": "Bearer "+rkey, "content-type": "application/json"}, json.dumps(recipe).encode()))["data"]["jobId"]
    # auto-save the subtitles into the same Drive folder, named after the video title (.srt is small)
    st = srt_text(timing, lines)
    safe = (re.sub(r"[^A-Za-z0-9 _-]", "", edu.get("videoTitle") or "subtitles").strip()[:80]) or "subtitles"
    try: drive_upload(folder_id, safe + ".srt", "text/plain", st.encode("utf-8"))
    except Exception: pass
    return {"jobId": job, "srt": "data:text/plain;base64," + base64.b64encode(st.encode()).decode(), "title": safe}
def rl_upload_bytes(data, ct, key):
    d = json.loads(http("https://renderly.video/api/v1/uploads", "POST",
        {"Authorization": "Bearer "+key, "content-type": "application/json"},
        json.dumps({"contentType": ct}).encode()))["data"]
    http(d["uploadUrl"], "PUT", {"Content-Type": ct}, data); return d["fileUrl"]
def status(job):
    rkey = os.environ["RENDERLY_KEY"]
    d = json.loads(http("https://renderly.video/api/v1/renders/" + job, "GET", {"Authorization": "Bearer "+rkey}))["data"]
    if d["status"] == "COMPLETED": return {"done": True, "videoUrl": d["outputUrl"]}
    if d["status"] in ("FAILED", "ERROR"): return {"error": d.get("errorMessage") or "render failed"}
    return {"step": "Rendering the video…"}

def preview(folder_id, handle):
    # Show each scene's LINE next to the PHOTO that will be used — so she can check before rendering.
    edu = json.loads(http((REPO_RAW % handle) + "?_=" + str(int(time.time()))))  # cache-buster: always read the LATEST saved script (raw.githubusercontent is CDN-cached)
    files = drive_list(folder_id)
    byname = {f["name"]: f for f in files}
    n = len(edu["scenes"])
    _cb = int(time.time())
    def thumb(k):
        f = photo_for(files, k)
        return ("https://drive.google.com/thumbnail?id=%s&sz=w800&_=%d" % (f["id"], _cb)) if f else ""
    # kind per scene tells the preview how it will be shown: photos/products/title = cover-cropped to 16:9 (show a red crop box);
    # infographics = contained whole (no crop box).
    from io import BytesIO
    def white_scene(k):
        # peek the small Drive thumbnail to see if this photo sits on a white background (blog infographic)
        try:
            f = photo_for(files, k)
            if not f: return False
            return is_white_bg(Image.open(BytesIO(http("https://drive.google.com/thumbnail?id=%s&sz=w400" % f["id"]))))
        except Exception:
            return False
    rows = [{"label": "Title (scene 1) — photo 01", "text": clean(edu["videoTitle"]), "img": thumb(1), "kind": "title"}]
    for i in range(1, n + 1):
        _pk = (edu["scenes"][i-1].get("kind") or "photo")
        if _pk == "photo" and white_scene(i + 1): _pk = "infographic"  # white-bg -> shown whole, no crop box
        rows.append({"label": "Scene %d — photo %02d" % (i + 1, i + 1), "text": clean(edu["scenes"][i-1]["text"]), "img": thumb(i + 1), "kind": _pk})
    for i, o in enumerate(edu["outro"], 1):
        rows.append({"label": "Ending card %d" % i, "text": clean(o), "img": "", "fixed": True, "kind": "card"})
    missing = [k for k in range(1, n + 2) if not thumb(k)]
    # warn if two photo files share the same leading number (e.g. an old one not deleted) — photo_for would pick one at random
    dcount = {}
    for f in files:
        low = f["name"].lower()
        if not (low.endswith(".png") or low.endswith(".jpg") or low.endswith(".jpeg") or low.endswith(".webp")): continue
        m = re.match(r"0*(\d+)", f["name"])
        if m: dcount[int(m.group(1))] = dcount.get(int(m.group(1)), 0) + 1
    dupes = sorted([k for k, v in dcount.items() if v > 1])
    return {"ok": True, "rows": rows, "missing": missing, "dupes": dupes, "photoCount": len([f for f in files if f["name"].lower().endswith((".png",".jpg",".jpeg",".webp"))]), "needed": n + 1}

# ---------- thumbnail ----------
def bake_title(img01_path, video_title):
    # exactly the video's title card (frame_00): cover-fill the 01 image + black title bar + LEMON title + logo.
    b = cover(openimg(img01_path)); d = ImageDraw.Draw(b); barh = 240
    d.rectangle([0, H-barh, W, H], fill=(0, 0, 0)); f = F(LEMON, 66)
    L = wrap(d, clean(video_title).upper(), f, W-300); asc, desc = f.getmetrics(); lh = int((asc+desc)*1.05)
    ty = H-barh//2-(len(L)*lh)//2
    for ln in L: d.text((W//2, ty), ln, font=f, fill="white", anchor="ma"); ty += lh
    add_logo(b); return b
def _title_source_image(files, indir, edu):
    # Pick the image to bake the title card on — robust so the thumbnail is NEVER black:
    #   1) photo 01  ->  2) the lowest-numbered image  ->  3) any image in the folder
    #   4) the saved script's featured / first reuse image (downloaded from its URL)
    IMG = (".png", ".jpg", ".jpeg", ".webp")
    f = photo_for(files, 1)
    if not f:
        imgs = [x for x in files if (x.get("name") or "").lower().endswith(IMG)]
        def numkey(x):
            m = re.match(r"0*(\d+)", x["name"]); return int(m.group(1)) if m else 10 ** 9
        imgs.sort(key=numkey)
        f = imgs[0] if imgs else None
    if f:
        low = f["name"].lower(); ext = "png" if low.endswith("png") else ("webp" if low.endswith("webp") else "jpg")
        p = os.path.join(indir, "src." + ext); open(p, "wb").write(drive_download(f["id"]))
        return p
    # fallback: the featured / first reuse image from the saved script
    url = ((edu.get("featured") or {}).get("url")) or edu.get("featuredImage") or ""
    if not url:
        for im in (edu.get("reuseImages") or []):
            if im and im.get("url"): url = im["url"]; break
    if url:
        p = os.path.join(indir, "src.img"); open(p, "wb").write(http(url))
        return p
    return None
def make_thumbnail(folder_id, handle):
    # Rebuild the title card and save it into the video's Drive folder as thumbnail.png, so the
    # Metricool file can use a clean branded frame (never the black first frame). Falls back through
    # 01 -> lowest-numbered -> any image -> the saved featured image, so it never comes out black.
    edu = json.loads(http((REPO_RAW % handle) + "?_=" + str(int(time.time()))))
    files = drive_list(folder_id)
    indir = "/tmp/edu_thumb"; os.makedirs(indir, exist_ok=True)
    p = _title_source_image(files, indir, edu)
    if not p: raise RuntimeError("No image found to build the thumbnail (no folder image and no featured image).")
    img = bake_title(p, edu.get("videoTitle") or handle)
    buf = io.BytesIO(); img.save(buf, "PNG"); data = buf.getvalue()
    up = drive_upload(folder_id, "thumbnail.png", "image/png", data)
    if not up.get("ok"): raise RuntimeError("Could not save the thumbnail to Drive: " + str(up.get("error")))
    return {"ok": True, "thumbUrl": "https://drive.google.com/uc?export=download&id=" + up["id"], "fileId": up["id"]}

class handler(BaseHTTPRequestHandler):
    def _send(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self): self._send({}, 200)
    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            b = json.loads(self.rfile.read(n) or b"{}")
            a = b.get("action")
            if a == "edu-make-video":
                self._send(make_video(b.get("folderId", ""), b.get("handle", "")))
            elif a == "edu-preview":
                self._send(preview(b.get("folderId", ""), b.get("handle", "")))
            elif a == "edu-video-status":
                self._send(status(b.get("jobId", "")))
            elif a == "edu-thumbnail":
                self._send(make_thumbnail(b.get("folderId", ""), b.get("handle", "")))
            else:
                self._send({"error": "unknown action"}, 400)
        except Exception as e:
            self._send({"error": str(e)}, 200)
