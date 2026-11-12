// Des fichiers d'essai FICTIFS, fabriqués sans bibliothèque (12/11) : un PDF
// avec du texte, une image PNG d'une seule couleur, une image PNG qui porte un
// mot en grosses lettres. Pour l'épreuve du modèle de vision (lib/vision.js),
// le script d'essai de la tour (scripts/essai-pieces.mjs), les tests et les
// données de démonstration. Rien de personnel n'y entre jamais.

import zlib from "node:zlib";

// Un PDF d'une page, en Helvetica (police standard : rien à embarquer).
export function pdfEssai(lignes = ["Document d'essai de Remy"]) {
  const echapper = (l) => String(l).replace(/[()\\]/g, "\\$&");
  const flux = "BT /F1 14 Tf 72 720 Td " + lignes.map((l, i) => `${i ? "0 -20 Td " : ""}(${echapper(l)}) Tj`).join(" ") + " ET";
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(flux, "latin1")} >>\nstream\n${flux}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let sortie = "%PDF-1.4\n";
  const positions = [];
  objets.forEach((o, i) => {
    positions.push(Buffer.byteLength(sortie, "latin1"));
    sortie += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(sortie, "latin1");
  sortie += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n` + positions.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("");
  sortie += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(sortie, "latin1");
}

const crc = (b) => {
  let c = ~0;
  for (const o of b) {
    c ^= o;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
};
function morceau(type, donnees) {
  const l = Buffer.alloc(4);
  l.writeUInt32BE(donnees.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), donnees]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([l, td, c]);
}

// Un PNG RVB : `pixel(x, y)` rend [r, v, b].
export function png(largeur, hauteur, pixel) {
  const ligne = 1 + largeur * 3;
  const brut = Buffer.alloc(ligne * hauteur);
  for (let y = 0; y < hauteur; y++) {
    brut[y * ligne] = 0;
    for (let x = 0; x < largeur; x++) {
      const [r, v, b] = pixel(x, y);
      brut[y * ligne + 1 + x * 3] = r;
      brut[y * ligne + 2 + x * 3] = v;
      brut[y * ligne + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 2; // RVB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    morceau("IHDR", ihdr),
    morceau("IDAT", zlib.deflateSync(brut)),
    morceau("IEND", Buffer.alloc(0)),
  ]);
}

export const COULEURS = { rouge: [220, 30, 30], vert: [30, 170, 60], bleu: [30, 70, 220] };
export const pngUni = (couleur = "rouge", cote = 64) => png(cote, cote, () => COULEURS[couleur] || COULEURS.rouge);

// Des lettres 5×7, agrandies : de quoi éprouver une lecture du texte (OCR).
const GLYPHES = {
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};
export function pngMot(mot = "REMY 42", echelle = 12) {
  const lettres = [...String(mot).toUpperCase()].filter((c) => GLYPHES[c]);
  const marge = echelle * 3;
  const largeur = marge * 2 + lettres.length * 6 * echelle;
  const hauteur = marge * 2 + 7 * echelle;
  return png(largeur, hauteur, (x, y) => {
    const gx = Math.floor((x - marge) / echelle);
    const gy = Math.floor((y - marge) / echelle);
    if (x < marge || y < marge || gy >= 7 || gx < 0) return [255, 255, 255];
    const i = Math.floor(gx / 6);
    const colonne = gx % 6;
    if (i >= lettres.length || colonne === 5) return [255, 255, 255];
    return GLYPHES[lettres[i]][gy][colonne] === "1" ? [0, 0, 0] : [255, 255, 255];
  });
}
