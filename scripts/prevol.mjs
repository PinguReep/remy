// Prévol de la tour, AVANT tout déploiement (Lot 0). Lancé par
// scripts\verifier-tour.ps1, ou seul :
//
//   node --env-file=%USERPROFILE%\.remy\remy.env scripts\prevol.mjs [--sans-sauvegarde]
//
// Vérifie Node, la clé des sauvegardes, les destinations (dont une HORS de la
// tour), la place libre ; puis fait une vraie sauvegarde « avant-lot0 »
// (base, coffre, base SQLite si elle existe) et la RESTAURE à l'essai dans un
// dossier temporaire, copie par copie, empreinte par empreinte.
//
// Ce script ne modifie rien de Rémy : il LIT la base et le coffre, n'écrit que
// les archives (dans les dossiers de sauvegarde et sur le Spark) et un dossier
// temporaire effacé à la fin. Il n'ouvre la base SQLite qu'en lecture seule,
// ne crée pas remy.db et ne note pas d'état dans la base. Rien n'est envoyé à
// Motion, Google ni Claude.
//
// Code de sortie : 0 si tout est bon (✅/⚠️), 1 au premier ❌ bloquant.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { "sans-sauvegarde": { type: "boolean", default: false } } });

const lignes = [];
let bloquant = false;
const ok = (t) => lignes.push(`  ✅ ${t}`);
const attention = (t) => lignes.push(`  ⚠️  ${t}`);
const ko = (t) => {
  lignes.push(`  ❌ ${t}`);
  bloquant = true;
};
const titre = (t) => lignes.push(`\n${t}`);
const afficher = () => {
  console.log(lignes.join("\n"));
  lignes.length = 0;
};
const go = (n) => `${(n / 1024 ** 3).toFixed(1)} Go`;
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

// --- 1. Node -------------------------------------------------------------------------
titre("Node");
const [maj, min] = process.versions.node.split(".").map(Number);
let sqlite = null;
try {
  sqlite = await import("node:sqlite");
} catch {}
if ((maj > 22 || (maj === 22 && min >= 13)) && sqlite) ok(`Node ${process.versions.node} avec node:sqlite`);
else ko(`Node ${process.versions.node} : Rémy a besoin de Node 22.13 ou plus (base SQLite). Installe la LTS depuis nodejs.org.`);

// --- 2. Données -------------------------------------------------------------------------
titre("Données (lecture seule)");
const coffre = process.env.REMY_VAULT || null;
const base = process.env.REMY_DATA_DIR || (coffre ? path.join(coffre, ".remy") : null);
if (!coffre || !fs.existsSync(coffre)) ko(`Coffre introuvable (REMY_VAULT=${coffre || "vide"})`);
else ok(`Coffre : ${coffre}`);
if (!base || !fs.existsSync(base)) ko(`Base introuvable (${base || "ni REMY_DATA_DIR ni REMY_VAULT"})`);
else ok(`Base : ${base}`);
const cheminDb = base ? path.join(base, "remy.db") : null;
const dbExiste = Boolean(cheminDb && fs.existsSync(cheminDb));
lignes.push(`  ℹ️  Base SQLite : ${dbExiste ? "présente (copiée en lecture seule)" : "absente — normal avant le Lot 0, elle sera créée au premier démarrage"}`);
if (base && fs.existsSync(base)) {
  try {
    const s = fs.statfsSync(base);
    const libre = s.bavail * s.bsize;
    (libre > 5 * 1024 ** 3 ? ok : attention)(`Place libre sur le disque de la base : ${go(libre)}`);
  } catch {}
}

// --- 3. Rémy en marche ? -------------------------------------------------------------------
titre("Rémy sur la tour");
const port = process.env.PORT || 3010;
try {
  const r = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(3000) });
  if (r.status === 404) lignes.push(`  ℹ️  En marche sur le port ${port}, version d'AVANT le Lot 0 (pas de /api/version)`);
  else {
    const v = await r.json().catch(() => ({}));
    lignes.push(`  ℹ️  En marche sur le port ${port} : ${v.serveur || "?"}${v.commit ? ` · ${v.commit}` : ""}`);
  }
} catch {
  lignes.push(`  ℹ️  Rien ne répond sur le port ${port} (Rémy arrêté ?)`);
}

// --- 4. Clé des sauvegardes ---------------------------------------------------------------
const sv = await import("../lib/sauvegarde.js");
titre("Clé des sauvegardes");
let cle = null;
try {
  cle = sv.cleSauvegarde();
  if (!cle) ko("REMY_SAUVEGARDE_CLE absente : node scripts\\cle-sauvegarde.mjs --creer");
} catch (err) {
  ko(err.message);
}
if (cle) {
  ok(`REMY_SAUVEGARDE_CLE présente — empreinte ${sv.empreinteCle()}`);
  lignes.push("  ℹ️  Ta copie hors de la tour doit porter la même empreinte (node scripts\\cle-sauvegarde.mjs --verifier).");
}

// --- 5. Destinations -------------------------------------------------------------------------
titre("Destinations");
const dests = sv.destinations();
const locale = dests.find((d) => d.nom === "locale");
lignes.push(`  ℹ️  Locale (sur la tour, ne compte pas comme sauvegarde) : ${locale.dossier}`);
let horsTour = 0;
const externe = dests.find((d) => d.nom === "externe");
if (externe) {
  if (!fs.existsSync(path.dirname(path.resolve(externe.dossier)))) attention(`Disque externe absent : ${externe.dossier}`);
  else if (base && sv.volumeDe(externe.dossier) === sv.volumeDe(base)) ko(`« Externe » sur le même disque que la base : ${externe.dossier} — ce n'est pas une copie externe`);
  else {
    ok(`Disque externe : ${externe.dossier}`);
    horsTour++;
  }
}
const spark = dests.find((d) => d.nom === "spark");
const sftp = await import("../lib/sftp.js");
let cibleSpark = null;
if (spark) {
  try {
    cibleSpark = sftp.lireCible(spark.distant);
    const config = sftp.configSftp();
    if (!fs.existsSync(config.cleSsh)) throw new Error(`clé SSH absente (${config.cleSsh}) : lance scripts\\spark-relier.ps1`);
    if (!fs.existsSync(config.hotesConnus)) throw new Error(`empreinte du Spark pas épinglée (${config.hotesConnus}) : scripts\\spark-relier.ps1 -Epingler`);
    const etat = await sftp.etatDistant(cibleSpark);
    const archives = etat.noms.filter((n) => n.endsWith(sv.EXTENSION));
    const libre = etat.libre;
    if (libre != null && libre < 20 * 1024 ** 3) attention(`Spark ${cibleSpark.hote} : seulement ${go(libre)} libres`);
    else ok(`Spark ${cibleSpark.hote} joignable : ${libre != null ? `${go(libre)} libres` : "place inconnue"}, ${archives.length} archive(s)`);
    horsTour++;
  } catch (err) {
    ko(`Spark : ${err.message}`);
    cibleSpark = null;
  }
}
if (!horsTour) ko("Aucune destination HORS de la tour (REMY_SAUVEGARDES_SPARK ou REMY_SAUVEGARDES_EXTERNE) : une copie sur la tour ne protège de rien si elle meurt.");

// --- 6. Dernière sauvegarde existante ------------------------------------------------------
titre("Sauvegardes déjà faites");
if (cle && fs.existsSync(locale.dossier)) {
  const derniere = fs.readdirSync(locale.dossier).filter((n) => sv.lireNom(n)).sort().at(-1);
  if (!derniere) lignes.push("  ℹ️  Aucune archive locale pour l'instant");
  else {
    try {
      const lu = sv.lireArchive(fs.readFileSync(path.join(locale.dossier, derniere)), { cle });
      ok(`Dernière archive locale lisible : ${derniere} (${lu.fichiers.length} fichiers)`);
    } catch (err) {
      attention(`Dernière archive locale ILLISIBLE avec cette clé : ${derniere} — ${err.message}`);
    }
  }
} else lignes.push("  ℹ️  Aucune archive locale pour l'instant");
afficher();

// --- 7. Sauvegarde « avant-lot0 » et restauration à l'essai --------------------------------------
if (values["sans-sauvegarde"]) {
  console.log("\nSauvegarde d'essai : sautée (--sans-sauvegarde).");
} else if (bloquant) {
  console.log("\nSauvegarde d'essai : pas lancée tant qu'il reste un ❌ ci-dessus.");
} else {
  titre("Sauvegarde « avant-lot0 » puis restauration à l'essai");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "remy-prevol-"));
  try {
    const extras = [];
    if (dbExiste) {
      // Rien n'est créé ni migré dans la base de production. Rémy arrêté (pas
      // de journal -wal) : le fichier est complet, on le lit tel quel. Rémy en
      // marche : copie cohérente par une connexion en LECTURE SEULE.
      let contenu;
      if (!fs.existsSync(`${cheminDb}-wal`)) contenu = fs.readFileSync(cheminDb);
      else {
        const copie = path.join(tmp, "remy.db");
        const db = new sqlite.DatabaseSync(cheminDb, { readOnly: true });
        try {
          db.exec(`VACUUM INTO '${copie.replace(/'/g, "''")}'`);
        } finally {
          db.close();
        }
        contenu = fs.readFileSync(copie);
      }
      extras.push({ chemin: "base/remy.db", contenu });
    }
    const r = await sv.sauvegarder({ base, coffre, cle, destinations: dests, raison: "avant-lot0", extras });
    lignes.push(`  ℹ️  ${r.nom} — ${r.fichiers} fichiers, ${(r.taille / 1024 ** 2).toFixed(1)} Mo (Motion : instantané fait par l'installeur)`);
    for (const c of r.copies) {
      if (!c.ok) {
        (c.nom === "locale" ? ko : attention)(`Copie ${c.nom} : ${c.erreur}`);
        continue;
      }
      // Relire LA copie écrite (le Spark : re-téléchargée), puis restaurer.
      try {
        const fichier = c.nom === "spark"
          ? await sftp.telechargerDuSpark({ cible: cibleSpark, nom: r.nom, vers: path.join(tmp, "spark") })
          : c.fichier;
        const lu = sv.lireArchive(fs.readFileSync(fichier), { cle });
        const vers = path.join(tmp, `restauree-${c.nom}`);
        sv.restaurerFichiers(lu.fichiers, { vers });
        const parChemin = new Map(lu.manifeste.fichiers.map((f) => [f.chemin, f.sha256]));
        let identiques = 0;
        for (const f of lu.fichiers) {
          const [prefixe, ...reste] = f.chemin.split("/");
          if (sha256(fs.readFileSync(path.join(vers, prefixe, ...reste))) === parChemin.get(f.chemin)) identiques++;
        }
        if (identiques === lu.fichiers.length) {
          ok(`Copie ${c.nom} relue et restaurée à l'essai : ${identiques}/${lu.fichiers.length} fichiers identiques${c.libre ? ` · ${c.libre} libres` : ""}`);
        } else ko(`Copie ${c.nom} : ${lu.fichiers.length - identiques} fichier(s) restauré(s) différent(s)`);
      } catch (err) {
        ko(`Copie ${c.nom} : restauration à l'essai impossible — ${err.message}`);
      }
    }
    if (!r.copies.some((c) => c.ok && c.horsTour)) ko("Aucune copie HORS de la tour n'a réussi.");
  } catch (err) {
    ko(`Sauvegarde impossible : ${err.message}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  afficher();
}

console.log(bloquant ? "\n❌ Prévol : à corriger avant tout déploiement." : "\n✅ Prévol : rien de bloquant.");
process.exit(bloquant ? 1 : 0);
