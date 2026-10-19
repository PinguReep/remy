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
