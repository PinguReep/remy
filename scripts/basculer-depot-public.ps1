# Bascule de la tour vers le dépôt public, UNE fois, sans rien perdre.
# Dans un PowerShell ADMINISTRATEUR, depuis une copie du dépôt public :
#   git clone https://github.com/PinguReep/remy $env:USERPROFILE\remy
#   powershell -ExecutionPolicy Bypass -File $env:USERPROFILE\remy\scripts\basculer-depot-public.ps1 -Ref <commit>
#
# 1. Range tes fichiers privés de la copie de production (l'ancien dépôt) dans
#    %USERPROFILE%\.remy\prive : constitution, décisions, audit, specs, docs, CLAUDE.md.
# 2. Y garde tout l'historique de l'ancien dépôt (historique-ancien-depot.bundle) :
#    ce dépôt peut ensuite disparaître de GitHub sans rien perdre.
# 3. Ajoute à remy.env ton prénom, ton vocabulaire de dictée et le dossier privé.
# 4. Fait suivre le dépôt public à la copie de production, puis lance l'installeur.
# Rien n'est supprimé, ni sur GitHub ni sur la tour. Relançable sans risque.
param(
  [Parameter(Mandatory = $true)][string]$Ref,
  [string]$Prenom = '',
  [string]$Vocabulaire = ''
)

$ErrorActionPreference = 'Stop'
$estAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $estAdmin) {
  throw "Relance cette commande dans un PowerShell ouvert en administrateur. Rien n'a été changé."
}
$base = Join-Path $env:USERPROFILE '.remy'
$app = Join-Path $base 'app'
$prive = Join-Path $base 'prive'
$envFile = Join-Path $base 'remy.env'
$utf8 = New-Object Text.UTF8Encoding($false)
$public = (& git -C $PSScriptRoot remote get-url origin).Trim()
if (-not (Test-Path (Join-Path $app '.git'))) { throw "Pas de copie de production dans $app : lance directement scripts\installer-tour.ps1." }
if (-not (Test-Path $envFile)) { throw "$envFile introuvable : rien n'a été changé." }
$actuel = (& git -C $app remote get-url origin).Trim()

if ($actuel -ne $public) {
  # 1. Le privé d'abord : l'installeur va remplacer ces fichiers par la version publique.
  New-Item -ItemType Directory -Force -Path $prive | Out-Null
  foreach ($f in 'constitution', 'DECISIONS.md', 'AUDIT.md', 'REMY_PRODUCT_SPEC.md', 'REMY_TECHNICAL_PLAN.md', 'CLAUDE.md', 'README.md', 'docs') {
    $source = Join-Path $app $f
    $cible = Join-Path $prive $f
    if ((Test-Path $source) -and -not (Test-Path $cible)) { Copy-Item -Recurse -Path $source -Destination $cible }
  }
  # 2. Tout l'historique de l'ancien dépôt, vérifié avant d'aller plus loin.
  $bundle = Join-Path $prive 'historique-ancien-depot.bundle'
  if (-not (Test-Path $bundle)) {
    & git -C $app bundle create $bundle --all
    if ($LASTEXITCODE -ne 0) { throw "Historique non sauvegardé : rien n'a été basculé." }
  }
  & git bundle verify $bundle | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Sauvegarde de l'historique illisible ($bundle) : rien n'a été basculé." }
  Write-Output "Privé rangé dans $prive (historique : $bundle)."
}

# 3. Ce qui te concerne vit dans remy.env, sur la tour seulement.
$reglages = [IO.File]::ReadAllText($envFile)
$ajouts = @()
if ($reglages -notmatch '(?m)^REMY_PRENOM=') {
  if (-not $Prenom) { $Prenom = Read-Host 'Ton prénom, tel que Rémy l''emploie' }
  $ajouts += "REMY_PRENOM=$Prenom"
}
if ($reglages -notmatch '(?m)^REMY_VOCABULAIRE=') {
  if (-not $Vocabulaire) { $Vocabulaire = Read-Host 'Mots que tu dictes souvent : proches, projets (facultatif, séparés par des virgules)' }
  $ajouts += "REMY_VOCABULAIRE=$Vocabulaire"
}
if ($reglages -notmatch '(?m)^REMY_PRIVE=') { $ajouts += "REMY_PRIVE=$prive" }
if ($ajouts.Count) {
  $texte = "`n# Toi (jamais dans le dépôt public) : prénom, vocabulaire de dictée, notes privées.`n" + ($ajouts -join "`n") + "`n"
  [IO.File]::AppendAllText($envFile, $texte, $utf8)
  Write-Output "remy.env : $($ajouts.Count) réglage(s) ajouté(s)."
}

# 4. La copie de production suit désormais le dépôt public.
if ($actuel -ne $public) {
  & git -C $app remote set-url origin $public
  if ($LASTEXITCODE -ne 0) { throw "Changement de dépôt impossible." }
  Write-Output "Copie de production : $actuel -> $public"
}
& (Join-Path $PSScriptRoot 'installer-tour.ps1') -Ref $Ref
