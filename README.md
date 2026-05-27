# Painting AR — WebAR Template

Scan a printed image with your phone camera and display AR content anchored on top of it. No app download required — runs in the mobile browser.

This repo is a WebAR experience built on the Rachel Ruysch still life: flowers **emerge, bloom, wilt**, then fade back to the printed painting (*nature morte*) in a 30-second loop.

## Project structure

```
├── index.html                      AR scene + image target config
├── js/painting-resurrection.js     Grow / bloom / wilt animation loop
├── assets/
│   ├── Targets/painting.png        Image target to print
│   ├── layers/*.png                Feathered flower + insect cutouts
│   └── meta/layers.json            Positions, timing, sway (tweak here)
├── scripts/extract_layers.py       Re-export layers after mask edits
└── engine/                         8th Wall XR engine (do not modify)
```

## Resurrection loop (30 s)

| Phase | Duration | What you see |
|---|---|---|
| Still | 3 s | No overlay — only the printed painting |
| Emerge | 9 s | Flowers grow from stems (bottom → top) |
| Bloom | 8 s | Gentle sway, warm light pulse, butterfly appears |
| Wilt | 10 s | Desaturate, droop, falling petals, fade to print |

**Tweak timing without code:** edit [`assets/meta/layers.json`](assets/meta/layers.json) — `phases`, `emergeDelayMs`, `wiltDelayMs`, `swayFreq`, `swayAmp` per layer.

### Re-export layers after mask changes

```bash
python3 -m venv .venv          # first time only
.venv/bin/pip install Pillow   # first time only
.venv/bin/python scripts/extract_layers.py
```

Edit polygon coordinates in [`scripts/extract_layers.py`](scripts/extract_layers.py), then re-run.

### Align layers on phone

If a cutout sits off the painting:

1. Note the layer `id` (e.g. `rose-pink`).
2. In `layers.json`, nudge `centerPx` by ±5–15 px (x = left/right, y = up/down in image space).
3. Reload on phone — no script re-run needed for position-only tweaks.

For bad edges, adjust that layer’s polygon in `extract_layers.py` and re-export.

### Local HTTPS test (camera required)

```bash
npx --yes http-server -S -C cert.pem -K key.pem -p 8080
```

Open `https://<your-lan-ip>:8080` on your phone (same Wi‑Fi). Accept the self-signed cert warning once.

## Workflow: Cursor → GitHub → Firebase Studio

1. **Edit code** in Cursor (`index.html`, assets, etc.)
2. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "Describe your change"
   git push
   ```
3. **In Firebase Studio** — Source Control panel → **Pull**
4. **Test on phone** — open the Firebase preview URL (`https://xxxx.idx.dev`) in Safari/Chrome

## First-time Firebase Studio setup

1. Open [idx.google.com](https://idx.google.com/) → **Import a repo**
2. Paste `https://github.com/Ayymer/Aframe_8thwall_binary`
3. Wait 1–2 minutes for the workspace to load
4. Open the **Web preview** panel — it serves `index.html` via [`.idx/dev.nix`](.idx/dev.nix)

## Test on your phone

The preview URL is **private by default**. Opening it on your phone without setup causes a `401 Workstation does not exist` error.

### Option A: Public preview in Firebase Studio (quickest)

1. In Firebase Studio, open the **Web preview** panel
2. In the preview toolbar, click **Share Preview Link** (next to the address bar)
3. Enable **Make preview public**
4. Click **Copy preview URL** or scan the **QR code** shown there
5. Open that link on your phone in Safari/Chrome
6. Allow camera access → scan the printed painting

> The workspace must stay **open and running** in Firebase Studio while you test. Public preview turns off when you close the workspace or disable it.

**If you still get 401 on phone:** sign into the **same Google account** on your phone browser that owns the Firebase Studio workspace, or use Option B below.

### Option B: GitHub Pages (recommended for AR — always public)

1. On GitHub: **Settings → Pages → Deploy from branch → `main` → / (root) → Save**
2. Wait ~2 minutes, then open `https://ayymer.github.io/Aframe_8thwall_binary/` on your phone
3. No Firebase session needed — works anytime after you push

Push from Cursor → wait for Pages to rebuild → test on phone.

## Print the image target

Print [`assets/Targets/painting.png`](assets/Targets/painting.png) on paper (at least 10 cm wide, flat and well-lit).

## Troubleshooting

- **Pull fails with "divergent branches"** — Firebase Studio still has old history from before a force push. In the Firebase Studio **terminal**, run:
  ```bash
  git fetch origin && git reset --hard origin/main
  ```
  This replaces the local copy with GitHub. Safe if you haven't made uncommitted edits in Firebase Studio.

- **401 on phone / "Workstation does not exist"** — preview is not public. Use **Share Preview Link → Make preview public** in Firebase Studio, or deploy via **GitHub Pages** (see above)
- **Camera not working** — page must be HTTPS; don't use the embedded preview iframe on desktop for camera tests
- **Image not detected** — print clearly, avoid glare, check `width`/`height` in `index.html` match your image file
- **Debug on phone** — add before `</body>`:
  ```html
  <script src="https://cdn.jsdelivr.net/npm/eruda"></script>
  <script>eruda.init()</script>
  ```

## License

- **XR Engine** (`engine/`) — [Niantic Spatial XR Engine License](engine/LICENSE)
- **8frame / A-Frame** — MIT License
