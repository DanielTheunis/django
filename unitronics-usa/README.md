# Unitronics USA — website (unitronics-usa.com)

A static, dark, interactive 3D website. There's no build step and nothing to install.

## Pages
| File | Page | 3D scene |
|---|---|---|
| `index.html` | Home | Processor on a PCB with live data pulses (plus a signage totem) |
| `solutions.html` | Solutions | Controller/server rack with live status LEDs |
| `about.html` | About | Glass orb with an energy core and chrome rings (plus a network globe) |
| `signage.html` | Digital signage | Signage totem playing live content → links to unitronicsdigitalmedia.co.za |
| `contact.html` | Contact | Connected network globe, contact cards, and a form that opens the visitor's email app |

## Interaction
- Drag any model to rotate it. On phones, swipe sideways. Vertical swipes still scroll the page.
- Click or tap a model to send an energy pulse.
- On desktop, the models tilt to follow the mouse. In the hero, they drift and turn as the page scrolls.
- Pages load near-instantly: the Speculation Rules API prerenders them, with hover prefetch as a fallback, and view transitions animate the page change.

## Performance
- The models are built in code (three.js r160 from jsDelivr), so there are no large 3D files to download.
- Physically based materials, studio lighting and soft shadows (no glow or bloom). One shared WebGL renderer draws every model on the page.
- A scene only renders while it's on screen. Phones get a lower pixel ratio and fewer particles.
- If the device has no WebGL2, the page still works; only the 3D scenes are skipped.
- Honors `prefers-reduced-motion`.

## Contact details used
- Elcardo: 082 725 6786 (`tel:+27827256786`, WhatsApp button)
- Office: 021 330 5847
- elcardo@unitronics-sa.co.za

## Deploy
Upload the contents of this folder to the web root for unitronics-usa.com. Any static host works, such as cPanel, Netlify, Vercel or Cloudflare Pages. To preview it locally:

    cd unitronics-usa && python3 -m http.server 8000
