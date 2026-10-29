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
# - Tâche planifiée « Rémy » : lancée à l'ouverture de session, sans fenêtre,
#   relancée si elle tombe. Node n'écoute qu'en 127.0.0.1.
# - Tailscale Serve publie https://<tour>.ts.net:8444 aux seuls appareils du
#   tailnet (ni Internet, ni le LAN).
param(
  [string]$Ref = '',
  [switch]$AutoriserBranche,
  [int]$Port = 3010,
  [int]$HttpsPort = 8444,
  [switch]$Uninstall,
  [switch]$SansSauvegarde
)

$ErrorActionPreference = 'Stop'
$taskName = 'Rémy'
$base = Join-Path $env:USERPROFILE '.remy'
$app = Join-Path $base 'app'
$envFile = Join-Path $base 'remy.env'
$log = Join-Path $base 'remy.log'

# Remplacer la tâche planifiée demande un PowerShell administrateur quand elle a
# été créée depuis l'un d'eux. Le 15/10/2026, l'« Accès refusé » arrivait APRÈS
# l'arrêt de Rémy et le laissait arrêté : vérifié avant de toucher à quoi que ce soit.
$estAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $estAdmin -and (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
  throw "Relance cette commande dans un PowerShell ouvert en administrateur (clic droit > Exécuter en tant qu'administrateur) : la tâche « $taskName » ne se remplace pas sans. Rien n'a été changé, Rémy tourne toujours."
}

function Stop-Remy {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  }
  # Stop-ScheduledTask n'arrête que conhost : le node de la copie installée garderait le port.
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains('server.js') -and $_.CommandLine.Contains('remy.env') } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains('run-remy.ps1') } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($Uninstall) {
  Stop-Remy
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
  $ErrorActionPreference = 'Continue' # (voir la vérification de Node ci-dessous)
  & tailscale serve --https=$HttpsPort off 2>$null
  $ErrorActionPreference = 'Stop'
  Write-Output "Rémy arrêté et désinstallé. Le coffre, la base et $envFile sont gardés."
  return
}

if (-not $Ref) {
  throw "Indique la version à déployer : -Ref tour-v0.2.0 (tag) ou un commit précis. Rien n'a été changé."
}
New-Item -ItemType Directory -Force $base | Out-Null

# Node 22.13 ou plus : la base SQLite du Lot 0 (node:sqlite) en dépend. Vérifié
# AVANT de toucher à quoi que ce soit. Sous PowerShell 5.1, rediriger la sortie
# d'erreur d'un programme en mode « Stop » arrête le script à la première ligne
# — et Node écrit un avertissement « ExperimentalWarning » pour SQLite : d'où
# --no-warnings, et « Continue » le temps de l'appel (testé en CI, 5.1).
$ErrorActionPreference = 'Continue'
& node --no-warnings -e "try { require('node:sqlite'); process.exit(0) } catch { process.exit(1) }" 2>$null
$nodeOk = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = 'Stop'
if (-not $nodeOk) {
  throw "Node trop ancien ($(& node --version)) : Rémy a besoin de Node 22.13 ou plus récent (base SQLite). Installe la version LTS depuis nodejs.org, puis relance l'installeur. Rien n'a été changé."
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
# La version qui tourne (commit complet, immuable), pour pouvoir y revenir.
$precedente = $null
if (Test-Path (Join-Path $app '.git')) {
  $precedente = (& git -C $app rev-parse HEAD).Trim()
  Set-Content -Path (Join-Path $base 'version-precedente.txt') -Value $precedente -Encoding ASCII
}

# 1. Copie de production à la version demandée.
$repo = (& git -C $PSScriptRoot remote get-url origin).Trim()
if (-not (Test-Path (Join-Path $app '.git'))) {
  & git clone --quiet $repo $app
  if ($LASTEXITCODE -ne 0) { throw "git clone a échoué" }
}
& git -C $app fetch --quiet --prune --tags origin
if ($LASTEXITCODE -ne 0) { throw "git fetch a échoué" }
# La référence demandée, résolue en un commit précis. Rémy tourne encore : rien
# n'est arrêté si elle est introuvable ou si c'est une branche.
$commit = & git -C $app rev-parse --verify --quiet "$Ref^{commit}"
if (-not $commit) { throw "Version introuvable : $Ref. Rémy n'a pas été arrêté." }
$commit = "$commit".Trim()
$branche = & git -C $app for-each-ref --format='%(refname)' "refs/remotes/$Ref" "refs/remotes/origin/$Ref" "refs/heads/$Ref"
if ($branche -and -not $AutoriserBranche) {
  throw "« $Ref » est une branche : elle bouge, le retour arrière ne serait pas garanti. Déploie un tag (ex. tour-v0.2.0) ou le commit $commit. Rémy n'a pas été arrêté."
}
& git -C $app checkout --quiet --force --detach $commit
if ($LASTEXITCODE -ne 0) { throw "Version introuvable : $Ref" }
Push-Location $app
try {
  & npm ci --omit=dev --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { throw "npm ci a échoué" }
} finally { Pop-Location }

# 2. Réglages : créés une fois, jamais écrasés (les secrets y sont posés par Sam).
$dns = ((& tailscale status --json | ConvertFrom-Json).Self.DNSName).TrimEnd('.')
$url = "https://${dns}:$HttpsPort"
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

# 3. Tâche planifiée.
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
$node = (Get-Command node).Source
# Lanceur : node au premier plan de ce script (cmd.exe sous conhost --headless se
# ferme sans rien lancer). Node tient lui-même son journal (REMY_LOG) : relayée
# par PowerShell 5.1, sa sortie perdait les accents.
$runner = Join-Path $base 'run-remy.ps1'
$lanceur = @"
Set-Location -LiteralPath '$app'
`$env:REMY_LOG = '$log'
& '$node' '--env-file=$envFile' server.js
"@
[IO.File]::WriteAllText($runner, $lanceur, (New-Object Text.UTF8Encoding($true)))
# conhost --headless : aucune fenêtre (même raison que les tâches du fork T3).
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -WorkingDirectory $app `
  -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$runner`""
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
  Start-Process -FilePath 'conhost.exe' -WorkingDirectory $app -WindowStyle Hidden `
    -ArgumentList "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$runner`""
  Write-Warning "Rémy lancé directement (sans la tâche planifiée) : il ne redémarrera pas tout seul après une coupure. Relance l'installeur dans un PowerShell administrateur pour réparer la tâche."
}

# 4. Publication au tailnet seulement.
$serve = (& tailscale serve status --json | Out-String)
if ($serve -notmatch ":$HttpsPort`"") {
  & tailscale serve --bg --https=$HttpsPort "http://127.0.0.1:$Port" | Out-Null
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

$tagInstalle = & git -C $app tag --points-at HEAD | Select-Object -First 1
$installe = (& git -C $app rev-parse HEAD).Trim()
Write-Output "Rémy tourne : $(if ($tagInstalle) { "$tagInstalle = " })$installe — $url"
if ($precedente) {
  Write-Output "  retour    : powershell -ExecutionPolicy Bypass -File scripts\installer-tour.ps1 -Ref $precedente"
}
Write-Output "  cerveau   : $($h.cerveau)"
Write-Output "  GLM       : $($h.glm_local)"
Write-Output "  stockage  : $($h.stockage)"
Write-Output "  motion    : $($h.motion)"
Write-Output "  sauvegarde: $($h.sauvegardes)"
