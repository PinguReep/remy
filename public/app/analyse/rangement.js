// Une capture à plusieurs intentions, analysée par le modèle local puis
// VALIDÉE par Sam : chaque élément coché part vers sa vraie place, une seule
// fois. Le port de Rangement.swift (`BilanRangement`, `ElementCapture.pret`
// et `.destination`, `AppModel.ranger`, `ecrireTaches`) et de
// `OrganisationModel.suggestion` (Organisation.swift).
//   - tâche → Motion, par lots de 6 en UNE écriture (échéance et durée seulement si dites) ;
//   - rappel → rappel (avec ses étiquettes) ;
//   - contrainte (« dispo limitée samedi ») → rappel ce jour-là : pas de créneau inventé ;
//   - liste → la liste nommée (créée si besoin) ;
//   - note → le dossier « Notes » ;
//   - rendez-vous → l'agenda, seulement si l'heure est connue (sinon refusé) ;
//   - projet → un dossier de Remy (sous le projet ou dossier suggéré).
// Module sans DOM : les écritures passent par `appel(chemin, options)`, fourni
// par noter.js (api.js) ou par les tests.
import { plier } from "./dates.js";

// --- Formats (Format.swift, heure de la machine) ---
const F_JOUR = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const F_HEURE = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
/** « mer. 23 oct. » */
export const jourSemaineCourt = (ms) => F_JOUR.format(new Date(ms));
/** « 09:05 » */
export const heure = (ms) => F_HEURE.format(new Date(ms));
/** « 2 h 50 », « 40 min ». */
export function duree(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}
/** « 2026-10-30T23:00:00+01:00 » : une date avec le décalage de la machine, jamais en UTC. */
export function isoAvecFuseau(d) {
  const z = -d.getTimezoneOffset();
  const p = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${z >= 0 ? "+" : "-"}${p(z / 60)}:${p(z % 60)}`;
}

// --- Le récapitulatif ---

/** Prêt à partir sans précision de Sam (un rendez-vous a besoin de son heure). */
export function pret(e) {
  if (e?.nature === "rendez-vous") return e.quand != null && e.heureConnue === true;
  return e?.question == null;
}

/** Où l'élément ira, en mots (récapitulatif avant validation). */
export function destination(e, { agenda = false } = {}) {
  const date = e.quand != null ? (e.heureConnue === true ? `${jourSemaineCourt(e.quand)} ${heure(e.quand)}` : jourSemaineCourt(e.quand)) : null;
  const d = e.dureeMin ? `, ${duree(e.dureeMin)}` : "";
  switch (e.nature) {
    case "tache": return `Tâche Motion${date ? `, avant le ${date}` : ""}${d}`;
    case "rappel": return `Rappel${date ? ` le ${date}` : ", sans date"}`;
    case "contrainte": return `Rappel${date ? ` le ${date}` : ""} (pas de créneau bloqué)`;
    case "liste": return `Liste « ${e.liste || "Courses"} »${(e.articles?.length || 0) > 1 ? ` · ${e.articles.length} articles` : ""}`;
    case "note": return "Notes (Projets)";
    case "rendez-vous":
      if (!date || e.heureConnue !== true) return "Rendez-vous : heure manquante";
      return `${agenda ? "Agenda" : "Rappel"} · ${date}${d}`;
    case "projet": return `Nouveau dossier${e.parent ? ` dans « ${e.parent} »` : ""}`;
    default: return String(e.nature || "");
  }
}

/** Les éléments cochés dans l'ordre, et si « Ranger » peut partir. */
export function etatRangement(elements, coches) {
  const choisis = elements.filter((e) => coches.has(e.cle));
  return { choisis, possible: choisis.length > 0 && choisis.every(pret) };
}

/** « Ranger 3 éléments ». */
export const libelleRanger = (n) => `Ranger ${n} élément${n > 1 ? "s" : ""}`;

/**
 * La phrase du bilan (BilanRangement.phrase) : tout bon, rien de neuf, tout
 * raté, ou un mélange — « déjà là » n'est ni fait ni raté.
 */
export function phraseBilan({ faits = [], echecs = [], dejaLa = [] } = {}) {
  const deja = dejaLa.join(" ; ");
  if (!echecs.length) {
    if (!faits.length) return dejaLa.length ? `Rien de nouveau, déjà là : ${deja}.` : "Rien à ranger.";
    const base = faits.length === 1 ? `Rangé : ${faits[0]}` : `${faits.length} éléments rangés`;
    return base + (dejaLa.length ? ` ; déjà là : ${deja}.` : ".");
  }
  if (!faits.length && !dejaLa.length) return `Rien n'a été rangé : ${echecs.join(" ; ")}.`;
  const morceaux = [];
  if (faits.length) morceaux.push(`${faits.length} rangé${faits.length > 1 ? "s" : ""}`);
  if (dejaLa.length) morceaux.push((morceaux.length ? "déjà là : " : "Déjà là : ") + deja);
  morceaux.push(`pas fait : ${echecs.join(" ; ")}`);
  return `${morceaux.join(" ; ")}.`;
}

/** Des lots de `taille` (les tâches partent par 6 : une relecture de Motion par lot). */
export function lots(liste, taille = 6) {
  const out = [];
  for (let i = 0; i < liste.length; i += taille) out.push(liste.slice(i, i + taille));
  return out;
}

// --- Ce que rend une écriture (Motion ou l'agenda) ---

/** Déjà dans Motion ou dans l'agenda : rien n'a été créé (une tour d'avant le 24/10 le disait en échec). */
export const estDejaLa = (x) => x?.dejaLa === true || x?.deja_la === true
  || (x?.ok === false && /existe déjà dans Motion|déjà dans ton agenda/.test(x?.erreur || ""));
/** Rien d'écrit parce que tout existait déjà. */
export const toutDejaLa = (r) => r?.etat === "deja_la" || (Array.isArray(r?.results) && r.results.length > 0 && r.results.every(estDejaLa));
/** Échecs réels, sans les doublons évités. */
export const vraisEchecs = (r) => (r?.results || []).filter((x) => x?.ok !== true && !estDejaLa(x)).length;

/** Ce qu'est devenue chaque tâche d'un lot envoyé à Motion : { etat: fait | dejaLa | echec, erreur }. */
export function etatsLot(r, n) {
  const res = r?.results || [];
  return Array.from({ length: n }, (_, k) => {
    if (k < res.length) {
      const x = res[k];
      if (estDejaLa(x)) return { etat: "dejaLa" };
      if (x?.ok === true) return { etat: "fait" };
      return { etat: "echec", erreur: x?.erreur || "refusé par Motion" };
    }
    if (toutDejaLa(r)) return { etat: "dejaLa" };
    // Réponse sans détail par ligne : l'état d'ensemble.
    return vraisEchecs(r) === 0 && r?.etat !== "echouee" ? { etat: "fait" } : { etat: "echec", erreur: "refusé par Motion" };
  });
}

// --- Où ranger un projet ---

const egal = (a, b) => plier(String(a || "").trim()) === plier(String(b || "").trim());

/** Le nom suggéré → un dossier existant, sinon un projet Motion (« motion:<id> »), sinon null. */
export function parentPour(nom, { dossiers, projets } = {}) {
  const n = String(nom || "").trim();
  if (!n) return null;
  const d = (dossiers || []).find((x) => egal(x.nom, n));
  if (d) return d.id;
  const p = (projets || []).find((x) => egal(x.nom, n));
  return p ? `motion:${p.id}` : null;
}

/** Les mots de 4 lettres et plus, sans casse ni accents. */
export const mots = (t) => plier(String(t || "")).split(/[^\p{L}\p{N}]+/u).filter((m) => [...m].length >= 4);

/** Les endroits où ranger un dossier : les projets Motion, puis les dossiers existants. */
export const candidatsParent = ({ dossiers, projets } = {}) => [
  ...(projets || []).map((p) => ({ id: `motion:${p.id}`, nom: p.nom })),
  ...(dossiers || []).map((d) => ({ id: d.id, nom: d.nom })),
];

/** Le parent deviné par les mots en commun (OrganisationModel.suggestion) : { id, nom } ou null. */
export function suggestion(titre, connu = {}) {
  const voulus = new Set(mots(titre));
  if (!voulus.size) return null;
  let meilleur = null;
  for (const c of candidatsParent(connu)) {
    const n = new Set(mots(c.nom).filter((m) => voulus.has(m))).size;
    if (n > 0 && (!meilleur || n > meilleur.n)) meilleur = { ...c, n };
  }
  return meilleur ? { id: meilleur.id, nom: meilleur.nom } : null;
}

/** La place d'un nouveau dossier parmi ses frères : après le dernier. */
export function ordreApres(dossiers, parent = null) {
  const freres = (dossiers || []).filter((d) => (d.parent ?? null) === (parent ?? null)).map((d) => d.ordre).filter(Number.isFinite);
  return (freres.length ? Math.max(...freres) : -1) + 1;
}

// --- Les écritures ---

/** L'action Motion d'une tâche (échéance et durée seulement si dites). */
export function actionTache(e) {
  const a = { type: "creer", nom: String(e.titre).trim().slice(0, 200) };
  if (e.quand != null) a.echeance = isoAvecFuseau(new Date(e.quand));
  if (e.dureeMin) a.duree = e.dureeMin;
  if (e.etiquettes?.length) a.etiquettes = e.etiquettes;
  return a;
}
/** L'action d'agenda d'un rendez-vous à heure connue (une heure par défaut). */
export const actionAgenda = (e) => ({ type: "creer", titre: String(e.titre).trim().slice(0, 200), debut: isoAvecFuseau(new Date(e.quand)), duree: e.dureeMin ?? 60 });

const raison = (err) => (typeof err === "string" ? err : err?.message) || "erreur";

/**
 * Range les éléments validés. `appel(chemin, { methode, corps, delai })` fait
 * la requête (lève une erreur lisible) ; `connu` : { listes, dossiers, projets }
 * (complété au fil des créations) ; `agenda` : l'agenda est branché ;
 * `graine` : préfixe des identifiants (un nouvel essai réécrit les mêmes lignes
 * au lieu de les doubler) ; `nouvelId` : une clé d'écriture neuve.
 * Rend { faits, echecs, dejaLa, regles } — `regles` : les clés rangées ou déjà
 * là ; un nouveau « Ranger » ne renvoie que ce qui a raté.
 */
export async function ranger(elements, { appel, connu = {}, agenda = false, graine = "capture", nouvelId = () => `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, surAuth } = {}) {
  const bilan = { faits: [], echecs: [], dejaLa: [], regles: [] };
  connu.listes ||= [];
  connu.dossiers ||= [];
  connu.projets ||= [];
  const idDe = (e, suffixe = "") => `${graine}-${e.cle}${suffixe}`.replace(/[^A-Za-z0-9:_.-]/g, "-").slice(0, 150);
  const echec = (titre, err, quoi = "") => {
    if (err?.nature === "auth") surAuth?.(err);
    bilan.echecs.push(`« ${titre} »${quoi} : ${raison(err)}`);
  };
  const rappel = async (e, titre, quand, etiquettes) => {
    const r = await appel("/api/rappels", { methode: "POST", corps: { rappels: [{ id: idDe(e), texte: titre.slice(0, 300), quand: quand ?? null, etiquettes: etiquettes || [] }] } });
    return Boolean(r?.dejaLa?.length);
  };
  const taches = [];
  for (const e of elements) {
    const titre = String(e.titre || "").trim();
    if (!titre) continue;
    const avant = bilan.echecs.length;
    let differe = false;
    try {
      switch (e.nature) {
        case "tache":
          taches.push({ cle: e.cle, titre, action: actionTache({ ...e, titre }) });
          differe = true;
          break;
        case "rappel": case "contrainte":
          if (await rappel(e, titre, e.quand, e.etiquettes)) bilan.dejaLa.push(`« ${titre} » (rappels)`);
          else bilan.faits.push(`« ${titre} » (rappel)`);
          break;
        case "liste": {
          const nom = e.liste || "Courses";
          let l = connu.listes.find((x) => egal(x.nom, nom));
          if (!l) {
            l = { id: idDe(e, "-liste"), nom };
            await appel(`/api/listes/${encodeURIComponent(l.id)}`, { methode: "PUT", corps: { nom, ordre: connu.listes.length } });
            connu.listes.push(l);
          }
          const articles = e.articles?.length ? e.articles : [titre];
          const elementsListe = articles.map((t, i) => ({ id: idDe(e, `-${i}`), texte: String(t).slice(0, 200), fait: false }));
          const r = await appel(`/api/listes/${encodeURIComponent(l.id)}/elements`, { methode: "POST", corps: { elements: elementsListe } });
          const deja = new Set((r?.dejaLa || []).map((x) => x.id));
          const nouveaux = elementsListe.filter((x) => !deja.has(x.id));
          const dejaTextes = elementsListe.filter((x) => deja.has(x.id)).map((x) => `« ${x.texte} »`);
          if (nouveaux.length) bilan.faits.push(`liste « ${l.nom} »`);
          if (dejaTextes.length) bilan.dejaLa.push(`${dejaTextes.join(", ")} (liste « ${l.nom} »)`);
          break;
        }
        case "note":
          if (!connu.dossiers.some((d) => d.id === "notes")) {
            await appel("/api/dossiers/notes", { methode: "PUT", corps: { nom: "Notes", parent: null, ordre: -1 } });
            connu.dossiers.push({ id: "notes", nom: "Notes", parent: null, ordre: -1 });
          }
          await appel("/api/dossiers/notes/notes", { methode: "POST", corps: { notes: [{ id: idDe(e), texte: titre.slice(0, 500), fait: false }] } });
          bilan.faits.push(`« ${titre} » (note)`);
          break;
        case "rendez-vous":
          // Sans heure, pas de créneau inventé : refusé, Sam la complète.
          if (e.quand == null || e.heureConnue !== true) {
            bilan.echecs.push(`« ${titre} » : heure manquante`);
            break;
          }
          if (agenda) {
            const r = await appel("/api/google/apply", { methode: "POST", corps: { actions: [actionAgenda({ ...e, titre })], resume: "Capture rangée", origine: "capture", idCommande: nouvelId() }, delai: 150000 });
            const res = r?.results?.[0];
            if (toutDejaLa(r)) bilan.dejaLa.push(`« ${titre} » (agenda)`);
            else if (vraisEchecs(r) > 0 || (res?.ok === false && !estDejaLa(res))) bilan.echecs.push(`« ${titre} » : ${res?.erreur || "refusé par l'agenda"}`);
            else bilan.faits.push(`« ${titre} » (agenda)`);
          } else if (await rappel(e, titre, e.quand, e.etiquettes)) bilan.dejaLa.push(`« ${titre} » (rappels)`);
          else bilan.faits.push(`« ${titre} » (rappel : agenda non branché)`);
          break;
        case "projet": {
          const parent = parentPour(e.parent, connu);
          const id = idDe(e, "-dossier");
          const ordre = ordreApres(connu.dossiers, parent);
          await appel(`/api/dossiers/${encodeURIComponent(id)}`, { methode: "PUT", corps: { nom: titre.slice(0, 120), parent, ordre } });
          if (!connu.dossiers.some((d) => d.id === id)) connu.dossiers.push({ id, nom: titre.slice(0, 120), parent, ordre });
          bilan.faits.push(`dossier « ${titre} »`);
          break;
        }
        default:
          bilan.echecs.push(`« ${titre} » : nature inconnue`);
      }
    } catch (err) {
      echec(titre, err);
    }
    if (!differe && bilan.echecs.length === avant) bilan.regles.push(e.cle);
  }
  // Les tâches partent ensemble : une écriture par lot de 6.
  for (const lot of lots(taches)) {
    let etats;
    try {
      const r = await appel("/api/motion/apply", { methode: "POST", corps: { actions: lot.map((t) => t.action), resume: "Capture rangée", origine: "capture", idCommande: nouvelId() }, delai: 150000 });
      etats = etatsLot(r, lot.length);
    } catch (err) {
      if (err?.nature === "auth") surAuth?.(err);
      etats = lot.map(() => ({ etat: "echec", erreur: raison(err) }));
    }
    lot.forEach((t, k) => {
      const x = etats[k];
      if (x.etat === "fait") bilan.faits.push(`« ${t.titre} » (Motion)`);
      else if (x.etat === "dejaLa") bilan.dejaLa.push(`« ${t.titre} » (Motion)`);
      else bilan.echecs.push(`« ${t.titre} » : ${x.erreur}`);
      if (x.etat !== "echec") bilan.regles.push(t.cle);
    });
  }
  return bilan;
}

// --- Ce que dit « Noter » (CaptureView, Carnet.swift) ---

const debutJour = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** L'heure d'un rappel : « aujourd'hui 09:00 », « demain 18:30 », « mer. 30 oct. 09:00 » (LigneRappel.quand). */
export function quandRappel(ms, maintenant = new Date()) {
  const d = new Date(ms);
  const ecart = Math.round((debutJour(d) - debutJour(maintenant)) / 86400000);
  const j = ecart === 0 ? "aujourd'hui" : ecart === 1 ? "demain" : ecart === -1 ? "hier"
    : jourSemaineCourt(ms) + (d.getFullYear() === maintenant.getFullYear() ? "" : ` ${d.getFullYear()}`);
  return `${j} ${heure(ms)}`;
}

/** Des articles dans une liste : tout déjà là, un mélange, ou tout neuf (null : la phrase habituelle). */
export function phraseListe(nomListe, nouveaux = [], dejaLa = []) {
  const deja = dejaLa.map((t) => `« ${t} »`).join(", ");
  if (!nouveaux.length && dejaLa.length) return `Déjà dans « ${nomListe} » : ${deja}.`;
  return `${nouveaux.length} article${nouveaux.length > 1 ? "s" : ""} dans « ${nomListe} ».${deja ? ` Déjà dans ta liste : ${deja}.` : ""}`;
}

/** « En file chez Motion : ~25 s (12 requêtes par minute). Rien à refaire, ça part tout seul. » (FileMotion.swift) ; null : rien à dire. */
export function phraseAttenteMotion(f) {
  if (!f || !(f.enFile > 0) || !((f.attenteMs || 0) >= 2000)) return null;
  const s = Math.ceil((f.attenteMs || 0) / 1000);
  const d = s >= 90 ? `~${Math.round(s / 60)} min` : `~${Math.max(5, Math.ceil(s / 5) * 5)} s`;
  const q = f.quotaParMinute ? ` (${f.quotaParMinute} requêtes par minute)` : "";
  return `En file chez Motion : ${d}${q}. Rien à refaire, ça part tout seul.`;
}
