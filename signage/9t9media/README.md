# 9T9 Media digital signage

A full-screen signage page for 9T9 Media. Open `index.html` in a browser (kiosk
mode works well: `chromium --kiosk signage/9t9media/index.html`).

- Animated logo: it slams in on load, floats, glows and gets a light sweep and
  shake on every slide change, with ember particles around it.
- Rotating headline slides. Edit the `<article class="slide">` blocks in
  `index.html`; the timing is `SLIDE_MS`.
- A QR code that links to https://9t9media.co.za. It is inline SVG, so it
  works offline.
- A bottom ticker (`TICKER` in the script) and a clock on South Africa time.
- Works on landscape and portrait screens. The page reloads itself every hour
  to pick up changes.
