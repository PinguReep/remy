# Journal technique

Les décisions techniques non triviales : quoi, et pourquoi. Rien de personnel
ici (le dépôt est public) — les choix de produit et leur contexte vivent dans les
notes privées, sur la tour.

## 2026-10-18 — Dépôt public, rien de personnel dedans

- **Pourquoi** : CI macOS gratuite sur un dépôt public. Le code ne doit
  identifier personne : l'ancien dépôt privé a été repris avec un historique
  neuf, sans la constitution, les décisions, les specs ni les docs de déploiement.
- **Le prénom** de la personne accompagnée vient de `REMY_PRENOM` (`lib/profil.js`,
  « Sam » par défaut, fictif). Dans les chaînes envoyées aux modèles : `${PRENOM}`.
  La tour lance `node --env-file=remy.env`, donc les consignes construites au
  chargement des modules le voient. Test : `test/profil.test.mjs`.
- **Le vocabulaire de dictée** (`REMY_VOCABULAIRE`) s'ajoute à une liste générique.
- **La roadmap** est lue dans `REMY_PRIVE` (`.remy\prive`), plus dans le dépôt.
- **L'adresse de la tour** n'est plus une constante de l'app : saisie une fois
  (écran « L'adresse de ta tour », vérifiée par `/api/version`) puis gardée dans
  les `UserDefaults`, ou inscrite à la compilation (`RemyAdresseTour`, depuis le
  secret `REMY_ADRESSE_TOUR`). Le jeton d'appareil et les cookies sont rangés par
  nom d'hôte : retaper la même adresse garde la session.
- **Vérifier l'adresse sans session** (19/10) : une tour avec mot de passe ne
  rend à `/api/version` que `{api, appMin}`. L'écran décodait la version complète
  et prenait cette réponse pour « pas de réponse » ; la CI ne le voyait pas (serveur
  de démo sans mot de passe). `ClientAPI.tourRepond()` ne demande que `api`.
- **Tests et démo** : personnes, lieux et projets fictifs, cohérents entre la
  démo (`ios-native/ci/`) et les tests.
- **Numéros de build** : l'ancien dépôt s'est arrêté au build 15 ; le workflow
  TestFlight ajoute 15 au numéro d'exécution.

## 2026-10-19 — Corriger la dictée depuis l'app

- Surligner des mots dans le champ de saisie → « Corriger la dictée » (menu de
  sélection du `UITextView`) → une bulle demande le bon mot → la tour transmet à
  Dictée Locale (`POST /api/dictee/correction` → `127.0.0.1:8771/v1/vocabulaire/corrections`),
  qui crée une règle « entendu → voulu » **active tout de suite** (une correction
  tapée exprès n'est pas un accident, contrairement à la fenêtre de relecture qui
  attend de la voir deux fois). Un nom propre rejoint aussi les termes favorisés.
- Dictée Locale compare désormais les règles sans accents : une règle apprise sur
  « Rémi » s'applique aussi à « rémi ».
- Capacité `dictee-correction-v1` ; une Dictée Locale trop ancienne répond 404 et
  l'app le dit (« mets-la à jour »). Rien ne sort de la tour.

## Chaîne d'écriture (Motion, Google Agenda)

- Rémy **propose**, rien n'est écrit sans « Oui ». Les actions appliquées sont
  toujours lues dans la conversation **enregistrée** sur la tour, jamais dans la
  requête du client (une page web hostile ne peut pas glisser une action).
- Idempotence : `propositionId` ou `idCommande` ; une coupure réseau peut être
  rejouée sans double effet (`propositions-v1`). Chaque écriture est journalisée
  et annulable (« Annuler » relit l'état réel avant de défaire).
- **Propositions ajustables** (`propositions-ajustables-v1`, migration v5) : la
  tour garde la version ajustée (table `ajustements`), ligne par ligne via son
  `rang` d'origine. Seuls des champs listés et nettoyés changent ; le type et la
  cible viennent toujours de l'originale. Une ligne peut devenir un rappel ; si
  toutes le deviennent, la proposition passe `converti` et ne s'applique plus.
  Refus (409) une fois appliquée, refusée, rangée ou en cours.
- **Catégories des tâches** (`categories-taches-v1`) : les mêmes étiquettes que
  les rappels, gardées par la tour (table `categories_taches`), pas dans Motion.
  Posées à la création comme à la modification (identifiant Motion).

## Serveur

- **Capacités** (`lib/version.js`, `CAPACITES`) : l'app cache ce que la tour ne
  sait pas encore faire au lieu d'échouer. Toute nouveauté côté tour en ajoute une.
- **SQLite**, migrations en avant seulement : une version précédente du code lit
  une base plus récente (tables ajoutées, jamais retirées) — le retour arrière marche.
- **Cerveau local** d'abord (`REMY_GLM_URL`). Claude seulement sur autorisation
  explicite (recherche web : la carte dit ce qui partirait), ou en secours activé
  à la main. Aucun appel automatique non désactivable ; chaque appel a un `kind`
  dans le panneau coûts.
- **Non-lus** (`non-lus-v1`) : comptés en messages, pas en heures (pas de décalage
  d'horloge entre la tour et l'iPhone).
- **« Retenir » au choix** (`retenir-choix-v1`) : le modèle local propose les
  informations, l'utilisateur coche, seules les cochées entrent en mémoire.

## App iPhone

- Cœur `RemyCore` sans SwiftUI, testé sous Linux, y compris contre le vrai
  `server.js` de démo (`IntegrationTests`).
- Composeur sur `UITextView` (`ChampTexte`) : mesuré en CI dans le vrai écran
  (fil de 60 messages, dictée de 2 min dans le champ) : 96,6 ms par image avec
  `TextField(axis: .vertical)`, 17 ms avec le champ UIKit. L'écran « perf-remy »
  reste en CI comme garde-fou.
- Hors ligne : la journée et les gestes non envoyés restent sur l'iPhone (outbox),
  partent au retour du réseau.
- Rappels « à traiter » : sans date, ou sans catégorie dès qu'il en existe.

## CI

- `ios-native.yml` : build, tests du cœur, intégration contre `server.js` avec de
  faux services (Motion, Google, GLM, dictée), captures (dont iPhone SE).
- `ios-testflight.yml` : n'envoie qu'après tous les tests verts ; nettoie avant
  chaque archive les certificats de développement créés par l'API (plafond Apple).
- `serveur.yml` : `npm test` sur Ubuntu et Windows, et syntaxe des scripts
  PowerShell sous 5.1, comme la tour.
