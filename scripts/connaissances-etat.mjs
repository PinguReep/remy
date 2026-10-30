// Tes conversations d'ailleurs vues depuis la tour, sans l'app : ce que Rémy
// a lu de Claude Code, de T3 Code et de tes exports ChatGPT (comptes, dates,
// emplacements, erreurs et quoi faire). Rien n'est modifié chez Claude Code,
// T3 ni ChatGPT ; le contenu des conversations n'est jamais affiché.
//
//   node --no-warnings --env-file=%USERPROFILE%\.remy\remy.env %USERPROFILE%\.remy\app\scripts\connaissances-etat.mjs [--lire]
//
// --lire : lit tout de suite les sources allumées (sinon, Rémy le fait seul
// toutes les 30 minutes), et dit le bilan complet : fichiers lus, inchangés,
// écartés (et pourquoi), bases de T3 trouvées, Téléchargements.

import * as sync from "../lib/connaissances/sync.js";

const date = (ms) => (ms ? new Date(ms).toLocaleString("fr-FR", { timeZone: process.env.REMY_TZ || "Europe/Paris" }) : "jamais");

if (process.argv.includes("--lire")) {
  let r;
  try {
    r = await sync.synchroniser();
  } catch (err) {
    const p = sync.erreurDe(null, err);
    console.log(`Lecture impossible : ${p.message}\nÀ faire : ${p.quoiFaire}`);
    process.exit(1);
  }
  if (r.raison === "source-coupee") {
    console.log("Toutes les sources sont coupées (dans l'app, ou REMY_SOURCE_…=off dans remy.env).");
    process.exit(2);
  }
  for (const [id, b] of Object.entries(r.sources)) {
    const nom = sync.SOURCES[id]?.nom || id;
    if (!b.ok) {
      console.log(`${nom} : ÉCHEC — ${b.erreur.message}\n  À faire : ${b.erreur.quoiFaire}`);
      continue;
    }
    if (id === sync.SOURCE_CHATGPT) {
      console.log(`${nom} : ${b.importes} export(s) importé(s), ${b.deja} déjà vu(s), ${b.enAttente} en attente — ${b.duree} ms`);
      const t = b.telechargements;
      if (t?.coupe) console.log("  Téléchargements : surveillance coupée (Réglages › Sources des conversations, ou REMY_TELECHARGEMENTS=off)");
      else if (t) console.log(`  Téléchargements : ${t.dossiers} dossier(s), ${t.zips} .zip, ${t.importes} importé(s), ${t.deja} déjà vu(s), ${t.autres} autre(s) que ChatGPT, ${t.tropVieux} de plus de ${sync.TELECHARGEMENTS_JOURS} j, ${t.tropGros} trop gros, ${t.erreurs} illisible(s)`);
      continue;
    }
    console.log(`${nom} : ${b.messages} message(s) ajouté(s), ${b.masques} secret(s) masqué(s), ${b.erreurs} erreur(s) — ${b.duree} ms`);
    // Le bilan complet : la vraie raison d'un « 0 conversation » se lit ici.
    if (id === sync.SOURCE_CLAUDE) {
      console.log(`  Lecture : ${b.fichiers} fichier(s), ${b.lus} lu(s), ${b.inchanges} inchangé(s), ${b.relus} relu(s) du début, ${b.exclus} écarté(s), ${b.horsFiltre} hors filtre, ${b.illisibles} ligne(s) illisible(s)${b.aRelire ? `, ${b.aRelire} à relire (règle changée)` : ""}`);
      const rc = b.recensement;
      if (rc) console.log(`  Plus profond : ${rc.sousAgents} fichier(s) de sous-agents (jamais lus), ${rc.ailleurs} autre(s) .jsonl hors de projects\\<dossier>\\<session>.jsonl`);
    } else if (id === sync.SOURCE_T3) {
      if (!b.detail?.length) console.log("  Aucune base trouvée (où Rémy a cherché : plus bas)");
      for (const d of b.detail || []) {
        console.log(`  ${d.chemin} (${d.version === 2 ? "base V2" : "ancienne base"}) : ${d.erreur ? `ÉCHEC — ${d.erreur}` : `${d.fils} fil(s), ${d.gardes} gardé(s), ${d.horsFiltre} hors filtre, ${d.supprimes} supprimé(s), ${d.sousAgents} sous-agent(s), ${d.sansMessage} sans message lisible`}`);
      }
    }
    if (b.filtre) console.log(`  Filtre REMY_CONNAISSANCES_PROJETS : « ${b.filtre.join(", ")} »`);
  }
}

const e = sync.etat();
console.log(`Chiffré au repos : ${e.chiffre ? "oui" : "NON"} — clé : ${e.cle?.emplacement || "?"}`);
if (e.cle?.erreur) console.log(`  ERREUR : ${e.cle.erreur.message}\n  À faire : ${e.cle.erreur.quoiFaire}`);
console.log(`Rémy s'en sert : réponses ${e.usage.chat ? "oui" : "non"}, nuit ${e.usage.nuit ? "oui" : "non"}${e.usage.forceParLaTour ? " (coupé dans remy.env)" : ""}`);
for (const s of e.sources) {
  console.log(`\n${s.nom} : ${s.actif ? "allumée" : "COUPÉE"}${s.forceParLaTour ? " (réglée dans remy.env)" : ""}`);
  console.log(`  ${s.conversations} conversation(s), ${s.messages} message(s) ; dernière lecture : ${date(s.derniereLecture)}`);
  for (const l of s.emplacements) console.log(`  ${l.trouve ? "trouvé" : "cherché"} : ${l.chemin} (${l.origine})`);
  if (s.recensement?.phrase) console.log(`  ${s.recensement.phrase}`);
  const p = s.erreur || s.aide;
  if (p) console.log(`  ${s.erreur ? "ERREUR" : "Rien encore"} : ${p.message}${p.quoiFaire ? `\n  À faire : ${p.quoiFaire}` : ""}`);
}
console.log(`\nExports ChatGPT à déposer dans : ${e.imports.dossier} (${e.imports.enAttente} en attente, ${e.imports.importes} déjà importé(s))`);
const dl = e.chatgpt?.telechargements;
if (dl?.actif) for (const d of dl.dossiers) console.log(`  Téléchargements surveillé (lecture seule) : ${d.chemin}${d.trouve ? "" : " — absent"}`);
else if (dl) console.log(`  Téléchargements : non surveillé${dl.forceParLaTour ? " (REMY_TELECHARGEMENTS=off)" : " (coupé dans l'app)"}`);
if (dl?.phraseIllisibles) console.log(`  ${dl.phraseIllisibles}`);
const rp = e.chatgpt?.rappel;
if (rp) console.log(`  Dernier import : ${rp.dernierImport ? `${date(rp.dernierImport)} (il y a ${rp.depuisJours} j)` : "jamais"} ; carte « Exporter ChatGPT » : ${!rp.actif ? "coupée" : rp.aMontrer ? "montrée" : "pas maintenant"}`);
const o = e.imports.originaux;
if (o?.fichiers) console.log(`  ${o.fichiers} export(s) importé(s) encore en clair hors du coffre : ${o.dossier} (effacé(s) ${o.gardeJours} jour(s) après l'import)`);
