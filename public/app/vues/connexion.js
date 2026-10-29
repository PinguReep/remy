// La connexion : le mot de passe de la tour, avec une erreur claire pour
// chaque cas (mauvais mot de passe, trop d'essais, tour injoignable). Ce qui
// attend dans la file d'envoi est dit (le nombre seulement, jamais le texte) :
// gardé dans ce navigateur, il partira après la connexion (main.js vide la file).
import { api, ErreurAPI } from "../api.js";
import { h, vider, bouton, occupe, icone } from "../ui.js";
import * as fileEnvoi from "../file-envoi.js";

/** « 2 notes tapées sur cet ordinateur : elles partiront après la connexion. » ; null sans rien en attente. */
export function phraseFile(n) {
  if (!n) return null;
  return n === 1 ? "1 note tapée sur cet ordinateur : elle partira après la connexion." : `${n} notes tapées sur cet ordinateur : elles partiront après la connexion.`;
}

export function monter(racine, { surConnecte }) {
  racine.className = "connexion";
  racine.removeAttribute("aria-busy");
  const champ = h("input", { class: "champ", id: "mot-de-passe", type: "password", autocomplete: "current-password", required: true, "aria-describedby": "erreur-connexion" });
  const erreur = h("p", { class: "erreur-champ", id: "erreur-connexion", role: "alert" });
  const envoyer = bouton("Se connecter", { classe: "plein large", type: "submit" });
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      erreur.textContent = "";
      if (!champ.value) {
        erreur.textContent = "Tape le mot de passe de ta tour.";
        champ.focus();
        return;
      }
      await occupe(envoyer, async () => {
        try {
          await api("/api/login", { methode: "POST", corps: { password: champ.value }, delai: 15000 });
          surConnecte();
        } catch (err) {
          erreur.textContent = message(err);
          champ.select();
        }
      });
    },
  },
  h("label", { class: "etiquette-champ", for: "mot-de-passe" }, "Mot de passe"),
  champ, erreur, envoyer,
  phraseFile(fileEnvoi.compte()) ? h("p", { class: "aide connexion-file" }, icone("plateau"), h("span", null, phraseFile(fileEnvoi.compte()))) : null);
  vider(racine, h("div", { class: "carte" },
    h("span", { class: "marque-r", "aria-hidden": "true", style: { width: "44px", height: "44px", fontSize: "24px", borderRadius: "13px" } }, "R"),
    h("h1", null, "Bonjour"),
    h("p", { class: "aide" }, `Connecte-toi à ta tour (${location.host}).`),
    form,
    h("p", { class: "aide", style: { marginTop: "14px" } }, "Mot de passe oublié : il est dans le fichier de réglages de la tour (remy.env).")));
  champ.focus();
}

function message(err) {
  if (!(err instanceof ErreurAPI)) return "Erreur inattendue : réessaie.";
  if (err.statut === 401) return "Mot de passe incorrect.";
  if (err.statut === 429) return err.message || "Trop d'essais : attends un peu avant de réessayer.";
  if (err.nature === "reseau" || err.nature === "delai") return "La tour ne répond pas : vérifie qu'elle est allumée et que Tailscale est connecté.";
  return err.message;
}
