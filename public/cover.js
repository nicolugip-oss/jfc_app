// Titelbilder für Challenges im Stil des JFC-Logos:
// schwarz/weiss, Swoosh-Formen aus dem Logo, Schrift invertiert sich dort, wo sie den Swoosh kreuzt.
const W = 1600;
const H = 900;
const STRETCH = 1.16; // Schrift breiter ziehen – wie "Archivo Expanded" im Logo

let logoPromise = null;
function loadLogo() {
  logoPromise ||= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = 'logo-96.png';
  });
  return logoPromise;
}

function hash(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function random(seed) {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

// Die zwei Swoosh-Formen aus dem Logo (Koordinaten im 1080er-Quadrat)
function swooshPath(g) {
  g.beginPath();
  g.moveTo(0, 390);
  g.quadraticCurveTo(440, 170, 880, 35);
  g.quadraticCurveTo(480, 190, 0, 455);
  g.closePath();
  g.moveTo(1080, 150);
  g.bezierCurveTo(820, 280, 420, 560, 140, 945);
  g.bezierCurveTo(380, 760, 760, 660, 1080, 630);
  g.closePath();
}

function wrapLines(g, words, size, maxWidth) {
  g.font = `italic 900 ${size}px Archivo, "Arial Black", Arial, sans-serif`;
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? (line.endsWith('-') ? line + w : `${line} ${w}`) : w;
    if (g.measureText(test).width * STRETCH <= maxWidth || !line) line = test;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  const widest = Math.max(...lines.map((l) => g.measureText(l).width * STRETCH));
  return { lines, fits: widest <= maxWidth };
}

/** Zeichnet ein Titelbild (1600×900) und gibt das Canvas zurück. variant: 0, 1, 2 … für Abwechslung. */
export async function renderCover(title, variant = 0) {
  const text = String(title || 'Challenge').trim().toUpperCase() || 'CHALLENGE';
  const r = random(hash(`${text}#${variant}`));
  try { await document.fonts.load('italic 900 100px Archivo'); } catch {}
  const logo = await loadLogo();

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const light = r() < 0.3; // ab und zu weisser Hintergrund mit schwarzem Swoosh
  const bg = light ? '#fff' : '#000';
  const fg = light ? '#000' : '#fff';
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // Swoosh – Grösse, Lage, Drehung und Spiegelung je nach Variante
  g.save();
  const scale = (W / 1080) * (0.95 + r() * 0.45);
  g.translate(W / 2, H / 2);
  g.rotate((r() - 0.5) * 0.5);
  if (r() < 0.5) g.scale(-1, 1);
  g.translate(-540 * scale + (r() - 0.5) * 300, -540 * scale + (r() - 0.3) * 180);
  g.scale(scale, scale);
  g.fillStyle = fg;
  swooshPath(g);
  g.fill('evenodd');
  g.restore();

  // Schrift: weiss mit "difference" → invertiert sich auf dem Swoosh wie im Logo
  g.save();
  g.globalCompositeOperation = 'difference';
  g.fillStyle = '#fff';
  g.font = '700 30px Archivo, Arial, sans-serif';
  g.fillText('JESUS FIRST CAMP  ·  CHALLENGE', 100, 112);

  const words = text.replace(/-/g, '- ').split(/\s+/).filter(Boolean);
  const maxWidth = W - 200;
  let size = 220;
  let layout = wrapLines(g, words, size, maxWidth);
  while ((layout.lines.length > 3 || !layout.fits) && size > 64) {
    size -= 6;
    layout = wrapLines(g, words, size, maxWidth);
  }
  const lh = size * 0.94;
  const blockH = lh * (layout.lines.length - 1) + size * 0.74;
  let y = H / 2 + 40 - blockH / 2 + size * 0.74;
  g.scale(STRETCH, 1);
  for (const line of layout.lines) {
    g.fillText(line, 100 / STRETCH, y);
    y += lh;
  }
  g.restore();

  if (logo) {
    g.save();
    g.beginPath();
    g.roundRect?.(W - 196, H - 196, 108, 108, 22);
    g.clip();
    g.drawImage(logo, W - 196, H - 196, 108, 108);
    g.restore();
  }
  return c;
}

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

/** Titelbild + Vorschaubild als JPEG-Dateien (für den Upload). */
export async function coverFiles(title, variant = 0) {
  const c = await renderCover(title, variant);
  const t = document.createElement('canvas');
  t.width = 480;
  t.height = 270;
  t.getContext('2d').drawImage(c, 0, 0, 480, 270);
  const name = String(title || 'challenge').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'challenge';
  return {
    image: new File([await toBlob(c, 0.88)], `${name}.jpg`, { type: 'image/jpeg' }),
    thumb: new File([await toBlob(t, 0.8)], `${name}-klein.jpg`, { type: 'image/jpeg' }),
    canvas: c,
  };
}
