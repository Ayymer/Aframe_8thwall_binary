# Painting AR — WebAR Template

Scan a printed image with your phone camera and display AR content anchored on top of it. No app download required — runs in the mobile browser.

This repo is a minimal starter: one HTML file, one image target (Rachel Ruysch still life), and the 8th Wall engine. AR animation/content is added later inside `index.html`.

## How it works

1. Open the page over **HTTPS** on your phone
2. Allow camera access when prompted
3. Point the camera at the printed painting image
4. AR content inside `<xrextras-named-image-target>` appears on the image

## Workflow: Cursor → GitHub → Firebase Studio

1. **Edit code** here in Cursor (`index.html`, assets, etc.)
2. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "Describe your change"
   git push
   ```
3. **In Firebase Studio** — pull latest (Source Control panel → Pull), or re-import the repo once
4. **Test on phone** — open the Firebase preview URL (`https://xxxx.idx.dev`) in Safari/Chrome

---

## Quick start (Firebase Studio)

[Firebase Studio](https://idx.google.com/) gives you an **HTTPS preview URL** for testing on your phone.

### First-time setup

1. Push this repo to GitHub (see workflow above)
2. Open [idx.google.com](https://idx.google.com/) → **Import a repo**
3. Paste `https://github.com/Ayymer/Aframe_8thwall_binary`
4. Wait 1–2 minutes for the workspace to load

The project includes [`.idx/dev.nix`](.idx/dev.nix), which starts a static file server for the web preview.

### Open the web preview

1. Click the **Web** preview panel (bottom toolbar), or press `Cmd+Shift+P` → **Firebase Studio: Show Web Preview**
2. The preview loads `index.html` from the project root

The project includes [`.idx/dev.nix`](.idx/dev.nix), which starts a static file server automatically when you open the web preview.

### Test on your phone

**Important:** The camera does not work inside the embedded preview iframe. You must open the preview URL **on your phone**:

1. In the preview panel, click **open in new tab** (or copy the preview URL — `https://xxxx.idx.dev`)
2. Open that URL in Safari (iOS) or Chrome (Android)
3. Allow camera access when prompted
4. Point at the printed painting — you should see the red rotating cube

### Edit and refresh

- Edit [`index.html`](index.html) in Firebase Studio
- Save (`Cmd+S`) and refresh the page on your phone to see changes

---

## Alternative: local HTTPS server

If you prefer testing locally, run:

```bash
python3 serve.py
```

Then open `https://<your-computer-ip>:5501/` on your phone (same Wi‑Fi required). See [`qr.html`](qr.html) for a scannable QR code. This requires accepting a self-signed certificate.

---

## Print the image target

Print [`assets/Targets/painting.png`](assets/Targets/painting.png) on paper (at least 10 cm wide, flat and well-lit).

## Test checklist

1. Open the page over **HTTPS** on your phone (Firebase Studio preview URL or local server)
2. Allow camera access when prompted
3. Point the camera at the printed painting image
4. A red rotating cube should appear anchored on the image

## Project structure

```
├── index.html                          AR experience (edit this)
├── engine/                             8th Wall XR engine (do not modify)
├── assets/Targets/painting.png           Image target to print
└── README.md
```

## Add AR content

Edit the `<xrextras-named-image-target name="painting">` section in [`index.html`](index.html). Everything inside is positioned relative to the detected image:

- **Origin (0, 0, 0)** — center of the image
- **Y axis** — up (away from the surface)
- **X axis** — left/right
- **Z axis** — toward/away from you

Example — a floating cube:

```html
<xrextras-named-image-target name="painting">
  <a-box color="red" position="0 0.5 0" scale="0.3 0.3 0.3"
         animation="property: rotation; to: 0 360 0; loop: true; dur: 4000"></a-box>
</xrextras-named-image-target>
```

See the [A-Frame documentation](https://aframe.io/docs/) for shapes, models, video, text, and animations.

## Deploy to GitHub Pages

1. Push your repo to GitHub
2. **Settings → Pages → Deploy from branch → main → / (root)**
3. Open `https://<username>.github.io/<repo-name>/` on your phone

## Troubleshooting

- **Camera not working** — page must be HTTPS, not HTTP
- **Image not detected** — print clearly, avoid glare, check `width`/`height` match your file
- **Debug on phone** — add before `</body>`:
  ```html
  <script src="https://cdn.jsdelivr.net/npm/eruda"></script>
  <script>eruda.init()</script>
  ```

## License

- **XR Engine** (`engine/`) — [Niantic Spatial XR Engine License](engine/LICENSE)
- **8frame / A-Frame** — MIT License
