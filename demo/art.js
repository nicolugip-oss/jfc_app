// Generierte Beispielbilder für die Demo – schwarz/weiss im Stil des JFC-Logos
// (keine echten Fotos: einfache Illustrationen passend zur Challenge bzw. zum Camp-Moment)
const W = 1200;
const H = 900;

function random(seed) {
  let s = (Math.imul(seed + 1, 2654435761) >>> 0) || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

// Swoosh-Formen aus dem Logo (1080er-Koordinaten), skaliert/platziert
function swoosh(g, x, y, size, { flip = false, rotate = 0 } = {}) {
  g.save();
  g.translate(x, y);
  g.rotate(rotate);
  g.scale((flip ? -1 : 1) * size / 1080, size / 1080);
  g.translate(-540, -540);
  g.beginPath();
  g.moveTo(0, 390); g.quadraticCurveTo(440, 170, 880, 35); g.quadraticCurveTo(480, 190, 0, 455); g.closePath();
  g.moveTo(1080, 150); g.bezierCurveTo(820, 280, 420, 560, 140, 945); g.bezierCurveTo(380, 760, 760, 660, 1080, 630); g.closePath();
  g.fill();
  g.restore();
}

function grain(g, r, amount = 14000) {
  for (let i = 0; i < amount; i++) {
    const v = r() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${0.035 + r() * 0.05})`;
    g.fillRect(r() * W, r() * H, 1.6, 1.6);
  }
}

function vignette(g, strength = 0.55) {
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(0,0,0,${strength})`);
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}

function tag(g, text, color = '#fff') {
  g.save();
  g.fillStyle = color;
  g.font = 'italic 900 30px Archivo, Arial, sans-serif';
  g.textAlign = 'right';
  g.fillText(text, W - 40, H - 36);
  g.restore();
}

// Ganze Person (Piktogramm), Füsse bei (x, y), Höhe s
function person(g, x, y, s, pose = 'down') {
  g.beginPath();
  g.arc(x, y - 0.88 * s, 0.1 * s, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.roundRect(x - 0.15 * s, y - 0.75 * s, 0.3 * s, 0.38 * s, 0.08 * s);
  g.roundRect(x - 0.135 * s, y - 0.42 * s, 0.11 * s, 0.42 * s, 0.05 * s);
  g.roundRect(x + 0.025 * s, y - 0.42 * s, 0.11 * s, 0.42 * s, 0.05 * s);
  g.fill();
  const arm = (side, tx, ty) => {
    g.beginPath();
    g.moveTo(x + side * 0.12 * s, y - 0.7 * s);
    g.lineTo(x + side * tx * s, y - ty * s);
    g.stroke();
  };
  g.lineWidth = 0.085 * s;
  g.lineCap = 'round';
  const ends = { up: [0.3, 1.12], side: [0.38, 0.66], down: [0.2, 0.38] };
  const [lx, ly] = ends[pose === 'wave' ? 'down' : pose];
  const [rx, ry] = ends[pose === 'wave' ? 'up' : pose];
  arm(-1, lx, ly);
  arm(1, rx, ry);
}

// Kopf + Schultern (für Menschenmengen), Unterkante bei y, Breite w
function bust(g, x, y, w, armsUp = 0) {
  g.beginPath();
  g.arc(x, y - w * 0.98, w * 0.24, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(x, y - w * 0.12, w * 0.5, w * 0.62, 0, Math.PI, 0);
  g.lineTo(x + w * 0.5, y + 4);
  g.lineTo(x - w * 0.5, y + 4);
  g.fill();
  g.lineWidth = w * 0.17;
  g.lineCap = 'round';
  const raise = (side) => {
    g.beginPath();
    g.moveTo(x + side * w * 0.36, y - w * 0.5);
    g.lineTo(x + side * w * 0.6, y - w * 1.75);
    g.stroke();
    g.beginPath();
    g.arc(x + side * w * 0.62, y - w * 1.82, w * 0.13, 0, Math.PI * 2);
    g.fill();
  };
  if (armsUp >= 1) raise(1);
  if (armsUp >= 2) raise(-1);
}

function crowd(g, r, { y = H, rows = 2, size = 120, upChance = 0.45, fill = '#000', rim = 'rgba(255,255,255,.55)' } = {}) {
  for (let row = 0; row < rows; row++) {
    const w = size * (1 - row * 0.18);
    const baseY = y - row * w * 0.55;
    for (let x = -w * 0.3 + (row % 2) * w * 0.5 + r() * 30; x < W + w; x += w * (0.95 + r() * 0.3)) {
      const up = r() < upChance ? (r() < 0.5 ? 2 : 1) : 0;
      g.fillStyle = rim;
      g.strokeStyle = rim;
      bust(g, x, baseY + 3, w + 6, up);
      g.fillStyle = fill;
      g.strokeStyle = fill;
      bust(g, x, baseY + 6, w, up);
    }
  }
}

function beams(g, r, count = 4, top = 0) {
  for (let i = 0; i < count; i++) {
    const x = W * (0.1 + 0.8 * (i + r() * 0.5) / count);
    const spread = 160 + r() * 220;
    const tx = x + (r() - 0.5) * 500;
    const grad = g.createLinearGradient(x, top, tx, H);
    grad.addColorStop(0, 'rgba(255,255,255,.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x - 6, top);
    g.lineTo(x + 6, top);
    g.lineTo(tx + spread, H);
    g.lineTo(tx - spread, H);
    g.closePath();
    g.fill();
  }
}

function note(g, x, y, s) {
  g.beginPath();
  g.ellipse(x, y, s * 0.32, s * 0.22, -0.4, 0, Math.PI * 2);
  g.fill();
  g.fillRect(x + s * 0.24, y - s * 1.1, s * 0.09, s * 1.1);
  g.beginPath();
  g.moveTo(x + s * 0.3, y - s * 1.1);
  g.quadraticCurveTo(x + s * 0.75, y - s * 0.85, x + s * 0.62, y - s * 0.45);
  g.lineWidth = s * 0.09;
  g.stroke();
}

function differenceSwoosh(g, r) {
  g.save();
  g.globalCompositeOperation = 'difference';
  g.fillStyle = '#fff';
  swoosh(g, W * (0.45 + r() * 0.2), H * (0.5 + r() * 0.1), 1500 + r() * 400, { flip: r() < 0.5, rotate: (r() - 0.5) * 0.4 });
  g.restore();
}

// ---------- Szenen ----------
const SCENES = {
  // Menschenpyramide
  pyramid(g, r) {
    g.fillStyle = '#060606';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.08)';
    swoosh(g, W * 0.5, H * 0.45, 1500, { flip: r() < 0.5 });
    const floor = H * 0.87;
    g.fillStyle = '#e9e9e9';
    g.fillRect(0, floor, W, H - floor);
    const rows = r() < 0.5 ? [4, 3, 2, 1] : [3, 2, 1];
    const s = rows.length === 4 ? 205 : 245;
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    rows.forEach((n, k) => {
      const y = floor - k * s * 0.7;
      for (let i = 0; i < n; i++) {
        const x = W / 2 + (i - (n - 1) / 2) * s * 0.5;
        person(g, x, y, s, k === rows.length - 1 ? 'up' : k === 0 ? 'down' : 'side');
      }
    });
    differenceSwoosh(g, r);
  },

  // Selfie mit einem Leiter
  selfie(g, r) {
    g.fillStyle = '#efefef';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#000';
    swoosh(g, W * 0.55, H * 0.55, 1700, { flip: r() < 0.5, rotate: (r() - 0.5) * 0.3 });
    g.save();
    g.translate(W / 2 + (r() - 0.5) * 80, H / 2 + 20);
    g.rotate((r() - 0.5) * 0.2);
    g.fillStyle = '#111';
    g.beginPath();
    g.roundRect(-300, -390, 600, 800, 70);
    g.fill();
    g.save();
    g.beginPath();
    g.roundRect(-270, -360, 540, 740, 50);
    g.clip();
    const sky = g.createLinearGradient(0, -360, 0, 380);
    sky.addColorStop(0, '#9a9a9a');
    sky.addColorStop(1, '#2a2a2a');
    g.fillStyle = sky;
    g.fillRect(-270, -360, 540, 740);
    g.fillStyle = 'rgba(255,255,255,.12)';
    swoosh(g, 0, -60, 900, { flip: r() < 0.5 });
    // zwei Reihen Gesichter, die den Bildschirm füllen
    const smile = (x, headY, w) => {
      g.save();
      g.strokeStyle = '#2a2a2a';
      g.lineWidth = w * 0.04;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(x, headY + w * 0.02, w * 0.12, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
      g.fillStyle = '#2a2a2a';
      g.beginPath();
      g.arc(x - w * 0.08, headY - w * 0.06, w * 0.025, 0, Math.PI * 2);
      g.arc(x + w * 0.08, headY - w * 0.06, w * 0.025, 0, Math.PI * 2);
      g.fill();
      g.restore();
    };
    const row = (count, baseY, w, shade, wave) => {
      for (let i = 0; i < count; i++) {
        const x = -270 + ((i + 0.5) * 540) / count + (r() - 0.5) * 24;
        g.fillStyle = shade;
        g.strokeStyle = shade;
        bust(g, x, baseY, w, wave && i === count - 1 ? 1 : 0);
        g.fillRect(x - w * 0.5, baseY, w, 420 - baseY);
        smile(x, baseY - w * 0.98, w);
      }
    };
    row(3, 150, 190, '#cfcfcf', false);
    row(3 + Math.floor(r() * 2), 300, 230, '#fff', true);
    g.restore();
    g.fillStyle = '#111';
    g.beginPath();
    g.roundRect(-70, -378, 140, 22, 11);
    g.fill();
    g.restore();
    // Blitz
    g.fillStyle = '#fff';
    g.save();
    g.translate(W * 0.82, H * 0.17);
    for (let i = 0; i < 8; i++) {
      g.rotate(Math.PI / 4);
      g.beginPath();
      g.moveTo(0, -12); g.lineTo(90, 0); g.lineTo(0, 12);
      g.fill();
    }
    g.restore();
  },

  // Lobpreis-Flashmob
  flashmob(g, r) {
    g.fillStyle = '#040404';
    g.fillRect(0, 0, W, H);
    beams(g, r, 3);
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    for (let i = 0; i < 7; i++) note(g, 120 + r() * (W - 240), 120 + r() * 360, 40 + r() * 40);
    crowd(g, r, { rows: 2, size: 150, upChance: 0.6 });
    differenceSwoosh(g, r);
  },

  // Worship Night (ICF Youth)
  worship(g, r) {
    g.fillStyle = '#020202';
    g.fillRect(0, 0, W, H);
    const haze = g.createRadialGradient(W / 2, H * 0.35, 40, W / 2, H * 0.35, W * 0.7);
    haze.addColorStop(0, 'rgba(255,255,255,.35)');
    haze.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = haze;
    g.fillRect(0, 0, W, H);
    beams(g, r, 5);
    g.fillStyle = '#fff';
    g.fillRect(W * 0.28, H * 0.12, W * 0.44, H * 0.22);
    g.fillStyle = '#000';
    g.font = 'italic 900 64px Archivo, Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('JESUS FIRST', W / 2, H * 0.12 + H * 0.14);
    crowd(g, r, { rows: 3, size: 130, upChance: 0.55 });
  },

  // Camp-Opening in The Hall (ICF Youth)
  opening(g, r) {
    g.fillStyle = '#050505';
    g.fillRect(0, 0, W, H);
    beams(g, r, 4);
    for (let i = 0; i < 160; i++) {
      g.save();
      g.translate(r() * W, r() * H * 0.75);
      g.rotate(r() * Math.PI);
      g.fillStyle = r() < 0.7 ? '#fff' : '#8a8a8a';
      g.fillRect(-9, -4, 18, 8);
      g.restore();
    }
    g.save();
    g.globalCompositeOperation = 'difference';
    g.fillStyle = '#fff';
    g.font = 'italic 900 150px Archivo, Arial, sans-serif';
    g.textAlign = 'center';
    g.setTransform(1.15, 0, 0, 1, -W * 0.075, 0);
    g.fillText('WELCOME', W / 2, H * 0.4);
    g.restore();
    crowd(g, r, { rows: 3, size: 125, upChance: 0.7 });
  },

  // Silvester: Feuerwerk über der Menge (Schnappschuss)
  fireworks(g, r) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#000');
    sky.addColorStop(1, '#1a1a1a');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    for (let b = 0; b < 5; b++) {
      const cx = 140 + r() * (W - 280);
      const cy = 110 + r() * 300;
      const rad = 90 + r() * 120;
      const rays = 28 + Math.floor(r() * 16);
      g.strokeStyle = b % 2 ? '#fff' : '#bdbdbd';
      g.fillStyle = g.strokeStyle;
      g.lineWidth = 3;
      g.lineCap = 'round';
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2;
        const inner = rad * (0.25 + r() * 0.15);
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad + rad * 0.12);
        g.stroke();
        g.beginPath();
        g.arc(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad + rad * 0.12, 3.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.save();
    g.globalCompositeOperation = 'difference';
    g.fillStyle = '#fff';
    g.font = 'italic 900 200px Archivo, Arial, sans-serif';
    g.textAlign = 'center';
    g.setTransform(1.15, 0, 0, 1, -W * 0.075, 0);
    g.fillText('2027', W / 2, H * 0.62);
    g.restore();
    crowd(g, r, { rows: 2, size: 140, upChance: 0.75, fill: '#050505' });
  },

  // Smallgroup-Time (ICF Youth) – von oben: Kreis um ein Licht
  smallgroup(g, r) {
    g.fillStyle = '#080808';
    g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, 420);
    glow.addColorStop(0, 'rgba(255,255,255,.85)');
    glow.addColorStop(0.25, 'rgba(255,255,255,.25)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(W / 2, H / 2, 26, 0, Math.PI * 2);
    g.fill();
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.2;
      const x = W / 2 + Math.cos(a) * 300;
      const y = H / 2 + Math.sin(a) * 280;
      g.save();
      g.translate(x, y);
      g.rotate(a + Math.PI / 2);
      g.fillStyle = '#d9d9d9';
      g.beginPath();
      g.ellipse(0, 0, 95, 50, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1b1b1b';
      g.beginPath();
      g.arc(0, -4, 40, 0, Math.PI * 2);
      g.fill();
      if (r() < 0.6) { // offene Bibel
        g.fillStyle = '#fff';
        g.fillRect(-46, -110, 44, 58);
        g.fillRect(2, -110, 44, 58);
      }
      g.restore();
    }
  },
};

/** Erzeugt ein Bild (1200×900) + Vorschaubild als JPEG-Blobs. */
export async function artFiles(scene, seed = 1, label = '') {
  try { await document.fonts.load('italic 900 60px Archivo'); } catch {}
  const r = random(seed);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  (SCENES[scene] || SCENES.pyramid)(g, r);
  vignette(g);
  grain(g, r);
  tag(g, label || '#JFC26');
  const t = document.createElement('canvas');
  t.width = 480;
  t.height = 360;
  t.getContext('2d').drawImage(c, 0, 0, 480, 360);
  const toBlob = (canvas, q) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
  return { image: await toBlob(c, 0.86), thumb: await toBlob(t, 0.78) };
}

export const SCENE_NAMES = Object.keys(SCENES);
