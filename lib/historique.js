// L'historique des actions (Lot 1, retours TestFlight 13) : le journal fiable
// du Lot 0, relu pour un humain — pas un second système. Date, objet, action,
// origine, avant → après, et « Annuler » quand c'est encore possible.

import { db } from "./db.js";
import { TZ } from "./activite.js";

const lire = (v, defaut) => {
  try {
    return v ? JSON.parse(v) : defaut;
  } catch {
    return defaut;
  }
};

const date = (v) => {
  const ms = typeof v === "number" ? v : Date.parse(v || "");
  return Number.isFinite(ms) ? new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ms)) : null;
};
const heure = (v) => {
  const ms = Date.parse(v || "");
  return Number.isFinite(ms) ? new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(ms)) : null;
};
const PRIO = { ASAP: "urgente", HIGH: "importante", MEDIUM: "normale", LOW: "basse" };

/** « tap · iPhone de Sam » → « Toi (iPhone de Sam) ». */
export function origineHumaine(o) {
  const [quoi, appareil] = String(o || "").split(" · ");
  const ou = appareil ? ` (${appareil})` : "";
  if (quoi === "tap") return `Toi${ou}`;
  if (quoi === "chat") return `Rémy, dans une conversation${ou}`;
  if (quoi === "capture") return `Capture${ou}`;
  if (quoi === "avant-lot-0") return "Avant le journal";
  if (quoi === "nuit" || quoi === "auto") return "Automatisation";
  if (quoi === "synchro") return "Synchronisation";
  return quoi || "—";
}

// Ce qui a changé, en mots (« échéance : jeu. 15 oct. → ven. 16 oct. »).
function changements(r, source) {
  const a = r.avant || {};
  const b = r.apres || {};
  const out = [];
  if (source === "agenda") {
    // avant : l'événement Google ({start: {dateTime}}) ; après : son état ({start: "…"}).
    const instant = (x) => (typeof x === "string" ? x : x?.dateTime || x?.date || null);
    const [d0, d1, f0, f1] = [instant(a.start), instant(b.start), instant(a.end), instant(b.end)];
    if (d0 && d1 && heure(d0) !== heure(d1)) out.push(`heure : ${heure(d0)} → ${heure(d1)}`);
    else if (f0 && f1 && heure(f0) !== heure(f1)) out.push(`fin : ${heure(f0)} → ${heure(f1)}`);
    if (a.summary && b.summary && a.summary !== b.summary) out.push(`nom : « ${a.summary} » → « ${b.summary} »`);
    return out;
  }
  if ("name" in b && a.name && b.name && a.name !== b.name) out.push(`nom : « ${a.name} » → « ${b.name} »`);
  if ("dueDate" in b && date(a.dueDate) !== date(b.dueDate)) out.push(`échéance : ${date(a.dueDate) || "aucune"} → ${date(b.dueDate) || "aucune"}`);
  if ("duration" in b && a.duration !== b.duration && b.duration != null) out.push(`durée : ${a.duration ?? "?"} → ${b.duration} min`);
  if ("priority" in b && a.priority !== b.priority && b.priority) out.push(`priorité : ${PRIO[a.priority] || a.priority || "?"} → ${PRIO[b.priority] || b.priority}`);
  return out;
}

function verbe(r, source, chg) {
  if (r.dejaLa) return "Déjà là";
  if (source === "agenda") {
    if (r.type === "creer") return "Ajouté à l'agenda";
    if (r.type === "supprimer") return "Retiré de l'agenda";
    if (chg.some((c) => c.startsWith("heure"))) return "Décalé";
    if (chg.some((c) => c.startsWith("fin"))) return "Prolongé";
    return "Modifié dans l'agenda";
  }
  if (r.type === "creer") return "Ajoutée à Motion";
  if (r.type === "terminer") return "Terminée";
  if (chg.length === 1 && chg[0].startsWith("échéance")) return "Replanifiée";
  if (chg.length === 1 && chg[0].startsWith("durée")) return "Durée changée";
  if (chg.length === 1 && chg[0].startsWith("nom")) return "Renommée";
  return "Modifiée";
}

export function historique({ limite = 80 } = {}) {
  const lignes = db().prepare("SELECT * FROM journal ORDER BY ts DESC LIMIT ?").all(Math.min(200, Math.max(1, limite)));
  return lignes.map((j) => {
    const results = lire(j.results, []);
    const actions = lire(j.actions, []);
    const base = results.length ? results : actions;
    const elements = base.slice(0, 12).map((r) => {
      const chg = r.ok === false ? [] : changements(r, j.source);
      return {
        objet: r.nom || r.titre || r.nouveau_nom || r.nouveau_titre || "—",
        action: r.ok === false ? "Échec" : verbe(r, j.source, chg),
        changements: chg,
        erreur: r.ok === false ? r.erreur || null : null,
      };
    });
    const annulable = !j.annule && ["appliquee", "appliquee_partiellement"].includes(j.etat) && results.some((r) => r.ok && r.annulable);
    return {
      id: j.id,
      ts: j.ts,
      source: j.source,
      origine: origineHumaine(j.origine),
      resume: j.resume || null,
      etat: j.etat,
      annule: Boolean(j.annule),
      annuleA: j.annule_a || null,
      annulable,
      elements,
    };
  });
}
