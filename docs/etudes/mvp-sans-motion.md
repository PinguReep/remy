# MVP « tout vit dans Rémy » : tâches, plan et agenda sans Motion ni Google

Cahier des charges du 12/11/2026 pour la session qui construira (aucun code ici). Code lu : commit `4c75da4`. Cité
`fichier:ligne` = lu ; SUPPOSÉ = pas vérifié. À lire avant : `CLAUDE.md`, `docs/etudes/planificateur-local.md`.

## 1. En dix lignes

1. On construit trois choses : tes tâches rangées dans Rémy, un plan que Rémy calcule et explique, un agenda à toi.
2. Rémy propose, tu confirmes : rien ne s'ajoute, ne se coche ni ne se déplace sans ton « Oui » ou ton geste.
3. Chaque tâche placée a sa phrase : pourquoi ici, pourquoi avant celle-là.
4. Le plan se refait à chaque changement, jamais en boucle, sans tout rebattre : ce qui n'a pas de raison de bouger reste.
5. Le passage se fait par un réglage « Mes tâches : Motion / Rémy », réversible à tout moment.
6. Tes tâches et tes rendez-vous actuels sont repris en lisant seulement : aperçu d'abord, puis ton geste.
   Rien n'est supprimé ni modifié chez Motion ou Google.
7. On ne construit pas : travail en équipe, liens de réservation, pauses et trajets automatiques, Outlook, iCloud.
8. On pourra couper Motion après trois semaines en mode « Rémy » sans échéance ferme ratée à cause du plan,
   sans rouvrir Motion pour planifier, et sans tâche perdue.

## 2. Les situations que le MVP doit rendre possibles (sans Motion ni Google)

Semaine fictive : lundi 16 novembre 2026, horaires 9 h-18 h ; Sam, sa boutique de bougies (« Boutique »), et le
projet « Voyage à Porto » avec Léa.

1. **Noter une tâche et la voir placée.** Sam dicte « préparer les étiquettes de Noël pour la Boutique, deux heures,
   avant vendredi ». Rémy propose 2 h, échéance vendredi 18 h, projet Boutique ; oui. Elle apparaît mardi 9 h-11 h :
   « Due vendredi ; rien de plus pressé avant ».
2. **Prendre du retard.** À 11 h, « Relire le devis de Léa » (prévue 9 h-10 h) n'est pas cochée : remise au premier
   créneau libre (« Pas faite à 9 h : remise au premier créneau libre ») ; les autres gardent leur place.
3. **Un rendez-vous qui déplace ce qu'il faut.** Sam ajoute « Dentiste » jeudi 14 h-15 h dans l'agenda de Rémy. La
   tâche de jeudi 14 h part au premier créneau libre (« Déplacée de jeu. 14 h : rendez-vous ajouté (Dentiste) ») ;
   rien de ce qui est placé avant ne bouge.
4. **Une tâche bloquée.** « Réserver l'hôtel » (Voyage à Porto) attend « Choisir les dates avec Léa » : jamais placée
   avant, « Après “Choisir les dates avec Léa” : elle l'attend ».
5. **Une tâche qui revient.** « Faire la compta de la Boutique », 1 h, chaque lundi : ratée lundi, elle passe mardi,
   et revient le lundi suivant, une seule fois.
6. **Placer soi-même, ou « pas maintenant ».** Sam pose « Appeler la banque » demain 9 h : Rémy ne la bouge plus
   (« Tu l'as placée ici »). « Pas maintenant » sur une autre la repousse après le créneau en cours.
7. **Une échéance ferme qui ne tient pas.** « Envoyer le dossier à la banque », 4 h, ferme mercredi 12 h, 3 h libres :
   Rémy ne déborde pas seul, « Il manque 1 h : travailler mardi soir, ou repousser “Trier les factures” ? ».
8. **Finir en avance.** Coche à 10 h 20 d'une tâche prévue jusqu'à 11 h : rien ne saute, « Et maintenant ? » propose
   la suivante (`public/app/vues/et-maintenant.js`).

## 3. Ce qui existe déjà (vérifié), et ce qui manque

### 3.1 Réutilisé tel quel

| Fichier | Ce qu'il fait (vérifié) | Dans le MVP |
|---|---|---|
| `lib/planificateur.js` | Pur. `planifier()` `:384` ; règles `REGLES` `:53` ; `OPTIONS` `:64` (14 j, grille 5 min, morceaux ≥ 30 min au-delà d'1 h, urgence 48 h) ; temps libre avec changements d'heure `tempsLibre` `:162` ; garde des échéances fermes `tenables` `:226` ; stabilité R8 `ancienneValable` `:553` ; raisons par gabarit `:619-678` ; `comparer()` `:754`. 300 tâches : 47 ms mesurées (`test/planificateur.test.mjs:409`). | Devient le vrai planificateur ; étendu (§4.3), pas réécrit. |
| `lib/planning-remy.js` | `GET /api/planning-remy` calculé à l'ouverture depuis le cache Motion `:120` ; `creneauxPris` ignore annulés, « disponible », journées entières `:98` ; `planning-remy.json` (plan précédent, jugements) `:45,168` ; `compteJugements` `:73`. | Outil de comparaison tant que la source est Motion ; ses jugements prouvent avant la bascule. |
| `lib/carnet.js` | États en attente / commencée / faite par `tache_id` (`etatsTaches` `:388`, `marquerTache` `:413`) ; « bloquée par » entre tâches et nœuds `dossier:<id>`, `motion:<id>` (`blocages` `:460`, `estNoeud` `:484`, `contexteNoeuds` `:494`) ; `annoterTaches` `:870` ; dossiers, rattachements, catégories `:992,1059,1146`. | Inchangé : les identifiants restent compatibles (§4.1). |
| `lib/dashboard.js` | `normTache` lit la forme Motion (`name`, `dueDate`, `scheduledStart/End`, `duration`, `priority`, `project`) `:46` ; `normEvenement` la forme Google (`start.dateTime/date`, `summary`, `attendees`, `organizer`) `:103` ; `journee()` `:149`. | Inchangé : on lui donne des objets de même forme. |
| `lib/semaine.js`, `rituel.js`, `conseil.js`, `a-trancher.js`, `regles.js`, `proposition-priorites.js` | Semaine et charge (`semaine` `:93`), briefing, bilan, « menacées » (`rituel.js:85,186,258`), conseil local (`conseil.js:44,251`), « À trancher », règles, proposition de priorités : tous lisent la liste brute Motion et l'agenda brut Google. | Inchangés : alimentés par `lib/sources.js` (§4.6). |
| `lib/ecriture.js` | Chaîne d'écriture unique : idempotence, journal ouvert avant l'effet, une écriture à la fois par système, annulation (`appliquer` `:275`, sources `motion|agenda` `:276`, `annuler` `:428`). | Seul l'`executer` change selon la source. |
| `lib/handlers.js` | `applyMotion` `:1243`, `applyAgenda` `:1942` ; `lireJourneeDuJour` `:593` ; `getDashboard` `:612` (`systeme` `:651-656`) ; `getSemaine` `:866` ; `getProjets` `:1231` ; `putDossier` crée un projet Motion `:1180`. | Points de branchement. |
| `lib/priorites.js` | Priorités versionnées ; seules les `classee` comptent pour R5 (`planning-remy.js:111`), reliées par `projetMotion`. | Inchangé. |
| `lib/priorite.js`, `lib/jobs.js` | Classement demande / attendu / fond (`TRAVAUX` `:42`) ; circuits coupables (`jobs.js:29`, `planificateur` `:39`). | Une entrée « plan » à déclarer. |
| `lib/analyses.js` | L'analyse d'une capture distingue rendez-vous et tâche `:99-103`. | « Noter » propose l'un ou l'autre, comme aujourd'hui. |
| `lib/providers.js` | `motion_proposer` `:155`, `motion_lister` `:197`, `agenda_proposer` `:213` ; le modèle propose, rien ne s'écrit sans geste `:704-756` ; outils masqués sans clé Motion `:357-368`. | Mêmes outils, renommés pour le modèle (§4.5). |
| `test/outils/faux-motion.mjs`, `ios-native/ci/faux-services.mjs` | Faux Motion à état (quota, pages, pannes) ; faux Google Calendar `:9995`. | Tests d'import, captures. |
| iPhone | `sait()` des capacités (`RemyCore/.../Models.swift:1207`) ; écritures en `source: "motion"` (`Modeles.swift:743,894,932,982`) ; notifications locales, 64 au plus dont 54 pour les rappels (`Remy/App/Notifications.swift:51-89`). | Un iPhone pas à jour continue de marcher (§4.6). |

### 3.2 Ce qui manque

- Un lieu où les tâches vivent (seule la copie de Motion est gardée, `motion.js:36`, table `instantanes`), des
  projets à Rémy, un plan gardé et daté, un agenda à Rémy.
- Le planificateur ne sait pas : épinglée ; « pas avant » à l'heure près (date seule, `planificateur.js:301`) ;
  commencée autrement que par le calcul d'avant (`:550-551`) ; pourquoi une tâche a bougé ; récurrences ; déborder
  (`planning-remy.js:36-41`). Ses phrases disent « Motion » (`planificateur.js:641,648,660`).
- Les morceaux ne sont lus nulle part ailleurs : `normTache` ne prend que `scheduledStart/End` (`dashboard.js:53-54`).
- « Des tâches existent » se teste par la clé Motion : 23 appels à `motionEnabled()`/`motionWriteEnabled()` hors de
  `motion.js` (dont `handlers.js:642,652,1233,1247,2507`, `providers.js:364-368`, `a-trancher.js:214,303`,
  `regles.js:172`, `chat.js:936`, `ecriture.js:456`). Sans clé, tout s'éteint.

## 4. L'architecture cible (la plus petite qui tient)

Principe : **deux adaptateurs qui parlent la langue d'avant.** Une tâche de Rémy sort sous la forme d'une tâche
Motion, un rendez-vous de Rémy sous la forme d'un événement Google. Journée, semaine, rituel, conseil, carnet et
apps ne changent pas. Les routes `/api/motion/*` et `/api/google/*` restent les canaux d'écriture (noms
historiques), aiguillés par le réglage.

### 4.1 Les tâches vivent dans Rémy

Migration SQLite **suivante libre au moment de fusionner** : la 12 est la dernière sur `main` (`lib/db.js:366`), la
13 est prise par la branche `claude/arbre-memoire`. En avant seulement.

- `taches` : `id` PK · `titre` · `note` · `duree_min` (NULL = sans durée) · `rappel` (0/1, l'ancien `REMINDER`) ·
  `echeance` (ms) · `echeance_type` (`ferme|souple|aucune`) · `pas_avant` (AAAA-MM-JJ) · `pas_avant_a` (ms,
  « pas maintenant ») · `priorite` (`ASAP|HIGH|MEDIUM|LOW`) · `projet` · `epingle_debut`, `epingle_fin` ·
  `recurrence_id`, `occurrence` · `etat` (`a_faire|faite|abandonnee`) · `faite_a` · `origine`
  (`remy|chat|capture|motion`) · `import_id` · `cree_a`, `maj_a` · `supprimee` (douce, comme le carnet).
- `projets` (`id`, `nom`, `statut`, `origine`, `cree_a`, `maj_a`, `supprime`) ; `plans` (`id`, `calcule_a`,
  `declencheur` en mots, `plan` JSON = sortie de `planifier`, 50 derniers gardés) ; `imports` (`id`, `genre`
  `motion|google`, `a`, `compte`, `etat` `fait|defait`). En attente, commencée, bloquée par, catégorie et dossier
  restent dans les tables du carnet, par `tache_id`.
- **Identifiants.** Une tâche reprise de Motion GARDE son identifiant : états, dépendances, rattachements,
  catégories, jugements et propositions restent justes sans rien réécrire. Une tâche née dans Rémy :
  `remy-<uuid>` (accepté par `carnet.js:33`, ne commence ni par `motion:` ni par `dossier:`). Un projet repris
  garde son id et son nœud **`motion:<id>`** ; un projet créé dans Rémy : id `remy-<uuid>`, nœud
  `motion:remy-<uuid>`. Le préfixe `motion:` devient le nom historique de « projet de premier niveau » : aucune
  réécriture de masse ; l'arbre, le carnet, l'iPhone et `projetMotion` des priorités suivent. À noter au journal.
- **Adaptateur** `versMotion(t, placement)` (`lib/taches.js`) : `{ id, name, description, dueDate, deadlineType
  (HARD|SOFT|NONE), startOn, duration (min | "REMINDER"), priority, project: { id, name }, status: { name,
  isResolvedStatus }, completed, scheduledStart, scheduledEnd, chunks: [{ scheduledStart, scheduledEnd }],
  schedulingIssue, pourquoi: { regle, texte, details } }`. Le champ s'appelle **`pourquoi`, pas `raison`** : `raison`
  est pris par « en attente » (`carnet.js:908`). Une tâche en morceaux sort avec `scheduledStart/End` = son morceau
  en cours ou à venir, et apparaît au plus une fois par jour dans les listes servies aux apps (une ligne = un
  identifiant : les listes SwiftUI en dépendent) ; la charge de `semaine.js` compte tous les morceaux.
- **Écrire** : `appliquerActions(actions)`, mêmes verbes et résultats qu'`applyActions` (`motion.js:752`) : anti-doublon
  par nom, garde-fou du nom lu, mêmes champs de résultat, plus `echeance_type` et `pas_avant` (Motion ne recevait que `SOFT`, `motion.js:796`) ; `annulerResultat()` comme `motion.js:936`.
- **Reprendre Motion** (`lib/bascule.js`) : `GET /api/bascule/motion` = aperçu (tâches ouvertes, projets, horaires,
  ce qui ne sera pas repris : terminées, récurrentes reconnues, liste tronquée) ; `POST /api/bascule/motion` = reprise
  sur geste (`idCommande`), **idempotente par identifiant** (relancée, elle ne prend que les nouvelles) ;
  `POST /api/bascule/motion/defaire` = retire (douce) ce qui vient de l'import et n'a pas été touché, liste le reste.
  Chez Motion : uniquement des `GET`, toutes les pages dans le quota de 12/min (`motion.js:21,361`) ; refus si la
  liste reste tronquée. Les horaires Motion (`horairesConnus` `:613`) sont PROPOSÉS comme horaires de Rémy.

### 4.2 L'agenda intégré

- Table `evenements` : `id` (`remy-<uuid>` ; repris : `google-<id>`) · `titre` · `note` · `lieu` · `debut`, `fin` (ms) ·
  `journee` · `jour_debut`, `jour_fin` (fin EXCLUSIVE, comme Google, `dashboard.js:118-120`) · `tz` (IANA) · `occupe`
  (1 bloque le plan, 0 « disponible ») · `avec` (noms) · `rappels` (`[{ minutes }]`, 10 min par défaut, aucun pour
  une journée entière) · `recurrence` (lot 4) · `exceptions` · `origine` · `import_id` · `cree_a`, `maj_a`, `supprime`.
- **Adaptateur** `versGoogle(e)` : `{ id, summary, description, location, start: { dateTime | date }, end, status,
  transparency, attendees: [{ displayName, self: false }] si avec }` : « avec d'autres » (`dashboard.js:124-125`)
  garde son sens (pas modifiable d'un geste).
- `lib/agenda-remy.js` : `periode(debut, fin)` (rôle d'`agendaJournee`, `google.js:258`), `instantane()` (comme
  `agendaSnapshot` `:212`), `appliquer(actions)` (`creer|modifier|supprimer`, résultats d'`appliquerAgenda` `:343`,
  doublon = même titre à la minute `:319`), `annulerResultat()`.
- **Fuseaux** : un rendez-vous est un instant ; sa récurrence se déroule à l'heure murale de son `tz` (9 h reste 9 h
  après le changement d'heure). Réutiliser `debutJour/finJour` (`dashboard.js:17,32`) et l'heure locale du
  planificateur (`aLHeure`, `planificateur.js:112`, à exporter).
- **Journée entière** : ne bloque rien (comme `planning-remy.js:102`), sauf `occupe = 1` (« je ne travaille pas »).
  **Rappels** : sur Windows, le site appelle `bureau_notifier` (`docs/bureau.md:167`) ; sur l'iPhone (lot 5), en
  notifications locales, budget de 64 partagé avec les rappels (`Notifications.swift:51,82`). Aucun service nouveau.
- **« Et mes rendez-vous actuels ? »** (a) Reprise par la connexion Google EXISTANTE (`google.js:25`) : aperçu des
  12 mois à venir, puis geste ; ni tiers nouveau ni fichier. Récurrences reprises avec leur règle en lisant sans
  `singleEvents` (SUPPOSÉ : champ `recurrence` de l'API ; aujourd'hui `singleEvents=true`, `google.js:221,267`) ; hors
  du sous-ensemble géré, en occurrences, et c'est dit. (b) Un `.ics` exporté une fois : lecteur ICS à écrire
  (`VTIMEZONE`, `EXDATE`, `RECURRENCE-ID`) ou bibliothèque de plus. (c) Rien : tout ressaisir. **Recommandation : (a),
  puis Google relu en lecture seule pendant la transition** (occupé, rien n'y est écrit), jusqu'à la coupure.
- **« Voir l'agenda de Rémy ailleurs »** : un flux `.ics` en lecture seule servi par la tour sur le réseau privé
  (`GET /api/agenda.ics?cle=…` : jeton dans l'adresse, l'app Calendrier n'envoie pas d'en-tête), suivi par l'app
  Calendrier de l'iPhone (montre, widgets). SUPPOSÉ : relu par iOS tant que le VPN du réseau privé est actif, à son
  rythme. Environ 150 lignes et un jeton à révoquer. **Pas dans le MVP** (lot 6) : les apps Rémy montrent le plan.

### 4.3 Le planificateur passe de « fantôme » à « vrai »

`lib/plan.js` : `recalculer(declencheur)`, `planCourant()` ; routes `GET /api/plan`, `POST /api/plan/recalculer`.
- **Quand** : à la fin de chaque écriture réussie qui change une entrée (tâche, rendez-vous, état du carnet,
  bloquée par, priorités confirmées, horaires), dans la même requête (≈ 50 ms pour 300 tâches), une fois même si
  plusieurs arrivent ensemble ; et à la lecture si le plan a plus de 10 min ou date d'un autre jour. **Aucun
  minuteur, aucune boucle.** À déclarer dans `TRAVAUX` (`priorite.js:42`) : `plan`, catégorie `demande`, sans modèle.
- **Entrées** : tâches de Rémy (`normaliser` `planificateur.js:294`) ; occupé = agenda de Rémy + Google en lecture
  pendant la transition ; priorités confirmées ; horaires du réglage ; plan précédent (R8).
- **Ce qu'il fige** : le créneau en cours (déjà, `:553-563`) et une tâche « commencée » (`commencee_a` du carnet),
  de son début à début + durée ; une tâche épinglée, nouvelle règle **R0 « Tu l'as placée ici »** : son créneau
  devient occupé, et si un rendez-vous tombe dessus, Rémy le DIT sans la bouger ; `pas_avant_a`, comme R2 à la minute.
- **Ce qu'il explique en plus** : une tâche qui a bougé dit d'où elle vient et le `declencheur` (« Déplacée de jeu.
  14 h : rendez-vous ajouté (Dentiste) ») ; plus de « dans Motion » en mode Rémy (`:641,648,660`). Le modèle local ne
  calcule rien et n'invente aucune raison (étude, B5).
- **Corriger** : `PUT /api/taches/:id/place` `{ epingle: { debut, fin } | null }` ou `{ pasMaintenant: true | ms | null }`
  (`true` = après le créneau en cours) ; « Déplacer » = épingler ailleurs ; tout s'annule. **Ne rentre pas** : ce
  qui manque et deux choix (déborder un soir précis, repousser une tâche nommée), jamais appliqués seuls.
- **Mesurer** : avant la bascule, les jugements du fantôme (`compteJugements`) ; après, par semaine : corrections
  (épingler, pas maintenant, déplacer), échéances fermes ratées, non placées. Dans Réglages › Diagnostic.

### 4.4 Les écrans

- **Aujourd'hui** (`vues/aujourdhui.js`) : la ligne `pourquoi` sur chaque tâche et sur « Maintenant » ; bandeau
  « 2 tâches ne rentrent pas ». **Semaine** (`vues/semaine.js`) : les morceaux ; « Motion » devient « Rémy ».
- **Gérer** (`vues/gerer.js`) : « Pas maintenant », « Épingler ici », « Déplacer… » ; « Décaler » change toujours
  l'échéance (`:433-440`). **Planning de Rémy** (`vues/planning-remy.js`) : « Le plan de Rémy », sans colonne Motion,
  « Refaire le plan », non placées. **Prochaines heures** et **Projets** (autre session, §6) : marchent par les
  adaptateurs ; leurs mots « d'après Motion » à changer après leur fusion. **Disparaît** : file du quota Motion,
  bandeaux « Motion indisponible ».

Écran nouveau 1 — Réglages › « Tes tâches et ton agenda » :
```
Tes tâches          [ Motion | Rémy ]        ← « Rémy » grisé tant que rien n'est repris
  Rémy a lu Motion il y a 2 min, sans rien y changer :
  312 tâches ouvertes · 14 projets · horaires lun-ven 9 h-18 h
  Pas reprises : 4 qui ressemblent à des récurrentes (à recréer)
  [ Reprendre dans Rémy ]            Motion reste tel quel
Ton agenda          [ Google | Rémy ]
  41 rendez-vous à venir, dont 3 qui reviennent    ☑ Relire Google pendant la transition
  [ Reprendre dans Rémy ]            Revenir en arrière : un geste, rien n'est effacé.
```
Écran nouveau 2 — une tâche dans « Gérer » :
```
Préparer les étiquettes de Noël                  Boutique · 2 h
mar. 17, 09:00–11:00
Pourquoi ici : due vendredi ; rien de plus pressé avant.   ▸ gardée à sa place depuis hier
[ Terminer ] [ Commencer ] [ Pas maintenant ] [ Épingler ici ] [ Déplacer… ]
```
Écran nouveau 3 — un rendez-vous proposé après une dictée :
```
Rémy propose un rendez-vous
Dentiste · jeu. 19 nov., 14:00–15:00 · rappel 10 min avant
Ça déplace : « Répéter le morceau » → jeu. 15:00 (et rien d'autre)
[ Oui, ajoute-le ]   [ Ajuster ]   [ Non merci ]
```

### 4.5 Le chat

- En mode Rémy, le modèle voit `taches_proposer` et `taches_lister` (schéma de `motion_proposer` `providers.js:155`,
  sans les mots Motion, plus `echeance_type` et `pas_avant`). La carte stockée garde `source: "motion"` : cartes,
  ajustement, périmées, parties et iPhone marchent tels quels ; le traitement (`:704`) accepte les deux noms.
  `agenda_proposer` (`:213`) parle de l'agenda de Rémy.
- Contexte : l'instantané des tâches et de l'agenda de Rémy (`chat.js:727-735`) ; la consigne (`chat.js:451,454`) perd
  « Motion ne connaît pas ce lien ». Inchangé : **rien ne se crée sans le « Oui »** (`handlers.js:1243-1247`).

### 4.6 La bascule

- `lib/sources.js`, la seule porte : `taches({ frais })`, `tachesConnues()`, `tachesActives()`, `projets()`,
  `horaires()`, `agenda(debut, fin)`, `agendaActif()`, `instantanes()`. Elle remplace `tachesMotion`, `agendaJournee`
  et `motionEnabled()` chez les lecteurs du §3.2.
- Réglages (`store.putReglages`, `store.js:575`) : `sourceTaches` (`motion` par défaut | `remy`), `sourceAgenda`
  (`google` | `remy`), `horaires`. Les routes d'écriture aiguillent l'`executer` ; chaque résultat porte
  `systeme: "remy"` pour que l'annulation (`ecriture.js:456-458`) vise le bon système, même après un changement de réglage.
- `GET /api/dashboard` : `systeme.taches` et `systeme.agendaSource` en plus ; `systeme.motion` et `systeme.agenda`
  restent `true` en mode Rémy (les anciennes apps y attachent leurs gestes : `AgendaVues.swift:24`,
  `CaptureView.swift:459`, `gerer.js:641`).
- **Capacités** (`version.js:21`) : `taches-remy-v1` (lot 1), `plan-gestes-v1` (2), `agenda-remy-v1` (3),
  `recurrences-v1` (4). iPhone à jour, tour en retard : rien de nouveau ne s'affiche. Tour à jour, iPhone en retard :
  tout se lit et s'écrit (mêmes formes, mêmes routes) ; seuls des mots disent encore « Motion ».
- **Piège à fermer** : chaque lecture complète de Motion lève les liens d'une tâche absente de la liste
  (`handlers.js:845-848`, `carnet.js:779-780`). Mode Rémy : plus de réconciliation sur une lecture de Motion ; mode
  Motion : les identifiants `remy-` en sont exclus.
- **Revenir en arrière** : le réglage repasse à Motion, que rien n'a touché ; les tâches de Rémy restent en base ; une
  carte propose d'envoyer à Motion, par la chaîne d'écriture, celles nées dans Rémy depuis la bascule (ton « Oui »).

## 5. Les lots (tour et site d'abord, iPhone ensuite)

**Lot 1 — Les tâches dans Rémy et le vrai plan (tour + site). À lancer en premier. Gros.**
Apporte les situations 1, 2, 4 et 8 sans Motion, la reprise avec aperçu, la bascule réversible ; l'agenda reste Google.
- Crée `lib/taches.js`, `plan.js`, `sources.js`, `bascule.js`, la migration ; tests `test/taches|plan|bascule|site-bascule.test.mjs`.
  Touche `lib/handlers.js` (lecteurs, `applyMotion`, `getProjets`, `putDossier`), `routes.js`, `db.js`, `version.js`,
  `priorite.js` (une ligne), `providers.js`, `chat.js`, `planificateur.js` (mots), `semaine.js` (morceaux) ;
  `public/app/vues/reglages.js`, `aujourdhui.js`, `semaine.js`, `planning-remy.js`, `public/app/nouveautes.js`.
- Réussi si :
  1. `npm test` vert en entier, nouveaux fichiers compris.
  2. Faux Motion (312 tâches, 4 pages) : `GET /api/bascule/motion` rend les bons comptes et `m.requetes` ne contient
     QUE des `GET` ; deux `POST /api/bascule/motion` ne reprennent qu'une fois chaque tâche.
  3. Source `remy`, faux Motion arrêté : `GET /api/dashboard` rend des tâches placées, chacune avec `pourquoi.texte`
     non vide, `systeme.motion === true`, `systeme.taches === "remy"`.
  4. `POST /api/motion/apply` « terminer » : aucune requête au faux Motion, tâche faite, `calcule_a` plus récent ;
     `/api/motion/undo` la rouvre ; deux `GET /api/plan` sans changement rendent le même `calcule_a`.
  5. Retour à `motion` : le faux Motion reçoit `GET /tasks` ; `SELECT COUNT(*) FROM dependances_taches WHERE levee_a
     IS NULL` est le même avant et après l'aller-retour.
  6. Captures Playwright 430×932 et 1440×900 (Réglages › Tes tâches, Aujourd'hui, Semaine), regardées.
- Ne fait pas : l'agenda de Rémy, épingler, les récurrences, l'iPhone (qui marche par compatibilité).

**Lot 2 — Corriger le plan (tour + site). Moyen.** Situations 2, 6, 7 : R0, `pas_avant_a`, « déplacée parce que »,
« commencée » figée, non placées avec deux choix. Touche `planificateur.js`, `plan.js`, `PUT /api/taches/:id/place`,
`gerer.js`. Réussi si (`test/plan-gestes.test.mjs`) : une épinglée ne bouge pas quand un rendez-vous la recouvre, et le conflit est dit ;
« pas maintenant » ne bouge que la tâche visée et ce qui était placé après elle ; chaque tâche déplacée cite le
déclencheur ; captures de « Gérer ». Ne fait pas : le débordement automatique.

**Lot 3 — L'agenda de Rémy (tour + site). Gros.** Situation 3 : `evenements`, `lib/agenda-remy.js`, reprise depuis
Google (aperçu, geste, défaire), Google relu pendant la transition, `sourceAgenda`, `/api/google/apply` aiguillé,
rappels sur Windows, `agenda_proposer` vers Rémy. Réussi si (`test/agenda-remy.test.mjs`) : un rendez-vous ajouté jeudi 14 h ne bouge rien
avant ; un rendez-vous de 9 h le 24 octobre et le 31 octobre reste à 9 h à Paris, avec `TZ=UTC` comme `TZ=Asia/Tokyo` ;
une journée entière du 3 au 5 inclus se voit ces trois jours, pas le 6 ; la reprise ne fait que des `GET` au faux
Google ; captures. Ne fait pas : récurrences, invitations.

**Lot 4 — Ce qui revient (tour + site). Moyen.** Situation 5 : `recurrences`, sous-ensemble RRULE écrit à la main
(`FREQ=DAILY|WEEKLY|MONTHLY`, `INTERVAL`, `BYDAY`, `UNTIL|COUNT`) ; une vraie tâche par occurrence dans l'horizon ;
ratée ⇒ reprogrammée, sauf quotidienne ; rendez-vous récurrents déroulés à la lecture, exceptions. Réussi si (`test/recurrences.test.mjs`) :
52 lundis sur un an simulé, chacun une seule fois après 10 recalculs ; ratée lundi ⇒ mardi, puis le lundi suivant.

**Lot 5 — iPhone. Moyen.** Ligne « pourquoi », Pas maintenant / Épingler, rendez-vous de Rémy (proposés par la
capture ou le chat, modifier, supprimer), rappels en notifications locales, entrée de `RemyCore/Nouveautes.swift`.
Réussi si : `swift test` de `RemyCore` vert, contrôles automatiques verts, build TestFlight envoyé.

**Lot 6 — Optionnel, après la coupure.** Flux `.ics` ; « Couper Motion » (`motion.js` en archive) ; « Couper Google ».

## 5 bis. Règles à ajuster d'après les essais (à compléter sans réécrire le reste)

| Question ouverte | Règle de Rémy aujourd'hui | Où la changer |
|---|---|---|
| Une échéance souple proche bat-elle une priorité haute lointaine ? À partir de quel écart ? | Sous 48 h : avant tout sauf ASAP ; au-delà : priorités confirmées, puis échéance | `OPTIONS.urgenceH` `planificateur.js:69`, groupes `:521-528` |
| ASAP contre l'échéance ferme d'une autre tâche : qui gagne ? | La ferme qui ne tiendrait plus passe devant | `:603-612` |
| Morceau minimal, seuil de découpe ? | 30 min ; découpe au-delà d'1 h | `OPTIONS` `:67-68` |
| Une tâche en retard : tout de suite, ou après ce qui est prévu aujourd'hui ? | Placée dans l'ordre des règles, avant les priorités ; sa place passée ne compte plus | `:523`, `:558`, `:562` |
| Une tâche commencée qui dépasse son créneau ? | Gardée « en cours » d'après le calcul d'avant | `:553-563` |
| Finir en avance : les suivantes avancent-elles ? | Non (R8) ; « Et maintenant ? » propose la suivante | `:26-27` |
| Échéance ferme hors horaires : de combien, quand ? | Ne déborde pas, le dit | `:588-590` |
| Combien de tâches bougent quand on ajoute un rendez-vous ? | Rien avant lui ; au plus 3, de sa durée au plus, sur le jeu de démo | `test/planificateur.test.mjs:331-348` |
| « Pas avant » : minuit, ou début des horaires ? | Minuit local | `:368`, `:473` |
| Sans échéance ni priorité : planifiée ? | Oui, en dernier (Motion non, étude [2]) | groupe 4 `:526` |
| Récurrente ratée : quand revient-elle ? Comment la reconnaître dans `GET /tasks` ? | Lot 4 : prochain créneau, sauf quotidienne (étude [8]) | lot 4 |
| Pauses entre tâches ? | Aucune | `tempsLibre` `:162` |
| Horaires « travail » et « perso » distincts ? | Un seul horaire | réglage `horaires` |

## 6. Les règles du dépôt, et les zones des autres sessions

- **Dépôt public** : rien de personnel (prénom réel, adresse de la tour ou du réseau) dans le code, les tests, les
  captures, les PR ; « Sam » dans les tests, `${PRENOM}` dans les consignes aux modèles.
- **Definition of Done** : retour visible à chaque geste (chargement, succès, erreur et quoi faire) ; états vides et
  pannes (base illisible, tour injoignable, réponse non JSON) ; au pouce (≥ 44 px, safe-areas, 430×932) ; appel IA
  journalisé avec un `kind` et coupable (le plan n'en fait aucun) ; aucun tiers nouveau sans accord ; preuve exécutée
  (faux services, puis sonde de prod, chemins `/api/x/y` compris) ; un tutoriel dans les Nouveautés.
- **Capacités** dans `CAPACITES`, clé absente = comportement d'avant. **Migrations** en avant, numéro libre à la fusion.
- **Tests** indépendants de la plateforme (`process.env.TZ` posé, `tz` en paramètre, aucune heure réelle) ; `npm test`
  refuse tout vrai Motion ou Google (`test/test.env`). **Swift** compilé seulement par les contrôles automatiques.
- **Travail de fond** interruptible et classé (`lib/priorite.js`) : une demande passe toujours devant.
- **Parler à l'utilisateur** : une décision (question fermée, recommandation), une action à faire, « c'est utilisable »
  (une ligne) ou un problème ; le reste dans `docs/journal-technique.md`. `git merge origin/main` avant chaque PR.
- **Zones occupées — ne pas modifier, s'y brancher après leur fusion** : l'arbre des projets et sa vue verrouillée
  (`lib/arbre.js`, `lib/arbre-routes.js`, `lib/verrou.js`, `public/app/vues/projets.js` ; `arbre-routes.js` lit
  `projetsMotion` : à passer par `sources.projets()` avec eux) ; « Prochaines heures » (`public/app/vues/heures.js`,
  `public/app/analyse/heures.js`, et sur leur branche `lib/semaine.js`, `lib/motion.js`) ; la porte pour outils de
  code (`lib/passerelle.js`, qui touche aussi `priorite.js`, `jobs.js`, `store.js`) ; les priorités sur iPhone
  (`RemyCore/CeQuiCompte.swift`, `Cerveau.swift`, `Modeles.swift`, `CerveauVues.swift`). Fichiers partagés à
  toucher au plus court : `handlers.js`, `routes.js`, `version.js`, `db.js`, `priorite.js`, `atelier.css`.

## 7. Les risques, et ce qu'on perd en quittant Motion et Google

- **Les applis** : plus d'appli Motion ; plus de rendez-vous dans l'app Calendrier, sur la montre ou par Siri, sauf
  si on fait plus tard le flux de lecture (question 4).
- **Tout dépend de la tour.** Éteinte ou injoignable : l'iPhone montre la dernière copie, mais le plan ne se refait
  pas et la plupart des gestes attendent. Motion, lui, tournait en permanence.
- **Les invitations** : une invitation reçue par e-mail n'arrive plus seule dans ton agenda (il faudra la donner à
  Rémy). Personne ne voit plus ta disponibilité dans Google ; un agenda partagé (famille) n'est plus visible.
- **Les liens de réservation**, le travail à plusieurs : rien ne les remplace. **Déborder** pour une échéance ferme :
  Motion le faisait seul, Rémy te le propose. **Reste à prouver** : que le plan tienne aussi bien sur de vraies semaines.
- **Tes données** : dans la base de la tour, sauvegardée chiffrée (`lib/sauvegarde.js`) ; la base elle-même ne l'est
  pas, comme ton carnet et la copie de Motion aujourd'hui, ni le disque (`docs/journal-technique.md:1487`).
- **La double saisie** : une tâche ajoutée par habitude dans Motion n'apparaît pas dans Rémy ; l'aperçu de reprise,
  rouvert, dit « 2 nouvelles chez Motion » et les reprend d'un geste.

## 8. Les décisions qui te reviennent

1. **Tes rendez-vous actuels** : Rémy les reprend depuis ta connexion Google actuelle (aperçu, puis ton geste), et
   relit Google sans y écrire jusqu'à ce que tu coupes ? *Recommandation : oui.*
2. **Motion pendant l'essai** : on n'écrit rien chez Motion (il continue de planifier sa copie, que tu n'ouvres
   plus), plutôt que de couper sa planification automatique ? *Recommandation : ne rien écrire.*
3. **Une échéance ferme qui ne tient pas** : Rémy te propose de déborder un soir précis ou de repousser une autre
   tâche, sans jamais le faire seul ? *Recommandation : oui, proposer seulement.*
4. **L'agenda de Rémy dans l'app Calendrier de l'iPhone** : plus tard, après la coupure, plutôt que dans ce premier
   chantier ? *Recommandation : plus tard.*
5. **Le signal « on coupe Motion »** : trois semaines en mode Rémy, sans échéance ferme ratée à cause du plan, sans
   rouvrir Motion pour planifier, sans tâche perdue ? *Recommandation : oui.*

## 9. La phrase à coller dans l'autre session

> Lis `docs/etudes/mvp-sans-motion.md` en entier et `CLAUDE.md`, puis construis le **Lot 1 — les tâches dans Rémy et
> le vrai plan** (tour + site) avec le skill `/fonctionnalite` : écran d'abord, chaque critère du lot prouvé.
