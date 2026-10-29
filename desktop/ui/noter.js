// « Noter » de secours (page embarquée) : le site de la tour n'a pas pu se
// charger dans cette fenêtre. La note est gardée sur ce PC
// (bureau_note_locale) ; le site l'enverra dès que la tour répondra.
// Fenêtre cachée : on resonde la tour, et on passe sur le site dès qu'elle
// répond — jamais pendant qu'on tape.
"use strict";

const SONDE_DELAI_MS = 3000;
const RESONDE_MS = 60_000;

const $ = (id) => document.getElementById(id);
const tauri = window.__TAURI__;
const invoke = (commande, args) => tauri.core.invoke(commande, args);
const AIDE = $("message").innerHTML;

let adresse = null;
let enCours = false;
// La fenêtre est créée cachée ; la coquille la montre (bureau://noter-ouvert)
// et la cache dès qu'elle perd le focus. Revenue ici pendant qu'on la
// regardait (page de la tour en panne), elle a déjà le focus.
let visible = document.hasFocus();
// `?retour=502` : la coquille vient de nous ramener de la tour en panne. Pas de
// nouvel essai tout de suite (sinon aller-retour en boucle) : celui de la minute.
const retour = new URLSearchParams(location.search).get("retour");

function message(texte, genre) {
  const el = $("message");
  el.textContent = texte;
  el.className = "message" + (genre ? " " + genre : " meta");
}

function aide() {
  const el = $("message");
  el.innerHTML = AIDE;
  el.className = "message meta";
}

function etat(enAttente) {
  const quoi = retour ? "Rémy ne répond pas" : "Hors ligne";
  $("etat").textContent = enAttente > 0
    ? `${quoi} · ${enAttente} en attente`
    : `${quoi} · gardée sur ce PC`;
}

async function sonder() {
  if (!adresse) return false;
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

/** Fenêtre cachée et champ vide : si la tour répond, on passe sur le site. */
async function passerSurLeSiteSiPossible() {
  if (visible || $("champ").value.trim() || enCours) return;
  if (await sonder() && !visible && !$("champ").value.trim()) {
    try { await invoke("bureau_aller_tour"); } catch { /* on reste ici */ }
  }
}

async function fermer() {
  visible = false;
  try { await invoke("bureau_noter_fermer"); } catch { /* déjà cachée */ }
}

async function garder(ev) {
  ev.preventDefault();
  if (enCours) return;
  const champ = $("champ");
  const texte = champ.value.trim();
  if (!texte) {
    message("Écris d'abord quelque chose.", "erreur");
    champ.focus();
    return;
  }
  enCours = true;
  $("bouton-garder").disabled = true;
  try {
    const r = await invoke("bureau_note_locale", { texte });
    etat(r.enAttente);
    if (r.avertissement) {
      // Les notes d'avant n'ont pas pu être relues : on le dit, plus longtemps.
      message(`Gardée sur ce PC. ${r.avertissement}`, "erreur");
    } else {
      message(`Gardée sur ce PC (${r.enAttente} en attente). Elle partira vers Rémy dès que la tour répondra.`, "succes");
    }
    champ.value = "";
    setTimeout(() => { enCours = false; fermer(); }, r.avertissement ? 6000 : 1400);
  } catch (e) {
    enCours = false;
    message("Pas gardée : " + e + " Copie ton texte avant de fermer.", "erreur");
  } finally {
    $("bouton-garder").disabled = false;
  }
}

async function demarrer() {
  if (!tauri || !tauri.core) {
    message("Cette fenêtre s'ouvre dans l'app Rémy pour Windows.", "erreur");
    $("bouton-garder").disabled = true;
    return;
  }
  try {
    const lu = await invoke("bureau_adresse_lire");
    adresse = lu.adresse;
    etat(await invoke("bureau_notes_locales_compte"));
  } catch { /* la note se garde quand même */ }
  tauri.event.listen("bureau://noter-ouvert", async () => {
    visible = true;
    if (!enCours) aide();
    $("champ").focus();
    try {
      const lu = await invoke("bureau_adresse_lire");
      adresse = lu.adresse;
      etat(await invoke("bureau_notes_locales_compte"));
    } catch { /* rien */ }
  });
  if (visible) $("champ").focus();
  if (!retour) passerSurLeSiteSiPossible();
  setInterval(passerSurLeSiteSiPossible, RESONDE_MS);
}

$("form-noter").addEventListener("submit", garder);
$("bouton-fermer").addEventListener("click", fermer);
$("champ").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault();
    $("form-noter").requestSubmit();
  }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") { ev.preventDefault(); fermer(); }
});
window.addEventListener("blur", () => {
  visible = false;
  setTimeout(passerSurLeSiteSiPossible, 500);
});

demarrer();
