// Planche de contrôle : rend quelques images fixes, sans tout le film.
//   node scripts/images.mjs <dossier> <image> [<image> …]
//   node scripts/images.mjs <dossier> --scenes   (3 images par scène : début, milieu, fin)
// Avec REMOTION_NAVIGATEUR pour un Chromium déjà installé.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { construire } from "../src/montage.js";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [dossier, ...reste] = process.argv.slice(2);
if (!dossier) throw new Error("usage : node scripts/images.mjs <dossier> <image>… | --scenes");
fs.mkdirSync(dossier, { recursive: true });
let images = reste.filter((x) => /^\d+$/.test(x)).map(Number);
if (reste.includes("--scenes")) {
  const m = construire(JSON.parse(fs.readFileSync(path.join(RACINE, "public", "minutage.json"), "utf8")));
  images = m.scenes.flatMap((s) => [s.debut + 12, s.debut + Math.round(s.duree / 2), s.debut + s.duree - 14]);
}
const serveUrl = await bundle({ entryPoint: path.join(RACINE, "src", "index.ts"), publicDir: path.join(RACINE, "public") });
const browserExecutable = process.env.REMOTION_NAVIGATEUR || null;
const composition = await selectComposition({ serveUrl, id: "Presentation", browserExecutable });
for (const frame of images) {
  const sortie = path.join(dossier, `f${String(frame).padStart(4, "0")}.jpg`);
  await renderStill({ serveUrl, composition, frame, output: sortie, imageFormat: "jpeg", jpegQuality: 85, browserExecutable });
  console.log(sortie);
}
