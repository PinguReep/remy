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
   dépose-le dans `<coffre>\Imports` : lu au passage suivant (30 min au plus),
   puis rangé dans `Imports\Importés`. Le même export deux fois ne crée rien.
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
| `REMY_CONNAISSANCES_PROJETS` | ne garder que les projets dont le dossier contient l'un de ces mots |

La base (`<coffre>\.remy\connaissances.db`) est chiffrée ; le dossier
`Imports` n'entre pas dans les sauvegardes (lourd, en clair, déjà dans la
base). L'export déposé reste dans `Imports\Importés` : efface-le une fois tes
conversations vues dans l'app si ton coffre est synchronisé ailleurs.
« Tout effacer » (app) vide la base et ce que la nuit en a tiré, sans toucher
aux originaux.

## Recherche web (modèle local)

Depuis le 25/10, le modèle local cherche et lit lui-même sur le web, depuis la
tour : un moteur de recherche, puis la lecture des pages (sans JavaScript ; le
navigateur reste pour les autres). Ni Claude ni carte « Tu autorises ? ».

**La salle blanche.** Rémy, qui connaît ta mémoire et ton planning, ne cherche
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

Ce qui sort : la question de Rémy (la première recherche) et les requêtes de
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
est coupée). Allumé, la recherche passe par la salle blanche, et le filtre y
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

Après un changement de `remy.env`, relance l'installeur avec le même `-Ref` :
il redémarre Rémy.

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
