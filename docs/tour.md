# La tour : installer, mettre à jour, revenir en arrière

Rémy tourne sur une machine Windows à la maison (« la tour »). Node n'y écoute
qu'en `127.0.0.1` ; Tailscale Serve le publie aux seuls appareils du tailnet
(`https://<tour>.<tailnet>.ts.net:8444`), ni Internet, ni le réseau local.

## Où vivent les choses

| Quoi | Où |
| --- | --- |
| Le code qui tourne | `%USERPROFILE%\.remy\app` (copie du dépôt à une version précise) |
| Réglages et secrets | `%USERPROFILE%\.remy\remy.env` (créé une fois, jamais écrasé) |
| Mémoire, conversations, réflexions, captures | le coffre Obsidian (`REMY_VAULT`) |
| La base de l'app (rappels, listes, étiquettes…) | `<coffre>\.remy\` |
| Notes privées (vision, roadmap…) | `%USERPROFILE%\.remy\prive\` |
| Journal du serveur | `%USERPROFILE%\.remy\remy.log` |

Une mise à jour ne remplace que le code : le coffre, la base, `remy.env` et
`prive\` ne bougent pas.

## Ce qui te concerne : dans `remy.env`, jamais dans le dépôt

| Réglage | Rôle |
| --- | --- |
| `REMY_PRENOM` | ton prénom, tel que Rémy l'emploie (sinon « Sam », fictif) |
| `REMY_VOCABULAIRE` | les mots que tu dictes souvent (proches, projets), pour la dictée |
| `REMY_PRIVE` | le dossier de tes notes privées (défaut : `%USERPROFILE%\.remy\prive`) ; la roadmap y est lue (`constitution\roadmap.md`) |

L'app iPhone ne connaît pas l'adresse de la tour à l'avance : elle la demande
une fois (ou la reçoit à la compilation, secret `REMY_ADRESSE_TOUR`, voir
`docs/ios.md`).

## Venir d'une copie de l'ancien dépôt privé (une fois)

`scripts\basculer-depot-public.ps1 -Ref <commit>` (PowerShell administrateur,
depuis une copie de ce dépôt) : il range d'abord les fichiers privés de la copie
de production dans `prive\` avec tout l'historique (`historique-ancien-depot.bundle`),
ajoute tes réglages à `remy.env`, puis lance l'installeur. Rien n'est supprimé.

## Mettre à jour

Dans un PowerShell **administrateur**, depuis une copie du dépôt :

```powershell
git pull
powershell -ExecutionPolicy Bypass -File scripts\installer-tour.ps1 -Ref <commit>
```

- `-Ref` : un commit précis ou un tag (`tour-v…`) ; une branche est refusée
  (elle bouge, le retour arrière ne serait pas garanti).
- Avant de changer quoi que ce soit : une sauvegarde chiffrée « avant-maj »
  (base, coffre). Sans `REMY_SAUVEGARDE_CLE` dans `remy.env`, l'installeur
  s'arrête sans rien changer (`-SansSauvegarde` pour passer outre).
- À la fin : `/api/health` est sondé et la commande de retour arrière est affichée.

## Revenir en arrière

```powershell
powershell -ExecutionPolicy Bypass -File scripts\installer-tour.ps1 -Ref (Get-Content $env:USERPROFILE\.remy\version-precedente.txt)
```

Les migrations de la base vont toujours en avant et restent lisibles par la
version précédente (tables ajoutées, jamais retirées).

## Sauvegardes

- Clé : `node scripts\cle-sauvegarde.mjs --creer` (jamais affichée). Garde-en
  une copie hors de la tour : sans elle, les sauvegardes sont illisibles.
- Copie externe : `REMY_SAUVEGARDES_EXTERNE` (un disque externe ; un dossier
  sur la tour ne compte pas).
- Copie sur une autre machine du réseau (SFTP, archives chiffrées) :
  `scripts\spark-relier.ps1 -Spark <adresse> -Epingler`, puis
  `node scripts\spark-tester.mjs --cible <compte>@<adresse>:/sauvegardes`.
- Vérifier toute la chaîne : `scripts\verifier-tour.ps1`.

## Le modèle local et les Sparks

Rémy suit le modèle que les Sparks servent (`REMY_GLM_URL`, lu sur `/v1/models`) :
GLM, DeepSeek ou autre, sans rien régler. Les messages nomment ce modèle
(« le modèle local (DeepSeek-…) »), jamais un nom supposé.

| Réglage (`remy.env`) | Rôle |
| --- | --- |
| `REMY_SPARKS` | les serveurs de modèle de chaque Spark, séparés par des virgules, nommés ou non : `spark-1=http://<ip-spark-1>:8888/v1,spark-2=http://<ip-spark-2>:8000/v1`. `/api/health` dit alors « Sparks 2/2 répondent » et ce que sert chacune ; le diagnostic d'un code d'erreur aussi. En tensor parallèle (un modèle servi par les deux), seule la Spark de tête a un serveur de modèle : déclare l'autre par un port qu'elle ouvre, `spark-2=tcp://<ip-spark-2>:22` (« allumée », sans modèle à lire). Sans `REMY_SPARKS`, une seule adresse est connue (`REMY_GLM_URL`) et la ligne ne compte pas les Sparks |
| `REMY_REFLEXION_LIMITE` | jusqu'à quelle heure la réflexion de la nuit attend un modèle local éteint ou saturé (défaut 8 : nouvel essai toutes les 20 min, sans compter d'échec) |
| `REMY_FOND_DELAI_MS` | temps laissé au modèle pour une tâche de fond sans flux (défaut et plafond 290 000, 4 min 50 : au-delà de 300 s, le fetch de Node abandonne de lui-même une réponse sans en-têtes) |

Dans `/api/health` (et à la fin de l'installeur) :

- `glm_local` (« modèle ») : le serveur du modèle répond-il, et quel modèle Rémy y prend ;
- `sparks` : chaque Spark déclarée, et le modèle qu'elle sert ;
- `travail_de_fond` (« nuit ») : les échecs des tâches de fond, **datés** —
  une alerte disparaît dès que la même tâche réussit ensuite, et au bout de
  48 h dans tous les cas ; « inférences en cours » est la garde de charge (ce
  qui tourne en ce moment), pas un compte des Sparks.

Si la réflexion de la nuit dit « … est occupé » ou « … ne répond pas » : elle
réessaie seule jusqu'à 8 h. « Les Sparks ne servent pas le modèle demandé » :
regarde Réglages › Modèle dans l'app (ou repasse en automatique).

## Commerces : mise à jour mensuelle

La base des commerces (reconnaître « le coiffeur », « le drive ») vient
d'OpenStreetMap. Le premier import se fait à la main, une fois :

```powershell
node --no-warnings --env-file=$env:USERPROFILE\.remy\remy.env $env:USERPROFILE\.remy\app\scripts\commerces-importer.mjs
```

Ensuite, Rémy la remet à jour tout seul : une nuit par mois au plus (30 jours
après le dernier import), entre 1 h et 3 h, sans IA ; seuls les numéros de
département partent vers OpenStreetMap, jamais une position. Un échec est
réessayé dans la nuit (30 min, puis 1 h), puis la nuit suivante ; l'ancienne
base reste en place tant qu'un import n'a pas abouti. La date de la dernière
mise à jour, la prochaine et le dernier échec sont dans `/api/health`
(ligne `commerces`) et dans la vue des lieux de l'app.

| Réglage (`remy.env`) | Rôle |
| --- | --- |
| `REMY_COMMERCES_AUTO=off` | plus de mise à jour automatique (l'import à la main reste possible) |
| `REMY_COMMERCES_JOURS` | intervalle entre deux mises à jour (défaut 30) |
| `REMY_COMMERCES_HEURE` | début de la fenêtre de nuit (défaut 1 : de 1 h à 3 h) |

## Activité du PC (ActivityWatch)

Rémy peut savoir combien de temps tu passes dans chaque appli de la tour
(développement, navigateur, jeux…), d'après [ActivityWatch](https://activitywatch.net),
un logiciel libre qui tourne sur la tour elle-même. Rémy le lit en local ; rien
ne sort de la tour, et les titres de fenêtres ne sont jamais gardés.

1. Sur la tour, télécharge l'installeur Windows depuis activitywatch.net
   (`activitywatch-v….-windows-x86_64-setup.exe`) et installe-le.
2. Lance **ActivityWatch** (`aw-qt`, l'icône apparaît près de l'horloge) et fais-le
   démarrer avec Windows : coche l'option de démarrage proposée par l'installeur,
   ou ajoute un raccourci vers `aw-qt.exe` dans `shell:startup` (Win + R).
3. Vérifie qu'il répond : <http://127.0.0.1:5600> s'ouvre dans le navigateur de
   la tour et montre la journée.
4. Facultatif : l'extension « ActivityWatch Web Watcher » de ton navigateur, pour
   le détail par site (le domaine seulement, jamais l'adresse complète).
5. Dans l'app : Réglages › **Activité du PC** › allume. Le premier relevé lit la
   journée depuis minuit, puis toutes les 20 minutes.

| Réglage (`remy.env`) | Rôle |
| --- | --- |
| `REMY_ACTIVITE_PC=off` | coupe tout côté tour (l'app ne peut plus l'allumer) |
| `REMY_ACTIVITE_EXCLURE` | applis (ou domaines) jamais comptées, séparées par des virgules (`keepass,banque`) ; ce qui l'était s'efface au relevé suivant, et un navigateur emporte tous les sites relevés |
| `REMY_ACTIVITE_CATEGORIES` | corriger une catégorie (`monjeu=jeux,outil=developpement`) |
| `REMY_ACTIVITE_PC_JOURS` | durée de conservation (défaut 90 jours) |
| `REMY_ACTIVITYWATCH_URL` | si ActivityWatch n'écoute pas sur `http://127.0.0.1:5600` |

Si l'app affiche « ActivityWatch ne répond pas » : `aw-qt` n'est pas lancé (ou
plus) ; relance-le, puis tire l'écran vers le bas pour relever tout de suite.
Si elle affiche « aw-watcher-window (ou aw-watcher-afk) n'écrit plus depuis… » :
ActivityWatch répond, mais ce guetteur s'est arrêté et plus rien n'est compté ;
relance-le depuis l'icône d'ActivityWatch près de l'horloge (menu des modules),
ou quitte et relance `aw-qt`, puis tire pour relever.
« Tout effacer » vide ce que Rémy a gardé, sans toucher à ActivityWatch.

## Conversations d'ailleurs (Claude Code, T3 Code, ChatGPT)

Rémy lit tes sessions Claude Code et T3 Code de la tour, et les exports
ChatGPT que tu lui donnes : consultables dans l'app (Projets › Conversations),
relues la nuit par le modèle local, citées dans ses réponses quand ta question
s'y rapporte. À sens unique : rien n'est écrit chez Claude Code, T3 ni
ChatGPT, et rien ne repart vers Anthropic ou OpenAI. Détail et contrat :
`docs/conversations-externes.md`.

1. **Rien à faire pour Claude Code et T3** : allumées par défaut, lues toutes
   les 30 minutes (`%USERPROFILE%\.claude\projects`, `%USERPROFILE%\.t3\userdata`).
   Un dossier ailleurs (fork de T3, autre profil, WSL) : `REMY_CLAUDE_DIRS` ou
   `REMY_T3_DIRS` dans `remy.env` (séparés par `;`), puis l'installeur.
2. **ChatGPT** : ChatGPT › Réglages › Contrôle des données › Exporter ; le
   .zip arrive par mail (lien valable 24 h). Envoie-le depuis l'app
   (Réglages › Sources des conversations › Importer un export ChatGPT), ou
   dépose-le dans `<coffre>\Imports` (le .zip, ou le dossier que crée
   « Extraire tout ») : lu au passage suivant (30 min au plus), puis il
   **quitte le coffre** pour `%USERPROFILE%\.remy\imports-importes`, effacé
   7 jours après. Le même export deux fois ne crée rien. Trop gros pour
   l'envoi depuis l'iPhone : dans Fichiers, touche le .zip pour le
   décompresser et envoie seulement `conversations.json`.
3. **La clé** : `%USERPROFILE%\.remy\conversations.cle`, créée au premier
   usage, hors du coffre. Garde-en une copie avec la clé des sauvegardes : sans
   elle, une base restaurée est illisible (Claude Code et T3 se relisent, un
   export ChatGPT se réenvoie).
4. **Vérifier** depuis la tour, sans rien afficher du contenu :
   `node --no-warnings --env-file=%USERPROFILE%\.remy\remy.env %USERPROFILE%\.remy\app\scripts\connaissances-etat.mjs --lire`
   (chaque source : allumée ou non, emplacements trouvés, comptes, erreur et
   quoi faire).

| Réglage (`remy.env`) | Rôle |
| --- | --- |
| `REMY_SOURCE_CLAUDE_CODE=off` / `REMY_SOURCE_T3=off` / `REMY_SOURCE_CHATGPT=off` | coupe la source côté tour (l'app ne peut plus l'allumer) |
| `REMY_CONVERSATIONS_USAGE=off` | Rémy ne s'en sert plus (ni réponses, ni nuit) ; la consultation reste |
| `REMY_CLAUDE_DIRS`, `REMY_T3_DIRS` | des dossiers en plus, séparés par `;` |
| `REMY_IMPORTS_DIR` | le dossier surveillé des exports (défaut `<coffre>\Imports`) |
| `REMY_IMPORT_MAX_MO` | taille maximale d'un envoi depuis l'app (défaut 2048) |
| `REMY_IMPORTS_GARDE_JOURS` | jours pendant lesquels un export importé est gardé hors du coffre (défaut 7 ; 0 : effacé tout de suite) |
| `REMY_CONNAISSANCES_PROJETS` | ne garder que les projets dont le dossier contient l'un de ces mots |
| `REMY_GLM_LOCAL=oui` | à poser seulement si `REMY_GLM_URL` désigne un modèle chez toi sous un nom public : sinon passages et nuit sont refusés hors de la machine, du réseau privé et du tailnet |

La base (`<coffre>\.remy\connaissances.db`) est chiffrée. Une conversation
de Rémy qui cite ces conversations, ou importée d'un autre assistant, est
**scellée** dans `conversations.json` (chiffrée avec la même clé) et le coffre
Obsidian n'en garde qu'un renvoi (« Conversation privée (…).md »). Le dossier
`Imports` n'entre pas dans les sauvegardes (lourd, en clair, déjà dans la
base), et un export importé n'y reste pas. « Tout effacer » (app) vide la base
et ce que la nuit en a tiré, sans toucher aux originaux.

## Recherche web (modèle local)

Depuis le 25/10, le modèle local cherche et lit lui-même sur le web, depuis la
tour : un moteur de recherche, puis la lecture des pages (sans JavaScript ; le
navigateur reste pour les autres). Ni Claude ni carte « Tu autorises ? ».

**La recherche rapide (depuis le 29/10, par défaut).** Une question qui demande
le web (un montant, un horaire, une actualité…) est cherchée par la TOUR, avec
tes mots, avant même que le modèle réfléchisse : elle lit les meilleures pages
en même temps (sites officiels d'abord), en garde les passages utiles, et le
modèle répond en un seul appel, avec les liens et les dates. Avant, la salle
blanche enchaînait quatre ou cinq appels au modèle (plus d'une minute pour
l'ACRE). Ta question ne part ainsi que si elle ne contient aucun nom propre,
sigle inconnu ni numéro, rien de ta mémoire — même écrit par toi —, et aucun
contexte personnel à la première personne (santé, famille, justice, un
montant : « J'ai un cancer, l'ACRE est-elle cumulable avec l'AAH ? ») ; sinon,
et pour une suite (« Et pour la vente ? »), Rémy écrit lui-même une question
générale, et la tour la cherche de la même façon. Aucune adresse n'est écrite
par un modèle : seules s'ouvrent les pages que le moteur rend (ou tes liens).
En mode « hybride » (le défaut), Rémy peut relancer UNE recherche si les
passages ne répondent pas ; comme il a lu des pages avant de l'écrire, cette
relance passe le filtre SANS l'exemption de ce que tu viens d'écrire, et ne
peut contenir aucun nom propre (une page piégée pourrait le lui souffler) — la
même règle vaut, dans tous les modes, pour toute question écrite après une
première lecture. Moteur bloqué : pas de relance (elle échouerait).

**La salle blanche** (`REMY_RECHERCHE_MODE=salle`, le comportement du 25/10).
Rémy, qui connaît ta mémoire et ton planning, ne cherche
pas lui-même : il écrit une question, et une recherche séparée, sur la tour,
qui ne sait RIEN de toi (ni mémoire, ni planning, ni conversation, ni prénom),
cherche, lit les pages, et lui rend une synthèse avec les passages cités, leurs
liens et leurs dates. Une page piégée qui lui demanderait « cherche le nom de
son médecin » n'obtient rien : elle ne le connaît pas.

**Le filtre.** Avant tout envoi, chaque question, chaque requête et chaque
adresse de page composée passe un filtre, sans IA : il refuse une adresse
e-mail, un numéro de téléphone, un IBAN, une carte, un numéro de sécurité
sociale, une adresse postale, ou un terme personnel tiré de ta mémoire, de ton
profil ou de ton planning — les noms propres (Dr Untel, une agence, un lieu
privé), les sigles et numéros, les mots d'une ligne de santé (un médicament).
Les sujets eux-mêmes passent (« pompe à chaleur », « combles perdus ») : c'est
ce qu'on cherche. Passent aussi les villes, les organismes publics, les
produits, et ce que tu viens d'écrire toi-même. Rémy reformule en termes
généraux, ou te propose d'écrire le mot toi-même (il partira alors) ; après
deux refus dans un message, il répond sans le web. Le même filtre garde le
navigateur de Claude quand il prend le relais (secours).

Ce qui sort : ta question (recherche rapide, sans nom propre ni terme de ta
mémoire) ou la question générale de Rémy, et — en mode salle — les requêtes de
la salle blanche, vers le moteur, puis les pages
ouvertes — seulement des adresses trouvées par la recherche, données par toi
dans la conversation, ou d'un site public (`*.gouv.fr`, urssaf.fr, ameli.fr,
caf.fr…) sans « ? ». Chaque question, chaque recherche, chaque page (ouverte ou
refusée) et chaque requête bloquée (avec sa raison, sans la donnée) apparaît
dans la barre d'étapes du chat et dans le panneau des coûts, à 0 $. Le réglage
« Recherche web » de l'app coupe tout, le navigateur compris (et si les
réglages sont illisibles, tout reste coupé).

**Conversations privées** : pas de recherche, sauf si tu allumes « Recherche
dans les conversations privées » (coupé par défaut ; Réglages de l'app
iPhone, grisé quand la tour le verrouille ; sans effet quand la recherche web
est coupée). Allumé, la recherche passe par la tour (ou la salle blanche, en
mode salle) — jamais par un lien de la conversation —, et le filtre y
ajoute la conversation privée : ses noms propres et numéros ne sortent jamais
(même si tu viens de les écrire), ses mots rares seulement si tu les réécris
dans ton message ; les sujets de ta question du moment passent.
`REMY_RECHERCHE_PRIVEE=off` dans `remy.env` la verrouille, quoi que dise l'app.

| Réglage (`remy.env`) | Rôle |
| --- | --- |
| `REMY_RECHERCHE` | `duckduckgo` (défaut, sans clé ni installation), `searxng`, ou `off` (plus de recherche locale : on retrouve la recherche par Claude, sur autorisation) |
| `REMY_SEARXNG_URL` | l'adresse de SearXNG, pour `REMY_RECHERCHE=searxng` (ex. `http://<spark>:8090`) |
| `REMY_RECHERCHE_MAX` | recherches par message (défaut 4) |
| `REMY_LECTURE_MAX` | pages lues par message (défaut 6) |
| `REMY_BROWSE_MAX` | pages ouvertes par le navigateur par message (défaut 3) ; les trois budgets fixent aussi le nombre de tours d'outils, après quoi Rémy conclut |
| `REMY_RECHERCHE_DELAI_MS` / `REMY_LECTURE_DELAI_MS` | délai d'une recherche (8 s) / d'une page (15 s) |
| `REMY_WEB_SEARCH=off` | coupe toute recherche web, locale comme par Claude |
| `REMY_RECHERCHE_PRIVEE=off` | verrouille la recherche dans les conversations privées (le réglage de l'app ne peut plus l'allumer) |
| `REMY_RECHERCHER_MAX` | questions à la salle blanche par message (défaut 2) |
| `REMY_SALLE_BLANCHE_DELAI_MS` | durée totale de ces recherches par message (défaut 120 000, soit 2 min) |
| `REMY_FILTRE_PERMIS` | mots toujours permis par le filtre, séparés par des virgules (ta commune si elle n'est ni grande ni dans ta Base Adresse, un club, une marque) |
| `REMY_SALLE_BLANCHE=off` | Rémy cherche lui-même, comme avant le 25/10 (plus rapide, moins protégé : le filtre reste, mais jamais de recherche en conversation privée) |
| `REMY_RECHERCHE_MODE` | `hybride` (défaut : la tour cherche et lit, une relance possible), `direct` (un seul appel au modèle, aucune relance), `salle` (la salle blanche du 25/10) |
| `REMY_RECHERCHE_REFLEXION` | la réflexion du modèle quand les passages sont déjà là : `low` (défaut), `off` (plus rapide), `medium`, `high` |
| `REMY_RECHERCHE_PAGES` | pages lues en même temps (défaut 3) |
| `REMY_RECHERCHE_LECTURES_MS` / `REMY_RECHERCHE_GRACE_MS` | temps maximal des lectures (5 000) ; une fois un site officiel ou deux pages lus, le temps laissé aux autres (1 500) |
| `REMY_RECHERCHE_RELAIS_MS` | si DuckDuckGo (html) tarde, son autre point d'entrée (lite) part en relais après ce délai (2 000 ; 0 : l'un après l'autre) |
| `REMY_RECHERCHE_CACHE_MS` | résultats et pages gardés en mémoire vive, jamais sur le disque (15 min ; 0 : pas de cache) |

Après un changement de `remy.env`, relance l'installeur avec le même `-Ref` :
il redémarre Rémy.

### Comparer les stratégies : le banc (une commande)

Le banc tourne depuis la copie de production : il faut donc d'abord y
installer le commit qui le contient (« Mettre à jour » ci-dessus, `-Ref
<commit>`). Cette installation met la recherche rapide (`hybride`) en service
tout de suite ; pour garder la salle blanche jusqu'au verdict, ajoute AVANT
l'installation la ligne `REMY_RECHERCHE_MODE=salle` à `remy.env` — le banc
impose sa stratégie à chaque essai, il compare quand même les quatre.

Ensuite, dans un PowerShell (pas besoin d'administrateur), Rémy de préférence
inutilisé pendant ce temps (les Sparks seraient partagées) :

```powershell
cd $env:USERPROFILE\.remy\app
node --env-file=..\remy.env scripts\banc-recherche.mjs
```

Neuf questions (règles, montants, horaires, prix, météo, actualité, produit,
et une suite de conversation : « Et pour la vente de marchandises, c'est
combien ? »), chacune avec les quatre stratégies (`salle`, `direct`,
`hybride`, `direct-vif` = direct sans réflexion), contre le vrai modèle local :
un tableau (temps total, temps au premier mot, appels au modèle, pages lues,
chiffres vérifiés / à vérifier, débit d'écriture MESURÉ du modèle) et un JSON
avec les réponses complètes dans `<coffre>\.remy\bancs\` (elles peuvent
reprendre des bribes de ta mémoire, qui reste dans le coffre ;
`--sans-memoire` l'évite).
Compte 20 à 40 minutes. Rien n'est écrit dans Motion, l'agenda, la mémoire ni
les conversations ; aucune IA cloud (la clé Anthropic est retirée du processus).
Options : `--modes direct,hybride`, `--questions acre,smic`, `--sans-memoire`,
`--planning` (ajoute l'instantané Motion à la consigne, en lecture seule, pour
une consigne de la taille réelle). Pour garder une stratégie :
`REMY_RECHERCHE_MODE=…` dans `remy.env`, puis l'installeur.

La partie sans modèle (moteur, pertinence, lectures en série et en parallèle,
extraction) se mesure aussi seule : `node scripts\mesurer-recherche.mjs`.

### Si DuckDuckGo se met à bloquer : SearXNG sur un Spark

DuckDuckGo peut répondre par une vérification anti-robot quand la tour cherche
beaucoup. Rémy le dit alors en clair (« DuckDuckGo bloque les recherches… ») et
n'insiste pas pendant 5 minutes. La parade durable : SearXNG, un métamoteur libre,
sur un Spark. **À qui partent les requêtes** : SearXNG transmet chaque requête,
telle quelle, aux moteurs qu'il garde — par défaut une dizaine (Google, Bing,
DuckDuckGo, Brave, Qwant, Wikipédia…). L'étape 2 n'en garde que trois ; choisis
ceux que tu acceptes.

1. Sur le Spark (Docker installé), sur un port libre — pas celui du modèle —, et
   publié sur l'adresse du Spark dans le réseau local SEULEMENT (pas sur
   Tailscale, pas sur toutes les interfaces). L'image est épinglée (version
   datée et empreinte) : une mise à jour se décide, elle ne s'installe pas seule.

   ```bash
   mkdir -p ~/searxng
   docker run -d --name searxng --restart unless-stopped \
     -p <ip-lan-du-spark>:8090:8080 -v ~/searxng:/etc/searxng \
     searxng/searxng:2026.10.11-ad46ebd7d@sha256:ddd642cae6eac75412938fd846ddbf440a2df029cfeae8a562b8b205f4e35e25
   ```

2. Au premier démarrage, il écrit `~/searxng/settings.yml` (avec sa clé secrète).
   Ouvre-le : remplace la ligne `use_default_settings: true` par la liste des
   moteurs gardés, ajoute `json` aux formats, et coupe le limiteur (seule la tour
   l'interroge, et il n'écoute que le réseau local) :

   ```yaml
   use_default_settings:
     engines:
       keep_only:
         - duckduckgo
         - qwant
         - wikipedia
   search:
     formats:
       - html
       - json
   server:
     limiter: false
   ```

   puis `docker restart searxng`.
3. Depuis la tour : `curl.exe "http://<ip-lan-du-spark>:8090/search?q=test&format=json"`
   doit rendre du JSON (un 403 : `json` manque encore dans `formats`).
4. Dans `remy.env` : `REMY_RECHERCHE=searxng` et `REMY_SEARXNG_URL=http://<ip-lan-du-spark>:8090`,
   puis relance l'installeur. Rémy dit en clair si SearXNG ne répond pas, refuse
   le JSON, ou si ses moteurs sont muets.

SearXNG ne doit écouter que le réseau local : ne le publie ni sur Internet ni
par Tailscale Funnel.
