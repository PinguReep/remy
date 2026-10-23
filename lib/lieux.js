// La localisation (Sam, 20/10) : savoir où Sam en est dans sa journée — à la
// maison, à la salle, sur la route, chez un proche — pour que Rémy en tienne
// compte (notifications, conseils, tâches liées à un lieu).
//
//   - L'iPhone envoie des VISITES (arrivée, puis départ : iOS les détecte
//     seul, presque sans batterie) et des TRAJETS (en voiture). Jamais une
//     trace GPS continue.
//   - Chaque visite est rattachée à un LIEU : nommé par Sam, reconnu d'après
//     un rendez-vous de l'agenda à cet endroit, ou créé tel quel avec son
//     adresse, traduite SUR LA TOUR (lib/geocodage.js) — rien ne part ailleurs.
//   - Un lieu sans nom près d'un commerce connu (OpenStreetMap, sur la tour :
//     lib/commerces.js) devient « sans doute Salon Lumière (coiffeur) » — une
//     supposition, jusqu'à ce que Sam le nomme.
//   - Gardé 90 jours (REMY_LIEUX_JOURS), puis effacé ; tout s'efface d'un geste.
//   - Ce que Rémy en sait ne part qu'à GLM, jamais chez Claude (lib/chat.js).

import crypto from "node:crypto";
import fs from "node:fs";
import { cheminBase, db, transaction } from "./db.js";
import { adresseProche, distance, etatGeo } from "./geocodage.js";
import { commerceProche, etatCommerces, libelleCommerce } from "./commerces.js";
import { PRENOM } from "./profil.js";

export const JOURS = () => Number(process.env.REMY_LIEUX_JOURS) || 90;
export const lieuxActifs = () => process.env.REMY_LIEUX !== "off";
// Sans base, aucune visite n'a pu être enregistrée : rien à lire, et surtout
// rien à créer en passant (le chat ne fabrique pas la base pour une note vide).
export const lieuxConnus = () => lieuxActifs() && fs.existsSync(cheminBase());
const RAYON_DEFAUT = 80;
const TZ = () => process.env.REMY_TZ || "Europe/Paris";

const heure = (ms) => new Date(ms).toLocaleTimeString("fr-FR", { timeZone: TZ(), hour: "2-digit", minute: "2-digit" });
const jourDe = (ms) => new Date(ms).toLocaleDateString("fr-CA", { timeZone: TZ() }); // AAAA-MM-JJ

const plausible = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
const date = (v) => {
  const n = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(n) && n > 1_500_000_000_000 && n < Date.now() + 86_400_000 ? Math.round(n) : null;
};

// Le commerce le plus proche d'un lieu que Sam n'a pas nommé (relu à chaque
// fois : un nouvel import des commerces vaut tout de suite).
const commerceDe = (nom, lat, lon) => (nom ? null : commerceProche(lat, lon));
const deLieu = (l) =>
  l
    ? {
        id: l.id, nom: l.nom || null, adresse: l.adresse || null, lat: l.lat, lon: l.lon, rayon: l.rayon, source: l.source,
        commerce: commerceDe(l.nom, l.lat, l.lon),
      }
    : null;
export const nomAffiche = (l) =>
  l?.nom || (l?.commerce ? `sans doute ${libelleCommerce(l.commerce)}` : null) || l?.adresse || "un lieu sans adresse connue";
const ici = (v) => ({
  id: v.lieu_id, nom: v.nom || null, adresse: v.adresse || null,
  commerce: commerceDe(v.nom, v.llat ?? v.lat, v.llon ?? v.lon),
});

export function listerLieux() {
  return db()
    .prepare(
      `SELECT l.*, (SELECT COUNT(*) FROM visites v WHERE v.lieu_id = l.id) AS visites,
              (SELECT MAX(arrivee) FROM visites v WHERE v.lieu_id = l.id) AS derniere
         FROM lieux l ORDER BY derniere DESC`,
    )
    .all()
    .map((l) => ({ ...deLieu(l), visites: Number(l.visites), derniere: l.derniere || null }));
}

// Le lieu connu le plus proche, s'il couvre cette position.
function lieuPour(lat, lon) {
  let meilleur = null;
  let dMin = Infinity;
  for (const l of db().prepare("SELECT * FROM lieux").all()) {
    const d = distance({ lat, lon }, l);
    if (d <= l.rayon && d < dMin) {
      dMin = d;
      meilleur = l;
    }
  }
  return meilleur;
}

function creerLieu({ lat, lon, nom = null, source = "auto", rayon = RAYON_DEFAUT }) {
  const id = `lieu-${crypto.randomUUID().slice(0, 8)}`;
  const t = Date.now();
  db()
    .prepare("INSERT INTO lieux (id, nom, lat, lon, rayon, adresse, source, cree_a, maj_a) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, nom, lat, lon, rayon, adresseProche(lat, lon), source, t, t);
  return db().prepare("SELECT * FROM lieux WHERE id = ?").get(id);
}

// Les événements envoyés par l'iPhone. Une visite revient deux fois (arrivée,
// puis départ) avec le même identifiant : la seconde complète la première.
export function recevoir(evenements, { agenda = [] } = {}) {
  if (!lieuxActifs()) throw Object.assign(new Error("Localisation coupée sur la tour (REMY_LIEUX=off)."), { status: 409 });
  const liste = (Array.isArray(evenements) ? evenements : []).slice(0, 200);
  let visites = 0;
  let trajets = 0;
  let ecartes = 0;
  const maintenant = Date.now();
  transaction(() => {
    for (const e of liste) {
      const id = String(e?.id || "").slice(0, 80);
      if (!id) {
        ecartes++;
        continue;
      }
      if (e.type === "visite") {
        const lat = Number(e.lat);
        const lon = Number(e.lon);
        const arrivee = date(e.arrivee);
        const depart = e.depart == null ? null : date(e.depart);
        if (!plausible(lat, lon) || !arrivee || (depart && depart < arrivee)) {
          ecartes++;
          continue;
        }
        const deja = db().prepare("SELECT lieu_id FROM visites WHERE id = ?").get(id);
        let lieuId = deja?.lieu_id;
        if (!lieuId) {
          const l = lieuPour(lat, lon) || lieuDAgenda(lat, lon, arrivee, agenda) || creerLieu({ lat, lon });
          lieuId = l.id;
        }
        db()
          .prepare(
            `INSERT INTO visites (id, arrivee, depart, lat, lon, precision, lieu_id, recu_a) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET depart = COALESCE(excluded.depart, visites.depart), recu_a = excluded.recu_a`,
          )
          .run(id, arrivee, depart, lat, lon, Number.isFinite(Number(e.precision)) ? Math.round(Number(e.precision)) : null, lieuId, maintenant);
        visites++;
      } else if (e.type === "trajet") {
        const debut = date(e.debut);
        const fin = e.fin == null ? null : date(e.fin);
        if (!debut || (fin && fin < debut) || e.mode !== "voiture") {
          ecartes++;
          continue;
        }
        db()
          .prepare(
            `INSERT INTO trajets (id, debut, fin, mode, recu_a) VALUES (?, ?, ?, 'voiture', ?)
             ON CONFLICT(id) DO UPDATE SET fin = COALESCE(excluded.fin, trajets.fin), recu_a = excluded.recu_a`,
          )
          .run(id, debut, fin, maintenant);
        trajets++;
      } else {
        ecartes++;
      }
    }
  });
  return { visites, trajets, ecartes };
}

// « Assimilation » (Sam, 20/10) : un rendez-vous de l'agenda qui a lieu à ce
// moment-là, dont le lieu cite la rue où se trouve Sam, donne son nom au lieu
// (« Coiffeur », « Dentiste »). `agenda` : [{ summary, location, debut, fin }].
const plat = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function lieuDAgenda(lat, lon, arrivee, agenda) {
  if (!agenda?.length) return null;
  const adr = adresseProche(lat, lon);
  if (!adr) return null;
  // « 12 Rue de la République, 69001 Lyon » → « rue de la republique »
  const voie = plat(adr.split(",")[0].replace(/^\S*\d\S*\s+/, ""));
  if (voie.length < 6) return null;
  for (const ev of agenda) {
    const debut = Number(ev.debut);
    const fin = Number(ev.fin) || debut + 3_600_000;
    if (!Number.isFinite(debut) || arrivee < debut - 45 * 60_000 || arrivee > fin) continue;
    if (!plat(ev.location).includes(voie)) continue;
    return creerLieu({ lat, lon, nom: String(ev.summary || "").slice(0, 80) || null, source: "agenda" });
  }
  return null;
}

// Sam nomme un lieu : le plus proche de la position s'il la couvre, sinon un nouveau.
export function nommer({ id = null, lat, lon, nom, rayon = null }) {
  const n = String(nom || "").trim().slice(0, 80);
  if (!n) throw Object.assign(new Error("Il faut un nom (ex. « Salle de sport »)."), { status: 400 });
  let l = id ? db().prepare("SELECT * FROM lieux WHERE id = ?").get(String(id)) : null;
  if (id && !l) throw Object.assign(new Error("Lieu introuvable."), { status: 404 });
  if (!l) {
    if (!plausible(Number(lat), Number(lon))) throw Object.assign(new Error("Position illisible."), { status: 400 });
    l = lieuPour(Number(lat), Number(lon)) || creerLieu({ lat: Number(lat), lon: Number(lon), source: "sam" });
  }
  const r = Number.isFinite(Number(rayon)) ? Math.min(500, Math.max(30, Math.round(Number(rayon)))) : l.rayon;
  db().prepare("UPDATE lieux SET nom = ?, source = 'sam', rayon = ?, maj_a = ? WHERE id = ?").run(n, r, Date.now(), l.id);
  return deLieu(db().prepare("SELECT * FROM lieux WHERE id = ?").get(l.id));
}

export function supprimerLieu(id) {
  transaction((d) => {
    const r = d.prepare("DELETE FROM lieux WHERE id = ?").run(String(id));
    if (!r.changes) throw Object.assign(new Error("Lieu introuvable."), { status: 404 });
    d.prepare("UPDATE visites SET lieu_id = NULL WHERE lieu_id = ?").run(String(id));
  });
}

// Tout oublier : visites, trajets, et les lieux que Sam n'a pas nommés.
export function effacerHistorique() {
  transaction((d) => {
    d.exec("DELETE FROM visites; DELETE FROM trajets; DELETE FROM lieux WHERE source != 'sam';");
  });
}

// Au-delà de 90 jours, plus rien (les lieux nommés restent ; les autres, sans
// visite, partent avec).
export function purger(maintenant = Date.now()) {
  const limite = maintenant - JOURS() * 86_400_000;
  let n = 0;
  transaction((d) => {
    n += Number(d.prepare("DELETE FROM visites WHERE arrivee < ?").run(limite).changes);
    n += Number(d.prepare("DELETE FROM trajets WHERE debut < ?").run(limite).changes);
    d.prepare("DELETE FROM lieux WHERE source != 'sam' AND id NOT IN (SELECT DISTINCT lieu_id FROM visites WHERE lieu_id IS NOT NULL)").run();
  });
  return n;
}

// Où en est Sam, maintenant.
export function etat(maintenant = Date.now()) {
  const visite = db()
    .prepare("SELECT v.*, l.nom, l.adresse, l.lat AS llat, l.lon AS llon FROM visites v LEFT JOIN lieux l ON l.id = v.lieu_id ORDER BY v.arrivee DESC LIMIT 1")
    .get();
  const trajet = db().prepare("SELECT * FROM trajets ORDER BY debut DESC LIMIT 1").get();
  const enVoiture = trajet && !trajet.fin && maintenant - trajet.debut < 6 * 3_600_000 && (!visite || trajet.debut > visite.arrivee);
  if (enVoiture) return { ou: "voiture", depuis: trajet.debut };
  if (visite && !visite.depart && maintenant - visite.arrivee < 24 * 3_600_000) {
    return { ou: "lieu", depuis: visite.arrivee, lieu: ici(visite) };
  }
  if (visite) return { ou: "inconnu", dernier: { lieu: visite.nom || visite.adresse || null, depart: visite.depart || null } };
  return { ou: "inconnu" };
}

// Les visites d'un jour (heure de Paris).
export function journee(jour = jourDe(Date.now())) {
  return db()
    .prepare("SELECT v.*, l.nom, l.adresse, l.lat AS llat, l.lon AS llon FROM visites v LEFT JOIN lieux l ON l.id = v.lieu_id ORDER BY v.arrivee")
    .all()
    .filter((v) => jourDe(v.arrivee) === jour)
    .map((v) => ({ id: v.id, arrivee: v.arrivee, depart: v.depart || null, lieu: ici(v) }));
}

// Ce que Rémy sait de la position de Sam, pour sa consigne — GLM seulement.
// `taches` : noms des tâches Motion ouvertes, pour celles liées au lieu actuel.
export function noteLieux({ maintenant = Date.now(), taches = [] } = {}) {
  if (!lieuxActifs()) return null;
  const e = etat(maintenant);
  const jour = journee(jourDe(maintenant));
  if (e.ou === "inconnu" && !jour.length) return null;
  const lignes = [];
  if (e.ou === "voiture") lignes.push(`En ce moment : en voiture (depuis ${heure(e.depuis)}) — réponses courtes, rien à lire longuement.`);
  else if (e.ou === "lieu") lignes.push(`En ce moment : ${nomAffiche(e.lieu)} (depuis ${heure(e.depuis)}).`);
  if (jour.length) {
    lignes.push(
      `Aujourd'hui : ${jour
        .slice(-8)
        .map((v) => `${nomAffiche(v.lieu)} ${heure(v.arrivee)}${v.depart ? `–${heure(v.depart)}` : ""}`)
        .join(" · ")}.`,
    );
  }
  if (e.ou === "lieu") {
    const mots = `${e.lieu.nom || ""} ${e.lieu.adresse || ""} ${e.lieu.commerce?.nom || ""} ${e.lieu.commerce?.type || ""}`
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((m) => m.length >= 4);
    const liees = taches.filter((t) => {
      const n = String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      return mots.some((m) => n.includes(m));
    });
    if (liees.length) lignes.push(`Tâches qui semblent liées à ce lieu : ${liees.slice(0, 5).map((t) => `« ${t} »`).join(", ")} — tu peux proposer de les cocher ou de décaler la suite.`);
  }
  return (
    `# Où est ${PRENOM} (localisation de son iPhone, sur sa tour)\n\n${lignes.join("\n")}\n\n` +
    `Ce sont des repères, pas des certitudes : dis « je crois que tu es… » et laisse ${PRENOM} corriger. Ne cite jamais d'adresse sans raison.`
  );
}

export function vue(maintenant = Date.now()) {
  return {
    actif: lieuxActifs(),
    jours: JOURS(),
    etat: etat(maintenant),
    aujourdhui: journee(jourDe(maintenant)),
    lieux: listerLieux(),
    geocodage: etatGeo(),
    commerces: etatCommerces(),
  };
}
