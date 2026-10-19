// « Est-ce que je m'en sers vraiment ? »
//
// Deux mesures, volontairement distinctes :
//   - la PRÉSENCE : les moments où Rémy est ouvert devant Sam (le navigateur
//     envoie un signe de vie tant que l'écran est visible) ;
//   - l'ACTIVITÉ : les jours où Sam a réellement écrit quelque chose.
//
// Une journée passée avec l'app ouverte sans rien dire n'est pas une journée
// active : confondre les deux donnerait un chiffre flatteur et inutile.
//
// Rien du contenu n'est enregistré : des créneaux de 5 minutes et un compteur.
// Ce module ne fait aucune entrée/sortie — il se teste sans serveur ni base.

export const TZ = process.env.REMY_TZ || "Europe/Paris";
// Un créneau de 5 minutes : assez fin pour reconnaître « j'étais là de 9h05 à
// 9h40 », assez gros pour qu'une journée entière tienne en 288 nombres.
export const PAS_MIN = 5;
export const CRENEAUX_PAR_JOUR = (24 * 60) / PAS_MIN;

const formats = new Map();
function format(tz) {
  if (!formats.has(tz)) {
    // fr-CA rend les dates en AAAA-MM-JJ, et h23 évite le « 24 » de minuit.
    formats.set(
      tz,
      new Intl.DateTimeFormat("fr-CA", {
        timeZone: tz,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }),
    );
  }
  return formats.get(tz);
}

// Un instant → le jour et la minute LOCALE de Sam. Tout part de là : sur
// Vercel l'heure serveur est UTC, et une journée qui commence à 2h du matin
// n'aurait aucun sens pour lui.
export function horodate(ts = Date.now(), tz = TZ) {
  const p = Object.fromEntries(format(tz).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return {
    jour: `${p.year}-${p.month}-${p.day}`,
    minute: Number(p.hour) * 60 + Number(p.minute),
  };
}

export function creneauDe(ts = Date.now(), tz = TZ) {
  return Math.floor(horodate(ts, tz).minute / PAS_MIN);
}

function hhmm(minutes) {
  const h = Math.floor(minutes / 60);
  return `${String(h).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function creneauxValides(creneaux) {
  return [...new Set(creneaux || [])]
    .filter((n) => Number.isInteger(n) && n >= 0 && n < CRENEAUX_PAR_JOUR)
    .sort((a, b) => a - b);
}

export function minutesDe(creneaux) {
  return creneauxValides(creneaux).length * PAS_MIN;
}

// Les créneaux collés se recollent : « 09:05 → 09:40 » se lit, une liste de
// 7 nombres non.
export function plages(creneaux) {
  const tri = creneauxValides(creneaux);
  const brutes = [];
  for (const c of tri) {
    const derniere = brutes[brutes.length - 1];
    if (derniere && c === derniere.fin) derniere.fin = c + 1;
    else brutes.push({ debut: c, fin: c + 1 });
  }
  return brutes.map((p) => ({
    debut: hhmm(p.debut * PAS_MIN),
    fin: hhmm(p.fin * PAS_MIN),
    minutes: (p.fin - p.debut) * PAS_MIN,
  }));
}

// Les N derniers jours, du plus récent au plus ancien. Les libellés sont des
// étiquettes (pas des instants) : on fait l'arithmétique en UTC pour qu'un
// changement d'heure ne fasse ni sauter ni doubler une journée.
export function derniersJours(n, jourFin) {
  const base = Date.parse(`${jourFin}T00:00:00Z`);
  if (Number.isNaN(base)) return [];
  return Array.from({ length: Math.max(0, n) }, (_, i) =>
    new Date(base - i * 86_400_000).toISOString().slice(0, 10),
  );
}

// Une journée brute (telle que stockée) → une journée lisible.
export function jourLisible(jour, brut) {
  const creneaux = creneauxValides(brut?.creneaux);
  const messages = Number(brut?.messages) || 0;
  return {
    jour,
    minutes: creneaux.length * PAS_MIN,
    messages,
    plages: plages(creneaux),
    present: creneaux.length > 0,
    // « Actif » veut dire : Sam a parlé. Pas : l'app était ouverte.
    actif: messages > 0,
    premier: brut?.premier || null,
    dernier: brut?.dernier || null,
  };
}

// Série de jours actifs consécutifs. La journée en cours ne casse pas la série
// tant qu'elle n'est pas finie : sans ça, la série tomberait à zéro tous les
// matins avant le premier message.
export function serie(jours) {
  let n = 0;
  for (let i = 0; i < jours.length; i++) {
    if (jours[i].actif) n++;
    else if (i === 0) continue;
    else break;
  }
  return n;
}

export function resume(cartes, { jours = 14, aujourdhui } = {}) {
  const liste = derniersJours(jours, aujourdhui).map((j) => jourLisible(j, cartes?.[j]));
  const actifs = liste.filter((j) => j.actif).length;
  const presents = liste.filter((j) => j.present).length;
  const minutes = liste.reduce((s, j) => s + j.minutes, 0);
  return {
    jours: liste,
    aujourdhui: liste[0] || null,
    serie: serie(liste),
    joursActifs: actifs,
    joursPresents: presents,
    minutesTotal: minutes,
    messagesTotal: liste.reduce((s, j) => s + j.messages, 0),
    // Moyenne sur les jours où il était là : une moyenne diluée par les jours
    // d'absence ne dit rien de ses habitudes.
    minutesParJourPresent: presents ? Math.round(minutes / presents) : 0,
  };
}
