// La voix du site : dicter au micro du PC, transcrit par la tour (Dictée
// Locale), l'audio n'est jamais gardé — ni sur disque, ni dans localStorage.
// Le port de `DicteeModel` (Voix.swift) et de `BarreEnregistrement` /
// `VocauxEnAttente` (RemyView.swift) :
// - pendant l'enregistrement, une barre remplace le champ (l'« ancre ») :
//   ✕ « Annuler le vocal » (rien ne part), point qui clignote, durée m:ss,
//   « Je t'écoute… » puis « Encore N s » dans la dernière minute avant le
//   plafond de 15 min, ✓ « Transcrire le vocal » ; Échap annule, Entrée transcrit ;
// - pendant la transcription : « Je transcris ta voix sur la tour… » ;
// - le texte s'AJOUTE au champ (`surTexte`), il ne part jamais seul ;
// - un vocal dont la transcription échoue reste en MÉMOIRE VIVE (perdu à la
//   fermeture de la page) : « Renvoyer » ou la corbeille (monterAttente).
// Contrat D : disponible(), demarrerDictee({ ancre, prive, transcription,
// surTexte }) → { arreter }, monterAttente(conteneur, { prive, surTexte }).
// Module importable sous node : rien ne touche au DOM au chargement.
import { ErreurAPI, evenements, nouvelId } from "./api.js";
import { h, vider, icone, bouton, dire, occupe, texteErreur } from "./ui.js";

/** Plafond d'un vocal (la tour accepte ~24 Mo ; 15 min d'Opus en font bien moins). */
export const DUREE_MAX = 15 * 60;
export const SANS_TRANSCRIPTION = "La dictée n'est pas branchée sur la tour : rien ne peut transcrire ta voix pour l'instant.";
export const INDISPONIBLE = "La dictée n'est pas disponible ici (micro non accessible).";
export const REFUSE = "Micro refusé : autorise-le pour cette page, puis réessaie.";
export const MICRO_COUPE = "Le micro a été coupé : ce que tu as dit jusque-là est gardé.";

/** Le navigateur peut-il enregistrer le micro ? */
export const disponible = () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";

/** « 1:05 ». */
export const mss = (secondes) => {
  const s = Math.max(0, Math.floor(secondes));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** Ce que dit la barre : « Je t'écoute… », puis « Encore N s » dans la dernière minute. */
export function texteBarre(secondes, max = DUREE_MAX) {
  const reste = Math.floor(max - Math.floor(secondes));
  return reste <= 60 ? `Encore ${Math.max(0, reste)} s` : "Je t'écoute…";
}
/** Le temps laissé à la tour pour transcrire : il grandit avec le vocal (API.swift). */
export const delaiTranscription = (duree) => (120 + Math.max(0, Number(duree) || 0)) * 1000;
/** Assez long pour partir : une demi-seconde et 1 000 octets au moins. */
export const assezLong = (duree, octets) => duree >= 0.5 && octets >= 1000;
/** « Ton vocal n'est pas parti — … Il t'attend : touche « Renvoyer ». » */
export const phrasePasParti = (raison) => `Ton vocal n'est pas parti — ${raison} Il t'attend : touche « Renvoyer ».`;

/**
 * Envoie l'audio à la tour (POST /api/transcribe?type=&dur=[&prive=1]) et rend
 * le texte. Les erreurs sont des ErreurAPI comme celles d'api.js : réseau,
 * délai, session perdue (signalée comme partout), refus expliqué par la tour.
 */
export async function transcrire(blob, { duree = 0, prive = false, signal } = {}) {
  const type = String(blob?.type || "audio/webm").split(";")[0] || "audio/webm";
  const q = new URLSearchParams({ type, dur: (Math.max(0, duree)).toFixed(1) });
  if (prive) q.set("prive", "1");
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort("delai"), delaiTranscription(duree));
  const relais = () => ctrl.abort("annule");
  signal?.addEventListener("abort", relais, { once: true });
  let r;
  try {
    r = await fetch(`/api/transcribe?${q}`, {
      method: "POST", body: blob, signal: ctrl.signal, credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": blob?.type || "application/octet-stream", Accept: "application/json" },
    });
  } catch {
    if (ctrl.signal.reason === "annule") throw new ErreurAPI("Annulé.", { nature: "annule" });
    if (ctrl.signal.reason === "delai") throw new ErreurAPI("La tour met trop de temps à transcrire. Réessaie dans un instant.", { nature: "delai" });
    throw new ErreurAPI("La tour ne répond pas. Vérifie que le PC est allumé et que Tailscale est connecté.", { nature: "reseau" });
  } finally {
    clearTimeout(minuteur);
    signal?.removeEventListener("abort", relais);
  }
  const brut = await r.text().catch(() => "");
  let d = null;
  try {
    d = brut ? JSON.parse(brut) : null;
  } catch {}
  if ((r.status === 502 || r.status === 504) && (d == null || typeof d !== "object")) {
    throw new ErreurAPI("La tour est joignable mais Rémy n'y répond pas (redémarrage ou mise à jour en cours ?).", { nature: "reseau", statut: r.status });
  }
  if (r.status === 401) {
    evenements.dispatchEvent(new CustomEvent("session-perdue"));
    throw new ErreurAPI("Ta session a expiré : reconnecte-toi.", { nature: "auth", statut: 401 });
  }
  if (!r.ok) throw new ErreurAPI((d && (d.message || (typeof d.error === "string" ? d.error : null))) || `Erreur ${r.status} : réessaie.`, { nature: "serveur", statut: r.status });
  if (!d || typeof d !== "object") throw new ErreurAPI("La tour a répondu quelque chose d'illisible.", { nature: "illisible", statut: r.status });
  return String(d.text || "").trim();
}

// --- Les vocaux pas partis (mémoire vive seulement) ---

const attente = []; // { id, blob, duree, raison, prive }
const abonnes = new Set();
const prevenir = () => {
  for (const f of [...abonnes]) f();
};
export const vocauxEnAttente = () => attente.map(({ id, duree, raison, prive }) => ({ id, duree, raison, prive }));
function garder(v, raison) {
  const deja = attente.find((x) => x.id === v.id);
  if (deja) deja.raison = raison;
  else attente.push({ ...v, raison });
  prevenir();
}
function oublier(id) {
  const i = attente.findIndex((x) => x.id === id);
  if (i >= 0) attente.splice(i, 1);
  prevenir();
}
/** Déconnexion : rien de la session ne reste en mémoire. */
export function oublierTout() {
  attente.splice(0);
  prevenir();
}

/** Transcrit un vocal ; l'échec le garde, la réussite l'oublie. Rend le texte, ou null. */
async function essayer(v, { prive, surTexte }) {
  try {
    const t = await transcrire(v.blob, { duree: v.duree, prive: Boolean(v.prive || prive) });
    oublier(v.id);
    if (!t) {
      dire("Je n'ai rien entendu — réessaie plus près du micro.");
      return null;
    }
    surTexte?.(t);
    return t;
  } catch (err) {
    const raison = texteErreur(err);
    garder(v, raison);
    if (err?.nature !== "auth") dire(phrasePasParti(raison), { genre: "erreur" });
    return null;
  }
}

/**
 * La liste des vocaux pas partis, dans `conteneur` (cachée s'il n'y en a
 * pas). « Renvoyer » retente la même transcription ; la corbeille l'oublie.
 * Le conteneur se désabonne seul quand il quitte la page.
 */
export function monterAttente(conteneur, { prive = false, surTexte } = {}) {
  const dessiner = () => {
    if (!conteneur.isConnected && conteneur.dataset.monte === "1") {
      abonnes.delete(dessiner);
      return;
    }
    conteneur.dataset.monte = "1";
    conteneur.classList.add("dictee-attente");
    conteneur.hidden = !attente.length;
    vider(conteneur, attente.map((v) => {
      const renvoyer = bouton("Renvoyer", { classe: "texte petit dictee-renvoyer", titre: "Retente la transcription sur la tour" });
      renvoyer.addEventListener("click", () => occupe(renvoyer, () => essayer(v, { prive, surTexte })));
      const jeter = bouton("", { classe: "texte icone", icone: "corbeille", etiquette: "Jeter ce vocal", titre: "Jeter ce vocal" });
      jeter.addEventListener("click", () => {
        oublier(v.id);
        dire("Vocal jeté : rien n'est parti.");
      });
      return h("div", { class: "dictee-vocal", role: "group", "aria-label": `Vocal de ${mss(v.duree)} pas parti` },
        icone("onde"),
        h("div", { class: "corps" }, h("strong", null, `Vocal de ${mss(v.duree)} pas parti`), h("span", { class: "raison" }, v.raison)),
        renvoyer, jeter);
    }));
  };
  abonnes.add(dessiner);
  dessiner();
  return { detacher: () => abonnes.delete(dessiner) };
}

// --- L'enregistrement ---

let enCours = null; // la dictée qui enregistre ou transcrit (une à la fois)

function typeEnregistrement() {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    try {
      if (MediaRecorder.isTypeSupported?.(t)) return t;
    } catch {}
  }
  return "";
}

/**
 * Démarre une dictée. `ancre` : l'élément que la barre remplace (le champ, la
 * boîte du composeur) ; `transcription` : false si la tour dit qu'aucun moteur
 * n'est branché (refus dit avant d'enregistrer) ; `prive` : Dictée Locale
 * seulement ; `surTexte(texte)` reçoit le texte ; `surEtat(etat)` (facultatif) :
 * « enregistrement », « transcription », « repos ». Rend { arreter } :
 * arreter() annule sans rien dire (la feuille se ferme), arreter({ transcrire: true }) transcrit.
 */
export function demarrerDictee({ ancre, prive = false, transcription, surTexte, surEtat } = {}) {
  const rien = { arreter() {}, promesse: Promise.resolve(null) };
  if (enCours) return enCours.poignee;
  if (transcription === false) {
    dire(SANS_TRANSCRIPTION, { genre: "erreur" });
    return rien;
  }
  if (!disponible()) {
    dire(INDISPONIBLE, { genre: "erreur" });
    return rien;
  }
  let resoudre;
  const promesse = new Promise((r) => (resoudre = r));
  const etat = { fini: false, flot: null, enregistreur: null, morceaux: [], debut: 0, minuteur: null, barre: null, annule: false, coupe: false };
  const poignee = { arreter: (o) => arreter(o), promesse };
  enCours = { poignee };
  const signaler = (e) => {
    try {
      surEtat?.(e);
    } catch {}
  };

  const remettre = () => {
    clearInterval(etat.minuteur);
    document.removeEventListener("keydown", clavier, true);
    etat.flot?.getTracks().forEach((t) => t.stop());
    etat.barre?.remove();
    if (ancre) {
      ancre.hidden = false;
      ancre.style.display = etat.affichage ?? "";
    }
    if (enCours?.poignee === poignee) enCours = null;
    signaler("repos");
  };
  const finir = (texte = null) => {
    if (etat.fini) return;
    etat.fini = true;
    remettre();
    resoudre(texte);
  };

  const transcrireIci = async () => {
    const duree = (Date.now() - etat.debut) / 1000;
    const type = etat.enregistreur?.mimeType || typeEnregistrement() || "audio/webm";
    const blob = new Blob(etat.morceaux, { type });
    etat.morceaux = [];
    if (!assezLong(duree, blob.size)) {
      dire("Trop court : rien n'est parti.");
      return finir(null);
    }
    signaler("transcription");
    vider(etat.barre, h("span", { class: "dictee-roue", "aria-hidden": "true" }), h("span", { class: "dictee-libelle" }, "Je transcris ta voix sur la tour…"));
    etat.barre.setAttribute("aria-busy", "true");
    const v = { id: nouvelId(), blob, duree, prive: Boolean(prive) };
    if (etat.coupe) {
      // Coupé de l'extérieur : ce qui est enregistré attend, il ne part pas seul.
      garder(v, MICRO_COUPE);
      dire("Vocal coupé : il t'attend au-dessus du champ, touche « Renvoyer ».");
      return finir(null);
    }
    const t = await essayer(v, { prive, surTexte });
    finir(t);
  };

  // L'enregistreur rend ses derniers morceaux à l'arrêt : on attend « stop ».
  const arreterEnregistreur = () => new Promise((r) => {
    const e = etat.enregistreur;
    if (!e || e.state === "inactive") return r();
    e.addEventListener("stop", () => r(), { once: true });
    try {
      e.stop();
    } catch {
      r();
    }
  });

  async function arreter({ transcrire: aTranscrire = false, message = false } = {}) {
    if (etat.fini || etat.arret) return;
    etat.arret = true;
    clearInterval(etat.minuteur);
    if (!aTranscrire) {
      etat.annule = true;
      await arreterEnregistreur();
      etat.morceaux = [];
      if (message) dire("Vocal annulé : rien n'est parti.");
      return finir(null);
    }
    await arreterEnregistreur();
    etat.flot?.getTracks().forEach((t) => t.stop());
    await transcrireIci();
  }

  const clavier = (e) => {
    if (etat.fini || etat.arret) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      arreter({ message: true });
    } else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      const ici = document.activeElement;
      if (!ici || ici === document.body || etat.barre?.contains(ici)) {
        e.preventDefault();
        e.stopPropagation();
        arreter({ transcrire: true });
      }
    }
  };

  (async () => {
    try {
      etat.flot = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const refus = err?.name === "NotAllowedError" || err?.name === "SecurityError";
      dire(refus ? REFUSE : INDISPONIBLE, { genre: "erreur" });
      return finir(null);
    }
    if (etat.fini || etat.arret) {
      etat.flot.getTracks().forEach((t) => t.stop());
      return finir(null);
    }
    const type = typeEnregistrement();
    try {
      etat.enregistreur = new MediaRecorder(etat.flot, type ? { mimeType: type } : undefined);
    } catch {
      dire(INDISPONIBLE, { genre: "erreur" });
      return finir(null);
    }
    etat.enregistreur.addEventListener("dataavailable", (e) => {
      if (e.data?.size && !etat.annule) etat.morceaux.push(e.data);
    });
    // Un micro débranché (ou coupé par le système) en cours de route.
    for (const piste of etat.flot.getAudioTracks()) {
      piste.addEventListener("ended", () => {
        if (etat.fini || etat.arret) return;
        etat.coupe = true;
        arreter({ transcrire: true });
      });
    }
    const temps = h("span", { class: "dictee-temps" }, "0:00");
    const libelle = h("span", { class: "dictee-libelle" }, "Je t'écoute…");
    const annuler = bouton("", { classe: "texte icone dictee-annuler", icone: "fermer", etiquette: "Annuler le vocal", titre: "Annuler le vocal (Échap)" });
    annuler.addEventListener("click", () => arreter({ message: true }));
    const valider = bouton("", { classe: "plein icone dictee-valider", icone: "coche", etiquette: "Transcrire le vocal", titre: "Transcrire le vocal (Entrée)" });
    valider.addEventListener("click", () => arreter({ transcrire: true }));
    etat.barre = h("div", { class: "dictee-barre", role: "group", "aria-label": "Enregistrement en cours" },
      annuler, h("span", { class: "dictee-point", "aria-hidden": "true" }), temps, libelle, h("span", { class: "dictee-espace" }), valider);
    if (ancre) {
      ancre.after(etat.barre);
      // Caché pour de bon, même si sa classe impose un display (la boîte du composeur).
      etat.affichage = ancre.style.display;
      ancre.hidden = true;
      ancre.style.display = "none";
    }
    etat.debut = Date.now();
    etat.enregistreur.start(1000);
    signaler("enregistrement");
    document.addEventListener("keydown", clavier, true);
    valider.focus();
    etat.minuteur = setInterval(() => {
      const s = (Date.now() - etat.debut) / 1000;
      temps.textContent = mss(s);
      const t = texteBarre(s);
      libelle.textContent = t;
      libelle.classList.toggle("fin", t !== "Je t'écoute…");
      etat.barre.setAttribute("aria-label", `Enregistrement en cours, ${Math.floor(s)} secondes`);
      if (s >= DUREE_MAX) {
        dire(`${Math.round(DUREE_MAX / 60)} minutes : j'arrête l'enregistrement là et je transcris. Continue dans un nouveau vocal.`);
        arreter({ transcrire: true });
      }
    }, 500);
  })();

  return poignee;
}
