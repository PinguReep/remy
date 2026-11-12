# Installe (ou met à jour) Rémy sur la tour. Usage :
#   powershell -ExecutionPolicy Bypass -File scripts\installer-tour.ps1 -Ref tour-v0.2.0
#   powershell -ExecutionPolicy Bypass -File scripts\installer-tour.ps1 -Uninstall
#
# - Version : une référence IMMUABLE, un tag (tour-v…) ou un commit précis.
#   Une branche (origin/main) bouge : le retour arrière ne serait pas garanti,
#   elle est refusée (-AutoriserBranche pour passer outre). Le commit exact
#   déployé est affiché et noté.
# - Avant de changer de version : sauvegarde chiffrée « avant-maj » (base,
#   coffre, Motion), avec REMY_SAUVEGARDE_CLE posée dans remy.env. Sans elle,
#   l'installeur s'arrête sans rien changer (-SansSauvegarde pour passer outre).
# - À la fin : la commande exacte pour revenir à la version précédente.
# - Copie de production : %USERPROFILE%\.remy\app (clone du dépôt, à la version -Ref).
#   Le dépôt de travail peut changer sans toucher à ce qui tourne.
# - Réglages et secrets : %USERPROFILE%\.remy\remy.env (créé une fois, jamais écrasé).
# - Données : le coffre Obsidian (REMY_VAULT), base dans <coffre>\.remy.
# - Tâche planifiée « Rémy » : lancée à l'ouverture de session, sans fenêtre.
#   Son lanceur (run-remy.ps1) relance node s'il s'arrête (avec un frein contre
#   les chutes en série). Node n'écoute qu'en 127.0.0.1.
# - Tailscale Serve publie https://<tour>.ts.net:8444 aux seuls appareils du
#   tailnet (ni Internet, ni le LAN).
# - Mise à jour automatique (docs\tour.md) : -MiseAJourAuto (PowerShell
#   administrateur, une fois) réécrit le lanceur de Rémy, réenregistre « Rémy »,
#   et pose la tâche « Rémy - mise à jour » SANS droits d'administrateur (toutes
#   les 15 min et à l'ouverture de session) ; -SansMiseAJourAuto et -Uninstall la
#   retirent. Sans -Ref, ils ne touchent qu'aux tâches. Sans ces drapeaux, une
#   mise à jour à la main la laisse telle qu'elle est.
# - -Auto, -Retour : réservés à cette tâche (scripts\maj-auto.mjs). Sans droits
#   d'administrateur : aucune tâche planifiée n'y est touchée ; Rémy redémarre
#   parce que son lanceur relance node, que -Auto arrête.
param(
  [string]$Ref = '',
  [switch]$AutoriserBranche,
  [int]$Port = 3010,
  [int]$HttpsPort = 8444,
  [switch]$Uninstall,
  [switch]$SansSauvegarde,
  [switch]$MiseAJourAuto,
  [switch]$SansMiseAJourAuto,
  [switch]$Auto,
  [switch]$Retour
)

$ErrorActionPreference = 'Stop'
$taskName = 'Rémy'
$base = Join-Path $env:USERPROFILE '.remy'
$app = Join-Path $base 'app'
$envFile = Join-Path $base 'remy.env'
$log = Join-Path $base 'remy.log'
$tacheMaj = 'Rémy - mise à jour'
$majDir = Join-Path $base 'maj-auto'
$verrou = Join-Path $majDir 'verrou.json'
$raisonFichier = Join-Path $majDir 'installeur-raison.txt'
$verrouPris = $false
$runner = Join-Path $base 'run-remy.ps1'
# Par leur chemin complet : jamais trouvés dans un dossier courant (.remy, app).
$conhostExe = Join-Path $env:SystemRoot 'System32\conhost.exe'
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
# Git sur la copie de production : ni hooks, ni fsmonitor, ni objets de remplacement.
$gitSur = @('-c', 'core.hooksPath=NUL', '-c', 'core.fsmonitor=false')
$env:GIT_NO_REPLACE_OBJECTS = '1'

# Lancé par la tâche de mise à jour (-Auto) : la raison d'un arrêt lui est
# laissée en UTF-8 (la sortie de PowerShell 5.1 perd les accents en route).
if ($Auto) {
  New-Item -ItemType Directory -Force $majDir | Out-Null
  Remove-Item -LiteralPath $raisonFichier -Force -ErrorAction SilentlyContinue
  try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
}
# Pas de `trap` au niveau du script : en mode « Continue », son `continue`
# reprendrait APRÈS le bloc englobant (un -Uninstall sans tailscale sautait son
# `return` et déroulait une installation, 12/11). La raison d'un arrêt pour la
# tâche et le verrou rendu passent par le try/catch/finally qui entoure le seul
# chemin d'installation, plus bas ; les passages en « Continue » vérifient
# d'abord que leur commande existe (Get-Command) : rien ne peut y être terminal.
if ($MiseAJourAuto -and $SansMiseAJourAuto) {
  throw "-MiseAJourAuto ou -SansMiseAJourAuto, pas les deux. Rien n'a été changé."
}

# Remplacer la tâche planifiée demande un PowerShell administrateur quand elle a
# été créée depuis l'un d'eux. Le 15/10/2026, l'« Accès refusé » arrivait APRÈS
# l'arrêt de Rémy et le laissait arrêté : vérifié avant de toucher à quoi que ce soit.
$estAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
# La tâche de mise à jour (-Auto) n'en a pas besoin : elle ne touche à aucune tâche.
if (-not $Auto -and -not $estAdmin -and (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
  throw "Relance cette commande dans un PowerShell ouvert en administrateur (clic droit > Exécuter en tant qu'administrateur) : la tâche « $taskName » ne se remplace pas sans. Rien n'a été changé, Rémy tourne toujours."
}
# Poser ou retirer la tâche de mise à jour (et réenregistrer « Rémy ») : seul un
# PowerShell administrateur le peut (« Rémy » a été créée depuis l'un d'eux).
if (-not $estAdmin -and ($MiseAJourAuto -or $SansMiseAJourAuto -or ($Uninstall -and (Get-ScheduledTask -TaskName $tacheMaj -ErrorAction SilentlyContinue)))) {
  throw "Relance cette commande dans un PowerShell ouvert en administrateur : la tâche « $tacheMaj » ne se pose ni ne se retire sans. Rien n'a été changé."
}

# Le node de Rémy (même compte, sans droits d'administrateur), attendu jusqu'à
# ce qu'il ait vraiment quitté (le port libre, l'ancienne version muette).
function Arreter-NodeRemy {
  $p = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains('server.js') -and $_.CommandLine.Contains('remy.env') })
  foreach ($x in $p) { Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue }
  foreach ($x in $p) { Wait-Process -Id $x.ProcessId -Timeout 15 -ErrorAction SilentlyContinue }
}

function Stop-Remy {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  }
  # Stop-ScheduledTask n'arrête que conhost. Le lanceur d'abord (il relancerait
  # node), puis node, qui garderait le port.
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains('run-remy.ps1') } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Arreter-NodeRemy
}

# Le lanceur de la tâche « Rémy » : node au premier plan, RELANCÉ quand il
# s'arrête (3 s ; après 5 chutes en 2 min, 5 min d'attente, dit dans le
# journal). Un seul à la fois : un mutex de session, un second s'efface. Node
# tient lui-même son journal (REMY_LOG) : relayée par PowerShell 5.1, sa sortie
# perdait les accents. (cmd.exe sous conhost --headless se ferme sans rien lancer.)
function Ecrire-LanceurRemy {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) { throw "Node introuvable dans le PATH : installe la version LTS depuis nodejs.org, puis relance l'installeur." }
  $modele = @'
# Lanceur de Rémy (tâche « Rémy »), écrit par installer-tour.ps1. Rien de secret ici.
# node au premier plan, relancé s'il s'arrête : c'est ainsi que la mise à jour
# automatique, sans droits d'administrateur, redémarre Rémy (elle arrête node).
$ErrorActionPreference = 'Continue'
$verrouLanceur = New-Object System.Threading.Mutex($false, 'Local\RemyLanceur')
$tenu = $false
# (Abandonné par un lanceur arrêté de force : il nous revient.)
try { $tenu = $verrouLanceur.WaitOne(0) } catch { $tenu = $true }
if (-not $tenu) { exit 0 }
Set-Location -LiteralPath '__APP__'
$env:REMY_LOG = '__LOG__'
function Noter($texte) {
  try { [IO.File]::AppendAllText('__LOG__', "$((Get-Date).ToUniversalTime().ToString('o')) WARN lanceur : $texte`n", (New-Object Text.UTF8Encoding($false))) } catch {}
}
$chutes = New-Object 'System.Collections.Generic.List[datetime]'
while ($true) {
  & '__NODE__' '--env-file=__ENV__' server.js
  $code = $LASTEXITCODE
  $t = Get-Date
  $chutes.Add($t)
  while ($chutes.Count -gt 0 -and ($t - $chutes[0]).TotalSeconds -gt 120) { $chutes.RemoveAt(0) }
  if ($chutes.Count -ge 5) {
    Noter "Rémy est retombé $($chutes.Count) fois en 2 min (dernier code $code) : nouvel essai dans 5 min."
    $chutes.Clear()
    Start-Sleep -Seconds 300
  } else {
    Noter "Rémy s'est arrêté (code $code) : relancé dans 3 s."
    Start-Sleep -Seconds 3
  }
}
'@
  $texte = $modele.Replace('__APP__', $app).Replace('__LOG__', $log).Replace('__NODE__', $nodeCmd.Source).Replace('__ENV__', $envFile)
  [IO.File]::WriteAllText($runner, $texte, (New-Object Text.UTF8Encoding($true)))
}

function Lancer-LanceurDirect {
  Start-Process -FilePath $conhostExe -WorkingDirectory $app -WindowStyle Hidden `
    -ArgumentList "--headless `"$psExe`" -NoProfile -ExecutionPolicy Bypass -File `"$runner`""
}

# La tâche « Rémy » (installation à la main, ou -MiseAJourAuto) : arrêt,
# lanceur réécrit, tâche réenregistrée, démarrage.
function Installer-TacheRemy {
  Stop-Remy
  # Une tâche créée depuis un PowerShell administrateur ne se supprime pas depuis un
  # PowerShell normal (« Accès refusé », 15/10/2026). Rémy vient d'être arrêté :
  # l'installeur ne doit jamais s'interrompre ici en le laissant arrêté. La tâche
  # existante lance le même lanceur (réécrit ci-dessous) : on la garde.
  $tacheGardee = $false
  $existante = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existante) {
    try {
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    } catch {
      $tacheGardee = $true
      Write-Warning "Tâche « $taskName » non remplacée (droits administrateur) : je garde l'existante. Pour la réenregistrer un jour, relance l'installeur dans un PowerShell administrateur."
    }
  }
  Ecrire-LanceurRemy
  # conhost --headless : aucune fenêtre (même raison que les tâches du fork T3).
  $action = New-ScheduledTaskAction -Execute $conhostExe -WorkingDirectory $app `
    -Argument "--headless `"$psExe`" -NoProfile -ExecutionPolicy Bypass -File `"$runner`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable -MultipleInstances IgnoreNew
  if (-not $tacheGardee) {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal `
      -Settings $settings -Description "Rémy, assistant personnel, en 127.0.0.1:$Port (publié par Tailscale Serve)" | Out-Null
  }
  # La tâche gardée doit lancer CE lanceur ; sinon (ou si elle refuse de démarrer),
  # Rémy est lancé directement, de la même façon, jusqu'à la prochaine session.
  $parTache = -not $tacheGardee -or (($existante.Actions | ForEach-Object { $_.Arguments }) -join ' ').Contains('run-remy.ps1')
  $demarre = $false
  if ($parTache) {
    try {
      Start-ScheduledTask -TaskName $taskName
      $demarre = $true
    } catch {
      Write-Warning "La tâche « $taskName » refuse de démarrer ($($_.Exception.Message.Trim()))."
    }
  }
  if (-not $demarre) {
    Lancer-LanceurDirect
    Write-Warning "Rémy lancé directement (sans la tâche planifiée) : il ne redémarrera pas tout seul après une coupure de session. Relance l'installeur dans un PowerShell administrateur pour réparer la tâche."
  }
}

# Mise à jour automatique (-Auto) : AUCUNE tâche planifiée touchée. Le lanceur
# est réécrit (celui qui tourne garde le sien jusqu'à son prochain départ), node
# est arrêté, le lanceur le relance avec la nouvelle version. Pas de lanceur en
# boucle qui réponde (tour d'avant -MiseAJourAuto) : on en démarre un ; s'il y
# en avait déjà un, le nouveau s'efface (mutex).
function Relancer-ParLeLanceur {
  Ecrire-LanceurRemy
  Arreter-NodeRemy
  $repond = $false
  foreach ($i in 1..15) {
    Start-Sleep -Seconds 1
    try { Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3 | Out-Null; $repond = $true; break } catch {}
  }
  if (-not $repond) { Lancer-LanceurDirect }
}

# Rémy travaille-t-il (une réponse, un job de fond, une écriture) ? Demandé à
# scripts\maj-auto.mjs --occupe (code 10 : occupé), toutes les 15 s, au plus
# `$secondes`. Rend $true quand il est calme (ou injoignable).
function Attendre-Calme([int]$secondes) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $true }
  $fin = (Get-Date).AddSeconds($secondes)
  while ($true) {
    $ErrorActionPreference = 'Continue' # (voir la vérification de Node plus bas)
    & node --no-warnings "--env-file=$envFile" (Join-Path $PSScriptRoot 'maj-auto.mjs') --occupe 2>$null | Out-Null
    $codeCalme = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($codeCalme -ne 10) { return $true }
    if ((Get-Date) -ge $fin) { return $false }
    Start-Sleep -Seconds 15
  }
}

# La tâche « Rémy - mise à jour » : node lance scripts\maj-auto.mjs de la copie
# de production, SANS droits d'administrateur (RunLevel Limited) : elle ne touche
# à aucune tâche, elle arrête node et le lanceur de « Rémy » le relance.
# Ouverture de session (5 min après, le temps que Rémy démarre) et toutes les
# 15 minutes. -AvecRemy : réécrit aussi le lanceur de Rémy et réenregistre
# « Rémy » (-MiseAJourAuto seul ; une installation -Ref vient de le faire).
function Enregistrer-MajAuto([switch]$AvecRemy) {
  $script = Join-Path $app 'scripts\maj-auto.mjs'
  if (-not (Test-Path -LiteralPath $script)) {
    throw "La copie de production ($app) n'a pas encore la mise à jour automatique : installe d'abord un commit qui l'a, en une fois : installer-tour.ps1 -Ref <commit> -MiseAJourAuto. Rien n'a été changé."
  }
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) {
    throw "Node introuvable dans le PATH : la tâche « $tacheMaj » en a besoin. Rien n'a été changé."
  }
  New-Item -ItemType Directory -Force $majDir | Out-Null
  if ($AvecRemy) {
    Installer-TacheRemy
    Write-Output "Lanceur de Rémy réécrit (relance node s'il s'arrête), tâche « $taskName » réenregistrée et redémarrée."
  }
  $nodeExe = $nodeCmd.Source
  $runnerMaj = Join-Path $base 'run-maj-auto.ps1'
  $lanceurMaj = @"
# Lancé par la tâche « $tacheMaj » (installer-tour.ps1 -MiseAJourAuto). Rien de secret ici.
Set-Location -LiteralPath '$base'
if (-not (Test-Path -LiteralPath '$script')) { exit 0 }
& '$nodeExe' --no-warnings '--env-file=$envFile' '$script' --base '$base'
exit `$LASTEXITCODE
"@
  [IO.File]::WriteAllText($runnerMaj, $lanceurMaj, (New-Object Text.UTF8Encoding($true)))
  $actionMaj = New-ScheduledTaskAction -Execute $conhostExe -WorkingDirectory $base `
    -Argument "--headless `"$psExe`" -NoProfile -ExecutionPolicy Bypass -File `"$runnerMaj`""
  $aLOuverture = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $aLOuverture.Delay = 'PT5M'
  $toutesLes15 = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(2)) -RepetitionInterval (New-TimeSpan -Minutes 15)
  $principalMaj = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  $reglagesMaj = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) -StartWhenAvailable -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $tacheMaj -Action $actionMaj -Trigger @($aLOuverture, $toutesLes15) -Principal $principalMaj `
    -Settings $reglagesMaj -Force -Description "Rémy : installe le dernier commit de main dont les contrôles ont réussi (docs\tour.md)." | Out-Null
  $marque = @{ active = $true; depuis = (Get-Date).ToUniversalTime().ToString('o'); intervalleMin = 15; tache = $tacheMaj } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText((Join-Path $majDir 'tache.json'), $marque, (New-Object Text.UTF8Encoding($false)))
  Write-Output "Mise à jour automatique activée (tâche « $tacheMaj », toutes les 15 min). Journal : $(Join-Path $majDir 'journal.log'). Pause : Réglages > Diagnostic dans l'app ; retrait : -SansMiseAJourAuto."
}

function Retirer-MajAuto {
  if (Get-ScheduledTask -TaskName $tacheMaj -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $tacheMaj -Confirm:$false
  }
  Remove-Item -LiteralPath (Join-Path $majDir 'tache.json') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $base 'run-maj-auto.ps1') -Force -ErrorAction SilentlyContinue
  Write-Output "Mise à jour automatique désactivée (tâche « $tacheMaj » retirée). Le journal est gardé."
}

if ($Uninstall) {
  Retirer-MajAuto
  Stop-Remy
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
  if (Get-Command tailscale -ErrorAction SilentlyContinue) {
    $ErrorActionPreference = 'Continue' # (voir la vérification de Node ci-dessous)
    & tailscale serve --https=$HttpsPort off 2>$null
    $ErrorActionPreference = 'Stop'
  }
  Write-Output "Rémy arrêté et désinstallé. Le coffre, la base et $envFile sont gardés."
  return
}

# Seulement la tâche de mise à jour, sans réinstaller Rémy.
if (-not $Ref -and ($MiseAJourAuto -or $SansMiseAJourAuto)) {
  if ($MiseAJourAuto) { Enregistrer-MajAuto -AvecRemy } else { Retirer-MajAuto }
  return
}

if (-not $Ref) {
  throw "Indique la version à déployer : -Ref tour-v0.2.0 (tag) ou un commit précis. Rien n'a été changé."
}
New-Item -ItemType Directory -Force $base | Out-Null

# === Le chemin d'installation, jusqu'à la fin du fichier ===
# Une erreur qui l'arrête (mode « Stop ») : sa raison est laissée à la tâche
# (-Auto), puis l'erreur repart telle quelle ; le verrou d'une installation à la
# main est rendu dans tous les cas (finally). Pas réindenté (long, et lisible ainsi).
try {

# Jamais deux installations à la fois : la tâche de mise à jour tient un verrou
# (verrou.json, son numéro de processus) pendant son passage. Une installation
# à la main le prend aussi ; périmé si son processus n'existe plus, ou après 2 h.
if (-not $Auto) {
  New-Item -ItemType Directory -Force $majDir | Out-Null
  $pris = @{ pid = $PID; par = 'installeur'; depuis = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress
  $octets = (New-Object Text.UTF8Encoding($false)).GetBytes($pris)
  foreach ($essai in 1..2) {
    # Création exclusive : deux installeurs ne peuvent pas le prendre ensemble.
    $flux = $null
    try { $flux = [IO.File]::Open($verrou, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write) } catch {}
    if ($flux) {
      try { $flux.Write($octets, 0, $octets.Length) } finally { $flux.Close() }
      $verrouPris = $true
      break
    }
    $tenu = $null
    try { $tenu = Get-Content -LiteralPath $verrou -Raw | ConvertFrom-Json } catch {}
    $age = (Get-Date) - (Get-Item -LiteralPath $verrou).LastWriteTime
    $vivant = $tenu -and $tenu.pid -and (Get-Process -Id ([int]$tenu.pid) -ErrorAction SilentlyContinue)
    if (($vivant -and $age.TotalHours -lt 2) -or $essai -eq 2) {
      throw "Une mise à jour est déjà en cours ($($tenu.par), depuis $([int]$age.TotalMinutes) min) : attends qu'elle finisse (journal : $(Join-Path $majDir 'journal.log')). Rien n'a été changé."
    }
    # Périmé (processus mort, ou plus de 2 h) : retiré, puis repris.
    Remove-Item -LiteralPath $verrou -Force -ErrorAction SilentlyContinue
  }
}

# Node 22.13 ou plus : la base SQLite du Lot 0 (node:sqlite) en dépend. Vérifié
# AVANT de toucher à quoi que ce soit. Sous PowerShell 5.1, rediriger la sortie
# d'erreur d'un programme en mode « Stop » arrête le script à la première ligne
# — et Node écrit un avertissement « ExperimentalWarning » pour SQLite : d'où
# --no-warnings, et « Continue » le temps de l'appel (testé en CI, 5.1).
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node introuvable dans le PATH : installe la version LTS depuis nodejs.org, puis relance l'installeur. Rien n'a été changé."
}
$ErrorActionPreference = 'Continue'
& node --no-warnings -e "try { require('node:sqlite'); process.exit(0) } catch { process.exit(1) }" 2>$null
$nodeOk = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = 'Stop'
if (-not $nodeOk) {
  throw "Node trop ancien ($(& node --version)) : Rémy a besoin de Node 22.13 ou plus récent (base SQLite). Installe la version LTS depuis nodejs.org, puis relance l'installeur. Rien n'a été changé."
}

# Mise à jour automatique : Rémy travaille ? Alors rien, pas même la sauvegarde
# (code 3) ; la tâche repassera. Pas pour un retour en arrière : la version qui
# tourne ne répond déjà plus comme il faut.
if ($Auto -and -not $Retour -and -not (Attendre-Calme 0)) {
  Write-Output "Rémy travaille : rien n'a été changé, la mise à jour attendra le prochain passage."
  exit 3
}

# 0. Sauvegarde AVANT de changer de version (Lot 0, J0.1). Le script vient du
#    dépôt d'où l'installeur est lancé : Node seul, aucune dépendance.
if ((Test-Path $envFile) -and -not $SansSauvegarde) {
  # Exige une copie HORS de la tour (Spark ou disque externe) : une copie sur
  # la tour seule mourrait avec elle.
  & node "--env-file=$envFile" (Join-Path $PSScriptRoot 'sauvegarder.mjs') --raison avant-maj --exiger-hors-tour
  if ($LASTEXITCODE -ne 0) {
    throw "Sauvegarde avant mise à jour impossible ou sans copie hors de la tour : rien n'a été changé. Clé : node scripts\cle-sauvegarde.mjs --creer ; Spark : scripts\spark-relier.ps1 (voir docs\tour.md). Ou relance avec -SansSauvegarde en connaissance de cause."
  }
}
# Et s'il s'y est mis pendant la sauvegarde (une réponse, la réflexion de la nuit…) :
# toujours rien de changé, code 3.
if ($Auto -and -not $Retour -and -not (Attendre-Calme 0)) {
  Write-Output "Rémy s'est mis au travail pendant la sauvegarde : rien n'a été changé, la mise à jour attendra le prochain passage."
  exit 3
}
# La version qui tourne (commit complet, immuable), pour pouvoir y revenir.
$precedente = $null
if (Test-Path (Join-Path $app '.git')) {
  $precedente = (& git @gitSur -C $app rev-parse HEAD).Trim()
  Set-Content -Path (Join-Path $base 'version-precedente.txt') -Value $precedente -Encoding ASCII
}

# 1. Copie de production à la version demandée.
$repo = (& git -C $PSScriptRoot remote get-url origin).Trim()
if (-not (Test-Path (Join-Path $app '.git'))) {
  & git clone --quiet $repo $app
  if ($LASTEXITCODE -ne 0) { throw "git clone a échoué" }
}
& git @gitSur -C $app fetch --quiet --prune --tags origin
if ($LASTEXITCODE -ne 0) { throw "git fetch a échoué" }
# La référence demandée, résolue en un commit précis. Rémy tourne encore : rien
# n'est arrêté si elle est introuvable ou si c'est une branche.
$commit = & git @gitSur -C $app rev-parse --verify --quiet "$Ref^{commit}"
if (-not $commit) { throw "Version introuvable : $Ref. Rémy n'a pas été arrêté." }
$commit = "$commit".Trim()
$branche = & git @gitSur -C $app for-each-ref --format='%(refname)' "refs/remotes/$Ref" "refs/remotes/origin/$Ref" "refs/heads/$Ref"
if ($branche -and -not $AutoriserBranche) {
  throw "« $Ref » est une branche : elle bouge, le retour arrière ne serait pas garanti. Déploie un tag (ex. tour-v0.2.0) ou le commit $commit. Rémy n'a pas été arrêté."
}
& git @gitSur -C $app checkout --quiet --force --detach $commit
if ($LASTEXITCODE -ne 0) { throw "Version introuvable : $Ref" }
Push-Location $app
try {
  # --ignore-scripts : aucune dépendance installée n'a de script d'installation
  # (lockfile, 12/11) ; aucun ne s'exécute donc, même si un paquet en gagnait un.
  # --omit=optional : pdfjs-dist (lecture des PDF joints, 12/11) propose @napi-rs/canvas,
  # utile seulement pour dessiner les pages ; Rémy n'en extrait que le texte.
  & npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { throw "npm ci a échoué" }
} finally { Pop-Location }

# 2. Réglages : créés une fois, jamais écrasés (les secrets y sont posés par Sam).
# (Mise à jour automatique : pas d'appel à tailscale, l'adresse ne sert qu'à l'affichage.)
if ($Auto -and (Test-Path $envFile)) {
  $url = "https://<tour>:$HttpsPort"
} else {
  $dns = ((& tailscale status --json | ConvertFrom-Json).Self.DNSName).TrimEnd('.')
  $url = "https://${dns}:$HttpsPort"
}
if (-not (Test-Path $envFile)) {
  # Générateur cryptographique : Get-Random ne l'est pas (clé de session devinable).
  $rand = {
    $octets = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($octets)
    -join ($octets | ForEach-Object { '{0:x2}' -f $_ })
  }
  $vault = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Rémy'
  $lignes = @(
    '# Réglages de Rémy sur la tour. Ce fichier contient des secrets : il ne quitte pas la tour.',
    "PORT=$Port",
    'HOST=127.0.0.1',
    "REMY_VAULT=$vault",
    '# Cerveau : le modèle local des Sparks, en direct sur le LAN (Rémy suit celui qu''elles chargent).',
    'REMY_GLM_URL=http://192.168.1.50:8888/v1',
    '# Claude (recherche web, secours) passe par le CLI Claude Code : abonnement Max, pas de clé API.',
    'REMY_PROVIDER=claude-code',
    "SESSION_SECRET=$(& $rand)",
    "GOOGLE_REDIRECT_URI=$url/api/google/callback",
    '',
    '# --- À remplir ---',
    '# Toi (jamais dans le dépôt public) : ton prénom tel que Rémy l''emploie, et les mots',
    '# que tu dictes souvent (proches, projets), séparés par des virgules.',
    'REMY_PRENOM=',
    'REMY_VOCABULAIRE=',
    '# Tes notes privées (vision, roadmap…) : %USERPROFILE%\.remy\prive par défaut.',
    '# REMY_PRIVE=',
    '# Mot de passe : node scripts\hash-password.js "ton-mot-de-passe" puis colle le hash ici.',
    'APP_PASSWORD_HASH=',
    '# Motion : app Motion > Settings > API.',
    'MOTION_API_KEY=',
    '# Agenda Google : console Google Cloud (ajoute aussi GOOGLE_REDIRECT_URI aux URI autorisées).',
    'GOOGLE_CLIENT_ID=',
    'GOOGLE_CLIENT_SECRET=',
    '# Dictée : Dictée Locale (Whisper sur la tour, api_port 8771). Sans elle, rien ne part dans le cloud,',
    '# sauf TRANSCRIPTION_CLOUD=on (avec OPENAI_API_KEY) — choix D21.',
    'DICTEE_LOCALE_URL=http://127.0.0.1:8771/v1',
    'OPENAI_API_KEY=',
    '# Sauvegardes : clé de 64 caractères hexadécimaux. GARDES-EN UNE COPIE HORS DE LA TOUR,',
    '# sans elle les sauvegardes sont illisibles. Pour la créer :',
    '#   node scripts\cle-sauvegarde.mjs --creer   (jamais affichée ; à copier dans ton gestionnaire de mots de passe)',
    'REMY_SAUVEGARDE_CLE=',
    '# Copie externe : un dossier sur ton disque externe (ex. E:\Remy-sauvegardes). Un dossier sur',
    '# le disque de la tour ne compte pas : il mourrait avec elle.',
    'REMY_SAUVEGARDES_EXTERNE=',
    '# Copie sur un Spark (SFTP, archives chiffrées) : posé par scripts\spark-relier.ps1 -Epingler.',
    'REMY_SAUVEGARDES_SPARK=',
    '# Limites par appareil derrière Tailscale Serve : à activer une fois que /api/health',
    '# (ligne « proxy ») confirme que les adresses des appareils arrivent (docs\tour.md, V5).',
    '# TRUST_PROXY=1',
    '# Conversations d''ailleurs (Claude Code, T3 Code, ChatGPT) : lues sur la tour seule, chiffrées,',
    '# jamais envoyées à Claude ni ailleurs (docs\tour.md). Trouvées seules dans ~\.claude et ~\.t3 ;',
    '# un dossier en plus (fork, WSL) : chemins séparés par « ; ». =off coupe une source.',
    '# REMY_CLAUDE_DIRS=',
    '# REMY_T3_DIRS=',
    '# REMY_SOURCE_CHATGPT=off'
  )
  [IO.File]::WriteAllText($envFile, ($lignes -join "`n") + "`n", (New-Object Text.UTF8Encoding($false)))
  # Lisible par Sam seul.
  & icacls $envFile /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null
  Write-Output "Réglages créés : $envFile (secrets à remplir)."
}

# 3. Redémarrage. À la main : la tâche « Rémy » réenregistrée. Mise à jour
#    automatique : aucune tâche touchée, node arrêté et relancé par son lanceur —
#    juste après avoir attendu (10 min au plus) que Rémy ne travaille plus : la
#    copie est déjà à la nouvelle version, on ne peut plus reculer sans elle.
if ($Auto) {
  if (-not $Retour -and -not (Attendre-Calme 600)) {
    Write-Warning "Rémy travaille encore après 10 min d'attente : redémarrage quand même (la nouvelle version est déjà en place)."
  }
  Relancer-ParLeLanceur
} else {
  Installer-TacheRemy
}

# 4. Publication au tailnet seulement (déjà posée, persistante : pas en -Auto).
if (-not $Auto) {
  $serve = (& tailscale serve status --json | Out-String)
  if ($serve -notmatch ":$HttpsPort`"") {
    & tailscale serve --bg --https=$HttpsPort "http://127.0.0.1:$Port" | Out-Null
  }
}

# 5. Vérification.
$ok = $false
foreach ($i in 1..20) {
  Start-Sleep -Seconds 1
  try {
    $h = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 5
    $ok = $true; break
  } catch {}
}
if (-not $ok) { throw "Rémy ne répond pas en 127.0.0.1:$Port — voir $log" }
# (`tag --points-at` n'écrit rien sur stderr : sous PowerShell 5.1, une ligne
# d'erreur d'un programme arrêterait l'installeur.)
# 6. Garder les sessions Claude Code (effacées au bout de 30 jours sinon) : Rémy
#    en apprendra. Ne touche qu'à « cleanupPeriodDays » ; jamais bloquant.
try {
  & (Join-Path $PSScriptRoot 'claude-retention.ps1')
} catch {
  Write-Output "Claude Code : rétention non réglée ($($_.Exception.Message)) — scripts\claude-retention.ps1 à la main."
}

$tagInstalle = & git @gitSur -C $app tag --points-at HEAD | Select-Object -First 1
$installe = (& git @gitSur -C $app rev-parse HEAD).Trim()
Write-Output "Rémy tourne : $(if ($tagInstalle) { "$tagInstalle = " })$installe — $url"
if ($precedente) {
  Write-Output "  retour    : powershell -ExecutionPolicy Bypass -File scripts\installer-tour.ps1 -Ref $precedente"
}
Write-Output "  cerveau   : $($h.cerveau)"
Write-Output "  modèle    : $($h.glm_local)"
Write-Output "  Sparks    : $($h.sparks)"
Write-Output "  stockage  : $($h.stockage)"
Write-Output "  motion    : $($h.motion)"
Write-Output "  sauvegarde: $($h.sauvegardes)"
Write-Output "  nuit      : $($h.travail_de_fond)"
Write-Output "  commerces : $($h.commerces)"

# 7. Mise à jour automatique : posée ou retirée seulement si on le demande.
if ($MiseAJourAuto) { Enregistrer-MajAuto }
elseif ($SansMiseAJourAuto) { Retirer-MajAuto }
elseif (Get-ScheduledTask -TaskName $tacheMaj -ErrorAction SilentlyContinue) {
  Write-Output "  maj auto  : activée (tâche « $tacheMaj ») ; pause dans Réglages > Diagnostic de l'app"
} else {
  Write-Output "  maj auto  : désactivée (pour l'activer, une fois : -MiseAJourAuto)"
}

} catch {
  # Seules les erreurs terminales arrivent ici : les passages en « Continue »
  # ci-dessus ne lancent que des commandes vérifiées par Get-Command, et une
  # erreur y arrêterait l'installation AVANT tout changement (jamais une reprise
  # ailleurs dans le script, comme le faisait l'ancien trap).
  $erreur = $_
  if ($Auto) {
    try { [IO.File]::WriteAllText($raisonFichier, "$($erreur.Exception.Message)", (New-Object Text.UTF8Encoding($false))) } catch {}
  }
  throw $erreur
} finally {
  if ($verrouPris) { Remove-Item -LiteralPath $verrou -Force -ErrorAction SilentlyContinue }
}
