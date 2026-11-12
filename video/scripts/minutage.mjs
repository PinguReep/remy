// Lit voix/script.md et les fichiers de voix de public/voix/, et écrit
// public/minutage.json : la durée réelle de chaque scène parlée et le début /
// la fin de chaque phrase. Le montage (src/montage.js), la musique
// (scripts/sons.mjs) et les sous-titres se calent dessus : changer de voix,
// c'est remplacer les fichiers puis relancer ce script (le rendu le fait seul).
//
// Pour chaque scène <id> :
//   - public/voix/<id>.wav (ou .mp3, .m4a, .ogg : durée lue par ffprobe) ;
//   - public/voix/<id>.json (facultatif) : { phrases: [{ debut, fin }] } en
//     secondes, écrit par scripts/voix.py. Absent, ou d'un autre nombre de
//     phrases : les phrases sont réparties au prorata de leur longueur.
//   - Pas de fichier du tout : la scène est muette, sa durée estimée à
//     15 caractères par seconde (la vidéo se rend quand même, sous-titrée).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(RACINE, "voix", "script.md");
const VOIX = path.join(RACINE, "public", "voix");
const SORTIE = path.join(RACINE, "public", "minutage.json");

/** [{ id, phrases: [texte] }] — mêmes règles que scripts/voix.py. */
export function lireScript(texte) {
  const scenes = [];
  let courante = null;
  for (const ligne of texte.split(/\r?\n/)) {
    const m = /^##\s+(\S+)\s*$/.exec(ligne);
    if (m) scenes.push((courante = { id: m[1], phrases: [] }));
    else if (courante && ligne.startsWith("- ")) courante.phrases.push(ligne.slice(2).trim());
  }
  return scenes;
}

/** Durée d'un WAV PCM en secondes, en lisant ses blocs « fmt » et « data ». */
function dureeWav(fichier) {
  const b = fs.readFileSync(fichier);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${fichier} : pas un WAV`);
  let octetsParSeconde = 0;
  for (let i = 12; i + 8 <= b.length; ) {
    const nom = b.toString("ascii", i, i + 4);
    const taille = b.readUInt32LE(i + 4);
    if (nom === "fmt ") octetsParSeconde = b.readUInt32LE(i + 16);
    if (nom === "data") return Math.min(taille, b.length - i - 8) / octetsParSeconde;
    i += 8 + taille + (taille % 2);
  }
  throw new Error(`${fichier} : bloc data introuvable`);
}

function dureeFfprobe(fichier) {
  const s = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", fichier]).toString();
  return Number.parseFloat(s);
}

function prorata(phrases, duree) {
  // Une pause de 0,35 s entre phrases, le reste au nombre de caractères.
  const pause = phrases.length > 1 ? Math.min(0.35, (duree * 0.15) / (phrases.length - 1)) : 0;
  const parole = duree - pause * (phrases.length - 1);
  const total = phrases.reduce((s, p) => s + p.length, 0) || 1;
  let t = 0;
  return phrases.map((p) => {
    const d = (parole * p.length) / total;
    const r = { debut: t, fin: t + d };
    t += d + pause;
    return r;
  });
}

export function calculer() {
  const scenes = lireScript(fs.readFileSync(SCRIPT, "utf8"));
  const sortie = { genere: new Date().toISOString(), scenes: [] };
  for (const { id, phrases } of scenes) {
    const ext = [".wav", ".mp3", ".m4a", ".ogg"].find((e) => fs.existsSync(path.join(VOIX, id + e)));
    let duree;
    let minutage = null;
    let source = "estimée";
    if (ext) {
      const f = path.join(VOIX, id + ext);
      duree = ext === ".wav" ? dureeWav(f) : dureeFfprobe(f);
      source = "fichier";
      const j = path.join(VOIX, `${id}.json`);
      if (fs.existsSync(j)) {
        const lu = JSON.parse(fs.readFileSync(j, "utf8"));
        if (Array.isArray(lu.phrases) && lu.phrases.length === phrases.length) minutage = lu.phrases;
      }
    } else {
      duree = phrases.join(" ").length / 15 + 0.4 * (phrases.length - 1);
    }
    const temps = minutage || prorata(phrases, duree);
    sortie.scenes.push({
      id,
      fichier: ext ? `voix/${id}${ext}` : null,
      source,
      duree: Math.round(duree * 1000) / 1000,
      phrases: phrases.map((texte, i) => ({ texte, debut: temps[i].debut, fin: temps[i].fin })),
    });
  }
  fs.writeFileSync(SORTIE, JSON.stringify(sortie, null, 1));
  return sortie;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const m = calculer();
  const total = m.scenes.reduce((s, x) => s + x.duree, 0);
  for (const s of m.scenes) console.log(`${s.id.padEnd(14)} ${s.duree.toFixed(2).padStart(6)} s  ${s.source}${s.fichier ? "" : " (pas de fichier de voix)"}`);
  console.log(`voix : ${total.toFixed(1)} s → ${path.relative(process.cwd(), SORTIE)}`);
}
