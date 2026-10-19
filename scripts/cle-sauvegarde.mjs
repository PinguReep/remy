// La clé des sauvegardes (REMY_SAUVEGARDE_CLE), sans qu'elle s'affiche, ni
// dans le terminal, ni dans un journal, ni dans Git :
//
//   node scripts\cle-sauvegarde.mjs --creer      crée la clé dans remy.env (si aucune n'existe),
//                                                la met dans le presse-papiers, affiche son empreinte
//   node scripts\cle-sauvegarde.mjs --verifier   colle ta copie (masquée) : identique ou non ?
//   node scripts\cle-sauvegarde.mjs --copier     remet la clé dans le presse-papiers
//   node scripts\cle-sauvegarde.mjs --empreinte  affiche seulement l'empreinte
//
// L'empreinte (12 caractères) ne permet pas de retrouver la clé : elle sert à
// vérifier que la copie gardée hors de la tour est la bonne. Une clé existante
// n'est JAMAIS remplacée : les sauvegardes déjà faites deviendraient illisibles.
//
// Presse-papiers (Windows) : la clé y est posée sans entrer dans l'historique
// (Win+V) ni dans la synchronisation cloud, puis effacée dès que tu as fini.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { demander } from "./saisie.mjs";
import { lireValeur, poserValeur, ecrireEnv } from "./env-tour.mjs";
import { empreinteCle as empreinte } from "../lib/sauvegarde.js";

const { values } = parseArgs({
  options: {
    creer: { type: "boolean", default: false },
    verifier: { type: "boolean", default: false },
    copier: { type: "boolean", default: false },
    empreinte: { type: "boolean", default: false },
    fichier: { type: "string" },
  },
});

const fichier = values.fichier || path.join(os.homedir(), ".remy", "remy.env");
const sortir = (msg, code = 1) => {
  console.error(msg);
  process.exit(code);
};

if (!fs.existsSync(fichier)) sortir(`❌ ${fichier} introuvable : lance d'abord scripts\\installer-tour.ps1 (ou indique --fichier).`);
let texte = fs.readFileSync(fichier, "utf8");
const actuelle = () => lireValeur(texte, "REMY_SAUVEGARDE_CLE");
const valide = (hex) => /^[0-9a-fA-F]{64}$/.test(hex);

// --- Presse-papiers --------------------------------------------------------------
// La clé passe par l'entrée standard du programme, jamais par sa ligne de
// commande (visible dans la liste des processus).
const PS_POSER = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$v = [Console]::In.ReadLine()",
  "$d = New-Object System.Windows.Forms.DataObject",
  "$d.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $v)",
  "$zero = New-Object System.IO.MemoryStream(,[byte[]](0,0,0,0))",
  "$d.SetData('ExcludeClipboardContentFromMonitorProcessing', $zero)",
  "$d.SetData('CanIncludeInClipboardHistory', (New-Object System.IO.MemoryStream(,[byte[]](0,0,0,0))))",
  "$d.SetData('CanUploadToCloudClipboard', (New-Object System.IO.MemoryStream(,[byte[]](0,0,0,0))))",
  "[System.Windows.Forms.Clipboard]::SetDataObject($d, $true)",
].join("; ");
const PS_VIDER = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()";

function presse(cle) {
  if (process.platform === "win32") {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-STA", "-Command", PS_POSER], { input: cle + "\n", encoding: "utf8" });
    return r.status === 0;
  }
  if (process.platform === "darwin") return spawnSync("pbcopy", [], { input: cle }).status === 0;
  return false;
}
function viderPresse() {
  if (process.platform === "win32") spawnSync("powershell.exe", ["-NoProfile", "-STA", "-Command", PS_VIDER]);
  else if (process.platform === "darwin") spawnSync("pbcopy", [], { input: "" });
}

async function donnerLaCle(cle) {
  // Ctrl+C, fenêtre fermée, ou oubli : la clé ne reste pas dans le presse-papiers.
  const vider = () => viderPresse();
  process.once("SIGINT", () => {
    vider();
    console.log("\n   Interrompu : presse-papiers vidé.");
    process.exit(130);
  });
  process.once("SIGHUP", () => {
    vider();
    process.exit(129);
  });
  const minuteur = setTimeout(() => {
    vider();
    console.log("\n   Deux minutes passées : presse-papiers vidé. Relance avec --copier si besoin.");
    process.exit(0);
  }, 120_000);
  if (!presse(cle)) {
    sortir(`❌ Presse-papiers indisponible ici : la clé (empreinte ${empreinte(cle)}) n'est PAS affichée. Elle est bien dans remy.env ; récupère-la sur la tour avec --copier.`);
  }
  console.log("📋 La clé est dans le presse-papiers (hors historique Win+V et hors synchronisation).");
  console.log("   Colle-la maintenant dans ton gestionnaire de mots de passe, avec cette empreinte :");
  console.log(`      ${empreinte(cle)}`);
  console.log("   Ne la mets JAMAIS sur le Spark ni sur la tour à côté des sauvegardes.");
  await demander("   Entrée une fois collée — le presse-papiers sera vidé (sinon dans deux minutes). ");
  clearTimeout(minuteur);
  vider();
  console.log("   Presse-papiers vidé. Vérifie ta copie : node scripts\\cle-sauvegarde.mjs --verifier");
}

// --- Actions -----------------------------------------------------------------------
if (values.creer) {
  if (actuelle()) {
    if (!valide(actuelle())) sortir("❌ REMY_SAUVEGARDE_CLE est posée mais illisible (64 caractères hexadécimaux attendus) : corrige-la à la main.");
    sortir(`ℹ️  Une clé existe déjà (empreinte ${empreinte(actuelle())}) : elle n'est JAMAIS remplacée — les sauvegardes déjà faites deviendraient illisibles.\n   Pour en refaire une copie : --copier.`, 0);
  }
  const cle = crypto.randomBytes(32).toString("hex");
  // Écrit puis relu : la clé écrite est bien celle qu'on va te donner.
  ecrireEnv(fichier, poserValeur(texte, "REMY_SAUVEGARDE_CLE", cle));
  texte = fs.readFileSync(fichier, "utf8");
  if (actuelle() !== cle) sortir("❌ La clé relue dans remy.env ne correspond pas : rien n'est sûr, ne fais pas de sauvegarde et préviens-moi.");
  console.log(`✅ Clé créée dans ${fichier} (empreinte ${empreinte(cle)}).`);
  await donnerLaCle(cle);
} else if (values.copier) {
  if (!valide(actuelle())) sortir("❌ Pas de clé valide dans remy.env (--creer pour en créer une).");
  await donnerLaCle(actuelle());
} else if (values.verifier) {
  if (!valide(actuelle())) sortir("❌ Pas de clé valide dans remy.env (--creer pour en créer une).");
  const copie = (await demander("Colle ta copie de la clé (rien ne s'affiche) : ", { masque: true })).replace(/\s+/g, "");
  const a = Buffer.from(copie.toLowerCase());
  const b = Buffer.from(actuelle().toLowerCase());
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    console.log(`✅ Identique à la clé de la tour (empreinte ${empreinte(actuelle())}) : ta copie permet de tout relire.`);
  } else {
    sortir(`❌ DIFFÉRENTE de la clé de la tour (empreinte attendue ${empreinte(actuelle())}${valide(copie) ? `, ta copie : ${empreinte(copie)}` : ""}). Refais une copie : --copier.`);
  }
} else if (values.empreinte) {
  if (!actuelle()) sortir("⚠️  Aucune clé dans remy.env (--creer pour en créer une).");
  if (!valide(actuelle())) sortir("❌ REMY_SAUVEGARDE_CLE illisible (64 caractères hexadécimaux attendus).");
  console.log(`Empreinte de la clé des sauvegardes : ${empreinte(actuelle())}`);
} else {
  sortir("Usage : --creer | --verifier | --copier | --empreinte (voir l'en-tête du script).");
}
