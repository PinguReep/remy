// Le mode appel : parler à Rémy à voix haute, comme au téléphone (le port
// d'AppelView.swift et d'AppelModel / DetecteurParole / Parole, Voix.swift).
// J'écoute → une pause de 1,7 s (ou « J'ai fini de parler ») → je transcris
// sur la tour (l'audio n'est pas gardé) → je réfléchis (POST …/messages
// { text, call: true } : réponse courte, sans Markdown, écrite aussi dans le
// fil) → je parle, micro coupé → j'écoute de nouveau, jusqu'à « Raccrocher ».
// La voix : speechSynthesis avec des voix LOCALES seulement (localService) —
// aucune voix en ligne, aucun nouveau tiers. Sans voix locale, c'est dit, et
// la réponse s'affiche seulement.
// Contrat D : ouvrirAppel({ ctx, conv, prive }) → Promise<id de conversation | null>.
import { api, ecrire, flux, seg } from "../api.js";
import { h, vider, icone, bouton, dire, sansMarqueurs, texteErreur } from "../ui.js";
import { disponible, transcrire, assezLong, SANS_TRANSCRIPTION, INDISPONIBLE, REFUSE } from "../dictee.js";

// --- Fin de parole (DetecteurParole) ---

/**
 * Décide, au volume du micro, quand Sam a fini de parler : un silence de
 * 1,7 s après de la voix. Le bruit de fond est mesuré au début de chaque
 * écoute (0,4 s) ; la voix, c'est 12 dB au-dessus, jamais sous −50 dB, et un
 * fond plus fort que −35 dB est plafonné (Sam parlait déjà).
 */
export class DetecteurParole {
  constructor({ silenceFin = 1.7, calibrage = 0.4, marge = 12, seuilMin = -50, fondMax = -35, attenteMax = 30, paroleMax = 90 } = {}) {
    Object.assign(this, { silenceFin, calibrage, marge, seuilMin, fondMax, attenteMax, paroleMax });
    this.mesures = [];
    this.fond = null;
    this.parole = false;
    this.derniereVoix = 0;
    this.debutParole = 0;
  }
  get seuil() {
    return Math.max(Math.min(this.fond ?? -60, this.fondMax) + this.marge, this.seuilMin);
  }
  /** `db` : le volume mesuré ; `t` : secondes depuis le début de l'écoute. Rend continuer | finDeParole | rienEntendu. */
  analyser(db, t) {
    if (this.fond == null) {
      if (t < this.calibrage) {
        this.mesures.push(db);
        return "continuer";
      }
      this.fond = this.mesures.length ? this.mesures.reduce((a, b) => a + b, 0) / this.mesures.length : -60;
    }
    if (db > this.seuil) {
      if (!this.parole) {
        this.parole = true;
        this.debutParole = t;
      }
      this.derniereVoix = t;
    }
    if (this.parole) {
      if (t - this.derniereVoix >= this.silenceFin || t - this.debutParole >= this.paroleMax) return "finDeParole";
    } else if (t >= this.attenteMax) return "rienEntendu";
    return "continuer";
  }
  /** Le volume ramené entre 0 et 1, pour l'animation. */
  static normaliser(db) {
    return Math.max(0, Math.min(1, (db + 55) / 45));
  }
}

/** Ce que la voix de Rémy lit : sans Markdown, sans lien, sans marqueur (Parole.pourVoix). */
export function pourVoix(texte) {
  let t = sansMarqueurs(texte).replace(/\[(?:SESSION-FAITE|COUVERT|TRAITE):[^\]]*\]/gi, "");
  t = t.replace(/\*\((interrompu|coupée : réponse trop longue)\)\*/g, "");
  t = t.replace(/```[\s\S]*?```/g, " (code) ");
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1");
  t = t.replace(/https?:\/\/\S+/g, "(lien)");
  t = t.replace(/[*_#>`~]/g, "");
  return t.replace(/\s+/g, " ").trim();
}

/** Les voix françaises installées sur l'ordinateur (jamais une voix en ligne). */
export function voixLocales(toutes) {
  return (toutes || []).filter((v) => v && v.localService === true && /^fr\b|^fr[-_]/i.test(v.lang || ""))
    .sort((a, b) => Number(/^fr[-_]FR/i.test(b.lang)) - Number(/^fr[-_]FR/i.test(a.lang)));
}

/** Les mots de chaque état (AppelView). */
export function textesEtat(etat, { parleDeja = false, statut = "", message = "" } = {}) {
  switch (etat) {
    case "ecoute": return { titre: parleDeja ? "Je t'écoute…" : "Parle quand tu veux", sous: "Une pause, et je t'envoie la question. Ou touche le carré." };
    case "transcription": return { titre: "Je transcris…", sous: "Sur ta tour : l'audio n'est pas gardé." };
    case "reflexion": return { titre: "Je réfléchis…", sous: statut || "Réponse courte, à voix haute." };
    case "parole": return { titre: "Je parle", sous: "Le micro est coupé. Touche le carré pour me couper." };
    case "erreur": return { titre: "Ça coince", sous: message };
    default: return { titre: "Appel terminé", sous: "" };
  }
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function lireVoix() {
  if (typeof speechSynthesis === "undefined") return [];
  let v = speechSynthesis.getVoices();
  if (v.length) return voixLocales(v);
  await Promise.race([new Promise((r) => speechSynthesis.addEventListener("voiceschanged", r, { once: true })), attendre(1200)]);
  return voixLocales(speechSynthesis.getVoices());
}

let ouvert = null;

/**
 * Ouvre l'appel en plein écran. `conv` : la conversation où l'échange
 * s'écrit (null : une conversation naît à la première phrase) ; `prive` :
 * la dictée reste sur la tour. Rend l'id de la conversation (ou null) au
 * « Raccrocher ».
 */
export async function ouvrirAppel({ ctx, conv = null, prive = false } = {}) {
  if (ouvert) return ouvert;
  if (!disponible() || typeof AudioContext === "undefined" && typeof webkitAudioContext === "undefined") {
    dire(INDISPONIBLE, { genre: "erreur" });
    return null;
  }
  // La tour sait-elle transcrire ? (sonde légère, sans appel IA)
  try {
    const p = await api("/api/transcribe", { delai: 8000 });
    if (p && p.available === false) {
      dire(SANS_TRANSCRIPTION, { genre: "erreur" });
      return null;
    }
  } catch (err) {
    if (err?.nature !== "auth") dire(`L'appel n'a pas pu démarrer : ${texteErreur(err)}`, { genre: "erreur" });
    return null;
  }
  ouvert = appel({ ctx, conv, prive }).finally(() => {
    ouvert = null;
  });
  return ouvert;
}

function appel({ ctx, conv, prive }) {
  let resoudre;
  const fini = new Promise((r) => (resoudre = r));
  let convId = conv || null;
  let session = 0;
  let etat = "arrete";
  let parleDeja = false;
  let statut = "";
  let message = "";
  let entendu = "";
  let reponse = "";
  let niveau = 0;
  let finDemandee = false;
  let flot = null;
  let contexteAudio = null;
  let analyseur = null;
  let enregistreur = null;
  let lecture = null; // le flux de la réponse en cours (pour raccrocher)
  let verrou = null;
  let voix = [];
  let sansVoix = false;

  // --- L'écran ---
  const carre = h("button", { type: "button", class: "appel-carre", "aria-label": "J'ai fini de parler" }, h("span", { class: "appel-r", "aria-hidden": "true" }, "R"));
  const titre = h("h2", { class: "appel-titre" });
  const sous = h("p", { class: "appel-sous" });
  const roue = h("span", { class: "dictee-roue appel-roue", "aria-hidden": "true", hidden: true });
  const echange = h("div", { class: "appel-echange", "aria-live": "polite" });
  const actions = h("div", { class: "appel-actions" });
  const raccrocher = bouton("Raccrocher", { classe: "danger large appel-raccrocher", icone: "raccrocher", titre: "Raccrocher (Échap)" });
  const d = h("dialog", { class: "appel", "aria-label": "Appel avec Rémy" },
    h("header", { class: "appel-tete" }, h("span", { class: "appel-etiquette" }, "Appel avec Rémy"), h("span", { class: "appel-signal", "aria-hidden": "true" })),
    h("div", { class: "appel-centre" }, carre, h("div", { class: "appel-textes", role: "status" }, titre, sous, roue)),
    echange,
    h("div", { class: "appel-pied" }, actions, raccrocher));

  const dessiner = () => {
    const t = textesEtat(etat, { parleDeja, statut, message });
    titre.textContent = t.titre;
    sous.textContent = t.sous;
    sous.classList.toggle("erreur", etat === "erreur");
    roue.hidden = !(etat === "transcription" || etat === "reflexion");
    carre.className = `appel-carre ${etat}`;
    carre.disabled = !(etat === "ecoute" || etat === "parole");
    carre.setAttribute("aria-label", etat === "parole" ? "Couper la parole à Rémy" : "J'ai fini de parler");
    carre.style.setProperty("--niveau", String(etat === "ecoute" ? niveau : 0));
    vider(echange,
      entendu ? [h("span", { class: "appel-etiquette" }, "Tu as dit"), h("p", { class: "appel-dit" }, `« ${entendu} »`)] : null,
      reponse ? [h("span", { class: "appel-etiquette" }, "Rémy"), h("p", { class: "appel-reponse" }, pourVoix(reponse))] : null,
      sansVoix && reponse ? h("p", { class: "aide" }, "Pas de voix française installée sur cet ordinateur : je n'affiche que le texte (aucune voix en ligne n'est utilisée).") : null);
    echange.scrollTop = echange.scrollHeight;
    const btns = [];
    if (etat === "ecoute") btns.push(bouton("J'ai fini de parler", { classe: "papier large", kbd: "Espace", onclick: toucher }));
    if (etat === "parole") btns.push(bouton("Couper la parole", { classe: "papier large", kbd: "Espace", onclick: toucher }));
    if (etat === "erreur") btns.push(bouton("Réessayer", { classe: "plein large", icone: "rafraichir", onclick: reessayer }));
    vider(actions, btns);
  };

  function toucher() {
    if (etat === "ecoute") finDemandee = true;
    else if (etat === "parole") speechSynthesis?.cancel();
  }
  function reessayer() {
    if (etat !== "erreur") return;
    lancer();
  }
  const enCours = (s) => s === session;
  const poser = (e) => {
    etat = e;
    dessiner();
  };

  const couperMicro = (couper) => {
    flot?.getAudioTracks().forEach((t) => (t.enabled = !couper));
  };
  const niveauDb = () => {
    if (!analyseur) return -160;
    const tampon = new Float32Array(analyseur.fftSize);
    analyseur.getFloatTimeDomainData(tampon);
    let somme = 0;
    for (const x of tampon) somme += x * x;
    const rms = Math.sqrt(somme / tampon.length);
    return rms > 0 ? 20 * Math.log10(rms) : -160;
  };

  async function ouvrirMicro() {
    if (flot) return;
    flot = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    contexteAudio = new AC();
    contexteAudio.resume?.().catch?.(() => {});
    analyseur = contexteAudio.createAnalyser();
    analyseur.fftSize = 2048;
    contexteAudio.createMediaStreamSource(flot).connect(analyseur);
    for (const piste of flot.getAudioTracks()) {
      piste.addEventListener("ended", () => {
        if (etat === "arrete") return;
        session += 1;
        flot = null;
        message = "Le micro a été coupé. Rebranche-le, puis « Réessayer ».";
        poser("erreur");
      });
    }
  }

  const enregistrer = () => {
    const morceaux = [];
    let type = "";
    for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
      try {
        if (MediaRecorder.isTypeSupported?.(t)) {
          type = t;
          break;
        }
      } catch {}
    }
    const e = new MediaRecorder(flot, type ? { mimeType: type } : undefined);
    e.addEventListener("dataavailable", (x) => x.data?.size && morceaux.push(x.data));
    const debut = Date.now();
    e.start(500);
    return {
      jeter: () => {
        try {
          if (e.state !== "inactive") e.stop();
        } catch {}
      },
      arreter: () => new Promise((r) => {
        e.addEventListener("stop", () => r({ blob: new Blob(morceaux, { type: e.mimeType || type || "audio/webm" }), duree: (Date.now() - debut) / 1000 }), { once: true });
        try {
          e.stop();
        } catch {
          r({ blob: new Blob(morceaux, { type: type || "audio/webm" }), duree: (Date.now() - debut) / 1000 });
        }
      }),
    };
  };

  /** Une conversation naît à la première phrase (rien de vide dans la liste). */
  async function assurerConversation() {
    if (convId) return convId;
    const c = await ecrire("/api/conversations", prive ? { prive: true } : {});
    convId = c.id;
    return convId;
  }

  /** La réponse de Rémy, en flux ; rend le texte complet. */
  async function demander(texte, s) {
    const id = await assurerConversation();
    const ctrl = new AbortController();
    lecture = ctrl;
    let t = "";
    let erreur = null;
    try {
      await flux(`/api/conversations/${seg(id)}/messages`, { text: texte, call: true }, (nom, x) => {
        if (!enCours(s)) return;
        if (nom === "delta") {
          t += x.text || "";
          reponse = t;
          dessiner();
        } else if (nom === "status") {
          statut = x.text || statut;
          dessiner();
        } else if (nom === "done") {
          if (typeof x.text === "string" && x.text) t = x.text;
        } else if (nom === "error") erreur = x;
      }, { signal: ctrl.signal });
    } finally {
      if (lecture === ctrl) lecture = null;
    }
    if (erreur) throw new Error((erreur.message || "Erreur de la tour.") + (erreur.code ? ` (code ${erreur.code})` : ""));
    return t;
  }

  /** Lit la réponse à voix haute, micro coupé ; rend la main à la fin (ou si Sam coupe). */
  function parler(texte) {
    return new Promise((r) => {
      const v = voix[0];
      if (!v || typeof speechSynthesis === "undefined") return r();
      const u = new SpeechSynthesisUtterance(texte);
      u.voice = v;
      u.lang = v.lang;
      u.addEventListener("end", () => r(), { once: true });
      u.addEventListener("error", () => r(), { once: true });
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }

  async function boucle(s) {
    while (enCours(s)) {
      // 1. J'écoute.
      parleDeja = false;
      finDemandee = false;
      statut = "";
      try {
        await ouvrirMicro();
      } catch (err) {
        if (!enCours(s)) return;
        message = err?.name === "NotAllowedError" || err?.name === "SecurityError" ? REFUSE : INDISPONIBLE;
        poser("erreur");
        return;
      }
      if (!enCours(s)) return;
      couperMicro(false);
      poser("ecoute");
      const det = new DetecteurParole();
      const prise = enregistrer();
      enregistreur = prise;
      const debut = Date.now();
      let verdict = "continuer";
      while (verdict === "continuer") {
        await attendre(100);
        if (!enCours(s)) return prise.jeter();
        const db = niveauDb();
        niveau = DetecteurParole.normaliser(db);
        verdict = det.analyser(db, (Date.now() - debut) / 1000);
        if (det.parole !== parleDeja) {
          parleDeja = det.parole;
          dessiner();
        } else carre.style.setProperty("--niveau", String(niveau));
        if (finDemandee) verdict = "finDeParole";
      }
      niveau = 0;
      if (verdict === "rienEntendu") {
        prise.jeter();
        continue;
      }
      // 2. Je transcris.
      const { blob, duree } = await prise.arreter();
      enregistreur = null;
      if (!enCours(s)) return;
      if (!assezLong(duree, blob.size)) continue;
      couperMicro(true);
      poser("transcription");
      let texte;
      try {
        texte = await transcrire(blob, { duree, prive });
      } catch (err) {
        if (!enCours(s)) return;
        if (err?.nature === "auth") return fermer();
        message = texteErreur(err);
        poser("erreur");
        return;
      }
      if (!enCours(s)) return;
      if (!texte) continue;
      entendu = texte;
      // 3. Je réfléchis (la réponse s'écrit aussi dans la conversation).
      reponse = "";
      poser("reflexion");
      let r;
      try {
        r = await demander(texte, s);
      } catch (err) {
        if (!enCours(s) || err?.nature === "annule") return;
        if (err?.nature === "auth") return fermer();
        message = texteErreur(err) || "Rémy n'a pas pu répondre — réessaie.";
        poser("erreur");
        return;
      }
      if (!enCours(s)) return;
      if (!r) {
        message = "Rémy n'a pas pu répondre — réessaie.";
        poser("erreur");
        return;
      }
      reponse = r;
      // 4. Je parle — micro coupé (sinon il s'entendrait).
      if (voix.length) {
        poser("parole");
        await parler(pourVoix(r));
      } else {
        sansVoix = true;
        dessiner();
      }
    }
  }

  function lancer() {
    session += 1;
    const s = session;
    boucle(s).catch((err) => {
      if (!enCours(s)) return;
      message = texteErreur(err);
      poser("erreur");
    });
  }

  async function garderEcran() {
    try {
      verrou = await navigator.wakeLock?.request?.("screen");
    } catch {
      verrou = null;
    }
  }
  const auRetour = () => {
    if (document.visibilityState === "visible" && etat !== "arrete" && !verrou) garderEcran();
  };

  function fermer() {
    if (etat === "arrete" && !d.isConnected) return;
    session += 1;
    enregistreur?.jeter();
    enregistreur = null;
    // La réponse en cours continue sur la tour et restera dans la conversation.
    lecture?.abort();
    try {
      speechSynthesis?.cancel();
    } catch {}
    flot?.getTracks().forEach((t) => t.stop());
    flot = null;
    contexteAudio?.close?.().catch?.(() => {});
    verrou?.release?.().catch?.(() => {});
    verrou = null;
    document.removeEventListener("visibilitychange", auRetour);
    etat = "arrete";
    if (d.open) d.close();
    d.remove();
    resoudre(convId);
  }

  carre.addEventListener("click", toucher);
  raccrocher.addEventListener("click", fermer);
  d.addEventListener("cancel", (e) => {
    e.preventDefault();
    fermer();
  });
  // Fermé d'ailleurs (session perdue : fermerFeuilles) : le micro et la voix s'arrêtent aussi.
  d.addEventListener("close", () => {
    if (etat !== "arrete") fermer();
  });
  // Espace = « J'ai fini » / « Couper la parole », où que soit le focus
  // (jamais « Raccrocher » par accident : l'activation au relâché est retenue).
  d.addEventListener("keydown", (e) => {
    if (e.key !== " ") return;
    e.preventDefault();
    if (!e.repeat && (etat === "ecoute" || etat === "parole")) toucher();
  }, true);
  d.addEventListener("keyup", (e) => {
    if (e.key === " ") e.preventDefault();
  }, true);
  document.addEventListener("visibilitychange", auRetour);
  document.body.append(d);
  d.showModal();
  raccrocher.focus();
  dessiner();
  garderEcran();
  lireVoix().then((v) => {
    voix = v;
  });
  lancer();
  void ctx;
  return fini;
}
