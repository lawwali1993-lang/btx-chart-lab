// Copies bundled data into www/data and writes the manifest. Used by the Android build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'data'), dst = path.join(root, 'www', 'data');
fs.mkdirSync(dst, { recursive: true });
const manifest = [];
for (const f of fs.existsSync(src) ? fs.readdirSync(src) : []) {
  if (!f.endsWith('.btxd')) continue;
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
  const name = f.split('_')[0];
  const sumF = path.join(src, f.replace('.btxd', '.json'));
  const sum = fs.existsSync(sumF) ? JSON.parse(fs.readFileSync(sumF, 'utf8')) : {};
  manifest.push({ name, file: 'data/' + f, count: sum.count, from: sum.from, to: sum.to, description: sum.description, bytes: fs.statSync(path.join(src, f)).size });
}
fs.writeFileSync(path.join(dst, 'manifest.json'), JSON.stringify(manifest, null, 1));
const build = process.env.BUILD_ID || new Date().toISOString();
fs.writeFileSync(path.join(root, 'www', 'js', 'build.js'), `window.BTX_BUILD = ${JSON.stringify(build)};\n`);
console.log('web build ready', manifest);
