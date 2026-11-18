// Baut die Demo-Version für GitHub Pages nach ./_site
// Der Server-Code wird mit esbuild für den Browser gebündelt (Ersatzmodule in demo/shims).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, '_site');
const shim = (name) => path.join(root, 'demo', 'shims', name);
const SHIMS = {
  'node:sqlite': shim('sqlite.js'),
  'node:fs': shim('fs.js'),
  'node:path': shim('path.js'),
  'node:crypto': shim('crypto.js'),
  express: shim('express.js'),
  multer: shim('multer.js'),
  nodemailer: shim('nodemailer.js'),
};

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), out, { recursive: true });
for (const f of ['sql-wasm.js', 'sql-wasm.wasm']) {
  fs.copyFileSync(path.join(root, 'node_modules', 'sql.js', 'dist', f), path.join(out, f));
}

await build({
  entryPoints: [path.join(root, 'demo', 'main.js')],
  outfile: path.join(out, 'demo.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020', 'safari15'],
  minify: true,
  legalComments: 'none',
  define: { 'process.env': 'globalThis.__DEMO_ENV' },
  plugins: [{
    name: 'demo-shims',
    setup(b) {
      b.onResolve({ filter: /^(node:(sqlite|fs|path|crypto)|express|multer|nodemailer)$/ }, (args) => ({ path: SHIMS[args.path] }));
    },
  }],
  logLevel: 'warning',
});

// Demo-Modus einschalten (statt Socket.IO-Client vom Server)
const indexFile = path.join(out, 'index.html');
const html = fs.readFileSync(indexFile, 'utf8');
if (!html.includes('<script src="socket.io/socket.io.js"></script>')) throw new Error('index.html: Socket.IO-Zeile nicht gefunden');
fs.writeFileSync(indexFile, html.replace('<script src="socket.io/socket.io.js"></script>', '<script>window.JFC_DEMO = true;</script>'));

// Service-Worker-Version, damit Updates sicher ankommen
const version = (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 10);
const swFile = path.join(out, 'sw.js');
fs.writeFileSync(swFile, fs.readFileSync(swFile, 'utf8').replace('__VERSION__', version));
fs.writeFileSync(path.join(out, '.nojekyll'), '');

const size = (f) => `${Math.round(fs.statSync(path.join(out, f)).size / 1024)} KB`;
console.log(`Demo gebaut → ${out}  (demo.js ${size('demo.js')}, sql-wasm.wasm ${size('sql-wasm.wasm')}, Version ${version})`);
