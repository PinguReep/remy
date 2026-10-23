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
| `REMY_ACTIVITE_EXCLURE` | applis jamais comptées, séparées par des virgules (`keepass,banque`) |
| `REMY_ACTIVITE_CATEGORIES` | corriger une catégorie (`monjeu=jeux,outil=developpement`) |
| `REMY_ACTIVITE_PC_JOURS` | durée de conservation (défaut 90 jours) |
| `REMY_ACTIVITYWATCH_URL` | si ActivityWatch n'écoute pas sur `http://127.0.0.1:5600` |

Si l'app affiche « ActivityWatch ne répond pas » : `aw-qt` n'est pas lancé (ou
plus) ; relance-le, puis tire l'écran vers le bas pour relever tout de suite.
« Tout effacer » vide ce que Rémy a gardé, sans toucher à ActivityWatch.

