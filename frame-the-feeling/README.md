# Frame the Feeling — website

A one-page site for Frame the Feeling Photography. A 3D camera, built in
Three.js from scratch, sits in the middle of a watercolour ocean. It takes
itself apart and snaps a photo when the page loads, comes apart as you scroll
down, goes back together as you scroll up, and takes the last frame on the
roll before the booking form. When it faces you, the studio's wordmark rises
in the lens.

## Open it

**Quickest:** double-click `dist/frame-the-feeling.html` (opening `index.html` from disk now forwards there automatically). Everything
(Three.js, images, styles) is inside that one file, so it works straight from
disk. It needs an internet connection only for the Google fonts.

**The normal site** (`index.html`) uses ES modules and loads Three.js from a
CDN, which browsers block on `file://` URLs. Serve the folder instead:

```bash
cd frame-the-feeling
npm run serve          # or: python3 -m http.server 8080
# then open http://localhost:8080
```

To host it, upload the folder (without `node_modules`) to any static host:
Netlify, Vercel, GitHub Pages, Cloudflare Pages.

## Before going live

- **Booking email and Instagram**: set `CONFIG` at the top of `js/main.js`.
  The form has no server behind it. It prepares the request and opens the
  visitor's email app, with a copy button as a fallback. To receive
  submissions directly, point the form at a form service such as Formspree.
- **Portfolio**: the "Work" contact sheet uses crops of the brand watercolour
  in `assets/work/`. Swap in real photos with the same file names (3:2 works
  best) and update the captions and `alt` text in `index.html`.
- After changing anything, run `npm install` once and then `npm run build`
  to refresh `dist/frame-the-feeling.html`.

## How it's put together

| File | What it does |
| --- | --- |
| `index.html` | Page content and structure |
| `css/site.css` | Colours, type and layout for desktop, tablet and phone |
| `js/main.js` | Scroll story, intro, shutter, viewfinder readouts, booking form |
| `js/camera-model.js` | The camera: body, grip, dials, sensor, board, battery, 9-blade iris and lens elements, each with its own exploded position |
| `js/textures.js` | Leatherette, ribbed rubber, lens printing, dial faces, circuit board and rear screen, all drawn in code |
| `js/ocean.js` | Watercolour water, light shafts, caustics, bubbles and marine snow |
| `tools/build-standalone.mjs` | Builds the single-file version in `dist/` |

The camera's pose is a pure function of scroll position (see `KEYS` in
`js/main.js`), which is why scrolling back up always reassembles it. Phones
get their own keyframes that stand the exploded camera upright so it fits a
tall screen.

## Performance and accessibility

- Renders at up to 2× pixel density (sharp on 4K and Retina screens) and
  lowers the resolution automatically if frames start dropping.
- The water is rendered at reduced resolution and upscaled, since it is soft
  anyway.
- `prefers-reduced-motion` skips the intro, softens the flash and stops
  ambient drift.
- Without WebGL the page still works, with a static logo in place of the
  camera.
- Sound is off by default. The speaker button turns on a synthesised shutter
  click.
