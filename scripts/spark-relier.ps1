# Relie la tour à un DGX Spark pour les sauvegardes chiffrées (Lot 0), en
# attendant le disque externe. Trois temps :
#
#   1. Sur la tour :  powershell -ExecutionPolicy Bypass -File scripts\spark-relier.ps1 -Spark 192.168.1.51
#      → crée la clé SSH de la tour (si besoin) et affiche la commande pour le Spark.
#   2. Sur le Spark : sudo bash spark-preparer.sh "<clé>" <IP de la tour>
#      → compte enfermé, SFTP seul ; affiche l'empreinte du Spark.
#   3. Sur la tour :  ... scripts\spark-relier.ps1 -Spark 192.168.1.51 -Epingler
#      → épingle l'empreinte APRÈS comparaison, teste lecture/écriture, inscrit
#        REMY_SAUVEGARDES_SPARK dans remy.env.
#
# Diagnostic : -Relever affiche l'empreinte que voit la tour, sans rien épingler.
#
# Ne touche ni à Rémy, ni à ses données, ni à la clé des sauvegardes (qui ne va
# jamais sur le Spark).
param(
  [Parameter(Mandatory = $true)][string]$Spark,
  [string]$Utilisateur = 'remy-sauvegarde',
  [int]$Port = 22,
  [string]$Dossier = '/sauvegardes',
  [switch]$Epingler,
  [switch]$Relever
)

$ErrorActionPreference = 'Stop'
$base = Join-Path $env:USERPROFILE '.remy'
$cle = Join-Path $base 'spark_ed25519'
$hotes = Join-Path $base 'spark_hotes_connus'
$envFile = Join-Path $base 'remy.env'

foreach ($outil in 'ssh', 'ssh-keygen', 'sftp', 'node') {
  if (-not (Get-Command $outil -ErrorAction SilentlyContinue)) {
    throw "$outil introuvable (OpenSSH : Paramètres > Système > Fonctionnalités facultatives > Client OpenSSH). Rien n'a été changé."
  }
}
if ($Spark -notmatch '^[A-Za-z0-9.-]+$') { throw "Adresse du Spark illisible : $Spark" }
New-Item -ItemType Directory -Force $base | Out-Null

if (-not $Epingler -and -not $Relever) {
  if (-not (Test-Path $cle)) {
    # Sans phrase de passe : la sauvegarde de la nuit tourne sans personne. Cette
    # clé n'ouvre qu'un compte enfermé du Spark, qui ne peut que déposer et
    # relire des archives déjà chiffrées.
    $p = Start-Process -FilePath 'ssh-keygen' -ArgumentList "-q -t ed25519 -N `"`" -C remy-tour -f `"$cle`"" -NoNewWindow -Wait -PassThru
    if ($p.ExitCode -ne 0 -or -not (Test-Path $cle)) { throw 'Création de la clé SSH impossible.' }
    Write-Output "Clé SSH de la tour créée : $cle"
  } else {
    Write-Output "Clé SSH de la tour déjà là : $cle"
  }
  $pub = (Get-Content "$cle.pub" -Raw).Trim()
  $ipTour = $null
  try {
    $ipSpark = [System.Net.Dns]::GetHostAddresses($Spark) | Where-Object { $_.AddressFamily -eq 'InterNetwork' } | Select-Object -First 1
    $ipTour = (Find-NetRoute -RemoteIPAddress $ipSpark.IPAddressToString -ErrorAction Stop |
      Where-Object { $_.IPAddress } | Select-Object -First 1).IPAddress
  } catch {}
  Write-Output ''
  Write-Output 'Copie scripts\spark-preparer.sh sur le Spark (par ex. : scp scripts\spark-preparer.sh <toi>@<spark>:~), puis lance SUR LE SPARK :'
  Write-Output ''
  Write-Output "  sudo bash spark-preparer.sh `"$pub`" $ipTour"
  Write-Output ''
  if (-not $ipTour) { Write-Output "(IP de la tour non trouvée : ajoute-la à la fin de la commande — ipconfig.)" }
  Write-Output 'Puis reviens ici :'
  Write-Output "  powershell -ExecutionPolicy Bypass -File scripts\spark-relier.ps1 -Spark $Spark -Epingler"
  return
}

# --- Épingler l'empreinte du Spark, après comparaison par Sam -----------------
# Relevée par ssh lui-même (ssh-keyscan reste muet sur certaines tours
# Windows) : une connexion sans aucune authentification, qui échoue forcément,
# mais seulement après avoir noté la clé du Spark dans un fichier neuf. Config
# SSH vide : rien de ~/.ssh ne s'en mêle (clés, rebonds, hôtes déjà connus).
$tmp = "$hotes.nouveau"
$vide = "$hotes.vide"
Remove-Item -Force -ErrorAction SilentlyContinue $tmp
[IO.File]::WriteAllText($vide, '')
$ErrorActionPreference = 'Continue'
$sortie = & ssh -F ($vide -replace '\\', '/') -n -p $Port -l $Utilisateur `
  -o BatchMode=yes -o ConnectTimeout=15 -o PubkeyAuthentication=no -o PasswordAuthentication=no `
  -o KbdInteractiveAuthentication=no -o HostKeyAlgorithms=ssh-ed25519 -o HashKnownHosts=no `
  -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR `
  -o "UserKnownHostsFile=$($tmp -replace '\\', '/')" -o "GlobalKnownHostsFile=$($vide -replace '\\', '/')" `
  $Spark 2>&1
$ErrorActionPreference = 'Stop'
Remove-Item -Force -ErrorAction SilentlyContinue $vide
$lignes = @(if (Test-Path $tmp) { Get-Content $tmp | Where-Object { $_ -and $_ -notmatch '^#' } })
if (-not $lignes) {
  Remove-Item -Force -ErrorAction SilentlyContinue $tmp
  $sortie | ForEach-Object { Write-Output "   ssh : $_" }
  throw "Le Spark ne répond pas en SSH ($Spark, port $Port). Rien n'a été épinglé."
}
[IO.File]::WriteAllText($tmp, (($lignes) -join "`n") + "`n", (New-Object Text.UTF8Encoding($false)))
$annoncee = ((& ssh-keygen -lf $tmp) -join ' ' | Select-String -Pattern 'SHA256:[A-Za-z0-9+/=]+').Matches.Value | Select-Object -First 1
if (-not $annoncee) { Remove-Item -Force $tmp; throw "Empreinte du Spark illisible : rien n'a été épinglé." }
if ($Relever) { Remove-Item -Force $tmp; Write-Output "Empreinte vue par la tour : $annoncee (rien n'a été épinglé)"; return }
Write-Output ''
Write-Output 'Colle ici l''empreinte affichée par spark-preparer.sh SUR LE SPARK (la ligne « SHA256:… ») :'
# Rien de lisible (Entrée trop tôt, mauvaise ligne) : on redemande. Une
# empreinte lisible mais différente, elle, arrête tout.
$collee = $null
for ($essai = 1; $essai -le 3 -and -not $collee; $essai++) {
  $collee = ((Read-Host 'Empreinte') | Select-String -Pattern 'SHA256:[A-Za-z0-9+/=]+').Matches.Value | Select-Object -First 1
  if (-not $collee -and $essai -lt 3) { Write-Output 'Pas de « SHA256:… » dans ce que tu as collé : recopie la ligne « 256 SHA256:… ».' }
}
if (-not $collee) { Remove-Item -Force $tmp; throw "Aucune empreinte collée : rien n'a été épinglé. Relance : powershell -ExecutionPolicy Bypass -File scripts\spark-relier.ps1 -Spark $Spark -Port $Port -Epingler" }
if ($collee -cne $annoncee) {
  Remove-Item -Force $tmp
  throw "Empreintes DIFFÉRENTES (Spark : $annoncee ; collée : $collee) : rien n'a été épinglé. Quelqu'un peut s'interposer : ne continue pas."
}
Write-Output "Empreinte identique : $annoncee"
Move-Item -Force $tmp $hotes
Write-Output "Empreinte épinglée : $hotes"

if ($Port -eq 22) { $cible = "$Utilisateur@${Spark}:$Dossier" } else { $cible = "$Utilisateur@${Spark}:${Port}:$Dossier" }
& node (Join-Path $PSScriptRoot 'spark-tester.mjs') --cible $cible --enregistrer --fichier $envFile
if ($LASTEXITCODE -ne 0) { throw 'Test du Spark échoué : voir ci-dessus. remy.env n''a pas été modifié.' }
Write-Output ''
Write-Output 'Étape suivante : scripts\verifier-tour.ps1 (prévol complet, avec une vraie sauvegarde restaurée à l''essai).'
