// Le rendez-vous quotidien et celui de la semaine, sans réseau ni DOM : ce que
// la boîte (vues/boite.js) et « À trancher » (vues/trancher.js) décident et
// disent, avec les mêmes mots que l'iPhone (RemyCore : Rituel.swift,
// ATrancher.swift, Logique.swift › Nuit, Modeles.swift › Brouillons ;
// Vues : BoiteView, RituelVues, ATrancherVues). Testé sous node
// (test/site-boite.test.mjs).

const F_HEURE = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const F_JOUR_COURT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const F_JOUR_LONG = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const p2 = (n) => String(n).padStart(2, "0");
const debutJour = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const pluriel = (n, un, plusieurs) => (n > 1 ? plusieurs : un);
export const heure = (ms) => F_HEURE.format(new Date(ms));
/** « 27 oct. » (Format.jourCourt). */
export const jourCourt = (ms) => F_JOUR_COURT.format(new Date(ms));
/** « 2026-10-29 », dans le fuseau de la machine (Rituel.cleJour). */
export const jourISO = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`;
};
const capitale = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

// --- La nuit : « cette nuit » seulement si la réflexion vient de passer ---

/** Nuit.estRecente : depuis la veille à 18:00. Sans date : non (rien ne dit quand). */
export function nuitRecente(generatedAt, maintenant = Date.now()) {
  if (generatedAt == null) return false;
  return generatedAt >= debutJour(new Date(maintenant)).getTime() - 6 * 3600e3;
}
/** « cette nuit » (récente, ou sans date), sinon « le 27 oct. ». */
export const quandNuit = (generatedAt, maintenant = Date.now()) =>
  generatedAt == null || nuitRecente(generatedAt, maintenant) ? "cette nuit" : `le ${jourCourt(generatedAt)}`;

/** Le texte préparé pour Rémy (Brouillons.sujet) : jamais envoyé seul. */
export const phraseSujet = (texte, generatedAt, maintenant = Date.now()) =>
  `À propos de ce que tu as remarqué ${quandNuit(generatedAt, maintenant)} : « ${texte} ». Qu'est-ce que tu proposes ?`;

/** L'en-tête de la boîte (BoiteView.intro). */
export function introBoite(briefing, maintenant = Date.now()) {
  const g = briefing?.generatedAt;
  if (g == null || nuitRecente(g, maintenant)) return "Ce que Rémy a remarqué cette nuit. Rien ne presse : tu peux les laisser pour plus tard.";
  // « le 27 oct. » finit déjà par un point : pas de second.
  const j = jourCourt(g);
  return `Ce que Rémy a remarqué le ${j}${j.endsWith(".") ? "" : "."}`;
}
/** Rien à voir : dit pourquoi (BoiteView.rien). `reflexion` : dashboard.systeme.reflexion. */
export function rienBoite(briefing, reflexion, maintenant = Date.now()) {
  if (briefing?.generatedAt != null) return nuitRecente(briefing.generatedAt, maintenant) ? "Rien de notable cette nuit." : "Rien de notable la dernière fois.";
  if (reflexion === false) return "La préparation de nuit n'est pas active : rien ne s'affichera ici.";
  return "Chaque nuit, Rémy relit tes échanges et note ici ce qui mérite ton attention.";
}

// --- Les sujets de la nuit ---

/** Les sujets avec l'état vu à l'écran (`surcharges` : id → état, gestes en cours ou pas encore relus). */
export function sujets(briefing, surcharges = new Map()) {
  return (briefing?.items || [])
    .filter((s) => s && s.id)
    .map((s) => (surcharges.has(s.id) ? { ...s, etat: surcharges.get(s.id) } : s));
}
/** Les ouverts en tête, dans l'ordre de la tour ; puis les réglés, dans le même ordre. */
export const sujetsRanges = (liste) => [...liste.filter((s) => s.etat === "ouvert"), ...liste.filter((s) => s.etat !== "ouvert")];
/** Ce que comptent la pastille et l'intertitre : les sujets OUVERTS seulement. */
export const compteOuverts = (liste) => liste.filter((s) => s.etat === "ouvert").length;
/** « À voir avec Rémy (2) » ; sans sujet, sans nombre (BriefingVue). */
export const intertitreSujets = (liste) => `À voir avec Rémy${liste.length ? ` (${compteOuverts(liste)})` : ""}`;
/** Le libellé du bouton de la boîte, pour un lecteur d'écran. */
export function libelleBoite(n, avecRituel) {
  const base = avecRituel ? "Ton briefing et les sujets de la nuit" : "À voir avec Rémy";
  return n > 0 ? `${base}, ${n} ${pluriel(n, "ouvert", "ouverts")}` : base;
}
/** Le bandeau d'un geste réussi ; « Rouvrir » n'en a pas. */
export const phraseEtatSujet = (etat) => (etat === "traite" ? "Noté comme fait." : etat === "ignore" ? "Laissé de côté : Rémy ne le reproposera pas." : null);

// --- Le briefing du matin et le bilan du soir (GET /api/rituel) ---

/** Au-delà, ce qui a été lu n'est plus présenté comme frais (Rituel.fraicheurMax). */
export const FRAICHEUR_MAX = 3 * 3600e3;
export const perime = (luA, maintenant = Date.now()) => luA == null || maintenant - luA > FRAICHEUR_MAX;

/**
 * Le briefing qui vaut pour ce jour (RituelModel.briefing) : celui de la tour
 * dont `pour` est la date d'ici ; sinon, si la lecture est fraîche,
 * l'« aujourd'hui » de la tour (autre fuseau).
 */
export function briefingDuJour(rituel, { maintenant = Date.now(), luA = null } = {}) {
  if (!rituel) return null;
  const cle = jourISO(new Date(maintenant));
  const b = [rituel.aujourdhui, rituel.demain].find((x) => x && x.pour === cle);
  if (b) return b;
  return perime(luA, maintenant) ? null : rituel.aujourdhui || null;
}
/** Le bilan, s'il est bien celui d'aujourd'hui (ou tout frais de la tour). */
export function soirDuJour(rituel, { maintenant = Date.now(), luA = null } = {}) {
  const s = rituel?.soir;
  if (!s) return null;
  return s.jour === jourISO(new Date(maintenant)) || !perime(luA, maintenant) ? s : null;
}

/** « Jeudi 29 octobre » (le `jour` de la tour, capitalisé), sinon son titre. */
export const jourTitre = (b) => (b?.jour ? capitale(b.jour) : b?.titre || "");
/** La menace est-elle réelle (« Menacée : … ») ou rassurante (« Rien de menacé… ») ? */
export const estMenace = (b) => /^Menacée/.test(b?.menace || "");

/** « à l'instant », « il y a 12 min », « à 07:12 », « hier à 22:10 », « le 21 oct. » (Rituel.fraicheur). */
export function fraicheur(ms, maintenant = Date.now()) {
  const s = (maintenant - ms) / 1000;
  if (s < 90) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  const d = new Date(ms);
  const m = new Date(maintenant);
  if (debutJour(d).getTime() === debutJour(m).getTime()) return `à ${heure(ms)}`;
  const hier = new Date(m.getFullYear(), m.getMonth(), m.getDate() - 1);
  if (debutJour(d).getTime() === hier.getTime()) return `hier à ${heure(ms)}`;
  return `le ${jourCourt(ms)}`;
}
/** D'où viennent les trois lignes (TroisLignes.provenance). */
export function provenance({ luA, chargement = false, erreur = null, maintenant = Date.now() } = {}) {
  const quand = luA != null ? fraicheur(luA, maintenant) : "—";
  if (chargement) return `Calculé par ta tour ${quand}, sans IA · mise à jour…`;
  if (erreur) return `Calculé par ta tour ${quand}. Pas actualisé : ${erreur}`;
  return `Calculé par ta tour ${quand}, sans IA.`;
}

/** L'intertitre des menacées. */
export const intertitreMenacees = (n) => (n > 1 ? `Menacées (${n})` : "Menacée");
/** Préparé pour Rémy, jamais envoyé seul (CarteMenacee). */
export const phraseMenacee = (m) => `« ${m.titre} » est menacée : ${m.phrase} Trouve-lui un créneau avant son échéance, sans toucher à mes rendez-vous.`;

/** « Organiser ma journée » : envoyé, le clic étant le geste (Brouillons.journee). */
export const ORGANISER = "Organise ma journée : regarde mon agenda et mes tâches, dis-moi par quoi commencer et ce qui est en retard. Pose tes questions d'un coup si tu en as.";
/** Le titre de sa conversation (Fils.journee) : « 29/10/2026 · Journée ». */
export const titreJournee = (d = new Date()) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} · Journée`;

/** « 7:30 » pour « 07:30 » (ReglagesRituelVue.texteHeure). */
export function texteHeure(hhmm) {
  const [hh, mm] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(hh)) return String(hhmm || "");
  return `${hh}:${p2(Number.isFinite(mm) ? mm : 0)}`;
}

/** Le bilan « rangé pour la nuit » : acquis pour ce jour seulement. `garde` : { jour, range }. */
export const bilanRange = (garde, jour) => Boolean(garde && garde.range && garde.jour === jour);
/** Ce qui reste pour aujourd'hui, moins ce qui vient d'être poussé à demain. */
export const resteVisible = (soir, poussees = new Set()) => (soir?.reste || []).filter((t) => t && !poussees.has(t.id));
/** Le vide de « Reste pour aujourd'hui ». */
export const videReste = (poussees) => (poussees?.size ? "Poussé à demain. Motion recalcule." : "Rien ne reste : bravo.");

/**
 * Ce qu'a donné « Tout ce qui reste → demain » (RituelModel.toutADemain) :
 * combien sont parties, lesquelles (les résultats suivent l'ordre des
 * actions), et la raison du premier refus.
 */
export function bilanPoussee(r, reste) {
  const resultats = Array.isArray(r?.results) ? r.results : [];
  let ids;
  if (!resultats.length) ids = (r?.echecs ?? 0) === 0 ? reste.map((t) => t.id) : [];
  else if (resultats.length === reste.length) ids = reste.filter((_, i) => resultats[i]?.ok !== false).map((t) => t.id);
  else ids = resultats.some((x) => x?.ok !== false) ? reste.map((t) => t.id) : [];
  const reussies = !resultats.length ? ids.length : resultats.filter((x) => x?.ok !== false).length;
  return { reussies, echecs: Math.max(0, reste.length - reussies), ids, erreur: resultats.find((x) => x?.ok === false)?.erreur || null };
}
export const phrasePoussees = (reussies, echecs) =>
  `${reussies} ${pluriel(reussies, "tâche", "tâches")} pour demain. Motion recalcule.${echecs > 0 ? ` ${echecs} n'a pas pu partir.` : ""}`;

// --- La semaine : « À trancher », la revue du dimanche, les retards au retour ---

/** Les gestes de chaque type de ligne (GesteTri.pour), et le principal mis en avant. */
export const GESTES_TRI = {
  carte: [["oui", "Oui"], ["non", "Non"], ["plusTard", "Plus tard"]],
  doublon: [["fusionner", "Fusionner"], ["plusTard", "Plus tard"]],
  rappel: [["supprimer", "Supprimer"], ["plusTard", "Plus tard"]],
  articles: [["retirer", "Retirer"], ["plusTard", "Plus tard"]],
  idee: [["garder", "Gardée"], ["supprimer", "Supprimer"], ["plusTard", "Plus tard"]],
  fil: [["supprimer", "Supprimer"], ["plusTard", "Plus tard"]],
  retard: [["fait", "Fait"], ["demain", "Demain"], ["abandonner", "Abandonner"]],
  "rappel-retard": [["fait", "Fait"], ["demain", "Demain"], ["abandonner", "Abandonner"]],
};
export const gestesTri = (type) => GESTES_TRI[type] || [["plusTard", "Plus tard"]];
export const PRINCIPAUX = new Set(["oui", "fusionner", "retirer", "fait"]);

/** Le lundi 00:00 de la semaine de `d` (RituelSemaine.debutSemaine). */
export function debutSemaine(d) {
  const j = debutJour(new Date(d));
  return new Date(j.getFullYear(), j.getMonth(), j.getDate() - ((j.getDay() + 6) % 7));
}
/** Le dimanche, tant qu'elle n'a pas été faite cette semaine-là, et si elle n'est pas coupée. */
export function revueProposee({ maintenant = Date.now(), active = true, faiteLe = null } = {}) {
  if (!active || new Date(maintenant).getDay() !== 0) return false;
  if (faiteLe == null) return true;
  return debutSemaine(faiteLe).getTime() !== debutSemaine(maintenant).getTime();
}
/** Plus de 3 jours sans ouvrir Rémy (premier lancement : rien à rattraper). */
export const ABSENCE = 3 * 86400e3;
export const apresAbsence = (derniere, maintenant = Date.now()) => derniere != null && maintenant - derniere > ABSENCE;

/** Les rappels datés passés depuis plus d'une heure, pas faits : à trier avec les retards. */
export function rappelsEnRetard(rappels, maintenant = Date.now()) {
  return (rappels || [])
    .filter((r) => r && !r.fait && !r.supprime && typeof r.quand === "number" && r.quand < maintenant - 3600e3)
    .sort((a, b) => a.quand - b.quand)
    .map((r) => ({ cle: `rappelretard:${r.id}`, type: "rappel-retard", texte: r.texte, detail: "Rappel", depuis: r.quand, rappelId: r.id }));
}

/**
 * Les groupes tels qu'ils restent après les gestes faits ici
 * (RituelSemaine.filtrer) : une ligne réglée ou reportée sort ; un rappel
 * daté entre-temps, ou des doublons déjà fusionnés, aussi (`rappels` : la
 * dernière lecture de /api/rappels, null si pas lue : on croit la tour).
 */
export function filtrerGroupes(groupes, { masquees = new Set(), rappels = null, listes = null } = {}) {
  const ouverts = rappels ? new Map(rappels.filter((r) => r && !r.fait && !r.supprime).map((r) => [r.id, r])) : null;
  const parListe = listes ? new Map(listes.map((l) => [l.id, l])) : null;
  const sortie = [];
  for (const g of groupes || []) {
    const lignes = [];
    for (const l of g.lignes || []) {
      if (masquees.has(l.cle)) continue;
      if (l.type === "rappel" && ouverts && l.rappelId) {
        const r = ouverts.get(l.rappelId);
        if (!r || r.quand != null) continue;
      } else if (l.type === "doublon" && ouverts && l.rappelId) {
        if (!ouverts.has(l.rappelId) || !(l.doublons || []).some((id) => ouverts.has(id))) continue;
      } else if (l.type === "articles" && parListe && l.listeId) {
        const liste = parListe.get(l.listeId);
        const pris = (liste?.elements || []).filter((e) => e.fait);
        if (!liste || !pris.length) continue;
        lignes.push({ ...l, nombre: pris.length, texte: `${liste.nom} : ${pris.length} ${pluriel(pris.length, "article pris", "articles pris")}` });
        continue;
      }
      lignes.push(l);
    }
    if (!lignes.length) continue;
    const partis = (g.lignes || []).length - lignes.length;
    sortie.push({ ...g, lignes, total: Math.max(lignes.length, (g.total ?? lignes.length) - partis) });
  }
  return sortie;
}
/** Le compte de la carte : les groupes (les retards ont leur propre feuille). */
export const totalGroupes = (groupes) => (groupes || []).reduce((n, g) => n + (g.total || 0), 0);
/** « Rappel · prévu 20 oct. », « Abonnement de Tom · 1 action · depuis le 20 oct. » (LigneTri.sousTitre). */
export function sousTitreLigne(l) {
  const morceaux = [];
  if (l.detail) morceaux.push(l.detail);
  if (l.depuis != null) morceaux.push(l.type === "retard" || l.type === "rappel-retard" ? `prévu ${jourCourt(l.depuis)}` : `depuis le ${jourCourt(l.depuis)}`);
  return morceaux.length ? morceaux.join(" · ") : null;
}
export const phrasePlusDe = (n) => `Et ${n} de plus : elles viendront une fois celles-ci réglées.`;
export const phraseReportes = (r) =>
  `${r} ${pluriel(r, "ligne remise", "lignes remises")} à plus tard : ${pluriel(r, "elle reviendra", "elles reviendront")} dans la semaine.`;
export const phraseCarteTrancher = (n) => `${n} ${pluriel(n, "chose attend", "choses attendent")} un geste : cartes, rappels, articles, vieux fils, idées.`;
/** Un rappel remis à demain, à la même heure (rappelDemain). */
export function demainMemeHeure(quand, maintenant = Date.now()) {
  const m = new Date(maintenant);
  const h = quand != null ? new Date(quand) : null;
  return new Date(m.getFullYear(), m.getMonth(), m.getDate() + 1, h ? h.getHours() : 9, h ? h.getMinutes() : 0).getTime();
}

/** La revue, étape « Ta semaine » : « Cette semaine : 3 tâches faites, 1 rappel fait, 3 qui ont glissé. » */
export function resumeSemaine(revue) {
  const domaines = revue?.domaines || [];
  const faites = domaines.reduce((n, d) => n + (d.faites || 0), 0);
  const glissees = domaines.reduce((n, d) => n + (d.glissees || 0), 0);
  const rappels = revue?.rappelsFaits || 0;
  let s = `Cette semaine : ${faites} ${pluriel(faites, "tâche faite", "tâches faites")}`;
  if (rappels > 0) s += `, ${rappels} ${pluriel(rappels, "rappel fait", "rappels faits")}`;
  s += glissees > 0 ? `, ${glissees} qui ${pluriel(glissees, "a", "ont")} glissé.` : ", rien n'a glissé.";
  return s;
}
/** « 2 faites · 1 glissée » pour un domaine. */
export const ligneDomaine = (d) =>
  `${d.faites} ${pluriel(d.faites, "faite", "faites")}${d.glissees > 0 ? ` · ${d.glissees} ${pluriel(d.glissees, "glissée", "glissées")}` : ""}`;
/** « 45 min », « 1 h 15 » (Format.duree). */
export function dureeCourte(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  if (m < 60) return `${m} min`;
  const r = m % 60;
  return r ? `${Math.floor(m / 60)} h ${p2(r)}` : `${Math.floor(m / 60)} h`;
}
/** « · Relancer le comptable — prévu 20 oct. » */
export const ligneGlissee = (x) => `· ${x.nom}${x.echeance != null ? ` — prévu ${jourCourt(x.echeance)}` : ""}`;
/** Les décisions qui partent : sans les vides. */
export const decisionsPropres = (liste) => (liste || []).map((x) => String(x ?? "").trim()).filter(Boolean);
export const phraseDecisions = (n) => (n ? `Gardé : ${n} ${pluriel(n, "décision", "décisions")} pour la semaine.` : "Aucune décision gardée.");
export const TITRES_REVUE = ["Ta semaine", "Tes idées", "À trancher", "Trois décisions", "Ce que j'ai appris sur toi"];

/** Un « jeudi 29 octobre » complet pour une date (titres). */
export const jourLong = (ms) => F_JOUR_LONG.format(new Date(ms));
