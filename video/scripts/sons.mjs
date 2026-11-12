// La bande-son ORIGINALE, synthétisée ici, sans aucun échantillon :
//   public/sons/musique.wav    nappe, basse, percussions légères, montée avant
//                              le logo ; baissée sous chaque phrase de la voix ;
//   public/sons/bruitages.wav  souffles, pops, clics, notifications, sonnerie,
//                              calés sur les repères de src/montage.js.
// Les deux suivent public/minutage.json (lance scripts/minutage.mjs avant).
// Déterministe : même minutage, mêmes fichiers. 48 kHz, stéréo, 16 bits.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { construire } from "../src/montage.js";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SR = 48000;
const TAU = Math.PI * 2;

// ---------- Outils ----------
function aleatoire(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hasard = aleatoire(20261112);
const bruit = () => hasard() * 2 - 1;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const piste = (duree) => ({ g: new Float32Array(Math.ceil(duree * SR)), d: new Float32Array(Math.ceil(duree * SR)) });

/** Filtre biquad (RBJ). type : "lp" | "hp" | "bp". */
function biquad(type, f, q) {
  const w = (TAU * Math.min(Math.max(f, 20), SR * 0.45)) / SR; // borné : un filtre hors bornes diverge
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === "lp") [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  else if (type === "hp") [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  else [b0, b1, b2] = [alpha, 0, -alpha];
  const a0 = 1 + alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}
function filtrer(c, x) {
  const y = c.b0 * x + c.b1 * c.x1 + c.b2 * c.x2 - c.a1 * c.y1 - c.a2 * c.y2;
  c.x2 = c.x1; c.x1 = x; c.y2 = c.y1; c.y1 = y;
  return y;
}
/** Filtre un tableau en place ; `frequence(t)` peut varier (recalcul toutes les 64 valeurs). */
function filtrerTout(buf, type, frequence, q = 0.707) {
  let c = biquad(type, frequence(0), q);
  for (let i = 0; i < buf.length; i++) {
    if (i % 64 === 0) {
      const n = biquad(type, frequence(i / SR), q);
      Object.assign(c, { b0: n.b0, b1: n.b1, b2: n.b2, a1: n.a1, a2: n.a2 });
    }
    buf[i] = filtrer(c, buf[i]);
  }
}
function ajouter(p, debut, mono, gain = 1, pan = 0) {
  const i0 = Math.round(debut * SR);
  const gg = gain * Math.cos(((pan + 1) * Math.PI) / 4);
  const gd = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < mono.length; i++) {
    const j = i0 + i;
    if (j < 0 || j >= p.g.length) continue;
    p.g[j] += mono[i] * gg;
    p.d[j] += mono[i] * gd;
  }
}
/** Enveloppe ADSR simple, en secondes. */
function enveloppe(t, duree, a, d, s, r) {
  if (t < 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - ((1 - s) * (t - a)) / d;
  if (t < duree) return s;
  if (t < duree + r) return s * (1 - (t - duree) / r);
  return 0;
}
/** Réverbération de Schroeder (4 peignes + 2 passe-tout), stéréo décorrélée. */
function reverb(entree, longueur = 0.82, humide = 0.3) {
  const sortie = { g: new Float32Array(entree.g.length), d: new Float32Array(entree.d.length) };
  const canal = (x, y, decal) => {
    const peignes = [1557, 1617, 1491, 1422].map((n) => ({ b: new Float32Array(n + decal), i: 0, f: 0 }));
    const passes = [225, 556].map((n) => ({ b: new Float32Array(n + Math.floor(decal / 3)), i: 0 }));
    for (let n = 0; n < x.length; n++) {
      let s = 0;
      for (const c of peignes) {
        const v = c.b[c.i];
        c.f = v * 0.8 + c.f * 0.2; // amorti des aigus
        c.b[c.i] = x[n] + c.f * longueur;
        c.i = (c.i + 1) % c.b.length;
        s += v;
      }
      s *= 0.25;
      for (const a of passes) {
        const v = a.b[a.i];
        const w = s + v * 0.5;
        a.b[a.i] = w;
        a.i = (a.i + 1) % a.b.length;
        s = v - w * 0.5;
      }
      y[n] = x[n] * (1 - humide) + s * humide * 2.2;
    }
  };
  canal(entree.g, sortie.g, 0);
  canal(entree.d, sortie.d, 23);
  return sortie;
}
function crete(p) {
  let m = 0;
  for (const c of [p.g, p.d]) for (const v of c) m = Math.max(m, Math.abs(v));
  return m;
}
function ecrireWav(fichier, p, cible) {
  const k = cible / (crete(p) || 1);
  const n = p.g.length;
  const b = Buffer.alloc(44 + n * 4);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 4, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, p.g[i] * k)) * 32767), 44 + i * 4);
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, p.d[i] * k)) * 32767), 46 + i * 4);
  }
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, b);
}

// ---------- Instruments ----------
/** Une voix de nappe : deux dents de scie désaccordées + un triangle, attaque lente. */
function nappe(freq, duree, a = 1.2, r = 1.6) {
  const n = Math.ceil((duree + r) * SR);
  const out = new Float32Array(n);
  const det = [0.996, 1.004];
  const ph = [hasard(), hasard(), hasard()];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = enveloppe(t, duree, a, 0.6, 0.85, r);
    if (e === 0 && t > a) continue;
    let s = 0;
    for (let k = 0; k < 2; k++) {
      ph[k] = (ph[k] + (freq * det[k]) / SR) % 1;
      s += (ph[k] * 2 - 1) * 0.35;
    }
    ph[2] = (ph[2] + freq / SR) % 1;
    s += (1 - 4 * Math.abs(ph[2] - 0.5)) * 0.6;
    out[i] = s * e;
  }
  return out;
}
function basse(freq, duree) {
  const n = Math.ceil((duree + 0.08) * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = enveloppe(t, duree, 0.008, 0.25, 0.55, 0.08);
    const s = Math.sin(TAU * freq * t) + 0.35 * Math.sin(TAU * freq * 2 * t);
    out[i] = Math.tanh(s * 1.4) * e;
  }
  return out;
}
function grosseCaisse(force = 1) {
  const n = Math.ceil(0.45 * SR);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 44 + 70 * Math.exp(-t / 0.035);
    ph += (TAU * f) / SR;
    out[i] = Math.sin(ph) * Math.exp(-t / 0.16) * force;
  }
  return out;
}
function charleston(force = 1, duree = 0.045) {
  const n = Math.ceil(duree * 4 * SR);
  const out = new Float32Array(n);
  const hp = biquad("hp", 7500, 0.8);
  for (let i = 0; i < n; i++) out[i] = filtrer(hp, bruit()) * Math.exp(-i / SR / duree) * force;
  return out;
}
function claquement(force = 1) {
  const n = Math.ceil(0.3 * SR);
  const out = new Float32Array(n);
  const bp = biquad("bp", 1700, 1.1);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // trois micro-salves, comme des mains, puis une queue courte
    const salves = [0, 0.009, 0.018].reduce((s, d) => s + (t >= d ? Math.exp(-(t - d) / 0.006) : 0), 0);
    out[i] = filtrer(bp, bruit()) * (salves * 0.5 + Math.exp(-t / 0.07)) * force;
  }
  return out;
}
function pincee(freq, duree = 0.6, force = 1) {
  const n = Math.ceil(duree * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = Math.min(1, t / 0.004) * Math.exp(-t / (duree * 0.28));
    out[i] = (Math.sin(TAU * freq * t) + 0.25 * Math.sin(TAU * freq * 3 * t) * Math.exp(-t / 0.05)) * e * force;
  }
  return out;
}

// ---------- Bruitages ----------
const BRUITAGES = {
  souffle() {
    const d = 0.75;
    const n = Math.ceil(d * SR);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = bruit();
    filtrerTout(out, "bp", (t) => 350 + 2600 * Math.sin(Math.PI * Math.min(1, t / d)) ** 2, 1.2);
    for (let i = 0; i < n; i++) out[i] *= Math.sin(Math.PI * (i / n)) ** 2 * 0.9;
    return out;
  },
  pop() {
    const n = Math.ceil(0.16 * SR);
    const out = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      ph += (TAU * (320 + 650 * Math.exp(-t / 0.018))) / SR;
      out[i] = Math.sin(ph) * Math.exp(-t / 0.045) * Math.min(1, t / 0.002);
    }
    return out;
  },
  clic() {
    const n = Math.ceil(0.06 * SR);
    const out = new Float32Array(n);
    const hp = biquad("hp", 3000, 0.7);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      out[i] = filtrer(hp, bruit()) * Math.exp(-t / 0.003) * 0.8 + Math.sin(TAU * 2400 * t) * Math.exp(-t / 0.012) * 0.35;
    }
    return out;
  },
  ding() {
    const notes = [[1318.5, 1975.5], [1174.7, 1760], [1568, 2349.3], [1396.9, 2093]];
    const [a, b] = notes[Math.floor(hasard() * notes.length)];
    const n = Math.ceil(0.8 * SR);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const e = Math.min(1, t / 0.003);
      out[i] = e * (Math.sin(TAU * a * t) * Math.exp(-t / 0.22) * 0.55 + (t > 0.07 ? Math.sin(TAU * b * (t - 0.07)) * Math.exp(-(t - 0.07) / 0.25) * 0.45 : 0));
    }
    return out;
  },
  valide() {
    const n = Math.ceil(0.9 * SR);
    const out = new Float32Array(n);
    for (const [f, d] of [[880, 0], [1318.5, 0.09], [1760, 0.18]]) {
      for (let i = Math.round(d * SR); i < n; i++) {
        const t = i / SR - d;
        out[i] += Math.sin(TAU * f * t) * Math.exp(-t / 0.28) * Math.min(1, t / 0.003) * 0.4;
      }
    }
    return out;
  },
  sonnerie() {
    // Une sonnerie douce, façon marimba : deux salves, deux fois.
    const n = Math.ceil(3.2 * SR);
    const out = new Float32Array(n);
    const coups = [];
    for (const salve of [0, 1.5]) for (let k = 0; k < 6; k++) coups.push([salve + k * 0.11, k % 2 ? 1046.5 : 784]);
    for (const [d, f] of coups) {
      for (let i = Math.round(d * SR); i < Math.min(n, Math.round((d + 0.5) * SR)); i++) {
        const t = i / SR - d;
        out[i] += (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * f * 4 * t) * Math.exp(-t / 0.01)) * Math.exp(-t / 0.12) * 0.35;
      }
    }
    return out;
  },
  touche() {
    const n = Math.ceil(0.12 * SR);
    const out = new Float32Array(n);
    const lp = biquad("lp", 2200, 0.7);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      out[i] = filtrer(lp, bruit()) * Math.exp(-t / 0.006) * 0.9 + Math.sin(TAU * 170 * t) * Math.exp(-t / 0.025) * 0.6;
    }
    return out;
  },
  impact() {
    const n = Math.ceil(2.4 * SR);
    const out = new Float32Array(n);
    const lp = biquad("lp", 900, 0.7);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      ph += (TAU * (38 + 40 * Math.exp(-t / 0.08))) / SR;
      out[i] = Math.sin(ph) * Math.exp(-t / 0.7) * 0.9 + filtrer(lp, bruit()) * Math.exp(-t / 0.09) * 0.35;
    }
    return out;
  },
};
// Niveau relatif de chaque bruitage (les dings du chaos restent discrets).
const NIVEAUX = { souffle: 0.55, pop: 0.6, clic: 0.5, ding: 0.32, valide: 0.45, sonnerie: 0.45, touche: 0.7, impact: 0.9 };

// ---------- Composition ----------
function main() {
  const minutage = JSON.parse(fs.readFileSync(path.join(RACINE, "public", "minutage.json"), "utf8"));
  const m = construire(minutage);
  const T = m.total / m.fps;
  const debut = (id) => m.scenes.find((s) => s.id === id).debut / m.fps;
  const repere = (id, nom) => {
    const s = m.scenes.find((x) => x.id === id);
    return (s.debut + s.reperes[nom]) / m.fps;
  };
  const tOutils = debut("03-outils");
  const tTemps = debut("08-temps");
  const tChezToi = debut("09-chez-toi");
  const tLogo = repere("09-chez-toi", "logo");
  const tGel = repere("01-probleme", "gel");
  const tArrivee = repere("02-arrivee", "logo");

  const tempo = 96;
  const temps = 60 / tempo; // une noire
  const mesure = temps * 4;
  // Ré majeur, doux : Ré maj9, Si m7, Sol maj7(9), La 6/4 — en notes MIDI.
  const accords = [
    { basse: 38, notes: [50, 54, 57, 61, 64] },
    { basse: 35, notes: [50, 54, 57, 59, 62] },
    { basse: 31, notes: [50, 54, 55, 59, 62] },
    { basse: 33, notes: [49, 52, 57, 59, 64] },
  ];

  const nappes = piste(T + 3);
  const rythme = piste(T + 3);

  // 1. Le chaos : un bourdon serré (Ré, Mi bémol, La) et des tic-tac pressés qui s'accélèrent.
  for (const [note, g, pan] of [[38, 0.5, 0], [51, 0.22, -0.4], [57, 0.25, 0.4], [63, 0.12, 0.2]]) {
    ajouter(nappes, 0, nappe(hz(note), tGel - 0.2, 0.9, 0.6), g, pan);
  }
  for (let t = 0.25, k = 0; t < tGel; k++) {
    const pas = Math.max(0.105, 0.3 - 0.2 * (t / tGel));
    ajouter(rythme, t, charleston(0.35 + 0.25 * (k % 2), 0.03), 0.3, k % 2 ? 0.5 : -0.5);
    t += pas;
  }
  // Le gel : une note tenue, filtrée, qui retient son souffle jusqu'à l'arrivée.
  ajouter(nappes, tGel, nappe(hz(45), tArrivee - tGel, 0.3, 0.8), 0.28, 0);
  // 2. L'arrivée : l'accord se résout, large.
  for (const [i, note] of [38, 50, 54, 57, 61, 64, 69].entries()) {
    ajouter(nappes, tArrivee - 0.15, nappe(hz(note), tOutils - tArrivee + 0.6, 0.5, 1.8), i === 0 ? 0.45 : 0.24, ((i % 3) - 1) * 0.4);
  }
  // 3. Le corps : nappe + basse + batterie légère, de « Il se branche » jusqu'au logo.
  const finCorps = tLogo - 0.05;
  let k = 0;
  for (let t = tOutils; t < finCorps; t += mesure, k++) {
    const a = accords[k % accords.length];
    const d = Math.min(mesure, finCorps - t);
    for (const [i, note] of a.notes.entries()) ajouter(nappes, t, nappe(hz(note), d, 0.35, 0.9), 0.17, ((i / (a.notes.length - 1)) * 2 - 1) * 0.6);
    // basse : 1, « et » de 2, 3
    for (const [pos, long] of [[0, 1.4], [1.5, 0.45], [2, 1.8]]) {
      if (pos * temps < d) ajouter(rythme, t + pos * temps, basse(hz(a.basse), Math.min(long * temps, d - pos * temps)), 0.42, 0);
    }
    const plein = t >= tOutils + mesure; // la batterie entre après une mesure
    for (let b = 0; b < 4; b++) {
      const tb = t + b * temps;
      if (tb >= finCorps) break;
      if (plein && (b === 0 || b === 2)) ajouter(rythme, tb, grosseCaisse(), 0.55, 0);
      if (plein && (b === 1 || b === 3)) ajouter(rythme, tb, claquement(), 0.2, 0.15);
      for (const c of [0, 0.5]) if (tb + c * temps < finCorps) ajouter(rythme, tb + c * temps, charleston(c ? 0.28 : 0.4), 0.38, c ? 0.35 : -0.25);
    }
    // 8. « Il te rend du temps » : un arpège monte et porte jusqu'au logo.
    if (t + mesure > tTemps) {
      for (let c = 0; c < 8; c++) {
        const tc = t + c * (temps / 2);
        if (tc < tTemps || tc >= finCorps - 0.1) continue;
        const note = a.notes[c % a.notes.length] + 12;
        ajouter(nappes, tc, pincee(hz(note), 0.7), 0.16, (c % 2 ? 1 : -1) * 0.45);
      }
    }
  }
  // La montée : bruit qui s'ouvre et note qui grimpe, 2,6 s, jusqu'au logo.
  {
    const d = 2.6;
    const n = Math.ceil(d * SR);
    const souffle = new Float32Array(n);
    for (let i = 0; i < n; i++) souffle[i] = bruit() * (i / n) ** 2;
    filtrerTout(souffle, "bp", (t) => 300 * 2 ** ((t / d) * 4.5), 1.4);
    ajouter(rythme, tLogo - d, souffle, 0.5, 0);
    const monte = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      ph += (TAU * hz(50 + (i / n) * 24)) / SR;
      monte[i] = Math.sin(ph) * (i / n) ** 1.6 * 0.5;
    }
    ajouter(nappes, tLogo - d, monte, 0.35, 0);
  }
  // Le logo : l'accord final, large et tenu, qui s'éteint avec l'image.
  for (const [i, note] of [26, 38, 50, 54, 57, 61, 64, 69, 73].entries()) {
    ajouter(nappes, tLogo, nappe(hz(note), T - tLogo - 1.6, 0.04, 1.5), i < 2 ? 0.4 : 0.2, ((i % 3) - 1) * 0.5);
  }

  // Filtre : fermé pendant le chaos, s'ouvre à l'arrivée, ouvert ensuite.
  for (const c of [nappes.g, nappes.d]) filtrerTout(c, "lp", (t) => (t < tGel ? 900 : t < tOutils ? 900 + 1800 * Math.min(1, Math.max(0, (t - tArrivee) / 1.5)) : 2800), 0.8);
  const nappesR = reverb(nappes, 0.84, 0.38);
  const musique = piste(T);
  for (let i = 0; i < musique.g.length; i++) {
    musique.g[i] = nappesR.g[i] + rythme.g[i];
    musique.d[i] = nappesR.d[i] + rythme.d[i];
  }
  // Baisser la musique sous la voix (attaque 0,15 s, relâche 0,45 s) et fondu final.
  const phrases = m.scenes.flatMap((s) => s.phrases.map((p) => [(s.debut + p.debut) / m.fps, (s.debut + p.fin) / m.fps]));
  const sous = 0.33;
  let g = 1;
  for (let i = 0; i < musique.g.length; i++) {
    const t = i / SR;
    const parle = phrases.some(([a, b]) => t >= a - 0.12 && t <= b + 0.1);
    const cible = parle ? sous : 1;
    g += (cible - g) * (cible < g ? 1 / (0.15 * SR) : 1 / (0.45 * SR)) * 4;
    const fondu = Math.min(1, (T - t) / 1.6, t / 0.4);
    musique.g[i] *= g * Math.max(0, fondu);
    musique.d[i] *= g * Math.max(0, fondu);
  }
  ecrireWav(path.join(RACINE, "public", "sons", "musique.wav"), musique, 0.5);

  // Bruitages, aux repères du montage (et un souffle à chaque changement de scène).
  const bruitages = piste(T);
  const poses = [];
  for (const s of m.scenes) for (const x of s.sons) poses.push([x.son, x.image / m.fps]);
  for (const s of m.scenes.slice(2)) if (!poses.some(([, t]) => Math.abs(t - s.debut / m.fps) < 0.5)) poses.push(["souffle", s.debut / m.fps - 0.3]);
  for (const [son, t] of poses) ajouter(bruitages, t, BRUITAGES[son](), NIVEAUX[son], (hasard() - 0.5) * 0.5);
  ecrireWav(path.join(RACINE, "public", "sons", "bruitages.wav"), bruitages, 0.55);

  console.log(`musique.wav et bruitages.wav : ${T.toFixed(1)} s, ${poses.length} bruitages`);
}

main();
