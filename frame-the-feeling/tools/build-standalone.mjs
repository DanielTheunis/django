// Builds dist/frame-the-feeling.html: the whole site in one file, with Three.js,
// scripts, styles and images inlined, so it also works when opened straight
// from disk (file://), where browsers refuse to load ES modules and textures.
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

const workDir = path.join(root, 'assets/work');
const assets = [
  'assets/wordmark-white.png',
  'assets/logo-white.png',
  'assets/wallpaper.webp',
  'assets/favicon.png',
  ...(await fs.readdir(workDir)).map((f) => `assets/work/${f}`),
];
const uris = {};
for (const a of assets) {
  const data = await fs.readFile(path.join(root, a));
  uris[a] = `data:${mime[path.extname(a)]};base64,${data.toString('base64')}`;
}
const inline = (text, prefix = '') => assets.reduce((t, a) => t.split(prefix + a).join(uris[a]), text);

const bundle = await build({
  entryPoints: [path.join(root, 'js/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  legalComments: 'none',
  write: false,
});
const script = inline(bundle.outputFiles[0].text).replace(/<\/script/gi, '<\\/script');
const css = inline(await fs.readFile(path.join(root, 'css/site.css'), 'utf8'), '../');

let html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
html = html
  .replace(/<script type="importmap">[\s\S]*?<\/script>\n/, () => '')
  .replace(/<link rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net" crossorigin>\n/, () => '')
  .replace('<link rel="stylesheet" href="css/site.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="js/main.js"></script>', () => `<script>\n${script}\n</script>`);
html = html.replace(/ *\/\/ opened straight from disk[^\n]*\n *if \(location\.protocol === 'file:'\)[^\n]*\n/, () => '');
html = inline(html);

await fs.mkdir(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist/frame-the-feeling.html');
await fs.writeFile(out, html);
console.log(`wrote ${path.relative(root, out)} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
