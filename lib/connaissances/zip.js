// Un lecteur d'archives ZIP minimal (29/10) : l'export de ChatGPT arrive en
// .zip (conversations.json, et les images jointes qu'on ne lit pas). Sans
// dépendance : l'annuaire central en fin de fichier, ZIP64 compris (un export
// de plusieurs Go), puis l'entrée voulue décompressée EN FLUX (rien n'est
// gardé en entier en mémoire, rien n'est écrit sur le disque).

import fs from "node:fs";
import zlib from "node:zlib";
import { Readable } from "node:stream";

const SIG_FIN = 0x06054b50;
const SIG_FIN64 = 0x06064b50;
const SIG_LOC64 = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export class ZipInvalide extends Error {
  constructor(raison) {
    super(`Archive illisible : ${raison}`);
    this.code = "ZIP_INVALIDE";
  }
}

function lire(fd, position, taille) {
  const b = Buffer.alloc(taille);
  const n = fs.readSync(fd, b, 0, taille, position);
  return n === taille ? b : b.subarray(0, n);
}

const u64 = (b, o) => Number(b.readBigUInt64LE(o));

// La liste des entrées : { nom, methode, compresse, taille, local }.
// `annuaireMax` : au-delà, l'annuaire n'est pas lu (un .zip quelconque de
// Téléchargements ne remplit pas la mémoire de la tour).
export function entrees(fichier, { annuaireMax = Infinity } = {}) {
  const fd = fs.openSync(fichier, "r");
  try {
    const total = fs.fstatSync(fd).size;
    if (total < 22) throw new ZipInvalide("fichier trop court");
    const fenetre = Math.min(total, 22 + 65_535 + 20);
    const queue = lire(fd, total - fenetre, fenetre);
    let i = queue.length - 22;
    while (i >= 0 && queue.readUInt32LE(i) !== SIG_FIN) i--;
    if (i < 0) throw new ZipInvalide("pas de fin d'archive (ce n'est pas un .zip, ou il est incomplet)");
    let nombre = queue.readUInt16LE(i + 10);
    let tailleCentral = queue.readUInt32LE(i + 12);
    let debutCentral = queue.readUInt32LE(i + 16);
    // ZIP64 : le localisateur juste avant la fin d'archive.
    if (i >= 20 && queue.readUInt32LE(i - 20) === SIG_LOC64) {
      const pos64 = u64(queue, i - 20 + 8);
      const f64 = lire(fd, pos64, 56);
      if (f64.readUInt32LE(0) !== SIG_FIN64) throw new ZipInvalide("fin ZIP64 introuvable");
      nombre = u64(f64, 32);
      tailleCentral = u64(f64, 40);
      debutCentral = u64(f64, 48);
    }
    if (debutCentral + tailleCentral > total) throw new ZipInvalide("annuaire hors du fichier");
    if (tailleCentral > annuaireMax) throw new ZipInvalide("annuaire trop grand");
    const central = lire(fd, debutCentral, tailleCentral);
    const sortie = [];
    let o = 0;
    for (let k = 0; k < nombre; k++) {
      if (o + 46 > central.length || central.readUInt32LE(o) !== SIG_CENTRAL) throw new ZipInvalide("annuaire abîmé");
      const drapeaux = central.readUInt16LE(o + 8);
      const methode = central.readUInt16LE(o + 10);
      let compresse = central.readUInt32LE(o + 20);
      let taille = central.readUInt32LE(o + 24);
      const lNom = central.readUInt16LE(o + 28);
      const lExtra = central.readUInt16LE(o + 30);
      const lComm = central.readUInt16LE(o + 32);
      let local = central.readUInt32LE(o + 42);
      const nom = central.subarray(o + 46, o + 46 + lNom).toString(drapeaux & 0x800 ? "utf8" : "latin1");
      // Champ ZIP64 (0x0001) : les valeurs à 0xFFFFFFFF y sont, dans l'ordre.
      let e = o + 46 + lNom;
      const finExtra = e + lExtra;
      let taille64 = false;
      while (e + 4 <= finExtra) {
        const id = central.readUInt16LE(e);
        const lg = central.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let p = e + 4;
          const finChamp = Math.min(e + 4 + lg, finExtra);
          if (taille === 0xffffffff && p + 8 <= finChamp) (taille = u64(central, p)), (p += 8), (taille64 = true);
          if (compresse === 0xffffffff && p + 8 <= finChamp) (compresse = u64(central, p)), (p += 8);
          if (local === 0xffffffff && p + 8 <= finChamp) local = u64(central, p);
        }
        e += 4 + lg;
      }
      // 0xFFFFFFFF sans sa valeur ZIP64 : taille INCONNUE (contre-relecture
      // du 30/10, tour 2 : elle passait pour « pas jugée » et ouvrait une
      // décompression sans fin). Infinity : invraisemblable, jamais ouverte.
      if (taille === 0xffffffff && !taille64) taille = Infinity;
      sortie.push({ nom, methode, compresse, taille, local, crc: central.readUInt32LE(o + 16), chiffre: Boolean(drapeaux & 1) });
      o += 46 + lNom + lExtra + lComm;
    }
    return sortie;
  } finally {
    fs.closeSync(fd);
  }
}

// Une entrée invraisemblable (bombe de décompression, contre-relecture du
// 30/10) : une taille inconnue (0xFFFFFFFF sans champ ZIP64), plus de
// TAILLE_MAX décompressés, ou un rapport décompressé / compressé au-delà de
// RAPPORT_MAX (un vrai export JSON tourne autour de 5 à 20). Lue dans
// l'annuaire : écartée sans être ouverte.
export const RAPPORT_MAX = 100;
export const TAILLE_MAX = 8 * 1024 ** 3;
export function invraisemblable(e) {
  if (!e) return false;
  if (typeof e.taille !== "number" || Number.isNaN(e.taille) || !Number.isFinite(e.taille)) return true;
  if (e.taille > TAILLE_MAX) return true;
  return e.taille > 1_000_000 && e.compresse > 0 && e.taille / e.compresse > RAPPORT_MAX;
}

// L'abandon d'une lecture (un effacement demandé pendant un import) : le flux
// s'arrête au morceau suivant au lieu d'aller au bout.
export class Abandon extends Error {
  constructor() {
    super("Lecture interrompue : un effacement a été demandé.");
    this.code = "ABANDON";
  }
}

// Une lecture faite AVANT le geste de Sam (reconnaître un export, lire son
// compte) s'arrête à un plafond bas : un .zip quelconque de Téléchargements
// ne fait jamais travailler la tour plus de quelques secondes.
export class PlafondAtteint extends Error {
  constructor() {
    super("Lecture arrêtée au plafond permis avant ton accord.");
    this.code = "PLAFOND";
  }
}

// Le flux décompressé d'une entrée. `abandonne()` : vrai quand il faut
// s'arrêter ; `plafond` : octets décompressés au-delà desquels on s'arrête.
export function fluxEntree(fichier, entree, { abandonne = null, plafond = Infinity } = {}) {
  if (entree.chiffre) throw new ZipInvalide("entrée protégée par mot de passe");
  if (entree.methode !== 0 && entree.methode !== 8) throw new ZipInvalide(`compression non prise en charge (${entree.methode})`);
  const fd = fs.openSync(fichier, "r");
  let debut;
  try {
    const tete = lire(fd, entree.local, 30);
    if (tete.length < 30 || tete.readUInt32LE(0) !== SIG_LOCAL) throw new ZipInvalide("entrée abîmée");
    debut = entree.local + 30 + tete.readUInt16LE(26) + tete.readUInt16LE(28);
  } finally {
    fs.closeSync(fd);
  }
  if (entree.compresse === 0) return Readable.from([]);
  const brut = fs.createReadStream(fichier, { start: debut, end: debut + entree.compresse - 1, highWaterMark: 1 << 20 });
  const donnees = entree.methode === 0 ? brut : brut.pipe(zlib.createInflateRaw());
  if (donnees !== brut) brut.on("error", (e) => donnees.destroy(e));
  return verifie(donnees, entree, abandonne, plafond);
}

// Le contenu décompressé, vérifié : taille et somme de contrôle (CRC-32) de
// l'annuaire (contre-relecture du 29/10 : un .zip abîmé au téléchargement
// passait jusqu'à l'erreur JSON, avec un mauvais conseil).
// Plus long que ce que l'annuaire annonce : coupé tout de suite (un annuaire
// menteur ne fait pas décompresser des Go pour rien). Jamais sans borne :
// une taille inconnue vaut TAILLE_MAX.
async function* verifie(flux, entree, abandonne = null, plafond = Infinity) {
  const crc32 = typeof zlib.crc32 === "function" ? zlib.crc32 : null;
  const connue = Number.isFinite(entree.taille);
  const annoncee = connue ? Math.min(entree.taille, TAILLE_MAX) : TAILLE_MAX;
  let crc = 0;
  let taille = 0;
  try {
    for await (const c of flux) {
      if (abandonne?.()) throw new Abandon();
      taille += c.length;
      if (taille > plafond) throw new PlafondAtteint();
      if (taille > annoncee) throw new ZipInvalide("contenu plus long que l'annuaire ne l'annonce (archive piégée ?)");
      if (crc32) crc = crc32(c, crc);
      yield c;
    }
  } catch (err) {
    flux.destroy?.();
    if (err instanceof ZipInvalide || err instanceof Abandon || err instanceof PlafondAtteint) throw err;
    throw new ZipInvalide(`contenu abîmé (${err.code || "décompression impossible"})`);
  }
  if (connue && taille !== entree.taille) throw new ZipInvalide("contenu tronqué (téléchargement incomplet ?)");
  if (crc32 && typeof entree.crc === "number" && crc >>> 0 !== entree.crc >>> 0) throw new ZipInvalide("contenu abîmé (somme de contrôle fausse)");
}

// Le fichier commence-t-il comme une archive ZIP ?
export function estZip(fichier) {
  const fd = fs.openSync(fichier, "r");
  try {
    const b = lire(fd, 0, 4);
    return b.length === 4 && (b.readUInt32LE(0) === SIG_LOCAL || b.readUInt32LE(0) === SIG_FIN);
  } finally {
    fs.closeSync(fd);
  }
}
