# Faux installer-tour.ps1 pour l'essai de la mise à jour automatique (CI
# Windows, PowerShell 5.1) : mêmes paramètres, même contrat (code 0 : installé ;
# raison d'un arrêt dans installeur-raison.txt, en UTF-8), mais un simple
# `git checkout` de la copie. Lancé par scripts\maj-auto.mjs via powershell.exe -File.
param([string]$Ref = '', [switch]$Auto, [switch]$Retour)
$ErrorActionPreference = 'Stop'
$ligne = $Ref
if ($Auto) { $ligne += ' -Auto' }
if ($Retour) { $ligne += ' -Retour' }
Add-Content -LiteralPath $env:FAUX_INSTALLEUR_TRACE -Value $ligne -Encoding ASCII
if ($env:FAUX_INSTALLEUR_ARRET -eq '1' -and -not $Retour) {
  $raison = "Sauvegarde avant mise à jour impossible ou sans copie hors de la tour : rien n'a été changé. (essai)"
  [IO.File]::WriteAllText((Join-Path $env:REMY_MAJ_DIR 'installeur-raison.txt'), $raison, (New-Object Text.UTF8Encoding($false)))
  exit 1
}
$ErrorActionPreference = 'Continue'
& git -C $env:REMY_MAJ_APP checkout --quiet --force --detach $Ref
exit $LASTEXITCODE
