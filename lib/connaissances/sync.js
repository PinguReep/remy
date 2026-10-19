// Synchronisation de la mémoire de projets (lot B) : lire les sessions Claude
// Code accordées, ranger le dialogue masqué, rendre l'état et la recherche.
// Aucun appel IA ici : c'est la lecture seule, gratuite.
//
// Garde-fous :
//   - la source est COUPÉE par défaut (accord explicite, dans l'app ou par
//     REMY_SOURCE_CLAUDE_CODE=on sur la tour ; =off la coupe quoi qu'il arrive) ;
//   - REMY_CONNAISSANCES_PROJETS (sur la tour, jamais dans ce dépôt) limite la
//     lecture aux projets dont le dossier contient l'un de ces mots
//     (« projet-essai,autre ») ; vide = tous ;
//   - jamais d'écriture chez Claude Code ; un curseur par fichier.

import fs from "node:fs";
import { base, transaction, requeteFts, cheminConnaissances } from "./base.js";
import * as claude from "./claudeCode.js";

export const SOURCE_CLAUDE = "claude-code";

const envSource = () => process.env.REMY_SOURCE_CLAUDE_CODE;

export function sourceActive(id = SOURCE_CLAUDE) {
  if (envSource() === "off") return false;
  if (envSource() === "on") return true;
  // Jamais accordée : la base n'existe pas, et on ne la crée pas pour le dire
  // (le planificateur demande toutes les 10 minutes).
  if (!fs.existsSync(cheminConnaissances())) return false;
  return Boolean(base().prepare("SELECT actif FROM sources WHERE id = ?").get(id)?.actif);
}

export function reglerSource(id, actif) {
  base()
    .prepare("INSERT INTO sources (id, actif, maj_a) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET actif = excluded.actif, maj_a = excluded.maj_a")
    .run(id, actif ? 1 : 0, Date.now());
}

const filtresProjets = () =>
  String(process.env.REMY_CONNAISSANCES_PROJETS || "")
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);

export const projetRetenu = (racineNormalisee, filtres = filtresProjets()) =>
  !filtres.length || filtres.some((f) => racineNormalisee.includes(f));

let enCours = null;

// Un passage de synchronisation. Concurrent-sûr : une seconde demande attend
// la première au lieu de lire deux fois.
export function synchroniser(options = {}) {
  if (enCours) return enCours;
  enCours = synchroniserVraiment(options).finally(() => {
    enCours = null;
  });
  return enCours;
}

async function synchroniserVraiment({ racines = claude.racines() } = {}) {
  if (!sourceActive()) return { ok: false, raison: "source-coupee" };
  const b = base();
  const debut = Date.now();
  const journal = b.prepare("INSERT INTO journal_sync (debut, source) VALUES (?, ?)").run(debut, SOURCE_CLAUDE);
  const bilan = { fichiers: 0, lus: 0, inchanges: 0, relus: 0, exclus: 0, horsFiltre: 0, passages: 0, masques: 0, illisibles: 0, tropGrosses: 0, erreurs: 0 };
  const filtres = filtresProjets();
  const lecture = b.prepare("SELECT curseur, exclu FROM fichiers WHERE chemin = ?");
  for (const racine of racines) {
    for (const fichier of claude.fichiersDeSession(racine)) {
      bilan.fichiers++;
      try {
        const deja = lecture.get(fichier);
        let curseur = deja?.curseur ? JSON.parse(deja.curseur) : null;
        // Un projet laissé de côté puis ajouté au filtre : relu depuis le début.
        if (curseur && deja.exclu === "hors-filtre" && projetRetenu(claude.normaliserCwd(curseur.etat?.cwd || ""), filtres)) curseur = null;
        const st = fs.statSync(fichier, { bigint: true });
        if (curseur && curseur.ino === String(st.ino) && curseur.taille === Number(st.size) && curseur.offset === Number(st.size)) {
          bilan.inchanges++;
          continue;
        }
        const r = await claude.lireSession(fichier, curseur);
        bilan.lus++;
        bilan.illisibles += r.compte.illisibles;
        bilan.tropGrosses += r.compte.tropGrosses;
        const session = r.passages[0]?.session || fichier.split(/[\\/]/).pop().replace(/\.jsonl$/, "");
        const racineProjet = claude.normaliserCwd(r.etat.cwd || "");
        const projet = racineProjet ? claude.idProjet(racineProjet) : null;
        let exclu = null;
        if (r.exclue) exclu = `entrypoint:${r.etat.entrypoint}`;
        else if (!racineProjet) exclu = "sans-dossier";
        else if (!projetRetenu(racineProjet, filtres)) exclu = "hors-filtre";
        transaction((t) => {
          if (r.relu) t.prepare("DELETE FROM passages WHERE moteur = ? AND session = ?").run(SOURCE_CLAUDE, session);
          if (!exclu) {
            const ins = t.prepare(
              "INSERT OR IGNORE INTO passages (moteur, session, uuid, parent, projet, ts, auteur, texte) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            );
            let premiere = null;
            let derniere = null;
            for (const p of r.passages) {
              const res = ins.run(SOURCE_CLAUDE, p.session || session, p.uuid, p.parent, projet, p.ts, p.auteur, p.texte);
              if (res.changes) bilan.passages++;
              bilan.masques += p.masques;
              if (p.ts) {
                premiere = premiere === null ? p.ts : Math.min(premiere, p.ts);
                derniere = derniere === null ? p.ts : Math.max(derniere, p.ts);
              }
            }
            t.prepare(
              `INSERT INTO projets (id, racine, nom, premiere, derniere) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET premiere = MIN(COALESCE(projets.premiere, excluded.premiere), COALESCE(excluded.premiere, projets.premiere)),
                                             derniere = MAX(COALESCE(projets.derniere, 0), COALESCE(excluded.derniere, 0))`,
            ).run(projet, racineProjet, claude.nomProjet(racineProjet), premiere, derniere);
            t.prepare(
              `INSERT INTO conversations (moteur, id, projet, premiere, derniere) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(moteur, id) DO UPDATE SET projet = excluded.projet,
                 premiere = MIN(COALESCE(conversations.premiere, excluded.premiere), COALESCE(excluded.premiere, conversations.premiere)),
                 derniere = MAX(COALESCE(conversations.derniere, 0), COALESCE(excluded.derniere, 0))`,
            ).run(SOURCE_CLAUDE, session, projet, premiere, derniere);
          } else {
            bilan[exclu === "hors-filtre" ? "horsFiltre" : "exclus"]++;
          }
          t.prepare(
            `INSERT INTO fichiers (chemin, source, session, projet, curseur, exclu, lu_a) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(chemin) DO UPDATE SET session = excluded.session, projet = excluded.projet, curseur = excluded.curseur, exclu = excluded.exclu, lu_a = excluded.lu_a`,
          ).run(fichier, SOURCE_CLAUDE, session, projet, JSON.stringify(r.curseur), exclu, Date.now());
        });
        if (r.relu) bilan.relus++;
      } catch (err) {
        bilan.erreurs++;
        console.warn(`Mémoire de projets : session illisible (${err.code || err.name})`);
      }
    }
  }
  b.prepare("UPDATE journal_sync SET fin = ?, bilan = ? WHERE id = ?").run(Date.now(), JSON.stringify(bilan), journal.lastInsertRowid);
  return { ok: true, ...bilan, duree: Date.now() - debut };
}

// L'état pour l'app : la source, la dernière synchro, les projets vus.
export function etat() {
  const b = base();
  const derniere = b.prepare("SELECT debut, fin, bilan FROM journal_sync WHERE source = ? ORDER BY id DESC LIMIT 1").get(SOURCE_CLAUDE);
  const projets = b
    .prepare(
      `SELECT p.id, p.nom, p.premiere, p.derniere,
              (SELECT COUNT(*) FROM conversations c WHERE c.projet = p.id) AS sessions,
              (SELECT COUNT(*) FROM passages x WHERE x.projet = p.id) AS passages
         FROM projets p ORDER BY p.derniere DESC`,
    )
    .all();
  return {
    sources: {
      [SOURCE_CLAUDE]: {
        actif: sourceActive(),
        forceParLaTour: ["on", "off"].includes(envSource()),
        filtre: filtresProjets().length > 0,
        racines: claude.racines().length,
        derniereSync: derniere ? { debut: derniere.debut, fin: derniere.fin, bilan: derniere.bilan ? JSON.parse(derniere.bilan) : null } : null,
      },
    },
    projets: projets.map((p) => ({ ...p, sessions: Number(p.sessions), passages: Number(p.passages) })),
    chiffre: false, // stocké en clair sur le disque de la tour : dit, jamais simulé
  };
}

// Recherche dans le dialogue masqué : les passages les plus pertinents, avec
// leur source (session, date, uuid) pour pouvoir les citer.
export function chercher(q, { projet = null, limite = 8 } = {}) {
  const r = requeteFts(q);
  if (!r) return [];
  const lignes = base()
    .prepare(
      `SELECT p.session, p.uuid, p.ts, p.auteur, p.projet, pr.nom AS nomProjet,
              snippet(passages_fts, 0, '«', '»', '…', 24) AS extrait
         FROM passages_fts
         JOIN passages p ON p.id = passages_fts.rowid
         LEFT JOIN projets pr ON pr.id = p.projet
        WHERE passages_fts MATCH ? ${projet ? "AND p.projet = ?" : ""}
        ORDER BY bm25(passages_fts) LIMIT ?`,
    )
    .all(...(projet ? [r, projet, limite] : [r, limite]));
  return lignes;
}

// Oublier tout ce qui vient d'une source : passages, conversations, projets,
// curseurs. La source est coupée. Les sessions d'origine ne sont pas touchées.
export function purger(id = SOURCE_CLAUDE) {
  transaction((t) => {
    t.prepare("DELETE FROM passages WHERE moteur = ?").run(id);
    t.prepare("DELETE FROM conversations WHERE moteur = ?").run(id);
    t.prepare("DELETE FROM fichiers WHERE source = ?").run(id);
    t.prepare("DELETE FROM projets WHERE id NOT IN (SELECT DISTINCT projet FROM conversations WHERE projet IS NOT NULL)").run();
  });
  reglerSource(id, false);
  base().exec("INSERT INTO passages_fts (passages_fts) VALUES ('rebuild'); VACUUM;");
}
