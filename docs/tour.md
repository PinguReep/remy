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

## Recherche web (modèle local)

Depuis le 25/10, le modèle local cherche et lit lui-même sur le web, depuis la
tour : un moteur de recherche, puis la lecture des pages (sans JavaScript ; le
navigateur reste pour les autres). Ni Claude ni carte « Tu autorises ? ». Ce qui
sort : la requête, vers le moteur, puis les pages ouvertes. Jamais pour une
conversation privée ; le réglage « Recherche web » de l'app coupe tout.

| Réglage (`remy.env`) | Rôle |
| --- | --- |
| `REMY_RECHERCHE` | `duckduckgo` (défaut, sans clé ni installation), `searxng`, ou `off` (plus de recherche locale : on retrouve la recherche par Claude, sur autorisation) |
| `REMY_SEARXNG_URL` | l'adresse de SearXNG, pour `REMY_RECHERCHE=searxng` (ex. `http://<spark>:8090`) |
| `REMY_RECHERCHE_MAX` | recherches par message (défaut 4) |
| `REMY_LECTURE_MAX` | pages lues par message (défaut 6) |
| `REMY_RECHERCHE_DELAI_MS` / `REMY_LECTURE_DELAI_MS` | délai d'une recherche (8 s) / d'une page (15 s) |
| `REMY_WEB_SEARCH=off` | coupe toute recherche web, locale comme par Claude |

Après un changement de `remy.env`, relance l'installeur avec le même `-Ref` :
il redémarre Rémy.

### Si DuckDuckGo se met à bloquer : SearXNG sur un Spark

DuckDuckGo peut répondre par une vérification anti-robot quand la tour cherche
beaucoup. Rémy le dit alors en clair (« DuckDuckGo bloque les recherches… ») et
n'insiste pas pendant 5 minutes. La parade durable : SearXNG, un métamoteur libre,
sur un Spark (il interroge plusieurs moteurs à la fois ; rien d'autre ne part).

1. Sur le Spark (Docker installé), sur un port libre — pas celui du modèle :

   ```bash
   mkdir -p ~/searxng
   docker run -d --name searxng --restart unless-stopped -p 8090:8080 \
     -v ~/searxng:/etc/searxng searxng/searxng:latest
   ```

2. Au premier démarrage, il écrit `~/searxng/settings.yml` (avec sa clé secrète).
   Ouvre-le et ajoute `json` aux formats, puis coupe le limiteur (seule la tour
   l'interroge) :

   ```yaml
   search:
     formats:
       - html
       - json
   server:
     limiter: false
   ```

   puis `docker restart searxng`.
3. Depuis la tour : `curl.exe "http://<spark>:8090/search?q=test&format=json"` doit
   rendre du JSON (un 403 : `json` manque encore dans `formats`).
4. Dans `remy.env` : `REMY_RECHERCHE=searxng` et `REMY_SEARXNG_URL=http://<spark>:8090`,
   puis relance l'installeur. Rémy dit en clair si SearXNG ne répond pas, refuse
   le JSON, ou si ses moteurs sont muets.

SearXNG ne doit écouter que le réseau local : ne le publie ni sur Internet ni
par Tailscale Funnel.
