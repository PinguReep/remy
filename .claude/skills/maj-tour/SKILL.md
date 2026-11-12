---
name: maj-tour
description: Use when running ON the Windows tower that hosts Rémy and asked to check, update, verify or roll back the production copy (%USERPROFILE%\.remy\app), or to inspect, pause or remove the automatic update task « Rémy - mise à jour ». Never asks for a secret.
---

# Mettre la tour à jour (sur la tour elle-même)

Pour un agent qui tourne **sur la tour** (Windows, PowerShell 5.1). Rémy y est
servi par `server.js` en `127.0.0.1:3010` (tâche planifiée « Rémy »), depuis la
copie de production `%USERPROFILE%\.remy\app`. La règle complète :
`docs/tour.md`, « Mise à jour automatique ». Réponds en français.

## Les règles qui ne se discutent pas

- **Jamais de secret.** Ne lis pas, n'affiche pas, ne copie pas `remy.env` (ni
  `Get-Content`, ni `type`, ni `cat`). Ne demande jamais à l'utilisateur de
  coller une clé, un mot de passe ou un jeton : s'il en manque un, dis lequel
  et qu'il le pose lui-même dans `remy.env`. Ne régénère jamais
  `REMY_SAUVEGARDE_CLE` ni `DATA_KEY`.
- **Jamais `-SansSauvegarde`.** L'installeur fait une sauvegarde chiffrée
  « avant-maj » et s'arrête sans rien changer si elle est impossible : c'est
  voulu. Dis pourquoi elle échoue (clé absente, Spark ou disque externe
  injoignable) au lieu de la contourner.
- **PowerShell administrateur** pour l'installeur (la tâche « Rémy » a été
  créée ainsi : sans ces droits, « Accès refusé » — l'installeur le vérifie et
  s'arrête avant de toucher à quoi que ce soit). Si ta session n'est pas
  administrateur, donne la commande à l'utilisateur au lieu de la lancer.
- **PowerShell 5.1** : en `$ErrorActionPreference = 'Stop'`, `2>$null` ou
  `2>&1` sur un programme (node, git) arrête tout à la première ligne écrite
  sur sa sortie d'erreur. Passe en `'Continue'` le temps de l'appel.
- **Une référence immuable** : un commit complet ou un tag `tour-v…`, jamais
  une branche (`origin/main` bouge, le retour ne serait pas garanti).
- Ne lance pas d'installation pendant qu'une autre tourne (le verrou
  `maj-auto\verrou.json` le refuse de toute façon).

## 1. L'état, sans rien changer

```powershell
$base = "$env:USERPROFILE\.remy"
git -C "$base\app" log -1 --format='%H %s (%cd)' --date=iso   # ce qui tourne
Get-Content "$base\version-precedente.txt"                       # la version d'avant
Get-ScheduledTask -TaskName 'Rémy', 'Rémy - mise à jour' -ErrorAction SilentlyContinue | Format-Table TaskName, State
node --no-warnings "--env-file=$base\remy.env" "$base\app\scripts\maj-auto.mjs" --etat
node --no-warnings "--env-file=$base\remy.env" "$base\app\scripts\maj-auto.mjs" --a-blanc
Invoke-RestMethod http://127.0.0.1:3010/api/health
```

`--etat` montre la mise à jour automatique (activée, pause, dernier passage,
dernière installation, commits refusés) et la fin du journal ;
`--a-blanc` dit ce que ferait un passage maintenant, sans rien installer.
`--env-file` passe les réglages à Node **sans les afficher** : c'est la seule
façon d'utiliser `remy.env`. Le prévol complet : `scripts\verifier-tour.ps1`.

## 2. Mettre à jour à la main vers un commit

Depuis une copie du dépôt (pas la copie de production) :

```powershell
git pull
git log -1 --format=%H origin/main      # le commit voulu, en entier
powershell -ExecutionPolicy Bypass -File scripts\installer-tour.ps1 -Ref <commit>
```

Avant, regarde que les contrôles de ce commit ont réussi (onglet Actions du
dépôt, « Serveur — tests ») : la mise à jour automatique ne prendrait pas un
commit rouge, une installation à la main non plus.

Si la mise à jour automatique est activée, mets-la en pause pendant que tu
travailles (Réglages › Diagnostic dans l'app, ou demande à l'utilisateur), ou
attends la fin du passage en cours. Un commit hors de `main` installé à la main
la suspend (« pas en avant ») jusqu'au prochain commit de `main` installé à la
main.

## 3. Vérifier

```powershell
Invoke-RestMethod http://127.0.0.1:3010/api/health
node --no-warnings "--env-file=$env:USERPROFILE\.remy\remy.env" "$env:USERPROFILE\.remy\app\scripts\maj-auto.mjs" --etat
Get-Content "$env:USERPROFILE\.remy\remy.log" -Tail 30 -Encoding UTF8
```

Le commit servi : la fin de l'installeur (« Rémy tourne : … ») et `--etat`
(`installe`). `/api/version` ne donne le commit qu'avec une session : n'en
fabrique pas à la main, `maj-auto.mjs` le fait (avec `SESSION_SECRET`, sans
l'afficher).

## 4. Revenir en arrière

```powershell
powershell -ExecutionPolicy Bypass -File scripts\installer-tour.ps1 -Ref (Get-Content $env:USERPROFILE\.remy\version-precedente.txt)
```

La mise à jour automatique le fait seule quand `/api/version` n'annonce pas le
nouveau commit, et note ce commit « refusé » (`etat.json`, `refuses`) : il ne
sera pas retenté ; le commit suivant de `main` le sera. Si elle écrit
« le retour … a échoué », Rémy est peut-être arrêté : relance la commande
qu'elle donne (PowerShell administrateur), puis vérifie (3).

## 5. La mise à jour automatique

| Pour | Commande (PowerShell administrateur) |
| --- | --- |
| l'activer (une fois) | `scripts\installer-tour.ps1 -Ref <commit> -MiseAJourAuto` (ou `-MiseAJourAuto` seul si la copie l'a déjà) |
| la retirer | `scripts\installer-tour.ps1 -SansMiseAJourAuto` |
| la mettre en pause | Réglages › Diagnostic › « Installer seule les mises à jour » (dans l'app) |
| la couper côté tour | demande à l'utilisateur d'ajouter `REMY_MAJ_AUTO=off` à `remy.env` |
| lire le journal | `Get-Content $env:USERPROFILE\.remy\maj-auto\journal.log -Tail 20 -Encoding UTF8` |
| la dernière installation | `Get-Content $env:USERPROFILE\.remy\maj-auto\derniere-installation.log -Encoding UTF8` |

États fréquents : `a-jour`, `attente-controles` (un workflow tourne encore),
`controles-en-echec` (relancer le workflow sur GitHub suffit s'il passe),
`occupe` (Rémy travaille : repasse dans 15 min), `annulee` (avant tout
changement : réessai espacé ; après : retour fait, commit refusé),
`pas-en-avant`, `depot-inattendu`, `limite-github` (60 requêtes/h sans jeton :
attendre).
