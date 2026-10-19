// Rapatrie tout Rémy de Vercel vers la tour, en une commande :
//
//   node --env-file=%USERPROFILE%\.remy\remy.env scripts\migrer-depuis-vercel.mjs
//
// Demande le mot de passe de Rémy (rien ne s'affiche quand tu tapes), se
// connecte à l'ancienne app, lit /api/export et écrit tout dans la base locale
// et le coffre Obsidian. Rien n'est écrit ailleurs : l'export reste en mémoire.
//
// Par défaut, ce que la tour a déjà (conversations du jour…) est gardé et
// l'historique Vercel s'y ajoute ; la mémoire Vercel remplace celle de la tour,
// mise de côté dans le coffre (« Mémoire de Rémy (avant migration).md »).
//
// Options : --forcer (écraser la base locale au lieu de fusionner),
//           --depuis <url> (défaut https://ton-ancienne-app.vercel.app),
//           --fichier <export.json> (un export déjà téléchargé).

import fs from "node:fs";
import { demander } from "./saisie.mjs";

const args = process.argv.slice(2);
const opt = (nom) => {
  const i = args.indexOf(nom);
  return i === -1 ? null : args[i + 1];
};
const forcer = args.includes("--forcer");
const depuis = (opt("--depuis") || "https://ton-ancienne-app.vercel.app").replace(/\/+$/, "");

if (!process.env.REMY_VAULT && !process.env.REMY_DATA_DIR) {
  console.error("REMY_VAULT n'est pas défini : lance le script avec --env-file=%USERPROFILE%\\.remy\\remy.env");
  process.exit(1);
}

async function telecharger() {
  const mdp = await demander(`Mot de passe de Rémy (${new URL(depuis).host}) : `, { masque: true });
  const login = await fetch(`${depuis}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: depuis },
    body: JSON.stringify({ password: mdp }),
  });
  if (!login.ok) throw new Error(`Connexion refusée (${login.status}) — mot de passe ?`);
  const cookie = (login.headers.getSetCookie?.() || [login.headers.get("set-cookie")])
    .filter(Boolean)
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("Pas de cookie de session reçu.");
  process.stdout.write("Export en cours… ");
  const r = await fetch(`${depuis}/api/export`, { headers: { Cookie: cookie } });
  if (r.status === 404) throw new Error("L'ancienne app n'a pas encore la route /api/export (PR non déployée ?).");
  if (!r.ok) throw new Error(`Export refusé (${r.status}) : ${(await r.text()).slice(0, 200)}`);
  const e = await r.json();
  console.log("reçu.");
  return e;
}

const fichier = opt("--fichier");
const exportJson = fichier ? JSON.parse(fs.readFileSync(fichier, "utf8")) : await telecharger();
const { importerTout } = await import("../lib/store.js");
const bilan = await importerTout(exportJson, { forcer, fusionner: !forcer });
console.log(
  `Importé : ${bilan.conversations} conversation(s)${bilan.gardees ? ` (+ ${bilan.gardees} déjà sur la tour, gardées)` : ""}, mémoire de ${bilan.memoire} caractères, ` +
    `${bilan.reflexions} réflexion(s), ${bilan.captures} capture(s), ${bilan.jours} jour(s) d'activité` +
    `${bilan.google ? ", connexion Google" : ""}.`,
);
console.log(`Coffre : ${process.env.REMY_VAULT || "(pas de coffre)"}`);
if (fichier) console.log(`⚠️  ${fichier} contient tes données en clair (et le jeton Google) : supprime-le.`);
