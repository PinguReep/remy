# Prévol de la tour AVANT tout déploiement (Lot 0). Ne change rien à Rémy :
# lit l'état du système, puis lance scripts\prevol.mjs (clé, destinations,
# Spark, sauvegarde « avant-lot0 » restaurée à l'essai).
#
#   powershell -ExecutionPolicy Bypass -File scripts\verifier-tour.ps1 [-SansSauvegarde]
#
# Pour voir BitLocker, lance-le dans un PowerShell « en tant qu'administrateur ».
param([switch]$SansSauvegarde)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$base = Join-Path $env:USERPROFILE '.remy'
$envFile = Join-Path $base 'remy.env'
$app = Join-Path $base 'app'
$bloquant = $false
function Ok($t) { Write-Output "  [OK] $t" }
function Info($t) { Write-Output "  [i]  $t" }
function Ko($t) { Write-Output "  [KO] $t"; $script:bloquant = $true }

Write-Output 'Système'
$os = Get-CimInstance Win32_OperatingSystem
Info "$($os.Caption) $($os.Version)"
try {
  $bl = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop
  Info "BitLocker $($env:SystemDrive) : $($bl.ProtectionStatus) ($($bl.VolumeStatus))"
} catch {
  Info 'BitLocker : relance ce script en administrateur pour le voir'
}
foreach ($o in 'node', 'git', 'ssh', 'sftp', 'ssh-keygen', 'tailscale', 'claude') {
  $c = Get-Command $o -ErrorAction SilentlyContinue
  if ($c) { Ok "$o : $($c.Source)" }
  elseif ($o -in 'node', 'git') { Ko "$o introuvable" }
  else { Info "$o introuvable" }
}
if (Get-Command claude -ErrorAction SilentlyContinue) { Info "Claude CLI : $(& claude --version 2>$null)" }

Write-Output ''
Write-Output 'Rémy installé'
$tache = Get-ScheduledTask -TaskName 'Rémy' -ErrorAction SilentlyContinue
if ($tache) { Info "Tâche planifiée « Rémy » : $($tache.State)" } else { Info 'Tâche planifiée « Rémy » : absente' }
if (Test-Path (Join-Path $app '.git')) {
  Info "Copie de production : $(& git -C $app log -1 --format='%h %s (%cd)' --date=short 2>$null)"
  $versionPrec = Join-Path $base 'version-precedente.txt'
  if (Test-Path $versionPrec) { Info "Version précédente notée : $(Get-Content $versionPrec -Raw)" }
} else {
  Info "Pas de copie de production dans $app"
}
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
  $serve = (& tailscale serve status 2>$null) -join ' '
  if ($serve) { Info "Tailscale Serve : $serve" } else { Info 'Tailscale Serve : rien de publié' }
}
Info "Ce dépôt : $(& git -C $PSScriptRoot rev-parse --abbrev-ref HEAD 2>$null) @ $(& git -C $PSScriptRoot log -1 --format='%h %s' 2>$null)"

Write-Output ''
if (-not (Test-Path $envFile)) {
  Ko "$envFile introuvable : lance d'abord scripts\installer-tour.ps1"
  exit 1
}
$argsPrevol = @()
if ($SansSauvegarde) { $argsPrevol += '--sans-sauvegarde' }
& node "--env-file=$envFile" (Join-Path $PSScriptRoot 'prevol.mjs') @argsPrevol
$code = $LASTEXITCODE
if ($bloquant -and $code -eq 0) { $code = 1; Write-Output "`n[KO] Un outil indispensable manque (voir « Système »)." }
exit $code
