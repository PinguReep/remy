// Le rendu complet : minutage → bande-son → images (Remotion) → niveau final.
//
//   npm run rendu                      → sortie/remy-presentation.mp4
//   REMY_SORTIE=/un/dossier npm run rendu
//   REMOTION_NAVIGATEUR=/chemin/chromium npm run rendu   (un Chromium déjà installé)
//
// Le niveau final : normalisation EBU R128 en deux passes (ffmpeg loudnorm),
// −16 LUFS intégrés, crête vraie −1,5 dB ; la vidéo n'est pas réencodée.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SORTIE = path.resolve(process.env.REMY_SORTIE || path.join(RACINE, "sortie"));
const NOM = process.env.REMY_NOM || "remy-presentation";
const brut = path.join(SORTIE, `${NOM}.brut.mp4`);
const final = path.join(SORTIE, `${NOM}.mp4`);
fs.mkdirSync(SORTIE, { recursive: true });

const lancer = (cmd, args) => {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: RACINE, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
};

lancer("node", ["scripts/minutage.mjs"]);
lancer("node", ["scripts/sons.mjs"]);
const args = ["remotion", "render", "Presentation", brut, "--codec=h264", "--crf=18", "--audio-codec=aac", "--audio-bitrate=320k", "--pixel-format=yuv420p"];
if (process.env.REMOTION_CONCURRENCE) args.push(`--concurrency=${process.env.REMOTION_CONCURRENCE}`);
lancer("npx", args);

// Normalisation, passe 1 : mesurer.
const mesure = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", brut, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" }).stderr;
const m = JSON.parse(mesure.slice(mesure.lastIndexOf("{"), mesure.lastIndexOf("}") + 1));
const filtre = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
// Passe 2 : appliquer, la vidéo copiée telle quelle.
lancer("ffmpeg", ["-hide_banner", "-y", "-i", brut, "-c:v", "copy", "-af", filtre, "-ar", "48000", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", final]);
fs.rmSync(brut, { force: true });
console.log(`\nVidéo : ${final}  (avant normalisation : ${m.input_i} LUFS, crête ${m.input_tp} dBTP)`);
