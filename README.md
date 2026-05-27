# Painting AR — WebAR Template

Scan a printed image with your phone camera and display AR content anchored on top of it. No app download required — runs in the mobile browser.

This repo is a minimal starter: one HTML file, one image target (Rachel Ruysch still life), and the 8th Wall engine.

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

The camera does **not** work inside the embedded preview iframe. Open the preview URL **on your phone**:

1. Copy the preview URL from Firebase Studio (`https://xxxx.idx.dev`)
2. Open it in Safari (iOS) or Chrome (Android)
3. Allow camera access when prompted
4. Point at the printed painting — you should see a red rotating cube

## Print the image target

Print [`assets/Targets/painting.png`](assets/Targets/painting.png) on paper (at least 10 cm wide, flat and well-lit).

## Project structure

```
├── index.html                    AR experience (edit this)
├── engine/                       8th Wall XR engine (do not modify)
├── assets/Targets/painting.png   Image target to print
└── README.md
```

## Add AR content

Edit the `<xrextras-named-image-target name="painting">` section in [`index.html`](index.html). Everything inside is positioned relative to the detected image:

- **Origin (0, 0, 0)** — center of the image
- **Y axis** — up (away from the surface)
- **X axis** — left/right
- **Z axis** — toward/away from you

See the [A-Frame documentation](https://aframe.io/docs/) for shapes, models, video, text, and animations.

## Troubleshooting

- **Camera not working** — page must be HTTPS (Firebase Studio provides this automatically)
- **Image not detected** — print clearly, avoid glare, check `width`/`height` in `index.html` match your image file
- **Debug on phone** — add before `</body>`:
  ```html
  <script src="https://cdn.jsdelivr.net/npm/eruda"></script>
  <script>eruda.init()</script>
  ```

## License

- **XR Engine** (`engine/`) — [Niantic Spatial XR Engine License](engine/LICENSE)
- **8frame / A-Frame** — MIT License
