# Journal technique

Les décisions techniques non triviales : quoi, et pourquoi. Rien de personnel
ici (le dépôt est public) — les choix de produit et leur contexte vivent dans les
notes privées, sur la tour.

## 2026-10-24 — Feuille de partage : texte, lien, image vers la tour

- Texte et lien : la capture existante (`POST /api/capture`), source
  `partage` (nouvelle ; une tour plus ancienne la lit comme `note`). Le lien
  part avec son titre et le mot facultatif de Sam ; la tour refusant les
  textes de moins de 30 caractères, l'extension le dit avant d'envoyer
  (« ajoute un mot pour lui ») au lieu d'essuyer un 400.
- Image : aucune route existante ne prenait d'image (`analyser` et `extraire`
  lisent du texte), d'où `POST /api/capture/image` (capacité `partage-v1`).
  L'iPhone réduit l'image (ImageIO, 1600 px, JPEG sous 1,5 Mo) et lit son
  texte lui-même (Vision, hors ligne) : la tour ne voit jamais d'appel à un
  service d'image. Elle vérifie le format dans les octets (JPEG/PNG, 3 Mo au
  plus), range l'image dans le coffre (`Captures/Images`, affichée dans la
  note de capture, nommée comme l'image pour que deux images du même jour ne
  s'écrasent pas) et distille le texte lu + le mot de Sam comme une capture,
  avec le **modèle local seulement** (`prive`) : une capture d'écran peut
  montrer n'importe quoi. La capture garde `prive` : la réflexion de la nuit
  qui la relit passe alors au modèle local seulement. Sans texte, l'image est
  rangée sans appel au modèle. Le lien et le texte partagés avec l'image
  (`lien`, `joint`) partent avec elle.
- Tour pas encore à jour (404 sur la route d'image) : rien ne part (la capture
  ordinaire ne garantit pas le modèle local) ; « mets ta tour à jour », et
  « Copier ». L'iPhone attend 200 s, plus que les 180 s laissées au modèle
  local : pas de faux « vérifie Tailscale » ni de doublon au « Réessayer ».
- Erreurs (`EchecPartage`) : pas connecté (« Ouvre Rémy une fois »), 401
  (« reconnecte-toi »), tour injoignable (« vérifie Tailscale »), refus de la
  tour (son message). Toujours « Copier » (texte et image au presse-papiers).
  Le reçu : « J'ai compris. Classé. » si la mémoire a bougé, « Image rangée. »
  pour une photo sans texte (« Image reçue. » si la tour ne garde pas les
  images), « Gardé, pas encore classé. » sinon ; + le détail.

## 2026-10-24 — Rémy hors de l'app : activité en direct, widgets, Siri

- **Un seul choix, dans le cœur** : `ApercuMaintenant` (tâche en cours, sinon
  la suivante, sinon « à faire » ; copie datée si la tour ne répond pas, et
  « injoignable » si la copie est d'un autre jour) sert au widget
  « Maintenant » et à Siri ; `SuiviActivite` décide démarrer / mettre à jour /
  terminer pour l'activité en direct. Testés sous Linux (`HorsAppTests`).
- **Activité en direct sans push** : l'app la démarre (« Commencer », où que
  ce soit, via `TableauModel.surCommencee` ; ou seule quand une tâche commence,
  réglable), la suit toutes les 15 s tant qu'elle est ouverte, et la ferme
  quand la tâche est cochée ou finie. `staleDate` = fin prévue : app fermée,
  iOS affiche « Temps écoulé ». Les boutons sont des `LiveActivityIntent` :
  exécutés dans l'app (lancée en arrière-plan au besoin), ils appellent les
  mêmes gestes que l'app (`terminer` avec sa file d'envoi et son délai,
  `prolonger` en durée absolue, annulables depuis l'historique). Pour que
  l'extension puisse construire les boutons et l'app les exécuter, les
  intentions sont dans `ios-native/Intentions/`, compilé dans les deux cibles ;
  l'app s'y branche par `Raccourcis` (RemyCore), nil dans l'extension.
- **Widget « Maintenant »** : une lecture de la tour prépare une entrée par
  borne (débuts et fins des 6 h suivantes) et relit au bout de 15 min. Sa copie
  hors ligne vit dans le conteneur du widget (pas de groupe d'app).
- **Siri « Noter dans Rémy »** : Siri n'attend que quelques secondes, la
  distillation peut prendre une minute. La tour accepte `differe: true` : elle
  répond 202 dès la capture validée, puis l'absorbe (même code qu'avant,
  `absorberCapture`, texte gardé dans tous les cas). Source « siri » : 3
  caractères suffisent (30 pour les autres). Capacité `capture-siri-v1`.
- **Contrôle iOS 18** : le point d'entrée des widgets choisit le paquet selon
  la version (`WidgetsRemy18` avec le contrôle, `WidgetsRemy` sinon).
- **Relecture** : un bouton de l'activité touché deux fois n'agit qu'une fois
  (tâches « occupées » ; sinon « +15 min » doublé affichait 30 min quand
  Motion n'en recevait que 15 de plus), et le suivi de l'app ne touche pas à
  l'activité pendant qu'un bouton agit (il fermait « Fait » sous les doigts).
  Le suivi ignore aussi la copie du dernier lancement tant que la tour n'a pas
  été relue : elle ignore un « Commencer » fait depuis, et fermait l'activité.
  L'app ouverte recharge le widget « Maintenant » quand son aperçu change
  (`WidgetsAJour`, 5 s après, gratuit au premier plan) et tous les widgets à
  la connexion ou à la déconnexion. `Raccourcis.app` est une référence forte :
  lancée en arrière-plan pour une intention, l'app n'a pas de scène.

## 2026-10-24 — Extensions iPhone : un trousseau partagé, pas de groupe d'app

- Deux extensions embarquées dans l'app : `RemyWidgets` (WidgetKit,
  `com.pingureep.remy.widgets`) et `RemyPartage` (feuille de partage,
  `com.pingureep.remy.partage`). Même version que l'app (TestFlight l'exige),
  même signature automatique ; `scripts/asc-register-bundle.mjs` enregistre les
  trois identifiants (idempotent).
- Pas de groupe d'app (App Groups) : Apple ne permet pas d'enregistrer la
  capacité par l'API, et le build TestFlight de nuit échouerait. Le partage
  passe par un **trousseau partagé** : `keychain-access-groups =
  $(AppIdentifierPrefix)com.pingureep.remy`, couvert par tout profil de
  l'équipe. C'est aussi le groupe par défaut de l'app avant ce changement : le
  jeton d'appareil déjà rangé reste lisible, rien à refaire sur l'iPhone.
- L'app recopie l'adresse de la tour dans le trousseau (service
  `remy.adresse-tour`, `AfterFirstUnlockThisDeviceOnly`) au démarrage et à la
  connexion, l'efface à la déconnexion (`TrousseauPartage.publier`). Les
  extensions **lisent seulement** : `TrousseauPartage.systeme.client()` rend un
  `ClientAPI` (adresse + jeton, coffre en lecture seule : un 401 n'efface pas
  le jeton de l'app) ou « Ouvre Rémy une fois pour te connecter ».
- Liens `remy://capture` (la capture), `remy://aujourdhui|remy|projets`
  (l'onglet) : `LienRemy` dans le cœur, `.onOpenURL` dans l'app. La capture
  attend les onglets et ferme d'abord la feuille ouverte.
- `NSSupportsLiveActivities` posé dans l'app (les activités en direct viennent
  ensuite).

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

## 2026-10-24 — Ce qui casse à J+30 (usage intensif simulé)

Une tour de démo isolée a rejoué 30 jours d'usage intensif (669 captures, 457
articles, 169 rappels). La tour tient (ni fuite ni dérive) ; c'est
l'accumulation qui casse. Corrigé :

- **Plafonds du carnet** : ils ne comptent que ce qui reste à faire (articles à
  prendre, rappels pas faits). Une coche n'est jamais refusée (avant : 409 à
  500 lignes, dont 405 « pris »). Purge **douce** (récupérable) des pris de
  plus de 7 jours et des rappels faits de plus de 30 jours : job `carnet-purge`
  la nuit, et quand une liste grossit. « Retirer les pris » en une requête
  (`POST /api/listes/:id/retirer`, `carnet-lot-v1`).
- **Doublons à l'entrée** : même clé que l'anti-doublon de Motion (sans
  accents ni casse, lettres et chiffres seulement), même liste, pas fait →
  rien de recréé. L'iPhone vérifie sur sa copie ; la tour aussi (copie pas à
  jour, deuxième appareil) et rend `dejaLa: [{id, existant}]`. L'iPhone fond
  alors le fantôme dans l'existant, et les écritures encore en file visent
  l'existant (cocher le doublon coche l'original).
- **« Déjà dans Motion »** : `ok: true, dejaLa: true`, état `deja_la`, plus
  jamais compté comme échec. Les cartes rouges et lignes d'historique d'avant
  sont relues ainsi (texte « existe déjà dans Motion »), côté tour comme côté app.
- **Propositions périmées** (`propositions-perimees-v1`) : plus vieilles que
  `peremptionJours` (réglage, 7 par défaut) ou dont une date est passée (un
  rendez-vous dès son heure, une échéance les jours d'avant). La carte le dit ;
  « Oui » rend 409 `perimee` tant que Sam n'a pas confirmé (`confirmer: true`).
  L'âge vient de `creeA` (nouvelles cartes) ou, à défaut, du dernier message du
  fil (une borne sûre). Un ajustement remet la carte à neuf.
- **Règles** : une règle identique (même tâche, un mot en commun) est rendue
  telle quelle ou complétée de ses mots nouveaux ; une seule action par
  événement et par tâche, même avec des doublons d'avant.
- **Historique** (`historique-v2`) : `?avant=<ts>&filtre=echouee|annulee|deja_la`,
  réponse `{ entrees, suite }` ; une page lit au plus 5 000 lignes.
- **Rangement des rappels** : les 60 plus récents (avant : les 60 premiers par
  date), un exemplaire par texte.
- **Brouillon du « + »** : gardé sur l'iPhone (UserDefaults, une semaine),
  effacé dès que la capture est rangée.
- **Tâches rangées par lots** : une capture de 5 tâches (ou des rappels
  devenus tâches) part en UNE écriture par lot de 6. La tour relit Motion une
  fois par lot au lieu d'une fois par tâche : 6 requêtes Motion au lieu de 10
  pour 5 tâches, sous le quota (12/min) au lieu d'une attente d'une minute.

Revue contradictoire, corrigé dans la foulée :

- **Rappels** : même texte ET même jour (heure de Sam), ou l'un des deux sans
  date, font le même rappel. Le loyer du 1er novembre et celui du 1er décembre
  en font deux (avant : le second disparaissait, notification comprise) ;
  « Ranger en rappel » dit « déjà là » au lieu d'une fausse date.
- **Annuler un ajout fondu** : la suppression d'un doublon que la tour a fondu
  sort de la file ; elle n'efface plus l'article ou le rappel d'origine.
- **Règle redemandée avec un autre délai ou une autre durée** : la carte validée
  l'emporte (délai, durée, priorité). L'app dit « existait déjà » ou « mise à
  jour », plus jamais « créée » à tort.
- **« Déjà là » ne s'annule pas** : 409 `rien` (avant : journal passé en
  « annulée » sans rien défaire) ; le site n'affiche plus « Annuler » sur une
  carte où tout existait déjà.
- **Historique** : un filtre touché pendant une lecture relance une lecture, la
  dernière gagne. **Carte ajustée** : plus marquée périmée dans l'app.
  **Annuler « Retirer les pris »** : les articles reviennent par lots de 100
  (la tour n'en écrit que 100 par envoi).
## 2026-10-24 — Le rendez-vous quotidien (rituel-v1)

Constat des usages simulés : Rémy ne venait jamais à Sam (seuls les rappels
sonnaient). MVP à comparer à la version d'avant (captures `11-…` de la CI).

- **Calculé sur la tour, sans IA** (`lib/rituel.js`, `GET /api/rituel`) : le
  briefing d'aujourd'hui ET de demain (trois lignes : ce qui compte, pourquoi,
  ce qui est menacé), le bilan du soir, les tâches menacées. Les mêmes données
  donnent les mêmes phrases ; la réflexion de nuit n'entre que par ses sujets
  encore ouverts. Aucun appel automatique de plus.
- **« Menacée »** (déterministe, avant le retard) : placée par Motion après son
  échéance (`scheduledEnd > dueDate`) ; due sous 24 h sans créneau ; due
  aujourd'hui sans créneau et plus de temps libre jusqu'à 21 h (rendez-vous et
  tâches placées comptés une fois). Action : repousser l'échéance (chaîne
  d'écriture, annulable) ou préparer la question à Rémy (jamais envoyée seule).
  Aussi dans `/api/dashboard` (`menacees`) : le bandeau d'Aujourd'hui sans
  appel de plus.
- **Notifications locales** (pas d'APNs) : coupées par défaut, proposées une
  fois sur l'accueil. Chaque notification porte le briefing de SON jour
  (aujourd'hui ou demain, vu par la tour) ; sans contenu pour ce jour, elle
  invite à ouvrir Rémy. Préparée depuis plus de 3 h : le sous-titre le dit
  (et une source muette reste dite). Le soir, les chiffres (« 2 faits, 3
  restent ») seulement s'ils ont moins de 3 h : relus le matin, ils seraient
  faux ; sinon la notification reste générique.
  4 jours programmés d'avance (les rappels gardent 54 places sur les 64 d'iOS).
- **Arrière-plan** : `BGAppRefreshTask` `com.pingureep.remy.rituel`, demandé une
  heure avant le prochain rendez-vous allumé (briefing ou bilan) ; iOS choisit
  le moment (ou pas). Le jeton du trousseau est lisible après le premier
  déverrouillage. Notifications refusées dans iOS : Réglages le dit.
- **Bilan** : « tout ce qui reste → demain » = UNE proposition Motion (une
  écriture, un « Annuler ») ; même heure demain, bornée à 9 h–20 h. La ligne
  « comment ça s'est passé » est rangée comme une capture `source: bilan`
  (avec les faits du jour) : la réflexion de nuit lit déjà les captures.
- **Capture** : une pensée sans action claire (verbe d'action en tête, à
  l'infinitif ou à l'impératif, « il faut », une durée) va dans le dossier
  « Idées », plus dans Motion. Réglable (`capture.parDefaut`) ; une tour sans
  dossiers garde l'ancien comportement.
- **Réglages** : Diagnostic (temps de réponse, jauge et tok/s du chat masqués
  par défaut, appui du planning) ; les prototypes de design ne sont plus
  proposés (le code reste pour `ios-prototypes.yml`).
## 2026-10-24 — Demain et les 7 jours, sans IA (semaine-v1)

- **Constat** : l'app ne montrait que la journée en cours, et la vue à
  l'échelle n'était atteignable que par un appui long. « Qu'ai-je demain ? »
  passait par le modèle (latence, coût).
- **Tour** : `GET /api/semaine?jours=7` (`lib/semaine.js`, pur, testé à l'heure
  de Paris, changement d'heure compris). Par jour : la frise, les rendez-vous
  « journée entière », les échéances (menacée = placée après l'échéance ou pas
  placée), la charge (minutes de tâches placées contre les plages de l'horaire
  Motion moins les rendez-vous qui les recouvrent) et ce que Motion place après
  l'échéance. Une tâche que Motion étale sur plusieurs jours compte sa durée au
  prorata de chaque jour (une seule fois en tout) ; la frise n'en dessine que le
  bout du jour affiché.
- **Quota Motion** : aucune requête de plus. `GET /tasks` rend déjà les créneaux
  des jours suivants : la liste en cache de l'accueil sert telle quelle. Les
  horaires (`/schedules`) passent par le même cache de 10 min que l'instantané
  (`horairesMotion`, même choix d'horaire que `nomHoraire`).
- **Agenda** : une requête pour toute la période (250 événements au plus), dans
  un cache par période (4 au plus, 2 min, lectures simultanées partagées) : ouvrir
  les 7 jours ne chasse plus la journée de l'accueil. Une écriture vide tout.
- **iPhone** : bouton « À l'échelle » à côté de LA SUITE ; segment Aujourd'hui |
  Demain | 7 jours (boutons de 44 pt, pas le segment système). Toucher un jour
  l'ouvre à l'échelle ; toucher une tâche ouvre « Gérer », dont l'estimation de
  prolongation lit les voisins du bon jour (`SemaineModel.journee(contenant:)`).
  La dernière vue est gardée dans `semaine.json` (comme la journée), datée,
  relue au lancement et effacée à la déconnexion. Chargée avec le reste au
  lancement : sans IA ni Motion de plus, seulement l'agenda.
- **Tests** : `test/semaine.test.mjs` (faux Motion à quota, faux agenda qui
  compte ses lectures), `SemaineTests` (décodage tolérant, charge en mots),
  intégration contre `server.js` avec les horaires du faux Motion de la CI.

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
- **Activité du PC** (`activite-pc-v1`, `lib/activite-pc.js`, migration 9,
  24/10) : ActivityWatch tourne sur la tour (`REMY_ACTIVITYWATCH_URL`, défaut
  `http://127.0.0.1:5600`, API REST `/api/0`) ; Rémy le LIT seulement. Job
  `activite-pc-releve` toutes les 20 min (sans IA, dès que l'app l'a allumée) :
  ce qui est nouveau depuis le curseur, jusqu'à 5 min avant maintenant (l'absence
  n'est décidée qu'après 3 min d'inactivité, datée en arrière), une tranche par
  jour (heure de la tour), totaux et curseur écrits dans la même transaction —
  une coupure ne compte jamais deux fois. Temps actif = fenêtre au premier plan
  ∩ « not-afk », moins « afk » (l'absence l'emporte sur un chevauchement) ;
  segments qui se chevauchent : le plus récent l'emporte. Gardé (table
  `activite_pc`) : secondes par jour × application (exécutable sans `.exe`) et
  par domaine pour le navigateur (extension aw-watcher-web, domaine seul, jamais
  le chemin, onglets privés ignorés). **Les titres de fenêtres ne sont jamais
  écrits** (test : absents du fichier de la base). Catégories par table
  (`CATEGORIES`, sans IA), réglables (`REMY_ACTIVITE_CATEGORIES=appli=jeux,…` ou
  `categories` depuis l'API) ; `REMY_ACTIVITE_EXCLURE` + exclusions de l'app
  (applis ou domaines ; « .app » n'est pas retiré, agenda.app reste un domaine) :
  jamais comptées, et ce qui l'était s'efface (pour la tour, au relevé suivant).
  Exclure un navigateur efface tous les sites relevés (un domaine gardé ne dit
  pas quel navigateur l'a vu) et ignore les onglets de son seau web
  (`navigateurDuSeau`), écrits même quand il est derrière. Premier allumage : depuis minuit ;
  rallumée après une coupure voulue, ou après « tout effacer » : à partir de
  maintenant (le passé d'ActivityWatch n'est pas relu) ; après une panne de la
  tour, 7 jours rattrapés au plus. ActivityWatch absent : `joignable: false` et
  un message avec quoi faire, un seul avertissement au journal, réessai au
  relevé suivant. Un guetteur arrêté garde son seau : si sa dernière écriture
  (`last_updated`, ou `metadata.end` d'aw-server-rust) date de plus de 10 min
  avant le relevé d'avant, `fenetre`/`afk` passent à false avec « … n'écrit plus
  depuis HH:MM ». Pas d'alerte au réveil de la tour ni après un redémarrage
  d'ActivityWatch (relevé d'avant injoignable), ni pour une fenêtre muette
  pendant que Sam est absent (écran verrouillé) : il faut 2 min de présence
  (aw-watcher-afk) depuis son dernier événement. 90 jours (`REMY_ACTIVITE_PC_JOURS`, job `activite-pc-purge`).
  `GET/PUT/DELETE /api/activite-pc`, `POST /api/activite-pc/collecte`.
  La note « Activité du PC » (aujourd'hui et 7 jours par catégorie, présentée
  comme des repères) n'entre que dans la consigne de GLM, jamais chez Claude ;
  avec le secours Claude, ce que GLM en a dit dans la conversation peut lui
  être relu (historique, réflexion de nuit), comme le reste de la conversation.
  `REMY_ACTIVITE_PC=off` coupe tout. Il n'existe pas encore d'analyse
  hebdomadaire où les ranger : `bilanSemaine()` rend les totaux par catégorie
  des 7 derniers jours et des 7 d'avant (sans IA), repris dans la vue
  (`semaine`, `parJour`, `semainePrecedente`), dans l'app et dans la note.

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
- Réglages › Modèle (`RemyCore/ModelesLocaux.swift`, `ModelesVue`) :
  « Automatique » ou un modèle chargé sur les Sparks, vérifié par la tour.
  Claude n'est pas dans la liste, exprès (V8).
- Réglages › Activité du PC (`RemyCore/ActivitePC.swift`, `ActivitePCVue`,
  24/10) : visible si la tour a `activite-pc-v1`. Interrupteur (le premier
  relevé se fait pendant la requête, 8 s au plus), état d'ActivityWatch avec
  quoi faire, aujourd'hui et 7 jours par catégorie (barres), applis de la
  semaine (glisser = ne plus compter), sites par domaine, exclusions, « Tout
  effacer » confirmé. Tirer pour rafraîchir = relever maintenant.
- Ergonomie au pouce (24/10, `RemyCore/Ergonomie.swift`) : les choix « en un
  toucher » sont calculés dans le cœur, sans réseau, testés sous Linux.
  « Décaler » une tâche Motion ne change QUE son échéance (Motion choisit
  l'heure ; « Aujourd'hui » dès que l'échéance est passée) et ne la rapproche
  jamais : seuls les choix après l'échéance actuelle sont offerts (sinon
  « +1 sem. » à partir d'elle). Une activité de l'agenda se décale à l'heure
  (+15 min, +1 h, ce soir, demain), arrondie au quart d'heure SUPÉRIEUR : le
  décalage n'est jamais plus court qu'annoncé (de même « Dans 1 h » d'un rappel). Le même
  panneau « Gérer » sert toutes les tâches : une tâche à faire ou en retard y
  entre en `ElementJour` de type `sans-creneau` (ni horaire ni « prolonger »).
  La feuille système de 9 boutons (`ActionsTache`) a disparu.
- Rappels : « Quand ? » au toucher, glisser (fait / plus tard) dans la liste,
  et une catégorie de notification `rappel` (Fait, Dans 1 h, Demain 9:00). Les
  actions s'exécutent sans ouvrir l'app (iOS la lance en arrière-plan) : le
  carnet de l'iPhone change, les notifications sont reprogrammées, et le
  délégué attend l'envoi de la file vers la tour avant de rendre la main à
  iOS (`depuisNotification` n'envoie pas en tâche détachée). Le délégué (`DelegueNotifications`) montre aussi les
  rappels au premier plan, ce qu'iOS taisait sans lui.
- Une partie d'une proposition (`propositions-partielles-v1`) : l'iPhone envoie
  les `rangs` gardés avec `propositionId` ; la tour filtre sa version STOCKÉE
  (jamais celle de la requête), garde la même clé d'idempotence (`prop:id`),
  et dit les lignes écartées dans le bilan (`ecartees`). L'annulation ne
  défait que ce qui a été fait. Un second « Oui » ne rajoute pas les lignes
  écartées : pour elles, redemander à Rémy. Après un échec, les cases restent
  et « Réessayer » renvoie les mêmes `rangs` (relus du bilan `ecartees` si
  l'app a été relancée) : une tentative échouée est rejouée telle que la
  requête la décrit, la tour ne retient pas les rangs du premier essai.
- Noter : « Ajouter » et le micro sont collés au clavier (`safeAreaInset`) ;
  la touche Retour reste un saut de ligne, car « tomates⏎lait » fait deux
  articles et deux lignes deux intentions.
- Panneaux (`Surimpression`) : glisser vers le bas pour fermer, « Fermer » en
  haut à droite, modaux pour VoiceOver, et ils défilent quand ils dépassent
  l'écran (petit iPhone, grand texte). Les titres serif suivent Dynamic Type
  (`UIFontMetrics`, plafonné au double), relu au rendu : un changement de
  taille en cours de route s'applique au prochain affichage.

## CI

- `ios-native.yml` : build, tests du cœur, intégration contre `server.js` avec de
  faux services (Motion, Google, GLM, dictée, ActivityWatch sur :9993), captures
  (dont iPhone SE).
- `ios-testflight.yml` : n'envoie qu'après tous les tests verts ; nettoie avant
  chaque archive les certificats de développement créés par l'API (plafond Apple).
- `serveur.yml` : `npm test` sur Ubuntu et Windows, et syntaxe des scripts
  PowerShell sous 5.1, comme la tour.
