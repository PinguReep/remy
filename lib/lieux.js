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
import { etatMajCommerces } from "./commerces-maj.js";
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

// Une visite qui couvre 3 h du matin (heure de la tour) : on y a dormi.
const formats = new Map(); // un formateur par fuseau : les créer coûte cher
const heureLocale = (ms) => {
  const tz = TZ();
  if (!formats.has(tz)) {
    formats.set(tz, new Intl.DateTimeFormat("fr-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }));
  }
  const p = Object.fromEntries(formats.get(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { jour: `${p.year}-${p.month}-${p.day}`, heure: Number(p.hour) };
};
export function couvreLaNuit(arrivee, fin) {
  if (!Number.isFinite(arrivee) || !Number.isFinite(fin) || fin <= arrivee) return false;
  if (fin - arrivee >= 24 * 3_600_000) return true;
  const a = heureLocale(arrivee);
  const f = heureLocale(fin);
  if (a.jour === f.jour) return a.heure < 3 && f.heure >= 3;
  return a.heure < 3 || f.heure >= 3; // la nuit passe entre les deux jours
}

// Un lieu où Sam a dormi, ou passé des heures (chez lui, au bureau, chez un
// proche, à l'hôtel), n'est pas un commerce, même avec une boulangerie en bas :
// une visite qui couvre 3 h du matin, ou 4 h dans la même journée (le bureau,
// avec la pause de midi ailleurs). Une visite dont le départ s'est perdu
// s'arrête à l'arrivée suivante, ailleurs.
const LONGUE_MS = 4 * 3_600_000;
function lieuDeVie(lieuId, maintenant = Date.now()) {
  const parJour = new Map();
  return db()
    .prepare(
      `SELECT v.arrivee, COALESCE(v.depart, (SELECT MIN(w.arrivee) FROM visites w WHERE w.arrivee > v.arrivee)) AS fin
         FROM visites v WHERE v.lieu_id = ? ORDER BY v.arrivee DESC LIMIT 60`,
    )
    .all(String(lieuId))
    .some((v) => {
      const fin = v.fin ?? maintenant;
      if (fin - v.arrivee >= LONGUE_MS || couvreLaNuit(v.arrivee, fin)) return true;
      const jour = heureLocale(v.arrivee).jour;
      parJour.set(jour, (parJour.get(jour) || 0) + Math.max(0, fin - v.arrivee));
      return parJour.get(jour) >= LONGUE_MS;
    });
}

// -1 d'iOS, absente, 0 : on ne sait pas où est Sam à quelques mètres près.
const connue = (p) => Number.isFinite(p) && p > 0;
// Facultatif : une base des commerces illisible, un fuseau mal saisi ne
// bloquent jamais l'enregistrement d'une visite (ni la vue) — rien de supposé.
function sansPanne(f) {
  try {
    return f();
  } catch (err) {
    console.warn("Commerces illisibles :", err.message);
    return null;
  }
}
// Le commerce où était sans doute Sam, pour un lieu qu'il n'a pas nommé (relu
// à chaque fois : un nouvel import des commerces vaut tout de suite). Une
// visite dont le lieu a été oublié n'en a pas.
const commerceDe = (lieuId, nom, lat, lon, precision) =>
  !lieuId || nom || !connue(precision) ? null : sansPanne(() => (lieuDeVie(lieuId) ? null : commerceProche(lat, lon, { precision })));
// Un lieu automatique est centré sur la visite qui l'a créé (même position) :
// sa précision vaut pour lui. Partie avec les 90 jours : le centre n'est plus étayé.
function commerceDuLieu(l) {
  if (l.nom) return null;
  const f = db().prepare("SELECT precision FROM visites WHERE lieu_id = ? AND lat = ? AND lon = ? ORDER BY arrivee LIMIT 1").get(String(l.id), l.lat, l.lon);
  return f ? commerceDe(l.id, l.nom, l.lat, l.lon, f.precision) : null;
}
const deLieu = (l) =>
  l
    ? {
        id: l.id, nom: l.nom || null, adresse: l.adresse || null, lat: l.lat, lon: l.lon, rayon: l.rayon, source: l.source,
        commerce: commerceDuLieu(l),
      }
    : null;
export const nomAffiche = (l) =>
  l?.nom || (l?.commerce ? `sans doute ${libelleCommerce(l.commerce)}` : null) || l?.adresse || "un lieu sans adresse connue";
// Une visite : le commerce à SA position (le lieu couvre 80 m), avec sa précision.
const ici = (v) => ({
  id: v.lieu_id, nom: v.nom || null, adresse: v.adresse || null,
  commerce: commerceDe(v.lieu_id, v.nom, v.lat, v.lon, v.precision),
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

// Les lieux connus qui couvrent cette position, du plus proche au plus loin.
function lieuxPour(lat, lon) {
  return db()
    .prepare("SELECT * FROM lieux")
    .all()
    .map((l) => ({ l, d: distance({ lat, lon }, l) }))
    .filter((x) => x.d <= x.l.rayon)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.l);
}
const lieuPour = (lat, lon) => lieuxPour(lat, lon)[0] || null;

// Le lieu d'une nouvelle visite. Un lieu automatique couvre 80 m : la
// boulangerie et le coiffeur d'en face n'y font pas un seul lieu (sinon, chez
// le coiffeur, « sans doute la boulangerie ») — la visite va au plus proche des
// lieux qui ne sont pas sans doute un autre commerce.
function lieuDeLaVisite(lat, lon, precision) {
  const lieux = lieuxPour(lat, lon);
  if (!lieux.length) return null;
  const la = connue(precision) ? sansPanne(() => commerceProche(lat, lon, { precision })) : null;
  return (
    lieux.find((l) => {
      if (!la || l.nom) return true;
      const lui = commerceDuLieu(l);
      return !lui || lui.osm === la.osm;
    }) || null
  );
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
  const effaces = new Set(lireEffaces());
  let visites = 0;
  let trajets = 0;
  let ecartes = 0;
  const maintenant = Date.now();
  transaction(() => {
    for (const e of liste) {
      const id = String(e?.id || "").slice(0, 80);
      if (!id || effaces.has(id)) {
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
        const brute = e.precision == null ? NaN : Number(e.precision);
        const precision = Number.isFinite(brute) && brute >= 0 ? Math.round(brute) : null; // iOS : -1 si inconnue
        const deja = db().prepare("SELECT lieu_id FROM visites WHERE id = ?").get(id);
        // Le départ d'une visite déjà rangée la complète, sans recréer un lieu
        // que Sam a oublié entre-temps.
        let lieuId = deja ? deja.lieu_id : null;
        if (!deja) {
          const l = lieuDeLaVisite(lat, lon, precision) || lieuDAgenda(lat, lon, arrivee, agenda) || creerLieu({ lat, lon });
          lieuId = l.id;
        }
        db()
          .prepare(
            `INSERT INTO visites (id, arrivee, depart, lat, lon, precision, lieu_id, recu_a) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET depart = COALESCE(excluded.depart, visites.depart), recu_a = excluded.recu_a`,
          )
          .run(id, arrivee, depart, lat, lon, precision, lieuId, maintenant);
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
    // Nommé d'après UN rendez-vous : il ne couvre que ce cabinet, pas la boulangerie à 50 m.
    return creerLieu({ lat, lon, nom: String(ev.summary || "").slice(0, 80) || null, source: "agenda", rayon: 30 });
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

// Tout oublier : visites, trajets, et les lieux que Sam n'a pas nommés. Une
// visite (ou un trajet) en cours : iOS livrera sa fin plus tard, avec le même
// identifiant — elle ne doit pas revenir.
const lireEffaces = () => {
  try {
    return JSON.parse(db().prepare("SELECT valeur FROM meta WHERE cle = 'lieux_effaces'").get()?.valeur || "[]");
  } catch {
    return [];
  }
};
export function effacerHistorique() {
  transaction((d) => {
    const enCours = d.prepare("SELECT id FROM visites WHERE depart IS NULL UNION SELECT id FROM trajets WHERE fin IS NULL").all().map((r) => r.id);
    const garder = [...new Set([...lireEffaces(), ...enCours])].slice(-500);
    d.prepare("INSERT INTO meta (cle, valeur) VALUES ('lieux_effaces', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(JSON.stringify(garder));
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
    .prepare("SELECT v.*, l.nom, l.adresse FROM visites v LEFT JOIN lieux l ON l.id = v.lieu_id ORDER BY v.arrivee DESC LIMIT 1")
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
    .prepare("SELECT v.*, l.nom, l.adresse FROM visites v LEFT JOIN lieux l ON l.id = v.lieu_id ORDER BY v.arrivee")
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
    // Un lieu nommé : ses mots. Un lieu supposé : le type ou le nom du commerce
    // en entier (« salle de sport », pas « salle »), et Sam confirme d'abord.
    const mots = (e.lieu.nom ? `${e.lieu.nom} ${e.lieu.adresse || ""}` : "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((m) => m.length >= 4);
    const suppose = !e.lieu.nom && e.lieu.commerce ? [e.lieu.commerce.type, e.lieu.commerce.nom].filter(Boolean).map((x) => ` ${plat(x)} `) : [];
    const liees = taches.filter((t) => {
      const n = String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      return mots.some((m) => n.includes(m)) || suppose.some((x) => ` ${plat(t)} `.includes(x));
    });
    if (liees.length) {
      const suite = e.lieu.nom ? "tu peux proposer de les cocher ou de décaler la suite" : `demande d'abord à ${PRENOM} s'il y est vraiment`;
      lignes.push(`Tâches qui semblent liées à ce lieu : ${liees.slice(0, 5).map((t) => `« ${t} »`).join(", ")} — ${suite}.`);
    }
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
    // `maj` : la mise à jour mensuelle (dernière, prochaine, dernier échec).
    commerces: (() => {
      const e = etatCommerces();
      let maj = null;
      try {
        maj = etatMajCommerces(e);
      } catch {}
      return { ...e, maj };
    })(),
  };
}
