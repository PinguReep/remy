# Motion : ce qui manque à Rémy, et faut-il le refaire en local ?

Étude du 12/11/2026. Aucun code livré. Code lu : `/home/user/wt/integration` (branche la plus
récente, avec les « bloquée par »), car `/home/user/remy` est en retard et n'a pas encore `semaine.js`,
`rituel.js`, `a-trancher.js` ni `proposition-priorites.js`.
Sources numérotées [n] en fin de document. LU = lu dans la source citée. SUPPOSÉ = déduit.

## En dix lignes

1. Manques utiles. Trois sont **petits** et passent par l'API actuelle : écrire l'échéance ferme
   et la date « pas avant » (aujourd'hui Rémy écrit toujours `SOFT`), choisir l'horaire pro ou
   perso de chaque tâche, et lire les morceaux et le drapeau « ne rentre pas » que Motion renvoie déjà.
2. Deux sont **moyens** : les tâches récurrentes (l'API sait les créer), et les étapes ou modèles de projet.
3. Le manque **gros**, c'est le cœur de Motion : replanifier seul, puis dire pourquoi. L'API ne
   l'expose pas, et Motion ne l'explique pas.
4. Refaire le planificateur en local, c'est une **bonne idée, à une condition** : il doit d'abord
   faire ses preuves en « fantôme », sans rien écrire, à côté de Motion, pendant quelques semaines.
5. L'algorithme n'est pas le plus dur. Pour une personne seule, un glouton avec règles nommées
   (en gros « échéance la plus proche d'abord ») suffit et s'explique. Il calcule en millisecondes.
6. Le plus dur, c'est la plomberie : Rémy devient la source des tâches, il écrit les blocs dans
   l'agenda, il replanifie quand l'agenda bouge, et l'iPhone suit.
7. Le modèle local ne calcule pas le planning. Il peut estimer une durée ou proposer un découpage,
   toujours à confirmer. Il peut aussi reformuler une raison, mais jamais l'inventer.
8. Couper Motion ne fait entrer aucun nouveau tiers si tu restes sur Google Agenda : Rémy y écrit déjà.
   Pour Outlook ou iCloud, il faudrait un nouveau flux (Microsoft Graph ou CalDAV Apple), à valider avec toi.
9. Premier morceau : `planifier(entrées) → placements + raisons`, un module pur et testé, affiché
   dans la vue Semaine en face du planning de Motion.

## Méthode

- Sources : centre d'aide public de Motion (versions `.md` des pages) et doc publique de l'API.
  Notes de version : non consultées. Rien de décompilé, aucune API privée.
- Les pages d'aide demandent aux agents d'interroger un moteur de questions. Je ne l'ai pas fait :
  j'ai seulement lu les pages.
- Recherches web : termes génériques et noms de logiciels publics seulement.

## A. Inventaire

Colonnes : ce que fait Motion (LU) · ce que l'API expose (LU) · ce que Rémy a (fichier) · utilité pour une personne seule.

| Fonction | Motion (LU) | API (LU) | Rémy | Utilité |
|---|---|---|---|---|
| Blockers | Une tâche bloquée n'est pas planifiée avant sa bloquante [9][11]. Dans un même projet seulement [10]. | Non : aucun champ [16][17][18]. | Oui, dans Rémy, même entre projets (`lib/carnet.js` `annoterTaches`). Mais Motion planifie quand même la tâche bloquée (`docs/journal-technique.md`). | **Forte** : l'ordre réel des choses. |
| Échéance ferme / souple | Ferme : Motion peut sortir des horaires pour la tenir [1][4]. | `deadlineType` HARD/SOFT/NONE en lecture et en écriture [16][17]. | Lu (`lib/dashboard.js` `faitsTache`). **Toujours écrit SOFT** (`lib/motion.js:786`). | **Forte** : c'est la différence entre « idéalement » et « sinon c'est raté ». |
| Date « pas avant » | Pas planifiée avant ce jour, même si du temps est libre [2][3]. | `autoScheduled.startDate` en écriture, `startOn` en lecture [16][17]. | Lu (`dashboard.js`), jamais écrit. | **Forte** : désencombre la semaine. |
| Priorités ASAP / haute / moyenne / basse | ASAP passe avant tout et grise l'échéance [1]. | `priority` [16]. | Oui (`motion.js` `normPriorite`). En plus, Rémy a des priorités de projet confirmées, que Motion ignore (`lib/proposition-priorites.js`). | Forte, et déjà là. |
| Horaires par type de tâche | Plusieurs horaires (travail, perso, week-end). Chaque tâche est rattachée à l'un d'eux [4]. | `GET /schedules` en lecture seule [21]. Nom de l'horaire à la création [16]. | Partiel : un seul horaire pour tout (`motion.js` `nomHoraire`). | **Forte** : le perso ne déborde pas sur le pro. |
| Découpage en morceaux, taille minimale | « Min chunk » réglable : la tâche est répartie en blocs [3][6]. | Les morceaux en lecture seule (`chunks`), aucun réglage [16][17]. | Non. `chunks` n'est pas lu. La frise prend `scheduledStart`/`scheduledEnd` (`dashboard.js` `normTache`). SUPPOSÉ : une tâche coupée en deux y apparaît comme un seul long bloc. | **Forte** : les longues tâches n'entrent jamais d'un bloc. |
| Tâches récurrentes | Cadences du quotidien au trimestriel. Une occurrence ratée est reprogrammée, sauf pour une tâche quotidienne [8]. | `POST /recurring-tasks` : fréquence, heure idéale, horaire [19]. | Non trouvé. `principes.md` demande pourtant « les choses récurrentes planifiées une fois ». | **Forte**. |
| Replanification automatique | Un nouveau rendez-vous ou une nouvelle tâche, et tout se réarrange. Une tâche en retard prend le prochain créneau [2]. | Implicite : on relit `scheduledStart`. | Non. Rémy relit Motion 25 s après une écriture (`motion.js`). | **Forte** : c'est le cœur. |
| Alerte « échéance impossible » | « Past due » si placée après son échéance. « Can't fit » si rien ne rentre sur 31 jours [5]. | `schedulingIssue` (booléen) [17]. | Partiel : « menacées » (`lib/rituel.js`) et « déborde » (`lib/semaine.js`) sont recalculées. `schedulingIssue` n'est pas lu. | Forte. |
| Tâche à heure fixe | Verrouillée. Replanifiée quand même si elle n'est pas faite 60 min après [5][7]. | Non : `scheduledStart` est en lecture seule [18]. | Équivalent : un rendez-vous Google (`lib/arbitrage.js`). | Couvert. |
| Étapes de projet | Étapes en série. Les tâches des étapes futures sont des « fantômes » [5][9]. | Étapes données seulement à la création depuis un modèle [20]. Lecture : non trouvé. | Non. Les dossiers et sous-projets n'ont pas d'ordre (`carnet.js`). | Moyenne. |
| Modèles de projet, délais relatifs | Étapes, tâches, blockers et délais relatifs réutilisables [11][23]. | `projectDefinitionId` à la création [20]. Liste des modèles : non trouvée. | Non. | Moyenne : utile pour les démarches qui reviennent (administratif, voyages…). |
| Modèles de tâche | Enregistrer une tâche comme modèle [7]. | Non trouvé. | Non. | Gadget. |
| Pauses entre tâches | « X min de pause toutes les Y h » [4]. | Non trouvé. | Non. | Moyenne : le planning reste tenable. |
| Temps de trajet | Bloque du temps avant ou après un rendez-vous. Pas pour iCloud ni les rendez-vous récurrents [4]. | Non trouvé. | Non. C'est seulement une consigne au modèle (`lib/conseil.js:111`). | Moyenne : Rémy connaît déjà tes lieux. |
| Horaires d'un seul jour | « Commencer plus tard », « bloquer la journée » [1]. | Non trouvé. | Non. Contournable avec un rendez-vous Google « occupé ». | Moyenne. |
| Étiquettes | Étiquettes libres [16]. | `labels` [16]. | Dans Rémy seulement (`carnet.js`). | Gadget pour planifier. |
| Prises de rendez-vous | Liens de réservation avec tampons et plafond par jour [13]. | Non trouvé. | Non. | Gadget, sauf si des inconnus te prennent souvent rendez-vous. |
| Synchro des agendas | Rendez-vous dans les deux sens. Tâches vers Google et Outlook seulement, et à sens unique [14][15]. | — | Google lu et écrit en direct (`lib/google.js`). | Forte si on coupe Motion. |

Limite d'API qui pèse : 12 requêtes par minute pour un compte individuel [22].

### Les manques qui valent le coup, du plus utile au moins utile

1. **Échéance ferme et date « pas avant » écrites par Rémy** — petit. L'API le permet [16][18].
   Option à trancher avec toi : poser un « pas avant » sur une tâche bloquée, pour que Motion
   cesse de la planifier trop tôt (le journal technique l'avait écarté « en douce » ; ce serait avec ton accord).
2. **Lire `chunks` et `schedulingIssue`** — petit. La frise devient juste, et le « ne rentre pas »
   vient de Motion au lieu d'être deviné.
3. **Un horaire par tâche (pro ou perso)** — petit. Il faut une règle de choix et un réglage.
4. **Tâches récurrentes** — moyen. Création via l'API [19], affichage, et reprise en cas de ratage.
5. **Replanifier et expliquer** — gros. C'est la partie B.
6. **Étapes et modèles de projet** — moyen à gros. Dans Rémy, ce sont des chaînes de « bloquée par »
   avec des délais relatifs. Les « bloquée par » existent déjà.
7. **Pauses et trajets** — moyen. Seulement avec un planificateur local, car l'API ne les expose pas.

## B. Planificateur local

### B1. Ce que Motion dit de sa planification

- Entrées : durée, date de début, échéance, priorité, « effort », horaires, rendez-vous « occupés » [2][3]. LU.
  L'usage de « effort » n'est pas expliqué : non trouvé.
- Hiérarchie annoncée [1] (LU) : ASAP > échéance ferme > échéance souple (la plus proche d'abord) >
  priorité > durée (découpage) > date de début > récurrence. Une récurrente peut passer avant si elle seule rentre.
- La page se contredit [1] (LU). Elle écrit « la priorité passe toujours en premier », mais classe
  une tâche moyenne due demain devant une tâche haute à échéance ferme dans 10 jours.
  SUPPOSÉ : il s'agit d'un score pondéré, pas d'un ordre strict. C'est justement l'opacité dont tu te plains.
- Sans durée, ou sans échéance ni priorité, la tâche n'est pas planifiée [2]. LU.
- Une échéance ferme peut sortir des horaires [1][4]. LU.
- Les rendez-vous l'emportent toujours sur les tâches [2][12]. LU.
- Les tâches sont pesées entre projets, jamais entre espaces de travail [2]. LU.
- Longues tâches découpées en respectant une taille minimale de bloc [2][6]. LU.
  Le chiffre de 15 minutes vient d'une ancienne page d'aide, aujourd'hui redirigée : non confirmé.
- Échéance en danger : Motion avance la tâche ou affiche une alerte. Tâche en retard : prochain créneau libre [2]. LU.
- Horizon : 31 jours, puis « Can't fit » [5]. LU.
- Fréquence de recalcul, algorithme exact, poids des critères : non trouvés.
  SUPPOSÉ : un recalcul à chaque changement, avec un score combinant ces critères.

### B2. Comment on construit ça

Pour toi, on a **une seule personne**, donc une seule « machine ». Quelques centaines de tâches au plus.
Un horizon de 14 à 31 jours, découpé en créneaux de 5 à 15 minutes, soit quelques milliers de créneaux.

| Approche | Pour | Contre |
|---|---|---|
| **Glouton trié** (règles dans un ordre fixe, chaque tâche dans le premier créneau libre) | Simple. Déterministe. Une raison par placement. Millisecondes. | Peut rater une échéance ferme qu'un meilleur ordre aurait tenue. |
| **EDF** (« earliest deadline first », la plus proche échéance d'abord) | Résultat connu de l'ordonnancement : avec une seule machine et des tâches coupables, EDF tient toutes les échéances dès que c'est possible. Ça couvre les dates « pas avant », et les dépendances si on avance les échéances des bloquantes. | Ignore la priorité. La taille minimale de morceau casse un peu la garantie (quasi optimal). |
| **Programmation par contraintes / en nombres entiers** (CP-SAT d'OR-Tools, MiniZinc, HiGHS) | Optimum d'un objectif pondéré. Absorbe des contraintes exotiques. | L'explication devient « le solveur l'a trouvé ». Le plan peut changer beaucoup d'un calcul à l'autre. Dépendances lourdes. |
| **Recherche locale** (Timefold) | Très bonne sur les gros problèmes. | Java. Trop pour une personne seule. |

Proposition : un **hybride glouton + EDF**.

1. Vérifier, par EDF sur le temps libre, que les échéances fermes tiennent.
2. Placer ensuite le reste dans l'ordre des règles. Une tâche n'est acceptée que si les échéances fermes restent tenables.
3. **Stabilité** : on ne déplace un bloc d'hier que si une règle l'exige, et on dit laquelle.

On garde un solveur (HiGHS en WebAssembly, licence MIT) en réserve, seulement si le glouton échoue en vrai.

### B3. Open source existant

| Projet | Licence | État | Réutilisable |
|---|---|---|---|
| FluidCalendar [24] | MIT | Le README dit « très bogué, pas pour la production ». Next.js et Postgres. | Des idées (horaires, tampons, synchro Google, Outlook et CalDAV). Pas le code : autre pile, algorithme non documenté. |
| sp-autoplan, greffon de Super Productivity [25] | Non trouvée | Actif d'après son tutoriel | Bon modèle d'usage : score d'urgence par formules, bloc préféré et bloc minimal, « essai à blanc » avant « appliquer », tâches à ne pas déplacer. |
| Taskwarrior, calcul d'urgence [26] | MIT (de mémoire, à vérifier) | Mûr | Un score = somme de termes nommés et pondérés (échéance, priorité, bloquant +8, bloqué −5…). Très bon modèle d'explication. |
| Atomic [24 bis] | Non vérifiée | « En développement actif » | Rien de sûr : vu seulement dans une liste. |
| Timefold [27], OR-Tools | Apache 2.0 | Mûrs | Java ou Python, en local possible. Surdimensionnés ici. |
| npm `highs` (MIT), `yalps` (MIT), `minizinc` (MPL-2.0) [28] | — | Maintenus (2025-2026) | Solveurs utilisables dans Node, en local. |
| npm `rrule` (BSD-3), `tsdav` (MIT, CalDAV), `ical.js` (MPL-2.0) [28] | — | Maintenus | Récurrences, agenda CalDAV, lecture des fichiers ICS. |

Aucun de ces projets ne vaut d'être repris tel quel. On réimplémente les idées, ce qui est propre et légal.

### B4. Entrées et sorties chez Rémy

**Entrées**, toutes déjà sur la tour :
- Tâches : durée, échéance et type (ferme, souple, aucune), « pas avant », priorité, projet.
- Dépendances (`dependances_taches`) et états « en attente » ou « commencée » (`carnet.js`).
- Priorités de projet **confirmées** (`proposition-priorites.js`). Une priorité non confirmée ne compte pas.
- Horaires (`/schedules` aujourd'hui, réglage Rémy demain). Rendez-vous Google « occupés » (`google.js`).
- Plus tard : lieux et temps de trajet (`lib/lieux.js`), pauses, taille minimale de morceau.

**Règles, dans un ordre que tu valides**, chacune nommée : R1 bloquée (pas avant la fin de sa
bloquante) · R2 « pas avant » · R3 échéance ferme tenable · R4 ASAP · R5 projet prioritaire confirmé ·
R6 échéance souple la plus proche · R7 priorité de la tâche · R8 ne pas bouger sans raison.

**Sorties** :
- Pour chaque morceau : `{ tache, debut, fin, morceau 2/3, regle, raison, alternatives }`.
- Pour chaque tâche non placée : `{ tache, manque: "2 h 30 avant ven. 18 h", que faire }`.
- Exemples de raisons, construites à partir de la règle, sans modèle :
  - « Mardi 9 h-10 h 30, avant “Devis” : échéance ferme jeudi 18 h, et il ne reste que 3 h libres d'ici là. »
  - « Pas avant mercredi : elle attend “Rappel garage”, prévu mardi soir. »
  - « Déplacée de lundi à mardi : un rendez-vous a été ajouté lundi 14 h. »

### B5. Rôle du modèle local

- **D'accord avec toi** : il ne calcule pas le planning. Un modèle de langage n'est ni déterministe
  ni vérifiable, et il « explique » après coup.
- **Utile** :
  - Estimer une durée quand elle manque. Affichée « estimée », à confirmer.
  - Proposer un découpage (« 3 × 1 h ») ou une checklist.
  - Reformuler une raison, à partir de la règle et des chiffres fournis.
- **Risques** :
  - Une raison inventée ou fausse. Garde-fou : la raison affichée vient du gabarit ; le modèle n'en
    propose qu'une reformulation, et on rejette celle-ci si elle cite un nom ou une heure absents des données.
  - Des durées trop optimistes. Garde-fou : comparer, plus tard, aux temps réels (`completedTime`).
  - La latence et la panne du serveur du modèle. Garde-fou : le planning ne l'attend jamais.
  - Le coût : chaque appel est journalisé avec un `kind`, et on peut le couper.
- Vie privée : le modèle tourne chez toi. Aucun secours cloud pour ce circuit, comme `conseil.js`.

### B6. Ce qu'on perd en quittant Motion, et comment le remplacer

| Perte | Remplacement | Tiers nouveau ? |
|---|---|---|
| Les blocs de tâches visibles dans Google Agenda [14] | Rémy écrit ses blocs dans un agenda Google dédié (« Rémy — plan »). Le droit d'écrire existe déjà (`google.js`). | **Non** (Google est déjà branché) |
| Outlook | Microsoft Graph | **Oui**, ton accord est nécessaire |
| iCloud | CalDAV (`tsdav`), avec un mot de passe d'application Apple | **Oui**, ton accord est nécessaire |
| Applis Motion (iPhone, ordinateur) | Les applis Rémy existent. Il faut une vue « plan » et un geste « refaire le plan ». | Non |
| Fiabilité 24 h/24 dans le cloud | Le plan est calculé sur la tour. Tour éteinte : le dernier plan reste lisible dans Google Agenda. | Non |
| Récurrences, pauses, trajets, horaires d'un jour | À construire (`rrule`, règles du planificateur). | Non |
| Liens de réservation | Probablement pas nécessaires. Sinon Cal.com hébergé chez toi. | Non si hébergé chez toi |
| Historique des tâches | Export par l'API (paginé, 12 requêtes/min) dans la base Rémy, chiffrée. | Non |

Rien de personnel ne part ailleurs tant que tu restes sur Google. Les bibliothèques npm sont du code local, pas des services.

### B7. Chemin par étapes (Motion reste en place jusqu'à la preuve)

**Étape 0 — gains sur Motion — petite.** Écrire l'échéance ferme, le « pas avant » et l'horaire.
Lire les morceaux et `schedulingIssue`.
- Ce qu'on vérifie : des maquettes de l'API, puis une tâche de test en prod, relue.
- Pour passer à la suite : rien n'est obligatoire. L'étape vaut seule.

**Étape 1 — fantôme — moyenne.** Le module pur `planifier()` (sans entrée/sortie, avec des tests sur
des jeux de données fixes) tourne la nuit et à la demande, sur les mêmes tâches que Motion. La vue
Semaine montre « Motion » et « Rémy aurait fait », avec les écarts et leurs raisons. **Aucune écriture.**
- Ce qu'on vérifie :
  - Même entrée, même sortie.
  - Moins d'une seconde pour 300 tâches.
  - Un journal quotidien des écarts, où tu marques « Motion a raison », « Rémy a raison » ou « égal ».
- Pour passer à la suite, après 3 à 4 semaines :
  - Aucune échéance ferme ratée par Rémy que Motion tient.
  - Une majorité d'écarts jugés « Rémy » ou « égal ».
  - Tu trouves les raisons justes.

**Étape 2 — Rémy devient la source — grosse.**
- Les tâches vivent dans la base Rémy, chiffrée.
- Motion reçoit une copie sans planification automatique (`autoScheduled: null`, permis par l'API [16][18]).
  Sinon les deux planificateurs se battent.
- Rémy écrit son plan dans l'agenda Google dédié, et replanifie à chaque changement d'agenda ou de tâche.
- Ce qu'on vérifie :
  - Aucune tâche perdue : comptage Rémy contre Motion chaque nuit.
  - Plan refait en quelques secondes.
  - Tests iPhone au viewport 430×932.
- Pour passer à la suite : un mois d'usage réel sans rouvrir la planification de Motion.

**Étape 3 — on coupe — moyenne.**
- Export final, puis arrêt de l'abonnement.
- `motion.js` passe en lecture d'archive, puis il est retiré. La feuille de route le prévoit
  déjà (« Motion est un échafaudage »).
- Ce qu'on vérifie : les chemins de prod `/api/...` sondés après la mise en service, et l'archive relue.

### B8. Mon avis

**Bonne idée, à condition de** :
1. passer par le fantôme ;
2. rester sur une personne seule (pas d'équipes, pas de réservations) ;
3. faire de la stabilité et de l'explication des exigences, pas des options.

L'économie (environ 480 € par an) ne suffit pas à justifier le chantier. Ce qui le justifie :
- les tâches bloquées enfin respectées ;
- les priorités confirmées enfin prises en compte ;
- un « pourquoi » pour chaque placement.

Motion ne fait aucun des trois via son API. Le risque est la plomberie de l'étape 2, pas l'algorithme.

**Premier morceau** : `lib/planificateur.js`, pur.
- Règles R1 à R8, EDF pour les échéances fermes, morceaux avec taille minimale.
- Entrées lues depuis le cache actuel, sans aucune requête Motion de plus.
- Sortie affichée dans la vue Semaine, en face du planning de Motion.
- Faire avant, en parallèle : l'étape 0, petite et utile dès demain.

## Sources

Centre d'aide Motion : [1] https://www.usemotion.com/help/time-management/auto-scheduling · [2] …/auto-scheduling/reference-auto-scheduling/how-auto-scheduling-works-behind-the-scenes · [3] …/reference-auto-scheduling/what-auto-scheduling-considers · [4] https://www.usemotion.com/help/time-management/auto-scheduling/auto-scheduling-how-to-guide · [5] https://www.usemotion.com/help/project-management/task/reference-tasks/task-states-and-task-types · [6] https://www.usemotion.com/help/project-management/task/task-scheduling-faq · [7] https://www.usemotion.com/help/project-management/task/tasks-how-to-guide · [8] https://www.usemotion.com/help/project-management/task/reference-tasks/recurring-task-cadences · [9] https://www.usemotion.com/help/project-management/projects/reference-projects/project-stages-and-blockers · [10] https://www.usemotion.com/help/project-management/projects/reference-projects/limitations · [11] https://www.usemotion.com/help/project-management/projects/projects-how-to-guide · [12] https://www.usemotion.com/help/project-management/projects/reference-projects/calendar-behavior-and-indicators · [13] https://www.usemotion.com/help/time-management/booking-links/reference-booking-links/availability-and-scheduling-rules · [14] https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/scheduling-models-uni-and-bi-directional-sync · [15] https://www.usemotion.com/help/time-management/all-things-calendars/reference-all-things-calendars/supported-providers · [23] https://www.usemotion.com/help/time-management/auto-scheduling/concept-auto-scheduling/best-practices

API Motion : [16] https://docs.usemotion.com/api-reference/tasks/post · [17] …/tasks/get · [18] …/tasks/patch · [19] …/recurring-tasks/post · [20] …/projects/post · [21] …/schedules/get · [22] https://docs.usemotion.com/cookbooks/rate-limits

Logiciels libres : [24] https://github.com/dotnetfactory/fluid-calendar · [24 bis] https://github.com/rush86999/atomic · [25] https://codeberg.org/00sapo/sp-autoplan/wiki/Tutorial.md · [26] https://taskwarrior.org/docs/urgency/ · [27] https://timefold.ai/open-source-solver · [28] registre npm : `highs`, `yalps`, `minizinc`, `rrule`, `tsdav`, `ical.js` (versions et licences relevées le 12/11/2026)
