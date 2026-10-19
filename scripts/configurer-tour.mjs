// Pose les secrets de Rémy dans %USERPROFILE%\.remy\remy.env, sans qu'ils
// passent par l'historique du terminal ni par une conversation :
//
//   node scripts\configurer-tour.mjs
//
// Pour chaque réglage : Entrée garde la valeur actuelle. Le mot de passe est
// demandé deux fois et seule son empreinte (scrypt) est écrite. Rémy est
// relancé à la fin pour prendre les nouveaux réglages.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { demander } from "./saisie.mjs";
import { ecrireEnv } from "./env-tour.mjs";

const fichier = path.join(os.homedir(), ".remy", "remy.env");
if (!fs.existsSync(fichier)) {
  console.error(`${fichier} introuvable : lance d'abord scripts\\installer-tour.ps1`);
  process.exit(1);
}
let texte = fs.readFileSync(fichier, "utf8");
const valeur = (cle) => (texte.match(new RegExp(`^${cle}=(.*)$`, "m")) || [])[1] || "";
const poser = (cle, v) => {
  texte = new RegExp(`^${cle}=`, "m").test(texte)
    ? texte.replace(new RegExp(`^${cle}=.*$`, "m"), `${cle}=${v}`)
    : `${texte.trimEnd()}\n${cle}=${v}\n`;
};
const etat = (cle) => (valeur(cle) ? "défini" : "vide");

console.log("Réglages de Rémy — Entrée garde la valeur actuelle.\n");

const mdp = await demander(`Mot de passe de Rémy (${etat("APP_PASSWORD_HASH")}) : `, { masque: true });
if (mdp) {
  if (mdp.length < 12) console.log("  ⚠️  Court : vise au moins 12 caractères.");
  const encore = await demander("  Confirme : ", { masque: true });
  if (encore !== mdp) {
    console.error("  Les deux saisies diffèrent — mot de passe inchangé.");
  } else {
    const sel = crypto.randomBytes(16).toString("hex");
    poser("APP_PASSWORD_HASH", `scrypt:${sel}:${crypto.scryptSync(mdp, sel, 64).toString("hex")}`);
  }
}

for (const [cle, quoi] of [
  ["MOTION_API_KEY", "Clé Motion (Motion > Settings > API)"],
  ["GOOGLE_CLIENT_ID", "Google : client ID"],
  ["GOOGLE_CLIENT_SECRET", "Google : client secret"],
  ["OPENAI_API_KEY", "Clé OpenAI (dictée de secours, inutile avec Dictée Locale)"],
]) {
  const v = await demander(`${quoi} (${etat(cle)}) : `, { masque: cle !== "GOOGLE_CLIENT_ID" });
  if (v) poser(cle, v);
}

ecrireEnv(fichier, texte);
console.log(`\nEnregistré dans ${fichier}.`);

try {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Stop-ScheduledTask -TaskName 'Rémy' -ErrorAction SilentlyContinue; " +
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('server.js') -and $_.CommandLine.Contains('remy.env') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; " +
        "Start-ScheduledTask -TaskName 'Rémy'",
    ],
    { stdio: "ignore" },
  );
  console.log("Rémy relancé avec les nouveaux réglages.");
} catch {
  console.log("Relance Rémy toi-même : tâche planifiée « Rémy » (ou relance scripts\\installer-tour.ps1).");
}
