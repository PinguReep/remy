// Page de démarrage de l'app Windows (embarquée) : l'adresse de la tour au
// premier lancement, la sonde, et l'écran « La tour ne répond pas ».
// Dès que la tour répond, la coquille charge le site dans cette fenêtre.
"use strict";

const SONDE_DELAI_MS = 5000;
const REESSAI_AUTO_S = 30;

const $ = (id) => document.getElementById(id);
const tauri = window.__TAURI__;
const invoke = (commande, args) => tauri.core.invoke(commande, args);

let adresseCourante = null;
let compteARebours = null;

function montrer(vue) {
  for (const id of ["vue-connexion", "vue-adresse", "vue-hors-ligne"]) $(id).hidden = id !== vue;
}

function message(el, texte, genre) {
  el.textContent = texte || "";
  el.className = "message" + (genre ? " " + genre : "");
}

function hote(adresse) {
  try { return new URL(adresse).host; } catch { return adresse; }
}

/** La tour répond-elle ? Une réponse opaque suffit (pas de CORS, pas de cookie). */
async function sonder(adresse) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), SONDE_DELAI_MS);
  try {
    await fetch(adresse + "/api/version", { mode: "no-cors", cache: "no-store", credentials: "omit", signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(minuteur);
  }
}

function arreterCompte() {
  if (compteARebours) clearInterval(compteARebours);
  compteARebours = null;
}

async function allerSurLaTour() {
  arreterCompte();
  try {
    await invoke("bureau_aller_tour");
  } catch (e) {
    montrerHorsLigne(adresseCourante, "La tour répond, mais la fenêtre n'a pas pu s'y rendre : " + e);
  }
}

async function connecter(adresse) {
  adresseCourante = adresse;
  $("connexion-adresse").textContent = adresse;
  montrer("vue-connexion");
  if (await sonder(adresse)) return allerSurLaTour();
  montrerHorsLigne(adresse);
}

const EXPLICATION_HORS_LIGNE = "Rémy vit sur ta tour. Vérifie qu'elle est allumée et que Tailscale est connecté sur ce PC.";

/** `?injoignable=` posé par la coquille : la page de la tour n'a pas tenu. */
function panneDeLaTour() {
  const code = new URLSearchParams(location.search).get("injoignable");
  if (!code) return null;
  if (/^5\d\d$/.test(code)) {
    return {
      titre: "Rémy ne répond pas encore",
      explication: `La tour répond, mais pas Rémy (erreur ${code}). À l'ouverture de session, il lui faut parfois une minute pour démarrer. S'il ne revient pas, relance la tâche « Rémy » sur la tour.`,
    };
  }
  if (code === "muette") {
    return {
      titre: "La page de Rémy ne s'est pas chargée",
      explication: "La tour a été jointe, mais la page n'est pas arrivée en 20 s. La connexion Tailscale est peut-être lente ou coupée.",
    };
  }
  return {
    titre: "Rémy ne répond pas encore",
    explication: "La tour a renvoyé une page vide : Rémy démarre peut-être. S'il ne revient pas, relance la tâche « Rémy » sur la tour.",
  };
}

function montrerHorsLigne(adresse, texte, panne) {
  $("hors-ligne-adresse").textContent = adresse;
  $("hors-ligne-sur-titre").textContent = panne ? "Tour jointe" : "Hors ligne";
  $("hors-ligne-titre").textContent = panne ? panne.titre : "La tour ne répond pas";
  $("hors-ligne-explication").textContent = panne ? panne.explication : EXPLICATION_HORS_LIGNE;
  montrer("vue-hors-ligne");
  arreterCompte();
  let reste = REESSAI_AUTO_S;
  const dire = () => message($("reessai-message"), texte || `Nouvel essai tout seul dans ${reste} s.`);
  dire();
  texte = null;
  compteARebours = setInterval(() => {
    reste -= 1;
    if (reste <= 0) { reessayer(true); return; }
    dire();
  }, 1000);
  $("bouton-reessayer").focus({ preventScroll: true });
}

async function reessayer(automatique) {
  arreterCompte();
  const bouton = $("bouton-reessayer");
  bouton.disabled = true;
  bouton.textContent = "Je vérifie…";
  message($("reessai-message"), "");
  const ok = await sonder(adresseCourante);
  bouton.disabled = false;
  bouton.textContent = "Réessayer";
  if (ok) return allerSurLaTour();
  const heure = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  montrerHorsLigne(adresseCourante,
    `${automatique ? "Essai automatique" : "Essai"} de ${heure} : toujours pas de réponse. Nouvel essai tout seul dans ${REESSAI_AUTO_S} s.`);
}

function montrerAdresse({ changer }) {
  arreterCompte();
  montrer("vue-adresse");
  $("adresse-sur-titre").textContent = changer ? "Changer d'adresse" : "Premier lancement";
  $("bouton-annuler").hidden = !(changer && adresseCourante);
  $("bouton-garder").hidden = true;
  const champ = $("champ-adresse");
  if (changer && adresseCourante) champ.value = adresseCourante.replace(/^https:\/\//, "");
  message($("adresse-message"), "");
  champ.removeAttribute("aria-invalid");
  champ.focus();
  champ.select();
}

let adresseEnAttente = null;

async function continuer(ev) {
  ev.preventDefault();
  const champ = $("champ-adresse");
  const zone = $("adresse-message");
  const bouton = $("bouton-continuer");
  $("bouton-garder").hidden = true;
  let propre;
  try {
    propre = await invoke("bureau_adresse_normaliser", { adresse: champ.value });
  } catch (e) {
    champ.setAttribute("aria-invalid", "true");
    message(zone, String(e), "erreur");
    champ.focus();
    return;
  }
  champ.removeAttribute("aria-invalid");
  bouton.disabled = true;
  bouton.textContent = "Je vérifie…";
  message(zone, `Je cherche ${hote(propre)}…`);
  const ok = await sonder(propre);
  bouton.disabled = false;
  bouton.textContent = "Continuer";
  if (ok) {
    await garder(propre, true);
    return;
  }
  adresseEnAttente = propre;
  message(zone,
    `Pas de réponse de ${hote(propre)}. Vérifie que Tailscale est actif sur ce PC et que la tour est allumée, puis réessaie.`,
    "erreur");
  $("bouton-garder").hidden = false;
}

async function garder(propre, repond) {
  try {
    adresseCourante = await invoke("bureau_adresse_enregistrer", { adresse: propre });
  } catch (e) {
    message($("adresse-message"), String(e), "erreur");
    return;
  }
  message($("adresse-message"), "Adresse gardée sur ce PC.", "succes");
  if (repond) allerSurLaTour();
  else montrerHorsLigne(adresseCourante);
}

async function demarrer() {
  if (!tauri || !tauri.core) {
    montrer("vue-adresse");
    message($("adresse-message"), "Cette page s'ouvre dans l'app Rémy pour Windows.", "erreur");
    $("bouton-continuer").disabled = true;
    return;
  }
  let lu;
  try {
    lu = await invoke("bureau_adresse_lire");
  } catch (e) {
    montrer("vue-adresse");
    message($("adresse-message"), "L'app n'a pas pu lire ses réglages : " + e, "erreur");
    return;
  }
  $("version").textContent = `Rémy pour Windows · version ${lu.version}`;
  if (lu.raccourciLibelle) $("raccourci").textContent = lu.raccourciLibelle;
  adresseCourante = lu.adresse;
  const changer = new URLSearchParams(location.search).has("changer");
  const panne = panneDeLaTour();
  if (changer || !lu.adresse) montrerAdresse({ changer });
  // Revenue de la tour en panne : pas de nouvel essai tout de suite (sinon
  // aller-retour en boucle), le compte à rebours de 30 s s'en charge.
  else if (panne) montrerHorsLigne(lu.adresse, null, panne);
  else connecter(lu.adresse);
}

$("form-adresse").addEventListener("submit", continuer);
$("bouton-garder").addEventListener("click", () => adresseEnAttente && garder(adresseEnAttente, false));
$("bouton-annuler").addEventListener("click", () => adresseCourante && connecter(adresseCourante));
$("bouton-reessayer").addEventListener("click", () => reessayer(false));
$("bouton-changer").addEventListener("click", () => montrerAdresse({ changer: true }));
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !$("vue-adresse").hidden && !$("bouton-annuler").hidden) {
    ev.preventDefault();
    connecter(adresseCourante);
  }
});
// Le réseau revient (Tailscale reconnecté) : on n'attend pas les 30 s.
window.addEventListener("online", () => { if (!$("vue-hors-ligne").hidden) reessayer(true); });

demarrer();
