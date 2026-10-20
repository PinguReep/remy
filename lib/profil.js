// Ce qui est propre à la personne que Rémy accompagne. Réglé sur sa tour
// (remy.env), jamais écrit dans ce dépôt, qui est public :
//   REMY_PRENOM       — son prénom, tel que Rémy l'emploie (défaut : Sam, fictif) ;
//   REMY_VOCABULAIRE  — les mots qu'elle dicte souvent (proches, projets), pour la dictée ;
//   REMY_PRIVE        — le dossier de ses notes privées (roadmap…), sur la tour.
// La tour lance le serveur avec --env-file : ces valeurs sont là avant le
// premier import, les consignes construites au chargement les voient.

import os from "node:os";
import path from "node:path";

export const PRENOM = String(process.env.REMY_PRENOM || "").replace(/\s+/g, " ").trim().slice(0, 40) || "Sam";

export const VOCABULAIRE = String(process.env.REMY_VOCABULAIRE || "").replace(/\s+/g, " ").trim().slice(0, 400);

export const dossierPrive = () => process.env.REMY_PRIVE || path.join(os.homedir(), ".remy", "prive");
