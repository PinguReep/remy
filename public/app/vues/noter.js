// « Noter » : la même capture que le « + » de l'iPhone (CaptureView.swift).
// L'aperçu (genre deviné, échéance lue, titre propre) est calculé ICI, sans
// réseau ni IA (analyse/genre.js, port de l'iPhone) ; Sam corrige le genre
// d'un clic, et recliquer le genre choisi revient au genre deviné. Le bouton
// dit ce qu'il va faire et reste grisé tant que la capture n'est pas prête.
// Chaque capture a son identifiant : renvoyée après une coupure, elle n'est
// pas faite deux fois. Sans tour, elle attend dans la file d'envoi (dit avant).
//   Tâche → Motion · Idée → dossier « Idées » · Liste → une liste du carnet
//   Rappel → rappels (avec l'étiquette devinée) · Retenir → mémoire de Rémy
//   (un long texte : Sam coche les infos, ./retenir.js) · Question → Rémy, la
//   question préparée · Projet → un dossier de Remy, rangé où Sam le dit
// Plusieurs choses d'un coup : Rémy (le modèle local) les sépare, Sam valide
// le récapitulatif (analyse/rangement.js) ; rien ne part avant. Ce qui existe
// déjà (article, rappel, tâche Motion) est dit « déjà là », jamais « ajouté ».
// Le micro dicte (../dictee.js) : le texte arrive dans le champ, jamais envoyé seul.
// Une image collée (Ctrl+V) ou déposée : la feuille de partage de l'iPhone
// (EnvoiPartage) sur ordinateur. Un aperçu, un mot facultatif, puis rangée
// dans le coffre (POST /api/capture/image) ; rien ne part sans le bouton.
import { api, nouvelId, seg, natureEchec, sait, versionTour, tourJoignable, evenements } from "../api.js";
import { h, ajouterA, vider, icone, bouton, dire, direErreur, feuille, quand, isoLocal, local, occupe, kbd, texteErreur } from "../ui.js";
import { avantEcheance, echeanceLongue, plier } from "../analyse/dates.js";
import { apercu, GENRES, LIBELLES, MINIMUM_RETENIR, projet as lireProjet, plusieursIntentions } from "../analyse/genre.js";
import { etiquettePour } from "../analyse/etiquettes.js";
import * as R from "../analyse/rangement.js";
import * as fileEnvoi from "../file-envoi.js";
import * as bureau from "../bureau.js";
import * as dictee from "../dictee.js";
import { ouvrirRetenir } from "./retenir.js";

export const CLE_PAR_DEFAUT = "remy-capture-par-defaut";
export const parDefaut = () => (local.lire(CLE_PAR_DEFAUT, "idee") === "tache" ? "tache" : "idee");
const CLE_LISTE = "remy-capture-liste";
const CLE_QUESTION = "remy-question";
/** Ce qui est tapé dans « Noter » et pas envoyé : Échap ou un clic à côté ne le perdent plus. */
export const CLE_BROUILLON = "remy-noter-brouillon";
/** Au-delà, « Retenir » propose les infos à cocher (RetenirInfosVue) au lieu de tout donner. */
export const SEUIL_RETENIR_CHOIX = 280;

/** Ce que dit le bouton, selon le genre (CaptureView.action). */
export const ACTIONS = {
  tache: "Ajouter à Motion",
  idee: "Garder l'idée",
  liste: "Ajouter à la liste",
  rappel: "Créer le rappel",
  retenir: "Retenir",
  question: "Ouvrir chez Rémy",
  projet: "Créer le dossier",
};
const ICONES = { tache: "coche", idee: "plateauRanger", liste: "panier", rappel: "cloche", retenir: "ampoule", question: "remy", projet: "dossier" };
const ICONES_NATURE = { tache: "coche", rappel: "cloche", contrainte: "sablier", liste: "panier", note: "note", "rendez-vous": "calendrier", projet: "dossier" };

// Ce que la tour sait déjà (listes, dossiers, projets, étiquettes, agenda,
// dictée), lu une fois par ouverture.
let connu = { listes: null, dossiers: null, projets: null, etiquettes: null, agenda: null, transcription: null };
async function lireConnu() {
  const [l, d, p, e, g, t] = await Promise.allSettled([
    api("/api/listes"), api("/api/dossiers"), api("/api/projets"), api("/api/etiquettes"),
    api("/api/google/status", { delai: 8000 }), api("/api/transcribe", { delai: 8000 }),
  ]);
  const ok = (x) => x.status === "fulfilled";
  connu = {
    listes: ok(l) ? l.value?.listes || [] : connu.listes,
    dossiers: ok(d) ? d.value?.dossiers || [] : connu.dossiers,
    projets: ok(p) ? p.value?.projets || [] : connu.projets,
    etiquettes: ok(e) ? e.value?.etiquettes || [] : connu.etiquettes,
    // L'agenda branché (connecté, pas seulement configuré) : un rendez-vous daté y va.
    agenda: ok(g) ? g.value?.connecte === true : connu.agenda,
    transcription: ok(t) ? t.value?.available !== false : connu.transcription,
  };
  return connu;
}
const parents = () => [...(connu.dossiers || []).map((d) => d.nom), ...(connu.projets || []).map((p) => p.nom)];
// Tour pas encore lue (hors ligne au démarrage, petite fenêtre sans session) :
// on ne refuse rien, la capture attend dans la file et la tour tranchera.
const capable = (c) => !versionTour()?.capacites || sait(c);
const carnetPret = (genre) => (genre === "liste" ? capable("listes-v1") : genre === "rappel" ? capable("rappels-v1") : true);
const projetPret = () => capable("dossiers-v1");
/** Une pensée sans action claire : Idées (défaut) ou Motion ; sans dossiers sur la tour, Motion. */
const defautGenre = () => (projetPret() ? parDefaut() : "tache");

/** La liste visée : celle choisie, sinon « Courses », sinon la première. */
function cibleListe(choisie) {
  const ls = connu.listes || [];
  return ls.find((l) => l.id === choisie) || ls.find((l) => plier(l.nom) === "courses") || ls[0] || null;
}

const decrireDate = (a, maintenant = new Date()) => {
  const d = a.date;
  if (!d) return null;
  if (a.genre === "tache") {
    if (d.dejaPassee) return d.dejaPassee;
    if (d.heureDite && !d.limite) return `à ${quand(d.quand.getTime())}`;
    // Comme l'iPhone (Format.echeanceLongue) : « avant l'échéance : jeudi
    // 29 octobre », et « avant ce soir » le jour même.
    return avantEcheance(d.echeance, maintenant);
  }
  if (a.genre === "rappel") return d.dejaPassee || quand(d.quand.getTime());
  return null;
};

/**
 * L'aperçu en une ligne, avec les mots de l'iPhone (CaptureView.apercu).
 * `nomListe` : la liste visée (null : « Courses (créée) ») ; `nomParent` : où
 * ira le dossier (null : à part).
 */
export function phraseApercu(a, brut, { carnet = true, dossiers = true, micro = false, nomListe = null, nomParent = null, maintenant = new Date() } = {}) {
  const propre = String(brut || "").trim();
  // Le champ vide dit aussi qu'une image se colle ici (contre-relecture du 30/10, tour 2).
  if (!propre) return micro ? "Écris, dicte ou colle une image : Rémy devine où le ranger." : "Écris ou colle une image : Rémy devine où le ranger.";
  switch (a.genre) {
    case "tache": {
      const d = a.date;
      if (!d) return "Tâche → Motion lui trouvera un créneau";
      // Le jour compris reste une date limite, jamais un créneau fixe.
      return `Tâche « ${a.titre} » → Motion lui trouvera un créneau avant l'échéance : ${d.dejaPassee ?? echeanceLongue(d.echeance, maintenant)}`;
    }
    case "idee":
      return dossiers ? "Idée → gardée dans « Idées » (Projets), rien n'est planifié" : "Les Idées arriveront avec la mise à jour de ta tour.";
    case "liste": {
      if (!carnet) return "Les listes arriveront avec la mise à jour de ta tour.";
      const n = (a.articles.length ? a.articles : [propre]).length;
      return `${n} article${n > 1 ? "s" : ""} → ${nomListe || "Courses (créée)"}`;
    }
    case "rappel": {
      if (!carnet) return "Les rappels arriveront avec la mise à jour de ta tour.";
      const d = a.date;
      if (!d) return "Rappel sans date (ajoute « demain 9h », « lundi », « le 12/11 »…)";
      const passe = d.dejaPassee
        ? (d.quand.getTime() - maintenant.getTime() <= 3600e3 ? " (la date est déjà passée : il sonne dans l'heure)" : " (la date est déjà passée : il sonne aujourd'hui)")
        : "";
      return `Rappel → ${R.quandRappel(d.quand.getTime(), maintenant)} : « ${a.titre} »${passe}`;
    }
    case "retenir": {
      const manque = MINIMUM_RETENIR - [...propre].length;
      return manque > 0 ? `Retenir → encore ${manque} caractère${manque > 1 ? "s" : ""} pour que Rémy en tire quelque chose` : "Retenir → dans la mémoire de Rémy";
    }
    case "question":
      return "Question → s'ouvre chez Rémy, prête à envoyer";
    case "projet":
      if (!dossiers) return "Les sous-projets arriveront avec la mise à jour de ta tour.";
      return `Dossier « ${a.projet?.titre || propre} »${nomParent ? ` dans « ${nomParent} »` : " à part"} (Remy ; pas de projet Motion)`;
    default:
      return "";
  }
}

/** Prête à partir (CaptureView.pret) : le bouton reste grisé sinon. */
export function prete(a, brut, { carnet = true, dossiers = true } = {}) {
  const propre = String(brut || "").trim();
  if (!propre) return false;
  switch (a.genre) {
    case "retenir": return [...propre].length >= MINIMUM_RETENIR;
    case "liste": case "rappel": return carnet;
    case "projet": case "idee": return dossiers;
    default: return true;
  }
}

/** Les requêtes d'une capture (dans l'ordre) et de quoi la défaire. */
function preparer(a, texteBrut, id, { liste, etiquettes = [], parent = null } = {}) {
  const titre = (a.titre || texteBrut).slice(0, 500);
  switch (a.genre) {
    case "tache": {
      const action = { type: "creer", nom: titre.slice(0, 200) };
      if (a.date) action.echeance = isoLocal(a.date.echeance);
      return { resume: `Tâche « ${court(titre)} »`, titre, requetes: [{ chemin: "/api/motion/apply", corps: { actions: [action], resume: "Noté depuis le site", origine: "capture", idCommande: id }, delai: 150000 }] };
    }
    case "idee": {
      const requetes = [];
      if (!(connu.dossiers || []).some((d) => d.id === "idees")) requetes.push({ chemin: "/api/dossiers/idees", methode: "PUT", corps: { nom: "Idées", parent: null, ordre: -2 }, siAbsent: "idees" });
      requetes.push({ chemin: "/api/dossiers/idees/notes", corps: { notes: [{ id, texte: titre, fait: false }] } });
      return { resume: `Idée « ${court(titre)} »`, titre, requetes, defaire: { chemin: `/api/dossiers/idees/notes/${seg(id)}`, methode: "DELETE" } };
    }
    case "liste": {
      const articles = a.articles.length ? a.articles : [titre];
      const elements = articles.map((t, i) => ({ id: `${id}-${i}`, texte: t.slice(0, 200), fait: false }));
      const requetes = [];
      let lid = liste?.id;
      if (!lid) {
        lid = "l-courses";
        requetes.push({ chemin: `/api/listes/${lid}`, methode: "PUT", corps: { nom: "Courses", ordre: 0 } });
      }
      requetes.push({ chemin: `/api/listes/${seg(lid)}/elements`, corps: { elements } });
      return {
        resume: `${articles.length > 1 ? `${articles.length} articles` : `« ${court(articles[0])} »`} dans « ${liste?.nom || "Courses"} »`,
        titre, requetes, elements, nomListe: liste?.nom || "Courses",
        defaireElements: (ids) => ids.map((eid) => ({ chemin: `/api/listes/${seg(lid)}/elements/${seg(eid)}`, methode: "DELETE" })),
        defaire: elements.map((e) => ({ chemin: `/api/listes/${seg(lid)}/elements/${seg(e.id)}`, methode: "DELETE" })),
      };
    }
    case "rappel":
      return {
        resume: `Rappel « ${court(titre)} »${a.date ? `, ${quand(a.date.quand.getTime())}` : ""}`,
        titre,
        requetes: [{ chemin: "/api/rappels", corps: { rappels: [{ id, texte: titre.slice(0, 300), quand: a.date ? a.date.quand.getTime() : null, etiquettes }] } }],
        defaire: { chemin: `/api/rappels/${seg(id)}`, methode: "DELETE" },
      };
    case "retenir":
      return { resume: "À retenir", titre, requetes: [{ chemin: "/api/capture", corps: { texte: texteBrut, source: "note", idCapture: id }, delai: 95000 }] };
    case "projet": {
      const p = a.projet || lireProjet(texteBrut, parents());
      const nom = (p.titre || texteBrut).slice(0, 120);
      return {
        resume: `Dossier « ${court(nom)} »`,
        titre: nom,
        requetes: [{ chemin: `/api/dossiers/${seg(id)}`, methode: "PUT", corps: { nom, parent, ordre: R.ordreApres(connu.dossiers || [], parent) } }],
        defaire: { chemin: `/api/dossiers/${seg(id)}`, methode: "DELETE" },
      };
    }
    default:
      return null;
  }
}
const court = (t) => (t.length > 60 ? t.slice(0, 57) + "…" : t);
/** Le texte dicté s'ajoute à la suite, séparé d'une espace. */
const coller = (v, t) => (v ? v + (/\s$/.test(v) ? "" : " ") + t : t);

const envoyer = (prep) => fileEnvoi.envoyerElement(prep);

/** Défait une capture. `direIci(texte, genre)` : la ligne de la feuille (sinon un bandeau). */
async function defaire(prep, ledgerId, direIci, requetes = null) {
  try {
    if (ledgerId) await api("/api/motion/undo", { methode: "POST", corps: { id: ledgerId } });
    else for (const r of [].concat(requetes || prep.defaire || [])) await api(r.chemin, { methode: r.methode });
    if (direIci) direIci("Annulé : rien n'a été gardé.", "info");
    else dire("Annulé : rien n'a été gardé.", { genre: "succes" });
    return true;
  } catch (err) {
    direErreur(err, () => defaire(prep, ledgerId, direIci, requetes), "Pas annulé");
    return false;
  }
}

// --- Une image (la feuille de partage de l'iPhone, RemyPartage) ---
/** Sous les 3 Mo que la tour accepte (lireImage, lib/capture.js). */
export const IMAGE_MAX_OCTETS = 2_900_000;
const IMAGE_COTE_MAX = 2560;

/**
 * L'image d'un collage : seulement s'il n'y a pas de texte (copier une
 * partie d'une page donne les deux : c'est le texte qu'on veut). Null sinon.
 */
export function imageCollee(donnees) {
  if (!donnees) return null;
  if (String(donnees.getData?.("text/plain") || "").trim()) return null;
  for (const it of [...(donnees.items || [])]) {
    if (it.kind === "file" && /^image\//.test(it.type)) return it.getAsFile?.() || null;
  }
  return [...(donnees.files || [])].find((f) => /^image\//.test(f.type)) || null;
}

/** Le titre de l'image : le nom du fichier déposé (sans son extension), sinon « Image collée ». */
export const titreImage = (fichier, colle = false) => (colle ? "" : String(fichier?.name || "").replace(/\.[a-z0-9]{2,5}$/i, "").trim().slice(0, 120)) || "Image collée";

const enBase64 = (blob) => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
  r.onerror = () => ko(new Error("Cette image n'a pas pu être lue : enregistre-la, puis dépose le fichier."));
  r.readAsDataURL(blob);
});

/**
 * L'image prête pour la tour, en base64 : telle quelle si c'est un PNG ou un
 * JPEG assez léger ; sinon redessinée en JPEG (fond blanc), réduite jusqu'à
 * passer sous IMAGE_MAX_OCTETS. Rien n'est lu dessus ici (pas d'OCR).
 */
export async function preparerImage(fichier, { max = IMAGE_MAX_OCTETS } = {}) {
  if ((fichier.type === "image/png" || fichier.type === "image/jpeg") && fichier.size <= max) return enBase64(fichier);
  let source;
  try {
    source = await createImageBitmap(fichier);
  } catch {
    throw new Error("Ce format d'image n'est pas lisible ici : enregistre-la en PNG ou en JPEG, puis dépose le fichier.");
  }
  let echelle = Math.min(1, IMAGE_COTE_MAX / Math.max(source.width, source.height));
  for (let essai = 0; essai < 6; essai++) {
    const toile = document.createElement("canvas");
    toile.width = Math.max(1, Math.round(source.width * echelle));
    toile.height = Math.max(1, Math.round(source.height * echelle));
    const c = toile.getContext("2d");
    c.fillStyle = "#fff"; // un PNG transparent ne devient pas noir en JPEG
    c.fillRect(0, 0, toile.width, toile.height);
    c.drawImage(source, 0, 0, toile.width, toile.height);
    for (const qualite of [0.85, 0.7]) {
      const blob = await new Promise((r) => toile.toBlob(r, "image/jpeg", qualite));
      if (blob && blob.size <= max) return enBase64(blob);
    }
    echelle *= 0.7;
  }
  throw new Error("Cette image reste trop lourde, même réduite : enregistre-la plus petite, puis dépose-la.");
}

/** Ce que dit Noter quand l'image est rangée (RecuPartage de l'iPhone). */
export function recuImage(r) {
  const ajouts = Array.isArray(r?.ajouts) ? r.ajouts : [];
  const classe = ajouts.length > 0 || r?.memoire !== false;
  const titre = classe ? "J'ai compris. Classé." : String(r?.message || "").startsWith("Image") ? (r?.image ? "Image rangée." : "Image reçue.") : "Gardé, pas encore classé.";
  const phrase = ajouts.length
    ? `Retenu : ${ajouts[0]}${ajouts.length > 1 ? ` — et ${ajouts.length - 1} autre${ajouts.length > 2 ? "s" : ""} chose${ajouts.length > 2 ? "s" : ""}.` : ""}`
    : r?.memoire === false ? (r?.message ? `Gardé : ${r.message}` : "Gardé : Rémy le relira cette nuit.") : "Rien de nouveau : Rémy le savait déjà.";
  let detail = ajouts.length || !r?.message ? phrase : r.message;
  if (r?.image && !detail.startsWith("Image")) detail = `Image gardée sur ta tour. ${detail}`;
  return { titre, detail };
}

/** Une image pas partie, en clair : quoi, et quoi faire (EchecPartage). Elle reste à l'écran. */
export function phraseEchecImage(err) {
  if (err?.nature === "auth") return "Tu n'es plus connecté à la tour : l'image n'est pas partie. Reconnecte-toi, puis colle-la de nouveau.";
  if (err?.nature === "reseau" || err?.nature === "delai") return "La tour ne répond pas : l'image n'est pas partie. Elle reste ici ; réessaie quand la tour répond.";
  if (err?.statut === 404 || err?.statut === 405) return "Ta tour ne sait pas encore ranger les images : mets-la à jour.";
  return `Pas rangée : ${texteErreur(err).replace(/[.\s]+$/, "")}.`;
}

/** Ce qu'on dit quand la capture attend dans la file, selon pourquoi. */
function phraseEnFile(err) {
  if (err?.nature === "auth") return "Tu n'es plus connecté à la tour : c'est gardé ici et ça partira quand tu te reconnecteras.";
  if (err?.statut === 502 || err?.statut === 503) return `La tour est indisponible pour l'instant (erreur ${err.statut}) : c'est gardé ici et ça repartira tout seul.`;
  if (natureEchec(err) === "incertain" && err?.nature !== "reseau" && err?.nature !== "delai") return "La tour a mal répondu : c'est gardé ici et ça repartira tout seul, sans doublon.";
  return "La tour ne répond pas : c'est gardé ici et ça partira tout seul.";
}

/** Une puce de choix (liste, parent, étiquette) : 44 px, au clavier comme à la souris. */
const puce = (libelle, actif, faire, { icone: ic, titre } = {}) => h("button", { type: "button", class: "puce", "aria-pressed": String(actif), title: titre, onclick: faire }, ic ? icone(ic) : null, h("span", null, libelle));
/** Après un choix, le champ reprend la main : Entrée envoie (comme après un genre). */
const puis = (zone, faire) => () => {
  faire();
  zone.focus();
};

/**
 * Le formulaire de capture. `surEnvoye(genre)` après un envoi réussi (ou mis
 * en file). `compact` : sans l'aide du clavier. `id` : imposé (notes de secours).
 * `confirmation` : « ligne » (dans le formulaire, qui reste ouvert pour
 * enchaîner) ou « bandeau ». `brouillon` : la clé où garder le texte pas envoyé.
 * `fermer` : ce que fait « Fermer » dans le récapitulatif.
 */
export function formulaireNoter({ texte = "", id: idImpose, compact = false, surEnvoye, extra, contexte, fenetre = false, confirmation = "bandeau", brouillon = null, fermer = null } = {}) {
  let id = idImpose || nouvelId();
  let genreChoisi = null;
  let envois = 0; // envois en cours (le bouton tourne, le champ reste libre)
  let form = null;
  let listeChoisie = local.lire(CLE_LISTE, null);
  let etiquetteRetiree = false;
  let parentChoisi; // undefined : pas choisi ; null : à part ; sinon l'id
  let analyseEnCours = false;
  let etatDictee = "repos";
  let dicteeEnCours = null;
  const zone = h("textarea", {
    class: "champ", rows: compact ? 2 : 4, "aria-label": "Ce que tu veux noter",
    placeholder: "Appeler le garage demain à 9h · tomates, lait, œufs · idée : …",
    autocomplete: "off", spellcheck: "true",
  });
  zone.value = texte || (brouillon ? local.lire(brouillon, "") || "" : "");
  const garderBrouillon = () => {
    if (!brouillon) return;
    // Une feuille déjà fermée (un envoi refusé après Échap) ne remplace pas le
    // brouillon d'une nouvelle feuille : elle ne remplit qu'une place vide.
    if (!form?.isConnected) {
      if (zone.value.trim() && !local.lire(brouillon, "")) local.ecrire(brouillon, zone.value);
      return;
    }
    if (zone.value.trim()) local.ecrire(brouillon, zone.value);
    else local.effacer(brouillon);
  };
  const vueApercu = h("div", { class: "apercu", "aria-live": "polite" });
  // La confirmation dans la feuille : « Noté : … · Annuler », lisible pendant
  // qu'on enchaîne au clavier (les bandeaux, eux, passent par-dessus).
  const ligneFaite = h("div", { class: "noter-fait", role: "status", "aria-live": "polite", hidden: true });
  const direIci = (texteLigne, genre = "succes", action = null) => {
    vider(ligneFaite, icone(genre === "succes" ? "coche" : genre === "info" ? "horloge" : "alerte"), h("span", { class: "msg" }, texteLigne),
      action ? bouton(action.libelle, { classe: "texte petit", onclick: (e) => occupe(e.currentTarget, action.faire) }) : null);
    ligneFaite.className = `noter-fait ${genre}`;
    ligneFaite.hidden = false;
  };
  const annoncer = (texteLigne, { genre = "succes", action = null, detail = null } = {}) => {
    if (confirmation === "ligne") direIci(detail ? `${texteLigne} ${detail}` : texteLigne, genre, action);
    else dire(texteLigne, { genre, action, detail });
  };
  const envoyerBtn = bouton("Garder l'idée", { classe: "plein", icone: "envoyer", kbd: "Entrée", type: "submit" });
  // Le micro, à gauche de l'envoi (le texte dicté arrive dans le champ).
  const micro = bouton("", { classe: "noter-micro", icone: "micro", etiquette: "Dicter", titre: "Dicter (le texte arrive dans le champ)" });
  const vocaux = h("div", { class: "dictee-attente", hidden: true });
  const ajouterDicte = (t) => {
    if (!form?.isConnected) return dicteeApresFermeture(t);
    zone.value = coller(zone.value, t);
    garderBrouillon();
    dessiner();
    zone.focus();
    zone.setSelectionRange(zone.value.length, zone.value.length);
  };
  // La feuille fermée pendant la transcription : le texte dicté n'est jamais
  // perdu en silence (l'audio, lui, n'est pas gardé). Il rejoint la feuille
  // rouverte entre-temps, sinon le brouillon ; sans brouillon (un texte venu
  // d'une conversation), il se reprend d'un clic.
  const dicteeApresFermeture = (t) => {
    zone.value = coller(zone.value, t);
    if (brouillon && noterOuvert?.cleBrouillon === brouillon && noterOuvert !== racine) return noterOuvert.ajouterDicte(t);
    if (brouillon) {
      local.ecrire(brouillon, coller(local.lire(brouillon, "") || "", t));
      dire("Dictée ajoutée à ton brouillon : N pour le reprendre.", { genre: "succes" });
      return;
    }
    const complet = zone.value;
    dire(`Ta dictée est arrivée après la fermeture : « ${court(t)} ».`, { action: { libelle: "Reprendre", faire: () => ouvrirNoter({ texte: complet, contexte }) } });
  };
  dictee.monterAttente(vocaux, { surTexte: ajouterDicte });
  micro.addEventListener("click", () => {
    if (etatDictee !== "repos") return;
    dicteeEnCours = dictee.demarrerDictee({
      ancre: zone, prive: false, transcription: connu.transcription, surTexte: ajouterDicte,
      surEtat: (e) => {
        etatDictee = e;
        dessiner();
      },
    });
  });
  form = h("form", { class: "noter", onsubmit: (e) => { e.preventDefault(); soumettre(); } },
    vocaux, zone, vueApercu, ligneFaite,
    h("div", { class: "noter-pied" },
      compact ? h("span", { class: "aide" }) : h("span", { class: "aide" }, kbd("Entrée"), " envoie · ", kbd("Maj"), " ", kbd("Entrée"), " passe à la ligne · ", kbd("Échap"), " ferme"),
      extra || null, micro, envoyerBtn));
  const recap = h("div", { class: "noter-recap", hidden: true });
  // L'image en attente (collée ou déposée) : à la place du formulaire, jusqu'à « Ranger » ou « Retirer ».
  const panneauImage = h("div", { class: "noter-image", hidden: true, role: "group", "aria-label": "Image" });
  const racine = h("div", { class: "noter-zone" }, form, recap, panneauImage);
  let image = null; // { fichier, url, titre }
  const retirerImage = () => {
    if (image?.url) URL.revokeObjectURL(image.url);
    image = null;
    panneauImage.hidden = true;
    vider(panneauImage);
    form.hidden = false;
    racine.focusChamp?.();
  };
  const prendreImage = (fichier, { colle = false } = {}) => {
    if (!recap.hidden) {
      dire("Termine d'abord le rangement en cours, puis dépose l'image.");
      return;
    }
    if (image?.url) URL.revokeObjectURL(image.url);
    image = { fichier, url: URL.createObjectURL(fichier), titre: titreImage(fichier, colle) };
    const mot = h("input", { class: "champ", type: "text", maxlength: "500", autocomplete: "off", placeholder: "Pour le gâteau de Léa samedi…", id: `noter-mot-${id}`,
      onkeydown: (e) => {
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          ranger.click();
        }
      } });
    const etat = h("p", { class: "noter-fait erreur", role: "alert", hidden: true });
    const ranger = bouton("Ranger l'image", { classe: "plein", icone: "plateauRanger", kbd: "Entrée" });
    ranger.addEventListener("click", () => occupe(ranger, async () => {
      etat.hidden = true;
      try {
        // L'appareil réel : la tour ne la dit plus « partagée depuis son iPhone » (contre-relecture du 30/10, tour 2).
        const corps = { image: await preparerImage(image.fichier), titre: image.titre, depuis: "ordinateur" };
        if (mot.value.trim()) corps.mot = mot.value.trim();
        const r = await api("/api/capture/image", { methode: "POST", corps, delai: 90000 });
        const recu = recuImage(r);
        retirerImage();
        annoncer(recu.titre, { genre: "succes", detail: recu.detail });
        surEnvoye?.("image");
      } catch (err) {
        if (err?.nature === "annule") return;
        vider(etat, icone("alerte"), h("span", { class: "msg" }, phraseEchecImage(err)));
        etat.hidden = false;
        // Session perdue dans la feuille : elle va se fermer, le bandeau reste lisible.
        if (err?.nature === "auth") dire(phraseEchecImage(err), { genre: "erreur" });
      }
    }));
    const octets = fichier.size >= 1e6 ? `${(fichier.size / 1e6).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(fichier.size / 1e3))} ko`;
    vider(panneauImage,
      h("div", { class: "noter-image-tete" },
        h("img", { src: image.url, alt: `Aperçu : ${image.titre}` }),
        h("div", { class: "noter-image-textes" },
          h("strong", null, "Image"),
          h("span", { class: "aide" }, `${image.titre} · ${octets}`),
          h("span", { class: "aide" }, "Rangée dans ton coffre (Captures/Images)."),
          // Pas de lecture du texte de l'image ici (l'iPhone, lui, la lit) : le mot est ce que Rémy en retiendra.
          h("span", { class: "aide noter-image-pas-lu" }, "Le texte de l'image n'est pas lu ici : ajoute un mot pour que Rémy en retienne quelque chose."))),
      h("label", { class: "etiquette-champ", for: mot.id }, "Un mot pour Rémy (facultatif)"), mot, etat,
      h("div", { class: "noter-pied" }, h("span", { class: "aide" }, kbd("Échap"), " retire l'image"),
        bouton("Retirer", { classe: "papier", onclick: retirerImage }), ranger));
    form.hidden = true;
    panneauImage.hidden = false;
    mot.focus();
  };
  // Échap retire l'image d'abord (la feuille reste ouverte, le texte aussi).
  panneauImage.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    retirerImage();
  });
  zone.addEventListener("paste", (e) => {
    const f = imageCollee(e.clipboardData);
    if (!f) return;
    e.preventDefault();
    prendreImage(f, { colle: true });
  });
  // Un fichier déposé : jamais ouvert par le navigateur à la place de Rémy.
  const avecFichiers = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  racine.addEventListener("dragover", (e) => {
    if (!avecFichiers(e)) return;
    e.preventDefault();
    racine.classList.add("depot");
  });
  racine.addEventListener("dragleave", (e) => {
    if (!racine.contains(e.relatedTarget)) racine.classList.remove("depot");
  });
  racine.addEventListener("drop", (e) => {
    racine.classList.remove("depot");
    if (!avecFichiers(e)) return;
    e.preventDefault();
    const fichiers = [...(e.dataTransfer.files || [])];
    const images = fichiers.filter((f) => /^image\//.test(f.type));
    if (!images.length) {
      dire("Seules les images (PNG, JPEG…) se rangent depuis Noter. Pour un texte, colle-le dans le champ.", { genre: "erreur" });
      return;
    }
    if (fichiers.length > 1) dire("Une image à la fois : la première est prête à ranger.");
    prendreImage(images[0]);
  });

  const microVisible = () => dictee.disponible() && connu.transcription !== false && etatDictee === "repos";

  const dessiner = () => {
    const brut = zone.value;
    const a = apercu(brut, { parDefaut: defautGenre(), genre: genreChoisi, parents: parents() });
    const cible = cibleListe(listeChoisie);
    const p = a.genre === "projet" ? a.projet : null;
    const idParent = p ? (parentChoisi !== undefined ? parentChoisi : R.parentPour(p.parent, connu) ?? R.suggestion(p.titre, connu)?.id ?? null) : null;
    const candidats = R.candidatsParent(connu);
    const nomParent = idParent ? candidats.find((x) => x.id === idParent)?.nom || p?.parent || null : null;
    const etiquette = a.genre === "rappel" ? etiquettePour(brut, connu.etiquettes || []) : null;
    const opts = { carnet: carnetPret(a.genre), dossiers: projetPret(), micro: dictee.disponible() && connu.transcription !== false };
    micro.hidden = !microVisible();
    const pret = prete(a, brut, opts);
    // Pendant une dictée, le texte n'est pas fini : rien ne part.
    envoyerBtn.disabled = !pret || etatDictee !== "repos";
    const lib = envoyerBtn.querySelector(".lib");
    if (lib) lib.textContent = ACTIONS[a.genre] || "Envoyer";
    vider(vueApercu);
    ajouterA(vueApercu, h("p", { class: `noter-phrase${brut.trim() ? "" : " vide"}` }, icone(ICONES[a.genre] || "plus"), h("span", null, phraseApercu(a, brut, { ...opts, nomListe: cible?.nom || null, nomParent }))));
    if (!brut.trim()) return;
    // La tour ne répond pas : dit avant d'envoyer (le bandeau réseau est derrière la feuille).
    if (a.genre !== "question" && !tourJoignable()) {
      ajouterA(vueApercu, h("p", { class: "noter-attendra" }, icone("plateauEnvoi"), h("span", null, "La tour est injoignable : ce sera gardé sur ce PC et envoyé dès qu'elle répond.")));
    }
    if (sait("analyse-capture-v1") && plusieursIntentions(brut)) {
      const plusieurs = h("button", { type: "button", class: "noter-plusieurs", disabled: analyseEnCours, "aria-busy": analyseEnCours ? "true" : null, onclick: () => analyser(brut) },
        analyseEnCours ? h("span", { class: "dictee-roue", "aria-hidden": "true" }) : icone("etincelles"),
        h("span", null, analyseEnCours ? "Rémy range…" : "Plusieurs choses ? Rémy les range une à une"));
      ajouterA(vueApercu, plusieurs);
    }
    ajouterA(vueApercu, h("div", { class: "genres", role: "radiogroup", "aria-label": "Genre" },
      GENRES.map((g) => h("button", {
        type: "button", class: "puce", role: "radio", "aria-checked": String(a.genre === g), "aria-pressed": String(a.genre === g),
        title: a.genre === g ? (a.devine ? "Deviné par Rémy : clique sur un autre genre pour corriger" : "Choisi par toi : reclique pour revenir au genre deviné") : null,
        onclick: () => {
          // Recliquer le genre choisi revient au genre deviné.
          genreChoisi = genreChoisi === g ? null : g;
          dessiner();
          zone.focus();
        },
      }, icone(ICONES[g]), h("span", null, LIBELLES[g])))));
    if (a.genre === "liste" && carnetPret("liste") && (connu.listes || []).length) {
      ajouterA(vueApercu, h("div", { class: "noter-puces", role: "group", "aria-label": "Dans quelle liste" },
        connu.listes.map((l) => puce(l.nom, cible?.id === l.id, puis(zone, () => {
          listeChoisie = l.id;
          local.ecrire(CLE_LISTE, l.id);
          dessiner();
        })))));
    }
    if (a.genre === "rappel" && etiquette) {
      ajouterA(vueApercu, h("div", { class: "noter-etiquette" },
        puce(etiquette.nom, !etiquetteRetiree, puis(zone, () => {
          etiquetteRetiree = !etiquetteRetiree;
          dessiner();
        }), { icone: "etiquette", titre: etiquetteRetiree ? "Remettre l'étiquette" : "Retirer l'étiquette" }),
        h("span", { class: "aide" }, etiquetteRetiree ? "sans étiquette" : "étiquette devinée")));
    }
    if (a.genre === "projet" && projetPret()) {
      ajouterA(vueApercu, h("div", { class: "noter-puces", role: "group", "aria-label": "Où ranger le dossier" },
        puce("À part", idParent == null, puis(zone, () => {
          parentChoisi = null;
          dessiner();
        }), { icone: "dossier" }),
        candidats.map((c) => puce(c.nom, idParent === c.id, puis(zone, () => {
          parentChoisi = c.id;
          dessiner();
        })))));
    }
    if (a.date?.dejaPassee && a.genre !== "tache" && a.genre !== "rappel") ajouterA(vueApercu, h("p", { class: "avertissement" }, a.date.dejaPassee));
  };

  // --- Plusieurs intentions : Rémy (le modèle local) les sépare, Sam valide ---
  async function analyser(brut) {
    if (analyseEnCours) return;
    analyseEnCours = true;
    dessiner();
    try {
      await lireConnu().catch(() => {});
      const r = await api("/api/capture/analyser", { methode: "POST", corps: { texte: brut.trim() }, delai: 100000 });
      const elements = (Array.isArray(r?.elements) ? r.elements : []).map((e) => ({ ...e }));
      if (!elements.length) {
        dire("Rémy n'a rien trouvé à ranger : choisis le genre toi-même.");
        return;
      }
      montrerRecap(elements);
    } catch (err) {
      if (err?.nature === "auth") return;
      // Le message de la tour quand elle en a un ; sinon la phrase de l'iPhone.
      const deLaTour = err?.nature === "serveur" && err.message && !/^Erreur \d+/.test(err.message);
      dire(deLaTour ? err.message : "Rémy n'a pas pu ranger : choisis le genre toi-même.", { genre: "erreur", detail: deLaTour ? null : texteErreur(err) });
    } finally {
      analyseEnCours = false;
      if (form.isConnected) dessiner();
    }
  }

  function montrerRecap(elements) {
    const coches = new Set(elements.filter(R.pret).map((e) => e.cle));
    const graine = `capture-${nouvelId()}`.slice(0, 60);
    let envoi = false;
    const liste = h("ul", { class: "noter-recap-liste" });
    const bilanLigne = h("div", { class: "noter-fait erreur", role: "alert", hidden: true });
    const attente = h("p", { class: "noter-attente", hidden: true });
    const ranger = bouton(R.libelleRanger(0), { classe: "plein", icone: "plateauRanger" });
    const retour = bouton("Retour", { classe: "texte", icone: "retour", titre: "Revenir au texte (il est intact)" });
    retour.addEventListener("click", () => cacherRecap());
    const fermerBtn = fermer ? bouton("Fermer", { classe: "texte", icone: "fermer" }) : null;
    fermerBtn?.addEventListener("click", () => fermer());
    const titre = h("h3", { class: "noter-recap-titre" }, `Rémy a trouvé ${elements.length} chose${elements.length > 1 ? "s" : ""}`);

    const majBouton = () => {
      const { choisis, possible } = R.etatRangement(elements, coches);
      ranger.querySelector(".lib").textContent = envoi ? "…" : R.libelleRanger(choisis.length);
      // Pendant l'envoi, aria-disabled (le clic est ignoré) plutôt que disabled,
      // qui ferait perdre le focus : au clavier, Sam retrouve « Ranger » après un échec.
      ranger.disabled = !envoi && !possible;
      for (const a of ["aria-disabled", "aria-busy"]) {
        if (envoi) ranger.setAttribute(a, "true");
        else ranger.removeAttribute(a);
      }
      ranger.title = choisis.length && !possible ? "Complète d'abord ce qui est coché et pas prêt (en rouge)." : "";
    };
    const dessinerLignes = (focus = null) => {
      vider(liste, elements.map((e) => {
        const actif = coches.has(e.cle);
        const caseLigne = h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": String(actif), "aria-label": `Ranger « ${e.titre} »`, dataset: { cle: e.cle } });
        caseLigne.addEventListener("click", () => {
          if (coches.has(e.cle)) coches.delete(e.cle);
          else coches.add(e.cle);
          dessinerLignes(e.cle);
        });
        const champ = h("input", { class: "champ noter-recap-champ", type: "text", "aria-label": "Titre", autocomplete: "off", maxlength: "200" });
        champ.value = e.titre || "";
        champ.addEventListener("input", () => {
          e.titre = champ.value;
          caseLigne.setAttribute("aria-label", `Ranger « ${e.titre} »`);
        });
        // Entrée dans un titre ne valide pas la feuille.
        champ.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") ev.preventDefault();
        });
        const corps = [champ, h("p", { class: "noter-recap-ou" }, icone(ICONES_NATURE[e.nature] || "chevron"), h("span", null, R.destination(e, { agenda: connu.agenda === true })))];
        if (!R.pret(e)) {
          const precision = [h("p", { class: "noter-question" }, e.question || "À préciser")];
          if (e.nature === "rendez-vous") {
            // Le jour et l'heure, choisis par Sam : jamais une heure inventée.
            const jour = h("input", { class: "champ", type: "date", "aria-label": "Jour du rendez-vous" });
            const heureChamp = h("input", { class: "champ", type: "time", "aria-label": "Heure du rendez-vous" });
            if (e.quand != null) jour.value = isoLocal(new Date(e.quand)).slice(0, 10);
            const poser = () => {
              if (!jour.value || !heureChamp.value) return;
              const d = new Date(`${jour.value}T${heureChamp.value}`);
              if (!Number.isFinite(d.getTime())) return;
              e.quand = d.getTime();
              e.heureConnue = true;
              e.question = null;
              coches.add(e.cle);
              dessinerLignes(e.cle);
            };
            jour.addEventListener("change", poser);
            heureChamp.addEventListener("change", poser);
            for (const c of [jour, heureChamp]) {
              c.addEventListener("keydown", (ev) => {
                if (ev.key !== "Enter") return;
                ev.preventDefault();
                poser();
              });
            }
            precision.push(h("div", { class: "noter-quand" }, h("label", null, h("span", { class: "aide" }, "Le"), jour), h("label", null, h("span", { class: "aide" }, "à"), heureChamp)));
          } else {
            precision.push(bouton("C'est bon comme ça", { classe: "papier petit", onclick: () => {
              e.question = null;
              coches.add(e.cle);
              dessinerLignes(e.cle);
            } }));
          }
          corps.push(h("div", { class: "noter-precision" }, precision));
        }
        return h("li", { class: `noter-recap-ligne${actif ? "" : " eteinte"}` }, caseLigne, h("div", { class: "corps" }, corps));
      }));
      if (focus) liste.querySelector(`.case[data-cle="${CSS.escape(focus)}"]`)?.focus();
      majBouton();
    };

    ranger.addEventListener("click", async () => {
      const { choisis, possible } = R.etatRangement(elements, coches);
      if (envoi || !possible) return;
      envoi = true;
      bilanLigne.hidden = true;
      majBouton();
      const finAttente = suivreAttente(attente);
      let bilan;
      try {
        connu.listes ||= [];
        connu.dossiers ||= [];
        connu.projets ||= [];
        bilan = await R.ranger(choisis, { appel: (chemin, o) => api(chemin, o), connu, agenda: connu.agenda === true, graine, nouvelId });
      } finally {
        finAttente();
        envoi = false;
      }
      const phrase = R.phraseBilan(bilan);
      contexte?.majCompteurs?.();
      if (!bilan.echecs.length) {
        // Tout est rangé : la feuille se ferme, le brouillon s'efface.
        dire(phrase, { genre: "succes" });
        cacherRecap();
        zone.value = "";
        genreChoisi = null;
        garderBrouillon();
        dessiner();
        surEnvoye?.("plusieurs");
        return;
      }
      // Seul ce qui a raté reste coché : « Ranger » ne refait pas le reste.
      for (const k of bilan.regles) coches.delete(k);
      // La feuille reste ouverte : le bilan s'y lit (rôle alert), pas dans un
      // bandeau qui, sur grand écran, cacherait le pied et l'attente de Motion.
      vider(bilanLigne, icone("alerte"), h("span", { class: "msg" }, phrase));
      bilanLigne.hidden = false;
      dessinerLignes();
    });

    vider(recap,
      h("div", { class: "noter-recap-tete" }, retour, h("span", { class: "espace" }), fermerBtn),
      titre,
      h("p", { class: "aide" }, "Rien ne part avant que tu valides. Décoche ce qui ne va pas, complète ce qui manque."),
      liste,
      // Le bilan d'un échec et l'attente de Motion se lisent dans le pied, à
      // côté du bouton, qui reste sous la main.
      h("div", { class: "noter-recap-pied" }, bilanLigne, attente, ranger));
    dessinerLignes();
    form.hidden = true;
    recap.hidden = false;
    (liste.querySelector(".case") || ranger).focus();
  }

  function cacherRecap() {
    recap.hidden = true;
    vider(recap);
    form.hidden = false;
    zone.focus();
  }

  const longueurOk = (t) => [...t.trim()].length >= MINIMUM_RETENIR;

  const soumettre = async () => {
    const brut = zone.value.trim();
    if (!brut) return zone.focus();
    if (etatDictee !== "repos") return;
    const a = apercu(brut, { parDefaut: defautGenre(), genre: genreChoisi, parents: parents() });
    if (!prete(a, brut, { carnet: carnetPret(a.genre), dossiers: projetPret() })) {
      if (a.genre === "retenir" && !longueurOk(brut)) annoncer(`Trop court pour Retenir (${MINIMUM_RETENIR} caractères au moins) : choisis Idée ou Tâche.`, { genre: "erreur" });
      else annoncer(phraseApercu(a, brut, { carnet: carnetPret(a.genre), dossiers: projetPret() }), { genre: "info" });
      return;
    }
    if (a.genre === "question") {
      local.ecrire(CLE_QUESTION, { texte: brut, a: Date.now() });
      zone.value = "";
      garderBrouillon();
      surEnvoye?.("question");
      if (fenetre && bureau.estBureau()) await bureau.invoke("bureau_ouvrir", { vue: "remy/nouvelle" }).catch(() => {});
      else contexte?.aller("remy/nouvelle");
      return;
    }
    // Un long texte à retenir : Rémy propose les infos, Sam coche (sur la tour seulement).
    if (a.genre === "retenir" && [...brut].length >= SEUIL_RETENIR_CHOIX && sait("retenir-choix-v1") && tourJoignable()) {
      // L'identifiant de la capture : un renvoi après un délai dépassé n'est pas retenu deux fois.
      const r = await ouvrirRetenir({ texte: brut, source: "note", idCapture: id });
      if (!r) return zone.focus();
      id = nouvelId();
      if (zone.value.trim() === brut) {
        zone.value = "";
        genreChoisi = null;
        garderBrouillon();
        dessiner();
      }
      annoncer(r.phrase, { genre: "succes" });
      surEnvoye?.("retenir");
      return;
    }
    const liste = cibleListe(listeChoisie);
    const etiquette = a.genre === "rappel" && !etiquetteRetiree ? etiquettePour(brut, connu.etiquettes || []) : null;
    let parent = null;
    if (a.genre === "projet") {
      const p = a.projet;
      parent = parentChoisi !== undefined ? parentChoisi : R.parentPour(p.parent, connu) ?? R.suggestion(p.titre, connu)?.id ?? null;
    }
    // Chaque envoi emporte SON identifiant, et le champ se vide tout de suite :
    // au clavier, Sam enchaîne la note suivante pendant que celle-ci part. Un
    // refus remet le texte dans le champ s'il est resté vide.
    const idEnvoi = id;
    id = nouvelId();
    const prep = preparer(a, brut, idEnvoi, { liste, etiquettes: etiquette ? [etiquette.id] : [], parent });
    const avant = { genreChoisi, etiquetteRetiree, parentChoisi };
    zone.value = "";
    genreChoisi = null;
    etiquetteRetiree = false;
    parentChoisi = undefined;
    garderBrouillon();
    dessiner();
    const ici = confirmation === "ligne" ? direIci : null;
    if (ici) ici(`Envoi : ${prep.resume}…`, "info");
    envois += 1;
    envoyerBtn.setAttribute("aria-busy", "true");
    // Rend le texte au champ s'il est libre ; sinon il est cité dans le message.
    const rendre = () => {
      if (zone.value.trim()) return false;
      zone.value = brut;
      ({ genreChoisi, etiquetteRetiree, parentChoisi } = avant);
      garderBrouillon();
      dessiner();
      return true;
    };
    const ouEst = (revenu) => (revenu ? "Ton texte est revenu dans le champ." : `Ton texte : « ${court(brut)} ».`);
    try {
      const r = await envoyer(prep);
      // Déjà dans Motion n'est pas un échec : rien à défaire, la feuille suit son cours.
      if (a.genre === "tache" && R.toutDejaLa(r)) {
        annoncer(`Déjà dans Motion : « ${court(prep.titre)} ».`, { genre: "info" });
        surEnvoye?.(a.genre);
        return;
      }
      if (r && r.ok === false && Array.isArray(r.results)) {
        const res = r.results.find((x) => !x.ok);
        if (res?.nature === "passager" || /quota|indisponible|429/i.test(res?.erreur || "")) throw Object.assign(new Error(res.erreur), { nature: "serveur", statut: 429 });
        annoncer(`Motion a refusé : ${res?.erreur || "raison inconnue"}. ${ouEst(rendre())}`, { genre: "erreur" });
        return;
      }
      const { phrase, prefixe = true, action = "defaire" } = phraseFaite(a, prep, r);
      const defaireIci = action === "defaire" && (prep.defaire || r?.ledgerId)
        ? { libelle: "Annuler", faire: () => defaire(prep, r?.ledgerId, ici) }
        : action?.requetes ? { libelle: "Annuler", faire: () => defaire(prep, null, ici, action.requetes) } : null;
      annoncer(ici && prefixe ? `Noté : ${phrase}` : phrase, { genre: action === null && /^Déjà/.test(phrase) ? "info" : "succes", action: defaireIci });
      surEnvoye?.(a.genre);
    } catch (err) {
      // Pas de réponse nette, ou une tour momentanément indisponible (502,
      // 503, 429…), ou plus de session : la capture attend ici, avec son
      // identifiant : la file renverra sans doubler (NatureEchec de l'iPhone).
      if (natureEchec(err) !== "refus") {
        fileEnvoi.ajouter({ id: idEnvoi, resume: prep.resume, genre: a.genre, requetes: prep.requetes });
        annoncer(phraseEnFile(err), { genre: "info", detail: prep.resume });
        contexte?.majCompteurs?.();
        surEnvoye?.(a.genre);
        return;
      }
      const revenu = rendre();
      direErreur(err, revenu ? () => soumettre() : null, "Pas envoyé");
      if (ici) ici(`Pas envoyé : ${prep.resume}. ${ouEst(revenu)}`, "erreur");
    } finally {
      envois -= 1;
      if (!envois) envoyerBtn.removeAttribute("aria-busy");
    }
  };

  zone.addEventListener("input", () => {
    if (!zone.value.trim()) {
      genreChoisi = null;
      etiquetteRetiree = false;
      parentChoisi = undefined;
    }
    garderBrouillon();
    dessiner();
  });
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      soumettre();
    }
  });
  // La tour revient ou s'en va : la ligne « injoignable » suit.
  const suivreReseau = () => {
    if (!racine.isConnected && racine.dataset.vu === "1") {
      evenements.removeEventListener("hors-ligne", suivreReseau);
      evenements.removeEventListener("en-ligne", suivreReseau);
      return;
    }
    if (racine.isConnected) racine.dataset.vu = "1";
    if (!form.hidden) dessiner();
  };
  evenements.addEventListener("hors-ligne", suivreReseau);
  evenements.addEventListener("en-ligne", suivreReseau);
  dessiner();
  lireConnu().then(() => {
    if (!form.hidden) dessiner();
  }).catch(() => {});
  racine.focusChamp = () => {
    if (!recap.hidden) return;
    zone.focus();
    zone.setSelectionRange(zone.value.length, zone.value.length);
  };
  racine.vider = () => {
    zone.value = "";
    genreChoisi = null;
    etiquetteRetiree = false;
    parentChoisi = undefined;
    id = nouvelId();
    ligneFaite.hidden = true;
    if (!recap.hidden) cacherRecap();
    garderBrouillon();
    dessiner();
  };
  racine.texte = () => zone.value;
  racine.imageEnAttente = () => Boolean(image);
  racine.ajouterDicte = ajouterDicte;
  racine.cleBrouillon = brouillon;
  /** La feuille se ferme pendant une dictée : rien ne part, rien n'est gardé. */
  racine.arreterDictee = () => dicteeEnCours?.arreter();
  return racine;
}

/** Pendant le rangement : la file de Motion, dite (« En file chez Motion : ~20 s »). */
function suivreAttente(ligne) {
  let fini = false;
  const lent = async () => {
    try {
      const t = R.phraseAttenteMotion(await api("/api/motion/file", { delai: 4000 }));
      if (!fini && t) {
        vider(ligne, icone("sablier"), h("span", null, t));
        ligne.hidden = false;
      }
    } catch {}
  };
  evenements.addEventListener("motion-lent", lent);
  return () => {
    fini = true;
    evenements.removeEventListener("motion-lent", lent);
    ligne.hidden = true;
  };
}

/** Ce que dit « Noter » une fois la capture partie (CaptureView, EnvoiCaptures). */
function phraseFaite(a, prep, r) {
  switch (a.genre) {
    case "tache": return { phrase: a.date ? `Ajoutée à Motion : « ${court(prep.titre)} », ${decrireDate(a)}.` : `Ajoutée à Motion : « ${court(prep.titre)} ». Il lui trouve un créneau.` };
    case "idee": return { phrase: "Gardée dans « Idées » (Projets) : rien n'est planifié." };
    case "liste": {
      // Ce qui était déjà dans la liste n'est pas « ajouté » ; Annuler ne retire que les nouveaux.
      const deja = new Set((r?.dejaLa || []).map((x) => x.id));
      const nouveaux = prep.elements.filter((e) => !deja.has(e.id));
      const dejaLa = prep.elements.filter((e) => deja.has(e.id)).map((e) => e.texte);
      const phrase = R.phraseListe(prep.nomListe, nouveaux.map((e) => e.texte), dejaLa);
      if (!nouveaux.length) return { phrase, prefixe: false, action: null };
      return { phrase, action: dejaLa.length ? { requetes: prep.defaireElements(nouveaux.map((e) => e.id)) } : "defaire" };
    }
    case "rappel":
      if (r?.dejaLa?.length) return { phrase: `Déjà dans tes rappels : « ${court(prep.titre)} ».`, prefixe: false, action: null };
      return { phrase: a.date ? `Rappel : ${R.quandRappel(a.date.quand.getTime())}.` : "Rappel noté, sans date.", prefixe: false };
    case "retenir": return { phrase: r?.phrase || "Rémy l'a lu et retenu l'essentiel.", prefixe: false, action: null };
    case "projet": return { phrase: `${prep.resume} créé (Projets).` };
    default: return { phrase: "C'est noté." };
  }
}

/** Le formulaire de la feuille « Noter » ouverte (une dictée arrivée après une fermeture l'y rejoint). */
let noterOuvert = null;

/**
 * La feuille « Noter » (N, le bouton du rail, le ＋ des onglets). Le texte pas
 * envoyé est gardé (CLE_BROUILLON) et revient à la réouverture ; un clic à
 * côté ne ferme pas la feuille tant qu'il y a quelque chose dans le champ.
 */
export function ouvrirNoter({ texte = "", contexte } = {}) {
  if (document.querySelector("dialog.feuille-noter")) {
    document.querySelector("dialog.feuille-noter textarea")?.focus();
    return;
  }
  let f;
  // Un texte imposé (« Noter » depuis une conversation) ne touche pas au brouillon.
  const form = formulaireNoter({ texte, contexte, confirmation: "ligne", brouillon: texte ? null : CLE_BROUILLON, fermer: () => f?.fermer(),
    surEnvoye: (g) => { if (g === "question" || g === "plusieurs") f?.fermer(); else form.focusChamp(); } });
  noterOuvert = form;
  f = feuille({
    titre: "Noter", sousTitre: "Une tâche, une idée, une liste, un rappel… Rémy range.", contenu: form, classe: "feuille-noter", large: true,
    avantFermeture: (cause) => {
      if (cause === "fond" && (form.texte().trim() || form.imageEnAttente())) {
        form.focusChamp();
        return false;
      }
      return true;
    },
    surFermeture: () => {
      if (noterOuvert === form) noterOuvert = null;
      form.arreterDictee?.();
      if (!texte && form.texte().trim()) dire("Brouillon gardé : N pour le reprendre.", { duree: 3000 });
    },
  });
  form.focusChamp();
}

// La fenêtre Noter sans session : un avis, et la note attend dans la file.
let avisSession = null;
export function sessionPerdue() {
  if (avisSession) avisSession.hidden = false;
}

/** La petite fenêtre « Noter » de l'app Windows (`?fenetre=noter`). */
export async function monterFenetre(racine, { contexte, sansSession = false }) {
  racine.className = "";
  racine.removeAttribute("aria-busy");
  let dernierEnvoye = false;
  avisSession = h("div", { class: "avis-session", role: "status", hidden: !sansSession },
    icone("cadenas"), h("span", null, "Tu n'es pas connecté à la tour : ce que tu notes attend ici et part après ta reconnexion dans la fenêtre principale."),
    bureau.estBureau() ? bouton("Ouvrir Rémy", { classe: "papier petit", onclick: () => bureau.invoke("bureau_ouvrir", {}).catch(() => {}) }) : null);
  const form = formulaireNoter({
    compact: true, fenetre: true, contexte, confirmation: "ligne",
    fermer: () => bureau.fermerNoter(),
    surEnvoye: () => {
      dernierEnvoye = true;
      // Le temps de lire « Noté : … » avant que la petite fenêtre se cache.
      setTimeout(() => bureau.fermerNoter(), 1400);
    },
  });
  vider(racine, h("div", { class: "fenetre-noter" },
    h("div", { class: "tete-noter" }, h("span", { class: "marque-r", "aria-hidden": "true", style: { width: "26px", height: "26px", fontSize: "15px", borderRadius: "8px" } }, "R"), h("h1", null, "Noter"),
      h("span", { class: "aide" }, kbd("Entrée"), " envoie · ", kbd("Échap"), " ferme")),
    avisSession, form));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      form.arreterDictee?.();
      bureau.fermerNoter();
    }
  });
  bureau.surNoterOuvert(() => {
    if (dernierEnvoye) form.vider();
    dernierEnvoye = false;
    form.focusChamp();
  });
  form.focusChamp();
}

/** La question préparée par « Noter » (genre Question), à reprendre dans Rémy. */
export function questionEnAttente() {
  const q = local.lire(CLE_QUESTION, null);
  if (!q || Date.now() - q.a > 10 * 60e3) return null;
  local.effacer(CLE_QUESTION);
  return q.texte;
}
