# Garde les sessions Claude Code au lieu de les laisser effacer au bout de
# 30 jours (réglage « cleanupPeriodDays » de Claude Code). Rémy apprendra de ces
# sessions : effacées, elles sont perdues pour de bon.
#   powershell -ExecutionPolicy Bypass -File scripts\claude-retention.ps1 [-Jours 3650]
# - Ne touche qu'à cette clé de settings.json, dans %USERPROFILE%\.claude (et
#   CLAUDE_CONFIG_DIR s'il est posé) ; le reste du fichier est gardé tel quel.
# - Une copie « settings.json.avant-remy-<date> » est faite avant toute écriture.
# - Un fichier illisible n'est jamais réécrit : le script le dit et s'arrête.
# - Une valeur déjà plus grande est laissée.
param([int]$Jours = 3650)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding($false)
$dossiers = @(Join-Path $env:USERPROFILE '.claude')
if ($env:CLAUDE_CONFIG_DIR) { $dossiers += $env:CLAUDE_CONFIG_DIR }
$dossiers = $dossiers | Select-Object -Unique

foreach ($d in $dossiers) {
  if (-not (Test-Path $d)) { Write-Output "Claude Code : $d absent, rien à régler."; continue }
  $fichier = Join-Path $d 'settings.json'
  $reglages = New-Object PSObject
  if (Test-Path $fichier) {
    $texte = [IO.File]::ReadAllText($fichier)
    if ($texte.Trim()) {
      try { $reglages = $texte | ConvertFrom-Json } catch {
        Write-Output "Claude Code : $fichier illisible (JSON invalide) : laissé tel quel, règle cleanupPeriodDays à la main."
        continue
      }
    }
    $actuel = $reglages.PSObject.Properties['cleanupPeriodDays']
    if ($actuel -and [int]$actuel.Value -ge $Jours) {
      Write-Output "Claude Code : sessions déjà gardées $($actuel.Value) jours ($fichier)."
      continue
    }
    Copy-Item $fichier ($fichier + '.avant-remy-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  }
  if ($reglages.PSObject.Properties['cleanupPeriodDays']) {
    $reglages.cleanupPeriodDays = $Jours
  } else {
    $reglages | Add-Member -NotePropertyName cleanupPeriodDays -NotePropertyValue $Jours
  }
  [IO.File]::WriteAllText($fichier, ($reglages | ConvertTo-Json -Depth 32), $utf8)
  Write-Output "Claude Code : sessions gardées $Jours jours ($fichier)."
}
