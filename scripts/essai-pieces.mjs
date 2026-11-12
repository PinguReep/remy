// Ce que la tour sait lire des pièces jointes du chat (12/11), en une commande
// (le même essai que Réglages › « Essayer la lecture des pièces ») :
//
//   node --no-warnings --env-file=%USERPROFILE%\.remy\remy.env %USERPROFILE%\.remy\app\scripts\essai-pieces.mjs
//
// Trois essais sur des fichiers FICTIFS fabriqués ici : l'OCR de Windows
// (une image « REMY 42 »), le modèle local avec une image (de quelle couleur
// est-elle ?), un PDF d'une page. Rien d'autre n'est envoyé, rien n'est gardé ;
// la sortie ne montre jamais d'adresse ni de jeton.
import { essayerLecture } from "../lib/essai-pieces.js";
import { logCost } from "../lib/chat.js";

const { lignes } = await essayerLecture({ journal: logCost });
console.log("Lecture des pièces jointes, sur cette tour :");
for (const l of lignes) console.log(`  ${l.ok ? "✔" : "✘"} ${l.libelle} : ${l.detail}`);
process.exit(0);
