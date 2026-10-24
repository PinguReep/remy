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

## 2026-10-19 — Vocaux longs : plus rien ne se perd

- **Constat** : un vocal de ~2 min parti tout seul puis perdu. Trois causes :
  plafond de 3 min qui envoyait d'office (vieille limite Vercel de 4,5 Mo),
  écran non maintenu allumé pendant la dictée (verrouillage = micro coupé),
  et 90 s pour transcrire quelle que soit la longueur (Dictée Locale transcrit
  puis relit : un vocal long dépasse).
- **Maintenant** : plafond 15 min, dernière minute affichée ; écran allumé tant
  que la dictée tourne ; délai tour = 90 s + la durée du vocal, iPhone = 120 s +
  la durée (la tour répond d'abord, avec la vraie raison) ; corps accepté jusqu'à
  24 Mo sur la tour (4,5 Mo sur Vercel).
- **Vocal qui ne part pas** : gardé **en mémoire** (jamais sur le disque, oublié
  à la déconnexion ou app fermée), au-dessus du champ : « Renvoyer » ou la
  poubelle. Micro coupé par le système ou app quittée en pleine dictée : même
  chose, rien ne part tout seul.

## 2026-10-19 — Plantage du micro (retour TestFlight, build 19)

- **Journal** : `EXC_BAD_ACCESS (SIGSEGV)` sur un fil d'AudioToolbox,
  `objc_loadWeak` ← `AudioRecorderAQInputCallback` : la file audio d'un
  `AVAudioRecorder` livrait encore un tampon après `stop()`, alors que l'app
  venait de libérer l'enregistreur (dictée validée, annulée, ou tour d'appel).
- **Correctif** : `MicroiPhone.retirer` arrête l'enregistreur et le garde en vie
  3 s avant de le lâcher (dictée, appel, interruption, plafond).
- **Relevé des retours** : job `retours` de `ios-testflight.yml` (voir
  `docs/ios.md`), désormais fait avant chaque envoi.

## 2026-10-19 — La barre d'étapes du chat (etapes-v1)

- Pendant une réponse, la tour envoie ses étapes en `status` (compatible avec
  les apps qui ne lisent que `text`) : `cle` (contexte, choix, modele,
  reflexion, motion, web, navigateur, proposition, budget, secours, ecrit), `t`
  (ms depuis le début) et, pour la réflexion du modèle local, un `detail` : un
  extrait d'une ligne, au plus toutes les 1,5 s (`lib/etapes.js`). Jusqu'ici la
  réflexion n'était jamais montrée ; l'extrait n'est ni enregistré ni envoyé
  ailleurs que dans l'app de la personne.
- L'app : une barre sous la réponse (étape en cours, chrono à la seconde) ; un
  appui déroule les étapes, leur durée et l'extrait. La dernière réponse garde
  « Réponse en 14 s » pour savoir pourquoi elle a pris du temps.

## 2026-10-19 — Conversations importées : privées d'office

- **Faille** : une conversation importée (ChatGPT, Claude) n'était pas privée :
  elle entrait dans la réflexion de nuit, et « Continuer avec Rémy » pouvait la
  faire passer par Claude quand le secours est activé.
- **Correctif** : import marqué `prive` ; les imports antérieurs le deviennent à
  la lecture (`store.getConversation` / `listConversations` : `origine` ⇒ privée).
  La réflexion de nuit garde les imports (encadrés) mais passe alors `prive` à
  `fournisseurDeFond`, qui refuse tout repli sur Claude (`PRIVE_DE_FOND`) :
  modèle local ou rien. Les conversations rendues privées par l'utilisateur
  restent hors de la réflexion, comme avant.

## Sessions Claude Code gardées (claude-retention.ps1)

- Claude Code efface ses sessions au bout de 30 jours (`cleanupPeriodDays`).
  `scripts/claude-retention.ps1` (lancé par l'installeur de la tour) pose 3650
  jours, ne touche qu'à cette clé, copie le fichier avant, ne réécrit jamais un
  JSON illisible. `scripts/audit-sources-tour.ps1` : audit en lecture seule des
  sources de sessions (rien que des structures et des hachages).

## 2026-10-19 — Mémoire de projets, lot B : lire les sessions Claude Code

- `lib/connaissances/` : lecture **seule** des sessions (`~/.claude/projects`,
  `CLAUDE_CONFIG_DIR`), curseur par fichier (inode, octet lu, empreinte des
  4 derniers Ko : un fichier réécrit est relu, une ligne en cours d'écriture
  attend), lignes de plus de 4 Mo sautées, pause tous les 500 enregistrements.
- Ne devient « passage » que le dialogue : texte tapé (fil principal, ni méta,
  ni commande, ni résultat d'outil, ni notification), un long collage marqué
  `colle`, le texte de l'assistant (jamais sa réflexion ni ses outils), les
  résumés de compaction (`resume`). Sous-agents et sessions `sdk-cli`
  (« claude -p » : Rémy, titres de T3…) exclus ; Rémy coupe en plus son propre
  historique (`CLAUDE_CODE_SKIP_PROMPT_HISTORY`).
- Secrets masqués en mémoire avant toute écriture (`masquage.js` : préfixes de
  clés, JWT, PEM, URL avec identifiants, « mot de passe : … », valeurs de
  remy.env).
- `connaissances.db` (à côté de remy.db, séparée) : sources, fichiers,
  projets (dossier normalisé, worktree T3 ramené au dépôt), conversations,
  passages + FTS5 sans accents, journal des lectures. **En clair sur le disque**
  (pas de BitLocker, choix du propriétaire) : dit dans l'état, jamais simulé.
- Source **coupée par défaut** (accord dans l'app ou `REMY_SOURCE_CLAUDE_CODE=on`,
  `=off` l'emporte) ; `REMY_CONNAISSANCES_PROJETS` limite aux projets dont le
  dossier contient l'un des mots (réglé sur la tour seulement). Lecture toutes
  les 30 min (job `connaissances-sync`, circuit « projets »), sans IA.
- Routes : `GET /api/connaissances`, `PUT …/sources`, `POST …/synchroniser`,
  `GET …/chercher?q=` (extraits + session + uuid pour citer), `DELETE
  …/sources/claude-code` (purge). `scripts/connaissances-etat.mjs` : l'état vu
  de la tour, `--lire` pour lire tout de suite.
- Lot C (à venir) : extraction des connaissances par GLM local, fiches
  `Projets/` dans le coffre, bloc « Projets » dans le chat (conversation passée
  en privé).

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
- **Jauge du chat** (`jauge-v1`, 19/10) : pendant la réponse, un événement
  `debit` `{ tps, jetons }` au plus une fois par seconde, estimé d'après les
  caractères reçus (réflexion, texte, arguments d'outils) avec un rapport
  caractères/jeton appris sur les vraies réponses. À la fin, `mesures` (dans
  `done` et sur le message enregistré) : jetons exacts du modèle, débit sur le
  seul temps d'écriture (ni lecture du contexte, ni outils), premier jeton,
  contexte du dernier appel (`prompt_tokens + completion_tokens`) et sa
  répartition ≈ par part de caractères (consigne, conversation, outils,
  réponse). Taille maximale : `REMY_GLM_CONTEXTE`, sinon déclarée par
  `/v1/models` (`max_model_len`, `parameters.max_seq_len`…), sinon inconnue —
  jamais supposée. Des compteurs, jamais de contenu (`lib/debit.js`).
  Chaque réponse dit aussi son modèle et sa machine (`REMY_GLM_MACHINE`,
  défaut « DGX Spark » ; Claude : « Anthropic (cloud) »).
- **Réponses trop longues** (19/10 : une dictée de ~8 min restait sans
  réponse) : passé le budget (`REMY_BUDGET_MS`, 4 min sur la tour), une
  réflexion qui n'a encore rien écrit est arrêtée et GLM conclut sans
  réfléchir à partir de ses notes ; coupée en pleine écriture à l'échéance
  (budget + 90 s), la réponse est gardée avec « *(coupée : réponse trop
  longue)* ». L'échéance n'est plus une panne (`nature: "delai"`) : GLM n'est
  pas marqué injoignable, et le message ne dit plus « ne répond pas ».
- **Codes d'erreur** (`lib/incidents.js`) : chaque erreur du chat (et chaque
  500 d'une route) reçoit un code `R-XXXXX` et un incident dans
  `<base>/incidents.jsonl` (300 derniers) : étapes, durées, tailles, modèle,
  débit, erreur technique bornée — jamais le contenu. `GET /api/incidents[/:code]`,
  et sur la tour `node scripts/incident.mjs [code]`.
- **Compactage** (`compactage-v1`, `lib/compactage.js`) : le début d'un long
  fil est résumé par GLM (jamais Claude) dans `conv.compactage` `{ jusqua,
  resume }` ; le modèle relit le résumé (dans la consigne) puis les messages
  depuis `jusqua` (toujours un message de l'utilisateur ; les 6 derniers sont
  gardés en entier). Rien n'est effacé. Automatique après une réponse qui a
  rempli 70 % du contexte (90 k jetons si la taille est inconnue), circuit
  `compactage` coupable ; à la demande : `POST /api/conversations/:id/compacter`.
  Coût journalisé (`kind: "compaction"`).
- **Règles de Rémy** (`regles-v1`, `lib/regles.js`, migration 6) : des tâches
  conditionnelles que Motion ne sait pas faire (« avant une sortie, me
  raser »). Une règle = des mots-clés + la tâche + « au plus tard N min
  avant ». Créée par l'outil `regle_proposer` (carte « Nouvelle règle »),
  validée par l'utilisateur (`POST …/propositions/:pid/regle`, lue dans la
  conversation stockée). Toutes les 3 h de 7 h à 22 h (job `regles-verifier`,
  circuit `regles`, sans IA) : agenda + Motion sur 7 jours ; un événement qui
  correspond (mots entiers, sans accents), sans la tâche déjà prévue dans les
  3 jours avant → une proposition Motion ordinaire dans le fil « Règles de
  Rémy » (`systeme: "regles"`), une seule fois par événement (`regles_vues`).
  `GET/PATCH/DELETE /api/regles`, `POST /api/regles/verifier`.
- **Localisation** (`lieux-v1`, `lib/lieux.js`, migration 7) : l'iPhone envoie
  des visites (arrivée puis départ, même identifiant) et des trajets en
  voiture — jamais de trace continue. Chaque visite est rattachée à un lieu :
  nommé par l'utilisateur, nommé d'après un rendez-vous de l'agenda dont le
  lieu cite la rue de la visite, ou créé avec son adresse. Adresses traduites
  sur la tour (`lib/geocodage.js`, `<base>/geo.db`, R*Tree) à partir de la Base
  Adresse Nationale (`scripts/geo-importer.mjs`, départements de
  `REMY_GEO_DEPARTEMENTS`, dans remy.env). 90 jours (`REMY_LIEUX_JOURS`) puis
  effacé (job `lieux-purge`) ; `DELETE /api/lieux/historique` efface tout sauf
  les lieux nommés. La consigne « Où est … » (lieu actuel, journée, tâches
  Motion liées au lieu) n'est donnée qu'à GLM, jamais à Claude (ni en secours,
  ni pour une recherche avec contexte). `REMY_LIEUX=off` coupe tout.
- **Commerces** (`lib/commerces.js`, `<base>/commerces.db`) : un lieu sans nom
  près d'un commerce connu devient « sans doute Salon Lumière (coiffeur) », pour
  Rémy comme dans l'app — une supposition, jusqu'à ce que l'utilisateur le nomme.
  Données d'OpenStreetMap (ODbL) importées par `scripts/commerces-importer.mjs` :
  une requête Overpass par département de `REMY_GEO_DEPARTEMENTS` (seuls les
  numéros partent, jamais une position ; ni les lieux privés ni les piscines
  sans nom ne sont téléchargés), `out geom` (les surfaces gardent leur vrai
  contour, trous et multipolygones compris : on est « dans » le supermarché
  sans être en son centre, pas dans l'école voisine parce qu'elle est en biais),
  `out center` si le serveur refuse (des points, jamais « dedans »). Tout est
  téléchargé avant de remplacer la base, en une transaction (tables refaites à
  neuf) : un import interrompu garde l'ancienne. Rapprochement à la lecture
  (R*Tree, puis contour) : un nouvel import vaut tout de suite.
  Prudence (23/10, premier import réel) : plutôt rien qu'un faux « sans doute ».
  Le plus proche doit être nommé, à 20 m au plus et 8 m plus près que le
  suivant, nommé ou non — ou seul à 35 m avec 15 m d'avance ; dans une grande
  surface, seuls comptent ceux qui y sont, et on n'y est « à coup sûr » que si
  la boutique mitoyenne n'est pas plus près que l'avance demandée. Une surface
  compte à la précision de son mur (5 à 15 m), jamais de l'extérieur pour une
  école, un hôpital ou un lieu de culte ; un petit commerce en point, à 8 m +
  1,5 × la précision au plus. La précision de la visite iOS élargit l'avance
  demandée ; inconnue ou au-delà de 50 m, rien. Plusieurs étages sous les pieds
  (centre commercial cartographié niveau par niveau) : seulement le bâtiment.
  Le centre de la boîte d'un site, d'une surface immense ou d'un contour cassé
  n'est jamais la réponse. Un lieu où l'on a dormi (3 h du matin) ou passé 4 h
  dans la journée (bureau, chez un proche) n'est pas un commerce ; une visite
  au départ perdu s'arrête à l'arrivée suivante ; un lieu d'agenda couvre 30 m.
  Une réponse Overpass coupée (HTTP 200 + « runtime error ») n'est jamais
  importée. Une base d'un format antérieur ne donne rien tant que l'import
  n'est pas refait (l'app le signale). Mesuré sur un vrai centre-ville (4 300
  éléments) : un « sans doute » (faux) pour 13 % des habitations à position
  exacte (33 % avant), 13 % à 10 m près, 5 % à 30 m près ; un commerce d'en
  face pris pour la grande
  surface où l'on est : 1 % (15 % avant) ; devant un commerce à 10 m près, le
  bon dans 35 % des cas, un autre dans 2 %. Sirene (INSEE) écarté pour
  l'instant : ~4 Go de fichiers nationaux à croiser chaque mois, positions à
  l'adresse seulement.
- **Modèle local** (`lib/glm.js`, 20/10) : les Sparks changent de modèle. Rémy
  envoie le modèle choisi dans l'app (`PUT /api/modeles`), sinon
  `REMY_GLM_MODEL`, chacun tant que `/v1/models` le sert, sinon le premier servi.
  La réflexion est demandée sous ses deux noms (`enable_thinking` pour GLM et
  Qwen, `thinking` pour DeepSeek) ; un serveur qui ne la range pas à part la
  rend dans le texte, close par `</think>` : le texte attend alors la fin de la
  réflexion (mémorisé par modèle), et `nettoyerSortie` la retire de toute façon
  à la fin, avec les jetons `<｜…｜>` de DeepSeek. Ses appels d'outils écrits en
  texte sont exécutés comme ceux de GLM (des propositions).

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
- Jauge du chat : un cadran dans l'en-tête (arc ouvert en bas, aiguille,
  pourcentage), la feuille « Contexte » (place prise, d'où elle vient, vitesse
  de la dernière réponse, moyenne du fil pondérée par le temps d'écriture) et
  les jetons par seconde en direct dans la barre d'étapes. Calculs dans
  `RemyCore/Jauge.swift` (tests du cœur).
- Sélection : l'appui long d'une bulle (la tienne, celle de Rémy, une
  erreur) propose « Sélectionner le texte » — le message dans un `UITextView`
  en lecture seule, la vraie sélection d'iOS. Une erreur montre son code et
  « Copier le diagnostic » (l'incident de la tour, en JSON).
- Localisation (`RemyCore/Lieux.swift`, `App/Localisation.swift`) : coupée
  par défaut. Les visites d'iOS (`startMonitoringVisits`, presque sans
  batterie, l'app est réveillée) et les trajets en voiture relus dans
  l'historique des mouvements (segments « automotive » ≥ 3 min, arrêts de
  moins de 3 min fusionnés) partent vers `POST /api/lieux/evenements`. Pas de
  GPS continu, pas de géocodage sur l'iPhone. File persistée (UserDefaults,
  500 au plus) : hors ligne, tout attend la tour. « Pause 2 h » n'enregistre
  rien. La feuille Réglages › Localisation lit `GET /api/lieux`.
- Nouveautés (`RemyCore/Nouveautes.swift`, `NouveautesVue`, 21/10) : un
  catalogue d'entrées par « série » (une par mise à jour, pas le numéro de
  build, que les collectes de retours consomment). Au premier lancement du
  système, seules celles de la dernière série sont nouvelles. Une entrée ne
  s'ouvre que si la tour a sa capacité ; vue = fermée (finie, « Plus tard » ou
  balayée), gardée dans les UserDefaults. Jamais en démo, jamais par-dessus une
  dictée, un appel ou les réglages.
- « À trancher », revue du dimanche, tri des retards (`lib/a-trancher.js`,
  `RemyCore/ATrancher.swift`, `ATrancherVues.swift`, 24/10). La tour
  rassemble (`GET /api/a-trancher`) en lisant toutes les conversations d'UNE
  seule lecture (`store.toutesLesConversations`, sinon un fichier relu par fil) ;
  un fil qui porte une carte en attente n'est pas proposé à la suppression.
  Les gestes passent par les chemins existants : « Oui » = chaîne d'écriture
  (la proposition est relue dans la conversation stockée), « Non » = refus
  enregistré, défait par `POST /api/a-trancher/rouvrir` (seul un refus se
  rouvre) ; rappels, doublons, articles = carnet de l'iPhone (hors ligne,
  avec son « Annuler ») ; un fil supprimé attend les 6 s du bandeau avant de
  partir (la suppression d'un fil est définitive). « Plus tard » = report daté
  de 7 jours dans `meta` (pas de migration : plusieurs branches en ajoutaient
  en parallèle). La revue (`GET /api/revue`) est déterministe : coches
  « terminer » du journal sur 7 jours (le projet est maintenant noté dans le
  résultat Motion), échéances passées encore ouvertes (cache Motion), rappels
  faits, et les puces « … (70 %) » déjà écrites par la nuit — aucun nouvel
  appel. Les trois décisions vivent dans `meta`, pour la semaine qui suit
  quand elles sont prises un dimanche. Côté iPhone, la revue est proposée le
  dimanche (Réglages › Revue du dimanche pour la couper) ; après plus de 3
  jours sans ouvrir l'app, « On trie tes retards ? » (tâches Motion en retard
  et rappels datés passés). « Abandonner » une tâche la clôt dans Motion
  (pas d'état « abandonné » côté Motion), annulable par le journal.
- Réglages › Modèle (`RemyCore/ModelesLocaux.swift`, `ModelesVue`) :
  « Automatique » ou un modèle chargé sur les Sparks, vérifié par la tour.
  Claude n'est pas dans la liste, exprès (V8).

## CI

- `ios-native.yml` : build, tests du cœur, intégration contre `server.js` avec de
  faux services (Motion, Google, GLM, dictée), captures (dont iPhone SE).
- `ios-testflight.yml` : n'envoie qu'après tous les tests verts ; nettoie avant
  chaque archive les certificats de développement créés par l'API (plafond Apple).
- `serveur.yml` : `npm test` sur Ubuntu et Windows, et syntaxe des scripts
  PowerShell sous 5.1, comme la tour.
