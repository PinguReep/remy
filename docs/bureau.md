# Rémy sur Windows (app de bureau) et le site remis à niveau

Deux chantiers liés, menés la nuit du 29/10 :

- **A. L'app Windows** (`desktop/`) : une vraie fenêtre « Rémy », épinglable à
  la barre des tâches, avec une icône dans la zone de notification, un
  raccourci global « Noter » et des notifications Windows.
- **B. Le site** (`public/`), servi par la tour : c'est lui que l'app Windows
  affiche. Il rattrape l'app iPhone « Atelier » et devient d'abord une
  interface d'ordinateur (clavier, souris, 1024 à 1920 px), lisible à 430 px.

La première partie de ce document est la **conception** (choix, contrat entre
la coquille et le site, direction visuelle, carte des écrans, découpage).
La seconde, **le mode d'emploi** (installer, premier lancement, raccourcis,
SmartScreen, désinstaller), est écrite par le lot SHELL.

---

## 1. Conception

### 1.1 Choix technique : Tauri v2 (WebView2), pas Electron

| | Tauri v2 | Electron |
| --- | --- | --- |
| Moteur | WebView2, déjà dans Windows 11 (Chromium, à jour par Windows Update) | Chromium embarqué |
| Installateur | ~2 Mo (NSIS `.exe`) | ~90–120 Mo |
| Mémoire au repos | une WebView2 partagée | un Chromium + Node par app |
| API natives depuis une page distante | ACL par origine (`capabilities` avec `remote.urls`) : rien n'est exposé hors liste | `contextBridge` à la main ; tout ce qu'on oublie de fermer reste ouvert |
| Ce qu'il faut sur la machine | rien (WebView2 présent) | rien |

Tauri gagne sur ce qui compte ici : le poids, et surtout la **sécurité par
origine** demandée (une page distante n'a accès qu'aux commandes listées).
Electron n'apporterait rien : on n'a pas besoin de Node dans la fenêtre.
Version : `@tauri-apps/cli` et `tauri` **2.12.x** (la dernière au 29/10),
épinglées (`package-lock.json`, `Cargo.lock`).

**Le site distant, pas une copie embarquée.** La fenêtre principale affiche
l'interface servie par la tour (`https://<tour>.<tailnet>.ts.net:8444/`).
Une mise à jour de la tour met donc l'app Windows à jour sans réinstaller,
exactement comme le navigateur. La coquille ne contient que : l'écran
d'adresse / hors ligne, une « Noter » de secours hors ligne, et le code natif.

### 1.2 Ce que fait la coquille (lot SHELL)

- **Adresse de la tour** demandée au premier lancement (page locale
  `desktop/ui/demarrage.html`), gardée dans `%APPDATA%\com.pingureep.remy.bureau\bureau.json`,
  jamais dans le code. Même règle que l'iPhone (`ClientAPI.normaliserAdresse`) :
  `https://` vers n'importe quel hôte avec un point, `http://` seulement vers
  `localhost` / `127.0.0.1` ; ni chemin, ni requête, ni identifiants ; un hôte
  nu (`tour.exemple.ts.net:8444`) devient `https://…`. Modifiable ensuite
  (menu de l'icône, ou Réglages › Ordinateur du site).
- **Démarrage** : la page locale sonde `<adresse>/api/version` (`fetch` en
  `no-cors`, sans cookie, 5 s ; `/api/version` plutôt que `/api/health`, qui
  vérifie la clé Anthropic et Motion quand l'appel vient de la tour elle-même)
  ; réponse → la fenêtre part sur la tour ; sinon page « La
  tour ne répond pas » avec l'adresse, **Réessayer** (et nouvel essai seul
  toutes les 30 s), **Changer l'adresse**. Une fois le site chargé une fois,
  son service worker sert la page même tour éteinte, et c'est le site qui dit
  « hors ligne » (bandeau + Réessayer).
- **Tour jointe, Rémy arrêté** (Tailscale Serve répond **502** tant que
  `server.js` n'écoute pas, par exemple à l'ouverture de session, quand la
  tâche « Rémy » et l'app démarrent ensemble) : la sonde `no-cors` ne voit pas
  le statut, donc la coquille contrôle la page elle-même. Un petit script
  (`src-tauri/src/controle.js`), injecté dans chaque page des deux fenêtres,
  dit à la coquille (`bureau_page_chargee`) le statut HTTP de la navigation
  (WebView2 le donne ; WebKit non, alors « page vide » sert de repli). Réponse
  5xx ou page vide → la fenêtre revient sur sa page embarquée **sans changer
  de visibilité** : la principale affiche « Rémy ne répond pas encore »
  (`demarrage.html?injoignable=502`, Réessayer et nouvel essai seul toutes
  les 30 s, sans aller-retour immédiat), Noter reprend sa page de secours
  (`noter.html?retour=502`, nouvel essai à la minute). **Garde-fou** : une
  page de la tour qui ne s'est pas signalée **20 s** après la navigation
  (chargement bloqué, page d'erreur du navigateur) est traitée pareil
  (`?injoignable=muette`). Une page qui répond 2xx n'est jamais renvoyée,
  même si c'est un site trop ancien pour parler à la coquille.
  Pas de sonde CORS sur `/api/version` : le 502 vient de Tailscale, sans
  en-tête CORS, il serait illisible lui aussi, et une tour pas encore mise à
  jour bloquerait l'app sur « ne répond pas ».
- **Une seule instance** (`tauri-plugin-single-instance`) : relancer l'app
  ramène la fenêtre existante au premier plan.
- **Taille et position mémorisées** (`tauri-plugin-window-state`), fenêtre
  1280×800 par défaut, minimum 420×560, zoom Ctrl+= / Ctrl+- / Ctrl+0
  (`zoomHotkeysEnabled`).
- **Fermer = rester dans la zone de notification** (réglable). La première
  fois, une notification le dit (« Rémy reste près de l'horloge. Quitter :
  clic droit sur l'icône »).
- **Icône de la zone de notification** : clic gauche = afficher/masquer ;
  menu : Ouvrir Rémy · Noter… (Ctrl+Alt+Espace) · Aujourd'hui · Réglages de
  l'ordinateur · ─ · ☑ Démarrer avec Windows · Changer l'adresse de la tour ·
  Recharger · ─ · Quitter Rémy.
- **Démarrage avec Windows** (clé `Run` de l'utilisateur, valeur « Rémy »,
  pas d'admin ; par `auto-launch` directement, car `tauri-plugin-autostart`
  écrit le chemin sans guillemets, ce qui casse sur un profil Windows dont le
  nom contient une espace), **allumé par défaut** au premier lancement, lancé
  avec `--demarrage` : la fenêtre se charge **cachée** (les notifications
  tournent), l'icône seule apparaît.
- **Raccourci global** (`tauri-plugin-global-shortcut`), `Ctrl+Alt+Space` par
  défaut, réglable ; refusé s'il n'a pas de modificateur, s'il est déjà pris
  (le message le dit, l'ancien reste actif), ou s'il vaut AltGr + une touche
  qui écrit (Ctrl+Alt+0 = AltGr+0 = « @ » sur un clavier français : il
  volerait ce caractère partout ; permis avec Maj ou Win en plus, ou avec
  Espace, Entrée, F1–F12). Il ouvre la petite fenêtre
  **Noter** (560×300, sans bordure, au-dessus de tout, hors barre des tâches,
  centrée sur l'écran de la souris). Échap ou perte du focus la cache ; elle
  est créée cachée au démarrage pour s'ouvrir sans délai.
- **Notifications Windows natives** (`tauri-plugin-notification`), envoyées
  par la commande `bureau_notifier` (le site décide quoi notifier, voir 1.4).
  Elles ne marchent que pour l'app **installée** (raccourci du menu Démarrer
  avec l'AUMID `com.pingureep.remy.bureau`) ; en développement elles
  s'affichent au nom de PowerShell.
- **Liens externes** : toute navigation hors de l'origine de la tour (et hors
  des pages locales) est annulée et ouverte dans le navigateur par défaut
  (`tauri-plugin-opener`, côté Rust, `http`/`https` seulement). Pas d'autre
  fenêtre.
- **Micro** (dictée du site) : WebView2 demande l'accord une fois, comme un
  navigateur.

### 1.3 Sécurité

- **Aucune API native hors de l'origine de la tour.** Deux capabilities :
  - `locale.json` — fenêtres `main` et `noter`, pages embarquées seulement
    (`tauri://localhost`, `http://tauri.localhost`) : les commandes d'adresse
    et la note de secours.
  - `distante.json` — fenêtres `main` et `noter`, `remote.urls` génériques :
    `https://*.ts.net:*/*`, `http://localhost:*/*`, `http://127.0.0.1:*/*`
    (rien de propre à une tour). Seulement les commandes `bureau_*` du
    contrat (1.4) et `core:event:allow-listen` / `allow-unlisten`.
- **Deuxième verrou, dans chaque commande** : l'origine de la page appelante
  (`webview.url()`) doit être **exactement** celle de l'adresse configurée
  (commandes distantes) ou une page embarquée (commandes locales). Une autre
  machine du tailnet, un autre port : refusé.
- **Pas d'exécution arbitraire** : ni `shell`, ni `fs`, ni `http`, ni
  `process` exposés ; aucune commande ne prend un chemin, un programme ou une
  URL à ouvrir autre que `http(s)` ; les textes de notification sont bornés
  (titre 80, corps 240 caractères) et limités à 10 par minute.
- **CSP stricte** sur les pages embarquées (`default-src 'self'`, `connect-src`
  limité à `https:` et au local, pour la sonde) ; outils de développement fermés en
  version publiée.
- **Session** : le cookie de la tour (`HttpOnly; SameSite=Strict`) vit dans le
  profil WebView2 de l'app (`%LOCALAPPDATA%\com.pingureep.remy.bureau\EBWebView`) ;
  la coquille ne le lit jamais. Le premier chargement de la page (statique,
  sans session) part sans cookie après la navigation depuis la page locale :
  sans effet, les appels `/api` qui suivent sont de même origine.
- **Notes de secours** (tapées dans « Noter » quand le site n'a jamais pu se
  charger) : gardées dans le profil Windows (`notes-en-attente.dat`),
  **chiffrées par DPAPI** (`CryptProtectData`, portée de l'utilisateur : seul
  ce compte Windows, sur ce PC, les relit ; aucune clé à garder), effacées dès
  que le site les a envoyées. Un fichier que Windows ne sait plus déchiffrer
  (profil réinitialisé, copie sur un autre PC) est mis de côté
  (`notes-en-attente.illisible`), jamais écrasé, et Noter le dit.
- **File d'envoi du site** (ce qu'on note dans le site tour coupée) : dans le
  `localStorage` du profil WebView2, **en clair**, comme dans un navigateur ;
  seule la session Windows la protège (le disque n'est pas chiffré). Elle ne
  garde que ce qui n'est pas encore parti. Choix noté dans
  `docs/journal-technique.md` (29/10, suite).

### 1.4 Le contrat coquille ↔ site (à respecter par les deux lots)

Le site détecte l'app par `window.__TAURI__` (`withGlobalTauri: true`) et
n'appelle que ces commandes (`window.__TAURI__.core.invoke(nom, args)`).
Dans un navigateur, tout ce qui suit est simplement absent.

| Commande | Arguments | Réponse | Rôle |
| --- | --- | --- | --- |
| `bureau_etat` | — | `{ version, adresse, raccourci, raccourciLibelle, raccourciErreur, demarrage, fermerDansZone, fenetre }` (`fenetre` : `"main"` ou `"noter"` ; `raccourci` rangé, à renvoyer tel quel, ex. `Ctrl+Alt+Space` ; `raccourciLibelle` pour l'affichage, ex. `Ctrl+Alt+Espace` ; `raccourciErreur` : texte si Windows l'a refusé au démarrage) | le site sait qu'il est dans l'app ; marque « site chargé » côté coquille (la Noter de secours passe alors sur le site) |
| `bureau_regler` | `{ raccourci?, demarrage?, fermerDansZone? }` | l'état à jour, ou une erreur texte (« Raccourci invalide », « Déjà pris par une autre application ») | Réglages › Ordinateur |
| `bureau_notifier` | `{ titre, corps, cle?, vue? }` | `null` | une notification Windows (`cle` : la même ne repart pas deux fois en 10 min ; `vue` : ouverte au clic sur la notification) |
| `bureau_noter_fermer` | — | `null` | cache la fenêtre Noter (après envoi, Échap) |
| `bureau_ouvrir` | `{ vue? }` | `null` | montre la fenêtre principale ; avec `vue`, lui envoie `bureau://aller` |
| `bureau_ouvrir_lien` | `{ url }` | `null` | ouvre un lien `http(s)` dans le navigateur par défaut |
| `bureau_changer_adresse` | — | `null` | ramène la fenêtre principale sur l'écran d'adresse |
| `bureau_notes_attente` | — | `[{ id, texte, a }]` | les notes de secours tapées hors ligne |
| `bureau_notes_acquitter` | `{ ids }` | `null` | les efface une fois envoyées (`idCapture` = leur `id`) |

Événements de la coquille vers le site (`window.__TAURI__.event.listen`) :

- `bureau://noter-ouvert` (fenêtre `noter`) : elle vient d'être montrée →
  focus dans le champ, état remis à zéro si la dernière note est partie.
- `bureau://aller` `{ vue }` (fenêtre `main`) : aller à une vue
  (`aujourdhui`, `remy`, `projets`, `reglages/ordinateur`…).

Adresses chargées par la coquille :

- fenêtre principale : `<adresse>/` (routes du site en `#/…`) ;
- fenêtre Noter : `<adresse>/?fenetre=noter` (une requête, pas un chemin :
  le service worker sert `/` hors ligne avec `ignoreSearch`).

Commande interne (ni à appeler ni à imiter par le site) :
`bureau_page_chargee { statut, vide }`, envoyée par le script de contrôle
que la coquille injecte dans chaque page (1.2, « Tour jointe, Rémy
arrêté »). Le site n'a rien à faire pour en profiter, à deux conditions :
ne jamais répondre 2xx avec une page vide (elle serait prise pour un échec
et la fenêtre reviendrait sur sa page embarquée), et, si une intégration
ajoute ses propres capabilities, garder `allow-bureau-page-chargee` dans
`desktop/src-tauri/capabilities/distante.json`.

Commandes locales (pages embarquées seulement) : `bureau_adresse_lire`,
`bureau_adresse_enregistrer { adresse }` (normalise, refuse, ou rend
l'adresse propre), `bureau_adresse_normaliser { adresse }` (sans garder : la
page sonde d'abord), `bureau_aller_tour`, `bureau_note_locale { texte }`,
`bureau_notes_locales_compte` ; et, pour les pages locales comme pour le site,
`bureau_noter_fermer` et `bureau_ouvrir`.

Côté site, en mode `?fenetre=noter` : mettre le focus dans le champ au
chargement ET à chaque `bureau://noter-ouvert` (la fenêtre est préchargée
cachée), appeler `bureau_noter_fermer` après l'envoi et sur Échap. Sans
session, la fenêtre Noter ne montre **jamais** l'écran de connexion : un
avis le dit, la note attend dans la file du site et part après la
reconnexion dans la fenêtre principale.

**Qui décide des notifications : le site**, dans la fenêtre principale
seulement (cachée, elle tourne encore ; WebView2 ralentit alors ses minuteries
à une par minute, ce qui suffit). Sans IA, par les routes existantes :

- **Rappels dus** — `GET /api/rappels` **toutes les 60 s au plus** : un
  rappel pas fait dont `quand` vient de passer est notifié une fois (clé
  `rappel:<id>@<quand>`, gardée en `localStorage`). Au lancement, ceux passés
  depuis plus de 2 h sont regroupés en une seule notification (« 3 rappels
  passés pendant ton absence »). Allumé par défaut.
- **Briefing du matin / bilan du soir** — `GET /api/rituel` **une fois**, à
  l'heure choisie (7 h 30 et 21 h 30 par défaut, comme l'iPhone), pour le
  texte de la notification. **Coupés par défaut**, comme sur l'iPhone ; la
  carte de premier lancement de l'app les propose d'un clic. Un rituel raté
  (tour pas encore joignable au réveil du PC, refus de Windows) se retente
  **au plus toutes les 5 min**, tant qu'on est dans sa fenêtre de 4 h.
- **Une clé n'est marquée « dite »** qu'après un `bureau_notifier` réussi :
  une notification refusée repart au tour suivant.
- **Session perdue** — si la tour répond 401 à la boucle, une notification
  « Rémy est déconnecté » part **une fois par jour** (clé `session@<jour>`,
  clic : Aujourd'hui) : sans session, plus aucun rappel ne part, et la
  fenêtre est peut-être rangée près de l'horloge. Le site ne force pas
  l'ouverture de la fenêtre.
- Jamais `/api/dashboard` en boucle : il peut relancer le conseil réfléchi
  (modèle local). Le site ne le relit qu'à l'affichage, au retour au premier
  plan, et toutes les 5 min quand la fenêtre est visible.

### 1.5 Direction visuelle : l'« Atelier », pour l'ordinateur

Le site actuel (« papier & encre », angles droits, `#FF4F00`) n'est plus la
direction de l'app iPhone. Le site reprend **l'Atelier**
(`ios-native/Remy/Design/Design.swift`, `Atelier.swift`) : papier chaud, titres
en serif, heures en mono, cartes douces à bord fin, **une seule couleur de
signal**. Mêmes valeurs, en variables CSS :

| Jeton | Clair | Sombre | Usage |
| --- | --- | --- | --- |
| `--fond` | `#F4EFE6` | `#14120F` | fond de page |
| `--surface` | `#FFFCF6` | `#1F1C18` | cartes |
| `--fond-2` | `#EDE5D8` | `#2B2722` | survol, champs |
| `--fond-3` | `#E2D8C8` | `#342F28` | sélection, pistes |
| `--encre` | `#221E18` | `#F3ECE1` | texte |
| `--encre-2` | `#564E43` | `#C2B9AB` | texte secondaire, titres de section |
| `--encre-3` | `#6F675B` | `#9A9286` | méta (≥ 4,5:1 sur le fond) |
| `--filet` | `#E2D8C8` | `#342F28` | bords, séparateurs |
| `--signal` | `#F2541B` | `#FF6A33` | aplats, repères, focus — jamais de petit texte |
| `--sur-signal` | `#221E18` | `#14120F` | texte sur aplat orange |
| `--danger` | `#B2361D` | `#FF8A6B` | suppression, erreur |
| `--ombre` | `rgba(92,70,48,.10)` | `rgba(0,0,0,.10)` | ombre chaude des cartes |

- **Couleurs de projet** : les six teintes de `Palette.projet` avec le **même
  hachage FNV-1a + brassage** porté en JS : un projet a la même couleur sur
  l'iPhone et sur le bureau. L'urgence se dit par une forme, jamais par ces couleurs.
- **Polices** : titres et voix de Rémy en serif — l'iPhone utilise New York,
  absent de Windows : on embarque **Source Serif 4** (OFL, auto-hébergée
  comme Inter, aucune requête à un tiers), repli `Georgia, Cambria, serif` ;
  texte en **Inter** ; heures et chiffres en **JetBrains Mono**
  (`tabular-nums`). Déjà dans `public/fonts/` pour les deux dernières.
- **Composants repris** : titre d'écran (sur-titre orange en capitales mono,
  grand titre serif), titre de section (mono 12, capitales, espacement 1,6),
  carte (rayon 18 sur ordinateur, 22 sur téléphone, bord 1 px `--filet`, ombre
  `0 8px 18px var(--ombre)`), puces de geste (44 px de haut), bouton plein
  (encre) / secondaire (papier) / signal (une seule action principale par vue).
- **Pour l'ordinateur** : un **rail** à gauche (232 px : Aujourd'hui, Rémy,
  Projets, Conversations, Réglages, et « Noter » en bouton plein ; replié en
  icônes, 76 px, dès 1279 px, libellés en infobulle), le contenu
  en colonnes selon la largeur (1.6), états de survol (`--fond-2`), focus
  visible partout (anneau 2 px `--signal`), infobulles qui donnent le
  raccourci (`<kbd>`), densité plus serrée que l'iPhone (texte 15 px,
  interligne 1,5) mais cibles ≥ 44 px. À ≤ 720 px : barre d'onglets en bas
  comme l'iPhone (Aujourd'hui, Rémy, ＋, Projets, Réglages), safe-areas.
- **Mouvement** : 120–200 ms, `ease-out`, uniquement pour dire un changement
  d'état (carte terminée qui s'efface, panneau qui s'ouvre) ;
  `prefers-reduced-motion` respecté. Squelettes de chargement à la forme du
  contenu, jamais de spinner seul.
- **Thème** : Auto / Clair / Sombre (comme « Apparence » de l'iPhone),
  appliqué avant le premier rendu.
- **Clavier** : `N` noter, `/` chercher dans la vue, `Ctrl+K` palette de
  commandes (vues, actions, réglages), `Ctrl+1…5` les vues, `Échap` ferme,
  `?` l'aide des raccourcis ; dans le chat `Entrée` envoie, `Maj+Entrée`
  passe à la ligne ; dans Noter `Entrée` envoie. Les lettres seules ne
  s'activent jamais dans un champ.

### 1.6 Carte des écrans et des routes

Toutes ces routes existent (`lib/routes.js`) ; l'iPhone les utilise déjà.
Ce qui a été ajouté ensuite pour la parité, écran par écran, et ce qui reste
volontairement absent sur ordinateur : 1.10.

| Écran (`#/…`) | Contenu (parité iPhone) | Routes |
| --- | --- | --- |
| **Aujourd'hui** `#/aujourdhui` | ≥ 1280 px : 2 colonnes. À gauche, la **carte Maintenant** (tâche en cours ou suivante, minuterie, Terminer · Décaler · +15 · Gérer) puis **la journée à l'échelle** (frise verticale des heures, rendez-vous et tâches, « maintenant » en trait orange). À droite : **À trancher**, **menacées**, **briefing du matin / bilan du soir**, **Demain** et **7 jours**, le conseil du moment | `GET /api/dashboard` (`?frais=1` au rafraîchissement), `GET /api/rituel`, `POST /api/rituel/bilan`, `GET /api/semaine?jours=7`, `GET /api/a-trancher`, `POST /api/a-trancher/reports`, `DELETE /api/a-trancher/reports/:id`, `POST /api/a-trancher/rouvrir`, `GET/PUT /api/revue[/decisions]`, `PUT /api/briefing/etat`, `GET /api/conseil?type=`, `POST /api/conseil/renouveler` |
| Gestes de tâche (Gérer) | Terminer (bandeau « Annuler » 2 s, rien ne part avant), Commencer maintenant, Bloquée (+ raison), Décaler (choix de `Ergonomie.swift` : +15 min, 1 h, demain…, date), Prolonger, catégories | `POST /api/motion/apply` · `/undo`, `POST /api/google/apply` · `/undo` (activités de l'agenda), `PUT /api/taches/:id/etat`, `PUT /api/taches/:id/etiquettes`, `GET /api/motion/file` |
| **Rémy** `#/remy/:id` | ≥ 1280 px : liste des conversations · fil · panneau (jauge du contexte, Compacter, étapes). Conversations (épingler, renommer, supprimer, non-lus), **conversation privée** (puce « Privée » avant le premier message, cadenas sur la marque, « Rendre privée » avec confirmation), **jauge** et **Compacter**, **barre d'étapes** (recherche web locale, pages lues, refus du filtre), **propositions ajustables** (date, durée, catégorie, rappel) avec **Oui** / **Non merci**, autorisations, Interrompre / Envoyer après, dictée | `GET/POST /api/conversations`, `GET/PATCH/DELETE /api/conversations/:id` (`{ prive: true }`, `title`, `pinned`), `POST …/messages` (SSE : `delta`, `status`, `proposal`, `autorisation`, `traites`, `debit`, `title`, `done`, `error`), `POST …/stop`, `POST …/compacter`, `POST …/autorisations/:aid`, `POST …/propositions/:pid/{ajuster,refus,regle,carnet}`, `POST /api/motion/apply`, `POST /api/transcribe[?prive=1]`, `POST /api/dictee/correction` |
| **Noter** (`N`, `?fenetre=noter`, ＋) | Le même aperçu que l'iPhone : **genre** deviné (Tâche, Idée, Liste, Rappel, Retenir, Question, Projet), corrigeable d'un clic, **échéance** lue (« demain 9h », « avant mardi 14h », « fin du mois »), titre nettoyé. Plusieurs intentions → « Rémy les range une à une ». File d'envoi hors ligne (`idCapture`) | aperçu **sans route** (analyse portée en JS, 1.7) ; envoi : `POST /api/motion/apply` (tâche), `PUT /api/dossiers/idees` + `POST /api/dossiers/idees/notes` (idée), `POST /api/listes/:id/elements` (liste), `POST /api/rappels` (rappel), `POST /api/capture` (retenir, `idCapture`), `POST /api/capture/extraire` (Retenir choisi, sur demande), `PUT /api/dossiers/:id` (projet) ; question → ouvre Rémy avec le texte |
| **Projets** `#/projets/…` | Maître-détail : Projets Motion, dossiers (et Idées), listes, rappels, étiquettes ; ajouter, cocher, renommer, supprimer, déplacer | `GET /api/projets`, `GET /api/dossiers`, `PUT/DELETE /api/dossiers/:id`, `POST/DELETE …/notes`, `GET /api/listes`, `PUT/DELETE /api/listes/:id`, `POST …/elements`, `POST …/retirer`, `PUT/DELETE …/elements/:eid`, `GET/POST /api/rappels`, `PUT/DELETE /api/rappels/:id`, `POST /api/rappels/analyser` (sur demande : modèle local), `GET/PUT/DELETE /api/etiquettes[/:id]`, `PUT /api/rattachements/:id`, `GET /api/historique` |
| **Conversations** `#/conversations/:source/:id[/:message]` | Claude Code, T3 Code, ChatGPT (contrat : `docs/conversations-externes.md`), seulement si la tour annonce `conversations-externes-v1`. Liste groupée par jour, puces par source, **« Aller à un jour »**, recherche sans IA (`/`) dont un résultat ouvre la conversation **au message trouvé** (mis en évidence, « Depuis le début »), lecture paginée, ce que la nuit en a tiré (thèmes, décisions, choses à faire → Noter). **Sources** (feuille, et Réglages › Sources des conversations) : état et quoi faire par source, où la tour cherche, allumer / couper, « Lire maintenant », effacer une source ou tout, s'en inspirer / relire la nuit, **import d'un export ChatGPT** par fichier avec sa progression. Chemins et phrases : `public/app/analyse/conversations.js` (les mots de `ConversationsExternes.swift`, testés par `test/site-conversations.test.mjs` contre les vraies routes) | `GET /api/conversations-externes`, `GET …/liste?source=&jour=&decalage=&limite=`, `GET …/jours`, `GET …/chercher?q=`, `GET …/conversations/:source/:id?apres=&autour=`, `GET …/nuit`, `POST …/synchroniser`, `PUT/DELETE …/sources/:id`, `PUT …/usage`, `DELETE …/tout`, `POST …/chatgpt` (le fichier en corps brut) |
| **Réglages** `#/reglages/…` | **Recherche dans les réglages** (filtre en direct, aussi dans `Ctrl+K`). Ordinateur (app Windows : raccourci, démarrage, fermer dans la zone, notifications rappels / briefing / bilan et leurs heures, tester une notification, adresse, version), Apparence, Rémy (circuits : réflexion de nuit, conseil réfléchi, compactage auto, règles), Recherche web, recherche dans les conversations privées, secours Claude, contexte cloud, modèle local, Mémoire, Coûts, Appareils connectés, jeton de capture, Agenda Google (état, connexion), Activité du PC, Sources des conversations (si la tour les lit ; « ChatGPT », « Claude Code », « T3 », « import » la trouvent), Diagnostic (version tour, incidents, copier le diagnostic), Se déconnecter, Interface classique | `GET/PUT /api/reglages`, `GET/PUT /api/modeles`, `GET/PUT /api/memory`, `GET /api/costs`, `GET/POST/DELETE /api/appareils`, `GET/POST/DELETE /api/capture/jeton`, `GET /api/google/status`, `POST /api/google/{auth,deconnexion,test}`, `GET/PUT/DELETE /api/activite-pc`, `GET /api/regles`, `PATCH/DELETE /api/regles/:id`, `GET /api/version`, `GET /api/incidents[/:code]`, `POST /api/logout` |
| Connexion | Mot de passe, erreurs claires (mauvais mot de passe, trop d'essais, tour injoignable) | `POST /api/login`, `GET /api/version` (426 : « mets la tour à jour ») |

**Ce qui ne passe pas dans la nouvelle interface** (roadmap, consigne de
nuit) reste disponible : l'ancienne page devient `public/classique.html`,
liée depuis Réglages › Avancé. Rien n'est perdu ; on la retirera quand plus
personne ne l'ouvre. Le mode appel (bouton téléphone en tête d'une
conversation, « Appeler Rémy » dans `Ctrl+K`), « Faire connaissance » (carte
d'Aujourd'hui) et l'import d'un export ChatGPT (Conversations › Sources) sont
dans la nouvelle interface.

### 1.7 Manques côté tour

1. **Analyse de capture sans IA : pas de route.** `POST /api/capture/analyser`
   appelle le modèle local ; l'aperçu de l'iPhone, lui, est local
   (`AnalyseDate` dans `Dates.swift`, `GenreCapture` dans `Accueil.swift`).
   → **Port en JS** dans `public/app/analyse/` (module ES pur, sans DOM),
   importé par le site ET par les tests node, avec **les mêmes phrases de
   test** que `AccueilTests.swift` / `CarnetTests.swift`. Pas de nouvelle
   route : l'aperçu reste instantané et marche hors ligne.
2. **Cache des fichiers du site** : `server.js` ne pose aucun `Cache-Control`.
   Avec des modules JS séparés, une page en cache et un module neuf pourraient
   se mélanger après une mise à jour de la tour. → `Cache-Control: no-cache`
   sur HTML/JS/CSS (revalidation à chaque chargement, le service worker reste
   réseau d'abord), test node.
3. **Notifications** : pas de route « ce qu'il faut signaler ». Pas besoin :
   `/api/rappels` + `/api/rituel` suffisent (1.4). À reconsidérer si la tour
   apprend à pousser (pas cette nuit).
4. **Conversations externes** : branchées à l'intégration de la nuit du
   29/10 (#26), sans nouvelle route (1.6).
5. Rien d'autre : la parité ne demande **aucune nouvelle route**. La seule
   ajoutée depuis, `POST /api/conversations-externes/chatgpt/telechargements`,
   est l'accord demandé avant d'importer un export trouvé (1.10).

### 1.8 Découpage en deux lots aux fichiers disjoints

Les deux lots avancent en parallèle ; ils ne se parlent que par le contrat
1.4. Aucun fichier n'est touché par les deux.

**Lot SHELL** — la coquille Windows, sa CI, la doc.

| Fichier | Contenu |
| --- | --- |
| `desktop/package.json`, `desktop/package-lock.json` | `@tauri-apps/cli` 2.12.x épinglé, scripts `tauri dev/build/icon` |
| `desktop/.gitignore` | `node_modules/`, `src-tauri/target/`, `src-tauri/gen/` |
| `desktop/ui/demarrage.html`, `desktop/ui/demarrage.js`, `desktop/ui/atelier.css` | adresse, sonde, hors ligne, Réessayer (Atelier, polices système) |
| `desktop/ui/noter.html`, `desktop/ui/noter.js` | Noter de secours (site jamais chargé) → `bureau_note_locale` |
| `desktop/src-tauri/Cargo.toml`, `Cargo.lock`, `build.rs` | `tauri` 2.12 (`tray-icon`), plugins single-instance, window-state, global-shortcut, notification, opener ; `auto-launch`, `serde`, `url`, `windows-sys` (identifiant d'app) ; `AppManifest` des commandes |
| `desktop/src-tauri/tauri.conf.json` | identifiant `com.pingureep.remy.bureau`, `productName` « Rémy », fenêtres, CSP, `withGlobalTauri`, NSIS `currentUser` en français (pas de `.msi`), icônes |
| `desktop/src-tauri/capabilities/locale.json`, `distante.json` | 1.3 |
| `desktop/src-tauri/icons/*` | générées depuis `public/icons/icon-512.png` (`tauri icon`) |
| `desktop/src-tauri/src/main.rs`, `lib.rs` | montage, plugins, fenêtres, `--demarrage` |
| `desktop/src-tauri/src/adresse.rs` | normalisation + vérification d'origine (tests `cargo test`) |
| `desktop/src-tauri/src/reglages.rs` | `bureau.json`, notes de secours |
| `desktop/src-tauri/src/commandes.rs` | les commandes du contrat, chacune avec son verrou d'origine |
| `desktop/src-tauri/src/zone.rs`, `raccourci.rs`, `fenetres.rs`, `demarrage.rs` | icône et menu, raccourci global, fenêtres main/noter, navigation externe, démarrage avec Windows |
| `.github/workflows/bureau-windows.yml` | `windows-latest` : `cargo test`, `tauri build` → artefact (`.exe` NSIS, `SHA256SUMS.txt`) ; lancement manuel depuis `main` avec `publier` → Release `bureau-vX.Y.Z` (version lue dans `tauri.conf.json`, refus si le tag existe ou hors de `main`) |
| `docs/bureau.md` | ce document : partie 2 (mode d'emploi) |
| `docs/journal-technique.md` | l'entrée du 29/10 (coquille + décisions du site rapportées par le lot SITE) |

Vérification SHELL : `cargo test` (adresse, origine, raccourci), workflow
vert sur `windows-latest`, artefact téléchargé et inspecté (noms, tailles,
empreintes). L'interface native ne peut pas être cliquée en CI : le
comportement se vérifie par les tests unitaires et la revue ; le premier
lancement réel se fait sur la tour.

**Lot SITE** — l'interface servie par la tour.

| Fichier | Contenu |
| --- | --- |
| `public/index.html` | la nouvelle page : `<head>`, thème avant rendu, squelette, `<script type="module" src="/app/main.js">` |
| `public/classique.html` | l'ancien `index.html` tel quel (+ un lien « Nouvelle interface ») |
| `public/app/atelier.css` | jetons 1.5, composants, mises en page ordinateur / 430 px |
| `public/app/main.js` | démarrage, routeur `#/…`, rail / onglets, raccourcis, aide `?` |
| `public/app/api.js` | `fetch` avec délai, réponse non-JSON, 401 → connexion, 426, hors ligne ; lecteur SSE |
| `public/app/ui.js` | bandeau (succès / erreur + quoi faire / Annuler), squelettes, feuilles, confirmations, `kbd` |
| `public/app/bureau.js` | pont vers la coquille (1.4) : détection, réglages Ordinateur, notifications (rappels / rituel), mode `?fenetre=noter`, notes de secours |
| `public/app/file-envoi.js` | file d'envoi hors ligne (`localStorage`, `idCapture`, reprise espacée) |
| `public/app/palette.js` | `Ctrl+K` : vues, actions, réglages |
| `public/app/couleurs.js` | couleur de projet (FNV-1a, comme l'iPhone) |
| `public/app/analyse/dates.js`, `public/app/analyse/genre.js` | port de `AnalyseDate` et `GenreCapture` (pur, testable sous node) |
| `public/app/vues/aujourdhui.js`, `gerer.js`, `remy.js`, `noter.js`, `projets.js`, `reglages.js`, `conversations-externes.js`, `connexion.js` | les écrans de 1.6 |
| `public/fonts/source-serif-4-*.woff2`, `public/fonts/LICENSE.txt` | la serif des titres (OFL) |
| `public/sw.js`, `public/manifest.json` | cache `remy-v3` (nouveaux fichiers), couleurs Atelier |
| `server.js` | `Cache-Control: no-cache` sur les fichiers du site (1.7) |
| `test/site-analyse.test.mjs`, `test/site-statique.test.mjs`, `test/site-bureau.test.mjs` | analyse (phrases des tests Swift), service des fichiers et en-têtes, logique de notification (rappels dus, regroupement, clés) |

Vérification SITE : `npm test` vert ; Playwright contre la tour de démo
(`ios-native/ci/donnees-demo.mjs` + `faux-services.mjs`, données fictives) à
1440×900, 1024×768 et 430×932 : chaque écran, chaque geste (succès, erreur,
hors ligne), les raccourcis, la palette ; le pont simulé par un faux
`window.__TAURI__` (`addInitScript`) qui enregistre les `invoke` : mode Noter,
Réglages › Ordinateur, notifications déclenchées une seule fois.

### 1.9 Décisions prises (sans attendre le réveil)

- Tauri v2 plutôt qu'Electron (1.1) ; le site **distant** dans la fenêtre,
  pas embarqué : une seule interface à tenir, mise à jour avec la tour.
- Le site décide des notifications (il a la session et connaît les données) ;
  la coquille ne fait que les afficher. Aucune requête réseau côté Rust.
- Démarrage avec Windows **allumé** par défaut (sinon pas de notifications),
  fenêtre cachée au démarrage de session ; rappels **allumés**, briefing et
  bilan **coupés** par défaut comme sur l'iPhone, proposés au premier lancement.
- Fermer la fenêtre la range dans la zone de notification (réglable).
- Ancienne page gardée en `classique.html` pour ce qui n'est pas porté.
- Analyse de la capture portée en JS plutôt qu'une route : instantané, hors
  ligne, sans IA ; mêmes phrases de test que l'iPhone.
- Serif embarquée (Source Serif 4) faute de New York sous Windows.
- Installateur NSIS **par utilisateur** (pas d'admin) en français, et lui
  seul : le `.msi` de Tauri s'installe pour toute la machine et, à la
  désinstallation, laisse la valeur « Rémy » de la clé `Run` (posée par
  l'app) pointer vers un programme effacé ; le `.exe` NSIS l'efface.
- Non signé : SmartScreen préviendra (partie 2, à écrire par le lot SHELL).

### 1.10 Parité avec l'iPhone (29/10)

Le 29 et le 30/10, le site — donc l'app de bureau, qui l'affiche — a rattrapé
l'app iPhone écran par écran. La référence : les vues SwiftUI
(`ios-native/Remy/Vues`) et les phrases de `RemyCore`, reprises mot pour mot
quand elles existent ; seuls les gestes changent (« clique », « Entrée »,
« clic droit » au lieu de « touche » et « appui long »). Chaque calcul porté
vit dans un module pur de `public/app/analyse/`, testé sous node avec les cas
des tests Swift (`test/site-*.test.mjs`, joués aussi contre les vraies
routes) ; les écrans, dans `public/app/vues/`.

Sept lots aux fichiers disjoints (conversations, boîte, aujourd'hui, chat,
noter, projets, réglages), puis une intégration et deux revues. Côté tour,
la parité n'a demandé qu'une route
(`POST /api/conversations-externes/chatgpt/telechargements`), deux champs
(`{ telechargements, rappel }` dans `PUT …/sources/chatgpt`, `depuis` dans
`POST /api/capture/image`) et deux capacités (`conversations-externes-v2`,
`telechargements-accord-v1`) ; tout le reste passe par les routes que
l'iPhone utilise déjà (1.6). Une fonction que la tour ne connaît pas encore
reste cachée, comme sur l'iPhone.

**Les contrats entre modules** (le code les cite par leur lettre) :

| Contrat | Ce qu'il fixe |
| --- | --- |
| A | Les modules d'accueil `creerBoite`, `creerTrancher`, `creerRappelsDuJour(ctx, { relire })` → `{ bouton?, carte, maj, ouvrir? }`. Aujourd'hui les charge par `import()` (un module absent laisse sa zone vide) et leur passe le tableau après chaque lecture, ratée comprise : ils ne lisent jamais `/api/dashboard` eux-mêmes |
| B | Les adresses `#/aujourdhui/<quoi>[/<arg>]` (`boite`, `briefing`, `bilan`, `nuit/<id>`, `trancher`, `revue`, `retards`, `echelle`, `connaissance`) : la feuille s'ouvre, puis l'adresse redevient `#/aujourdhui`. Les notifications Windows et `Ctrl+K` s'en servent |
| C | Une demande préparée pour Rémy. `remy-envoi` (`{ texte, a, titre? }`, valable 2 min) : le clic qui l'écrit est le geste, elle part dans une conversation neuve. `remy-question` : posée dans le champ avec le focus, jamais envoyée ; un brouillon en cours n'est remplacé qu'après « Le remplacer » |
| D | Les modules du chat, chargés par `import()` : `vues/propositions.js` (`carteProposition`, `majEcriture`), `dictee.js` (`demarrerDictee`, `monterAttente`), `vues/retenir.js` (`ouvrirRetenir`), `vues/appel.js` (`ouvrirAppel`). Un module absent est dit à l'écran |
| E | `analyse/etiquettes.js` : `etiquetteDevinee(texte, etiquettes)`, les indices de l'iPhone (Noter, Gérer, Ajuster, tri des rappels) |
| F | `non-lus.js` : `demarrer()` au début de la session, `maj(conversations)` ; la pastille des réponses non vues sur le rail, les onglets et le titre de la fenêtre |
| G | Les clés locales que Réglages écrit et que la conversation lit : `confirmerLiens`, `diagnostic.jauge`, `diagnostic.vitesse` |
| H | `Ctrl+K` et l'état de la tour : les feuilles d'Aujourd'hui, chacune cachée sans sa capacité ; « Tour en ligne » mène à Réglages › Envoi en attente |

**Ce qui a été ajouté, écran par écran :**

| Écran | Ajouté (comme sur l'iPhone) | Modules |
| --- | --- | --- |
| **Aujourd'hui** | Bouton **boîte** en tête (plateau, pastille des sujets ouverts) ; carte du matin compacte (repliée l'après-midi), **bilan du soir** devant dès 18 h ; **conseil du moment** calculé ici (`Conseil.pour`), sa feuille (Pourquoi, « Ce que Rémy a regardé », Ouvrir, « En parler avec Rémy ») et « Un autre conseil » ; **cases à cocher** dans la frise et les lignes (2 s pour Annuler, bloc « Cochées », hors ligne → file d'envoi, relecture ~35 s après un geste) ; « **Et maintenant ?** » après une coche ; « **Demain et 7 jours** » et la feuille « **À l'échelle** » (onglets, ← →) ; **Faire connaissance** ; bandeau d'état (rafraîchi, gestes en attente, phrase Motion), page d'un autre jour marquée périmée ; horloge **Historique des actions** ; « Organiser ma journée avec Rémy » | `vues/aujourdhui.js`, `conseil.js`, `et-maintenant.js`, `semaine.js` ; `analyse/conseil.js`, `journee.js`, `semaine.js` |
| Gérer (une tâche, un rendez-vous) | Prolonger en deux gestes avec la boîte d'impact (conflit éventuel) ; catégorie avec suggestion ; déplacer un rendez-vous ; « Remettre à sa place » après Commencer ou Arrêter ; détails (priorité, bloquée, horaires, quand sans créneau), Modifier | `vues/gerer.js` |
| **Boîte, briefing, bilan** | Feuille « Ton briefing » (les trois lignes, provenance, « Hier, dans tes conversations », menacées : Repousser ou « En parler à Rémy ») ; **sujets de la nuit** (C'est fait, Laisser tomber, En parler à Rémy ; Annuler, Rouvrir) ; bilan « Tout ce qui reste → demain » (Annuler 8 s) et « Rangé pour la nuit » ; « Cette nuit, je creuse aussi ? » ; proposition « Ton briefing chaque matin ? » (app Windows seulement) | `vues/boite.js`, `analyse/rituel.js` |
| **À trancher**, revue | Carte « À trancher · N », feuille groupée (« Et N de plus… »), tous les gestes avec Annuler, rappels en retard (Fait, Demain même heure, Abandonner), carte ancienne confirmée par « Appliquer quand même » ; **retards au retour** (absence de plus de 3 jours) ; **revue du dimanche** en 5 étapes | `vues/trancher.js` |
| **Rémy** (conversation) | Brouillons qui ne se perdent plus (fil, privée, file « Envoyer après ») ; écran vide de l'iPhone (privée, Organiser ma journée, en retard, Noter une idée, reprendre le fil du jour) ; mode « Noter une idée » ; boîte « Rémy répond encore » ; reprise d'une réponse en cours ; code d'erreur et « Copier le diagnostic » ; **clic droit** sur une bulle, un tableau, une conversation (lu / non lu, Renommer, Épingler, Supprimer) ; liste par jour avec recherche sans accents ; fil importé et « Continuer avec Rémy » ; **jauge détaillée** (niveaux, place, vitesse, cadran), **compactage** et son résumé ; corriger la dictée ; barre d'étapes chronométrée ; conversation privée | `vues/remy.js`, `analyse/remy.js`, `non-lus.js`, `menu.js` |
| Propositions, Retenir, dictée, appel | Cartes de proposition complètes (cases, « Oui, fais-le », Annuler, partielle, Règle, Carnet, attente de la file Motion), feuille **Ajuster** ; **Retenir** au-delà de 280 caractères ; **dictée** (barre, 15 min au plus, vocal en attente en mémoire seulement) ; **mode appel** (écoute, réflexion, voix locales du système) | `vues/propositions.js`, `ajuster.js`, `retenir.js`, `appel.js`, `dictee.js` |
| **Noter** | Aperçu du genre et du bouton, **étiquette devinée**, projet sous un parent ; « Plusieurs choses » → **récapitulatif à valider** (cases, question d'heure, bilan d'un échec partiel) ; **déjà-là** (Annuler ne retire que le nouveau) ; brouillon ; Retenir ; **image collée ou déposée** (la feuille de partage de l'iPhone : « Un mot pour Rémy », rangée dans le coffre) | `vues/noter.js`, `analyse/rangement.js`, `analyse/etiquettes.js` |
| **Projets › Rappels** | Groupes (en retard, aujourd'hui, plus tard, sans date, faits) ; feuille « **Quand ?** » (Dans 1 h, Ce soir, Demain, Lundi, Choisir…) ; **Étiquettes**, **filtre**, clic droit (Reporter, Plus tard, Étiquettes, Retirer) ; « Nouveau rappel » ; **tri des rappels** (tes catégories, puis Garder / Tâche Motion / Rien) ; carte « Rappels du jour » d'Aujourd'hui | `vues/rappels.js`, `tri-rappels.js`, `analyse/carnet.js` |
| Projets › le reste | Listes en tuiles (disposition, Pris, Annuler partout) ; dossiers (méta, « Aussi dans Motion… », suppression annulable avec tout son contenu) ; tâches rangées (Ranger dans…, Sortir du sous-projet) ; projets Motion (prochaine tâche, en retard, « En parler à Rémy ») ; **Historique** (filtres, « Annuler cette action ? », plus ancien) | `vues/projets.js` |
| **Conversations** | Carte « **Exporter ChatGPT** », carte « Un export ChatGPT trouvé dans Téléchargements » (Importer / Pas celui-là), recensement sous chaque source, réglages Téléchargements et rappel ; Cette nuit : « **Me le rappeler** » (un rappel sans heure) | `vues/conversations-externes.js`, `analyse/conversations.js` (contrat : `docs/conversations-externes.md`) |
| **Réglages** | Recherche qui va **droit à la ligne** (port de `RechercheReglages.swift`) ; **Ce qui compte** ; Mémoire (lecture, puis Corriger, conflit dit) ; **Activité du PC** (bilans, exclusions) ; circuits, **Règles**, **Localisation** (lire, renommer, oublier), **Modèle** ; À trancher et revue ; Ordinateur (textes de l'iPhone, Propositions de Rémy) ; Diagnostic (temps de réponse, jauge, vitesse) ; **Nouveautés** ; « **Ce que tu utilises vraiment** » ; Appareils ; **Envoi en attente** | `vues/reglages.js`, `analyse/recherche-reglages.js`, `nouveautes.js`, `usage.js`, `file-envoi.js` |
| Partout | `Ctrl+K` trouve chaque feuille et geste à adresse (briefing, bilan, À trancher, revue, retards, 7 jours, Historique, Catégories, Trier les rappels, Faire connaissance, Appeler Rémy, Organiser ma journée) ; menu du clic droit aussi au clavier (`Maj+F10`, touche Menu), dit par l'aide `?` ; pastille des non-lus ; session perdue : toutes les feuilles se ferment avant l'écran de connexion ; Nouveautés au lancement ; signe de vie, page visible seulement | `main.js`, `palette.js`, `menu.js`, `ui.js` |
| App Windows | Bilan à 22 h 45 par défaut ; **propositions de Rémy notifiées** (`GET /api/propositions/attente`) ; une notification ouvre sa feuille (`aujourdhui/briefing`, `aujourdhui/bilan`, `aujourdhui/nuit/<id>`, une conversation) ; une image déposée sur Noter arrive au site | `bureau.js`, `desktop/src-tauri/src/fenetres.rs` |

**Volontairement absent sur ordinateur :**

| Sur l'iPhone | Pourquoi pas ici | Ce qui en tient lieu |
| --- | --- | --- |
| Activité en direct, Dynamic Island, widgets | n'existent que sur iOS | la carte Maintenant (temps restant), les notifications Windows |
| Notifications des rappels et du rituel | celles de l'iPhone passent par iOS | `bureau.js` : notifications Windows (rappels, briefing, bilan, propositions) |
| « Importer mes rappels Apple » | EventKit n'existe que sur l'iPhone | les rappels déjà importés gardent leur marque « importé » |
| Capteur de localisation (visites, pause 2 h, nommer l'endroit où l'on est) | ni CoreLocation ni position sur un PC | Réglages › Localisation : lire, renommer, oublier, effacer l'historique |
| Feuille de partage, Siri, réglages d'iOS | propres à iOS | coller ou déposer une image ou un texte dans Noter ; Réglages › Ordinateur pour les autorisations Windows |
| Appui long, et sa durée réglable (Diagnostic) | geste tactile | clic droit, `Maj+F10`, touche Menu |
| Vibrations | pas de moteur haptique | bandeaux et états des boutons |
| Feuille « Sélectionner » (le texte d'une bulle) | contourne la sélection tactile d'iOS | sélection native ; « Copier » au clic droit |
| Mesure de saisie (champ UIKit contre SwiftUI) | écran de mesure de la CI iOS, jamais montré | — |
| Écran d'adresse de la tour | la coquille la demande à son premier lancement (1.2) | `desktop/ui/demarrage.html` |

**Écarts choisis**, à revoir si l'usage dit le contraire : « Copier » sur
une réponse (le texte en clair) réduit un lien à son texte (l'iPhone garde
« texte (url) ») ; les
gestes Étiquettes et Retirer d'un rappel ont un bandeau avec Annuler
(silencieux sur l'iPhone) ; une tâche rangée s'ouvre dans Gérer même hors de
la journée ; les Nouveautés du site ont leur propre catalogue, avec les
seules entrées utiles sur un ordinateur.

**Reste à faire** : lire le texte d'une image collée (l'iPhone le lit ; sur
Windows, l'OCR du système — en attendant, l'aperçu le dit) ; essayer sur
Windows réel le dépôt d'image, les notifications et leur clic ; une règle
commune pour `dialog.feuille.large` à 720 px et moins (chaque lot corrige
encore ses propres feuilles ; Noter y reste 32 px plus étroit que l'écran,
collé à gauche) ; à 720 px et moins, Conversations › « Cette nuit » (et son
« Me le rappeler ») est dans le panneau de droite sans sélection, que la
mise en page étroite cache : la carte n'y est pas atteignable.

---

## 2. Mode d'emploi

### 2.1 Installer

1. **Récupérer l'installateur.**
   - Version publiée : page *Releases* du dépôt, `bureau-vX.Y.Z`, fichier
     `Remy-Bureau_X.Y.Z_x64-setup.exe`.
   - Avant toute publication : onglet *Actions* › « Bureau Windows —
     installateur » › le dernier passage vert › artefact
     `remy-bureau-windows-X.Y.Z` (un `.zip` : l'extraire).
2. **Vérifier l'empreinte** (facultatif, recommandé : l'installateur n'est
   pas signé). Dans PowerShell, à côté du fichier :
   `Get-FileHash .\Remy-Bureau_X.Y.Z_x64-setup.exe` ; la valeur doit être
   celle de `SHA256SUMS.txt` (même artefact ou même Release).
3. **Double-clic sur `Remy-Bureau_X.Y.Z_x64-setup.exe`.** Installation pour
   ton compte seulement, **sans droits d'administrateur**, dans
   `%LOCALAPPDATA%\Rémy` ; raccourci « Rémy » dans le menu Démarrer.
   WebView2 est déjà dans Windows 11 (sinon l'installateur le télécharge).
   Pas de `.msi` : il s'installerait pour toute la machine et laisserait le
   démarrage avec Windows derrière lui à la désinstallation.

### 2.2 « Windows a protégé votre ordinateur » (SmartScreen)

L'installateur n'est pas signé (un certificat de signature de code coûte
plusieurs centaines d'euros par an). SmartScreen prévient donc au premier
lancement d'une nouvelle version :

1. clique **Informations complémentaires** ;
2. vérifie que l'éditeur est « Éditeur inconnu » et le fichier
   `Remy-Bureau_…-setup.exe` (pas un autre nom) ;
3. clique **Exécuter quand même**.

Si le fichier a été téléchargé et que Windows refuse sans bouton : clic
droit › Propriétés › cocher **Débloquer** › OK, puis relancer.
Si le **Contrôle intelligent des applications** (Sécurité Windows › Contrôle
des applications et du navigateur) est **activé**, Windows bloque toute app
non signée sans proposer de passer outre. Le désactiver est un choix lourd
(sur certaines versions de Windows, on ne peut plus le réactiver sans
réinstaller) : dans ce cas, garde Rémy dans le navigateur (même adresse, même
interface) plutôt que de l'affaiblir.

### 2.3 Premier lancement

1. **« Où est ta tour ? »** : tape l'adresse que Tailscale publie, la même que
   sur l'iPhone (forme `ma-tour.mon-tailnet.ts.net:8444` ; le `https://` est
   ajouté seul). **Continuer** vérifie qu'elle répond ; si elle ne répond pas
   (Tailscale coupé sur ce PC, tour éteinte), le message le dit et propose
   « Garder cette adresse quand même ». L'adresse reste sur ce PC
   (`%APPDATA%\com.pingureep.remy.bureau\bureau.json`), jamais ailleurs.
   Sur la tour elle-même, la même adresse marche.
2. **Connexion** : le mot de passe de Rémy, comme dans le navigateur. La
   session reste dans le profil WebView2 de l'app.
3. **Épingler à la barre des tâches** : clic droit sur l'icône de Rémy dans la
   barre des tâches › **Épingler à la barre des tâches** (ou menu Démarrer ›
   Rémy › clic droit › Épingler). Toutes les fenêtres de Rémy portent le même
   identifiant d'app : l'épingle relance bien la même app, même lancée au
   démarrage de Windows.
4. **L'icône près de l'horloge** : Windows la range parfois sous la flèche ^.
   Pour la garder visible : Paramètres › Personnalisation › Barre des tâches ›
   Autres icônes de la barre d'état système › **Rémy** : activé.
5. **Démarrer avec Windows** est allumé d'office (sinon pas de rappels quand
   la fenêtre n'a pas été ouverte) : à l'ouverture de session, Rémy démarre
   **caché**, icône seule ; un clic sur l'icône ouvre la fenêtre. Pour le
   couper : menu de l'icône › « Démarrer avec Windows » (décocher), ou
   Réglages › Ordinateur dans Rémy, ou le Gestionnaire des tâches (l'app
   suit ce que dit Windows).

### 2.4 Au quotidien

| Geste | Effet |
| --- | --- |
| **Ctrl+Alt+Espace** (partout dans Windows) | ouvre la petite fenêtre **Noter**, au-dessus de tout, sur l'écran de la souris ; **Entrée** envoie, **Maj+Entrée** passe à la ligne, **Échap** (ou un clic ailleurs) la referme. Le même raccourci la referme. |
| Clic sur l'icône près de l'horloge | montre la fenêtre, ou la range si elle est déjà devant |
| Clic droit sur l'icône | Ouvrir Rémy · Noter… · Aujourd'hui · Réglages de l'ordinateur · Démarrer avec Windows · Changer l'adresse de la tour · Recharger · Quitter Rémy |
| Fermer la fenêtre (×) | elle se **range près de l'horloge** (les rappels continuent) ; la première fois, une notification le rappelle. Pour quitter : clic droit sur l'icône › **Quitter Rémy**. Réglable (Réglages › Ordinateur : « Fermer = quitter »). |
| Relancer Rémy (épingle, menu Démarrer) alors qu'il tourne | ramène la fenêtre existante (une seule instance) |
| **Ctrl+=** / **Ctrl+-** / **Ctrl+0** | zoom de l'interface |
| **N**, **/**, **Ctrl+K**, **Ctrl+1…5**, **?** | raccourcis du site (noter, chercher, palette de commandes, vues, aide) — ils marchent aussi dans le navigateur |
| Lien vers un autre site | s'ouvre dans ton navigateur par défaut, jamais dans la fenêtre de Rémy |

**Le raccourci Noter se change** dans Réglages › Ordinateur (par exemple
`Ctrl+Maj+N`, `Win+Alt+R` ; les noms français marchent : Maj, Espace, Win).
Il faut au moins Ctrl, Alt ou Win : une lettre seule volerait la frappe dans
toutes les applications. **Ctrl+Alt + une lettre, un chiffre ou une
ponctuation est refusé** : sous Windows, c'est AltGr, et AltGr+0 écrit « @ »,
AltGr+E « € », AltGr+3 « # » sur un clavier français — le raccourci les
volerait partout. Ajoute Maj ou Win (`Ctrl+Alt+Maj+N`), ou prends Espace,
Entrée ou une touche F1 à F12. S'il est déjà pris par une autre application,
Windows le refuse : le message le dit et l'ancien reste actif. Au
démarrage, un raccourci devenu indisponible est signalé par une notification.

**Notifications** : les rappels dus (lus sur la tour au plus une fois par
minute, sans IA) ; le briefing du matin et le bilan du soir si tu les
allumes (Réglages › Ordinateur). Un clic sur la notification ouvre Rémy (à
la vue concernée quand le site la précise). L'assistant de concentration de Windows (Ne pas déranger) peut
les retenir : Paramètres › Système › Notifications › Rémy. Si la session
de la tour a expiré, une notification « Rémy est déconnecté » le dit une
fois par jour : ouvre Rémy et reconnecte-toi (Noter continue de garder tes
notes en attendant).

**La tour ne répond pas** : la fenêtre affiche « La tour ne répond pas »,
l'adresse, **Réessayer** (et un nouvel essai seul toutes les 30 s, ou dès que
le réseau revient) et **Changer l'adresse**. Si la tour répond mais pas Rémy
(erreur 502, le temps qu'il démarre à l'ouverture de session), la fenêtre
dit « Rémy ne répond pas encore » et réessaie seule de la même façon : rien à
faire, sauf si ça dure (relancer alors la tâche « Rémy » sur la tour). Une fois le site chargé une fois,
il sait aussi s'afficher hors ligne. **Noter marche quand même** : la note est
gardée sur ce PC, chiffrée (`notes-en-attente.dat`), et part vers Rémy dès que le site
répond, puis elle est effacée du PC.

### 2.5 Ce que l'app garde sur ce PC

| Où | Quoi |
| --- | --- |
| `%APPDATA%\com.pingureep.remy.bureau\bureau.json` | adresse de la tour, raccourci, démarrage, « fermer = ranger » |
| `%APPDATA%\com.pingureep.remy.bureau\notes-en-attente.dat` | notes tapées hors ligne, **chiffrées par Windows** (DPAPI, ton compte seulement), jusqu'à leur envoi (absent s'il n'y en a pas) |
| `%APPDATA%\com.pingureep.remy.bureau\.window-state.json` | taille et position de la fenêtre |
| `%LOCALAPPDATA%\com.pingureep.remy.bureau\EBWebView` | profil WebView2 : cookie de session de la tour, cache du site, et sa file d'envoi hors ligne (`localStorage`, comme un navigateur) |
| `HKCU\…\CurrentVersion\Run`, valeur « Rémy » | démarrage avec Windows (si allumé) |

Rien d'autre : pas de télémétrie, aucune requête de la coquille elle-même
(seule la page de démarrage sonde l'adresse de la tour).

### 2.6 Mettre à jour

- **L'interface** se met à jour avec la tour (`installer-tour.ps1`) : rien à
  faire sur le PC, c'est le site de la tour qui s'affiche.
- **La coquille** (fenêtre, icône, raccourci, notifications) : télécharger
  le nouvel installateur et le lancer par-dessus ; réglages, adresse et
  session sont gardés. Pas de mise à jour automatique (elle demanderait des
  clés de signature à garder quelque part : pas cette fois).

### 2.7 Désinstaller

Paramètres › Applications › Applications installées › **Rémy** ›
Désinstaller (ou menu Démarrer › Rémy › clic droit › Désinstaller). Le
désinstallateur retire le programme, les raccourcis et le démarrage avec
Windows ; coche « Supprimer les données de l'application » pour effacer
aussi l'adresse, les notes en attente et la session (sinon elles restent
pour une réinstallation). Rien n'est touché sur la tour.

### 2.8 Ce que l'app fait, et ce qu'elle ne fait pas

**Elle fait** : une vraie fenêtre « Rémy » épinglable, qui retient sa taille
et sa position ; l'icône près de l'horloge et son menu ; Noter au clavier
depuis n'importe quelle application ; le démarrage avec Windows (caché) ; les
notifications Windows des rappels (et du briefing / bilan si allumés) ; un
écran clair quand la tour ne répond pas ; des notes gardées hors ligne ; les
liens externes dans le navigateur.

**Elle ne fait pas** :

- rien sans la tour : c'est la tour qui pense, range et répond (hors notes
  gardées hors ligne et pages déjà en cache) ;
- pas de notification quand Rémy ne tourne pas sur ce PC (quitté, ou session
  Windows fermée), ni quand le PC dort ;
- pas de mise à jour automatique de la coquille (2.6) ; non signée (2.2) ;
- aucun accès à tes fichiers, aucun programme lancé, aucune commande système :
  les pages n'ont que les commandes `bureau_*` du contrat (1.4), et seulement
  depuis l'adresse exacte de ta tour (une tour hors `*.ts.net` s'affiche, mais
  sans icône active, notifications ni Noter du site) ;
- Windows 10 : devrait marcher (WebView2 à jour), pas testé ; macOS et Linux :
  non (le code compile sous Linux pour les tests, rien n'est construit ni
  essayé ailleurs que sous Windows).

### 2.9 Développer la coquille

Sur un PC Windows avec Rust (stable), Node 22 et les outils de compilation
C++ de Visual Studio : `cd desktop`, `npm ci`, `npm run dev` (la fenêtre
s'ouvre sur la page de démarrage ; pour une tour de développement, l'adresse
`http://localhost:3000`). Tests : `cd desktop/src-tauri`, `cargo test`
(adresse, origine, règles d'accès, raccourci, réglages, notes, notifications ;
ils tournent aussi sous Linux avec les bibliothèques WebKitGTK). Essai de
fumée du vrai binaire contre une fausse tour, sous Linux (Xvfb) :
`node desktop/essais/fumee.mjs desktop/src-tauri/target/debug/remy-bureau`
(tour en 502 puis page bloquée : retour sur la page embarquée et nouvel
essai seul ; sonde, départ sur le site, commandes permises et refusées, notes
de secours, Noter, navigation vers une autre origine ; ~1 min 30) ; pages
embarquées et script de contrôle dans Chromium avec un faux pont :
`node desktop/essais/pages.cjs` (Playwright). Icônes :
`npm run icones` (depuis `src-tauri/icons/icon.png`). L'installateur se
construit en CI (`.github/workflows/bureau-windows.yml`) à chaque envoi qui
touche `desktop/` (ou à la main, sur n'importe quelle branche, pour
l'artefact) ; lancé à la main **depuis `main`** avec « publier », il crée la
Release `bureau-vX.Y.Z` — monter alors la version dans `tauri.conf.json`,
`Cargo.toml` et `package.json` (la CI refuse un tag existant, et toute
publication depuis une autre branche : le numéro serait pris par du code pas
encore fusionné).
