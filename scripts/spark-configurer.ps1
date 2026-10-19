# Relie la tour au Spark principal pour les sauvegardes, en une seule commande.
#
#   powershell -ExecutionPolicy Bypass -File scripts\spark-configurer.ps1
#   … -ConfigSsh C:/chemin/ssh_config -Hote spark-xxxx   (ta connexion habituelle :
#      compte, adresse et clé sont lus dans ce fichier, rien à connaître)
#
# Tu n'as que trois choses à faire, quand le script le demande :
#   1. ton nom d'utilisateur sur le Spark (sauf avec -Hote) ;
#   2. le mot de passe du Spark, chaque fois que ssh ou sudo le demande ;
#   3. coller l'empreinte « SHA256:… » que le Spark vient d'afficher.
#
# Il enchaîne : vérification que c'est bien le Spark principal (GLM répond),
# clé SSH de la tour, préparation du Spark (spark-preparer.sh, lancé à
# distance), épinglage de l'empreinte et essai (spark-relier.ps1 -Epingler).
# Ne touche ni à Rémy, ni à ses données, ni à GLM, ni à la clé des sauvegardes.
param(
  [string]$Spark = '192.168.1.50',
  [string]$Compte = '',
  [string]$ConfigSsh = '',
  [string]$Hote = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$base = Join-Path $env:USERPROFILE '.remy'
$cle = Join-Path $base 'spark_ed25519'

foreach ($outil in 'ssh', 'scp', 'ssh-keygen', 'node') {
  if (-not (Get-Command $outil -ErrorAction SilentlyContinue)) {
    throw "$outil introuvable (OpenSSH : Paramètres > Système > Fonctionnalités facultatives > Client OpenSSH). Rien n'a été changé."
  }
}
New-Item -ItemType Directory -Force $base | Out-Null

# Ta connexion habituelle (un fichier de config SSH et son alias) : le compte et
# l'adresse du Spark en sont lus par « ssh -G », la clé suit toute seule.
$optsSsh = @()
$Port = 22
if ($ConfigSsh) {
  if (-not (Test-Path $ConfigSsh)) { throw "Fichier de config SSH introuvable : $ConfigSsh" }
  $optsSsh = @('-F', $ConfigSsh)
}
if ($Hote) {
  $resolu = & ssh @optsSsh -G $Hote
  $Spark = (($resolu | Where-Object { $_ -match '^hostname ' } | Select-Object -First 1) -replace '^hostname ', '').Trim()
  $Compte = (($resolu | Where-Object { $_ -match '^user ' } | Select-Object -First 1) -replace '^user ', '').Trim()
  $lu = (($resolu | Where-Object { $_ -match '^port ' } | Select-Object -First 1) -replace '^port ', '').Trim()
  if ($lu -match '^\d+$') { $Port = [int]$lu }
  if (-not $Spark -or -not $Compte) { throw "« $Hote » introuvable dans la config SSH." }
  $cibleSsh = $Hote
  Write-Output "Connexion « $Hote » : compte $Compte sur $Spark (port $Port)."
  if ($resolu | Where-Object { $_ -match '^(proxyjump|proxycommand) ' -and $_ -notmatch ' none$' }) {
    Write-Output "     Attention : cette connexion passe par un rebond ; la sauvegarde de la nuit, elle,"
    Write-Output "     ira directement de la tour à $Spark. Si l'étape 4 échoue, envoie-moi la sortie."
  }
}

# --- 1. Le Spark principal : celui qui sert GLM ---------------------------------
Write-Output ''
Write-Output "1/4  Le Spark principal ($Spark)"
try {
  $modeles = Invoke-RestMethod "http://${Spark}:8888/v1/models" -TimeoutSec 10
  Write-Output "     OK : GLM répond ici ($(@($modeles.data)[0].id)) — c'est bien le Spark principal."
} catch {
  Write-Output "     GLM ne répond pas sur ${Spark}:8888 : ce n'est peut-être pas le Spark principal."
  if ((Read-Host '     Continuer quand même ? (oui/non)') -ne 'oui') { return }
}

# --- 2. Ton compte sur le Spark -------------------------------------------------
Write-Output ''
Write-Output '2/4  Ton compte sur le Spark'
if (-not $Compte) {
  # Un compte déjà utilisé pour ce Spark dans ta config SSH, sinon ton nom Windows.
  $propose = $null
  $config = Join-Path $HOME '.ssh\config'
  if (Test-Path $config) {
    $noms = @(); $hote = $null; $util = $null
    foreach ($l in @(Get-Content $config) + 'Host __fin__') {
      if ($l -match '^\s*Host\s+(.+)$') {
        if ($util -and (($noms -contains $Spark) -or $hote -eq $Spark)) { $propose = $util; break }
        $noms = $Matches[1] -split '\s+'; $hote = $null; $util = $null
      } elseif ($l -match '^\s*HostName\s+(\S+)') { $hote = $Matches[1] }
      elseif ($l -match '^\s*User\s+(\S+)') { $util = $Matches[1] }
    }
  }
  if (-not $propose) { $propose = "$env:USERNAME".ToLower() }
  $saisi = Read-Host "     Nom d'utilisateur sur le Spark (celui de son installation / NVIDIA Sync) [$propose]"
  if ($saisi) { $Compte = $saisi.Trim() } else { $Compte = $propose }
}
if ($Compte -notmatch '^[a-z_][a-z0-9_.-]{0,31}$') { throw "Nom d'utilisateur illisible : $Compte" }
if (-not $Hote) { $cibleSsh = "${Compte}@${Spark}" }
Write-Output "     Compte : $Compte"

# --- 3. Clé SSH de la tour, puis préparation du Spark -----------------------------
Write-Output ''
Write-Output '3/4  Préparation du Spark'
if (-not (Test-Path $cle)) {
  # Sans phrase de passe : la sauvegarde de la nuit tourne sans personne. Elle
  # n'ouvre qu'un compte enfermé, qui ne peut que déposer des archives chiffrées.
  $p = Start-Process -FilePath 'ssh-keygen' -ArgumentList "-q -t ed25519 -N `"`" -C remy-tour -f `"$cle`"" -NoNewWindow -Wait -PassThru
  if ($p.ExitCode -ne 0 -or -not (Test-Path $cle)) { throw 'Création de la clé SSH impossible.' }
  Write-Output "     Clé SSH de la tour créée : $cle"
}
$pub = (Get-Content "$cle.pub" -Raw).Trim()
$ipTour = $null
try {
  $ipSpark = [System.Net.Dns]::GetHostAddresses($Spark) | Where-Object { $_.AddressFamily -eq 'InterNetwork' } | Select-Object -First 1
  $ipTour = (Find-NetRoute -RemoteIPAddress $ipSpark.IPAddressToString -ErrorAction Stop |
    Where-Object { $_.IPAddress } | Select-Object -First 1).IPAddress
} catch {}
if ($ipTour) { Write-Output "     Seule la tour ($ipTour) pourra déposer des sauvegardes." }
else { Write-Output "     (IP de la tour introuvable : l'accès sera limité à la clé seule.)" }

# sudo demandera-t-il un mot de passe ? Mieux vaut le savoir avant de commencer.
$sudo = & ssh @optsSsh -n -o StrictHostKeyChecking=accept-new $cibleSsh "sudo -n true 2>/dev/null && echo SUDO_LIBRE || echo SUDO_MDP"
if ($LASTEXITCODE -ne 0 -or -not $sudo) { throw "Connexion au Spark impossible ($cibleSsh) : voir le message ci-dessus. Rien n'a été changé." }
if ("$sudo" -match 'SUDO_MDP') {
  Write-Output "     Sur le Spark, sudo demandera le mot de passe du compte « $Compte »."
  if ((Read-Host '     Tu le connais ? (oui/non)') -ne 'oui') {
    Write-Output "     Arrêt : rien n'a été changé. Dis-moi « je ne connais pas le mot de passe sudo »."
    return
  }
}
Write-Output "     Le Spark peut demander le mot de passe de « $Compte » (copie, connexion, puis sudo)."
Write-Output "     Rien ne s'affiche pendant la saisie, c'est normal. Si sudo demande un mot de passe"
Write-Output "     que tu ne connais pas : Ctrl+C, rien n'aura été changé, et dis-le-moi."
# Git sous Windows a pu passer le script en fins de ligne CRLF : bash
# s'arrêterait dès la première ligne (« pipefail\r »). On envoie une copie
# en fins de ligne Unix.
$preparer = [IO.Path]::GetTempFileName()
try {
  $texte = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'spark-preparer.sh')) -replace "`r`n", "`n"
  [IO.File]::WriteAllText($preparer, $texte, (New-Object Text.UTF8Encoding($false)))
  & scp @optsSsh -o StrictHostKeyChecking=accept-new $preparer "${cibleSsh}:spark-preparer.sh"
} finally { Remove-Item -Force -ErrorAction SilentlyContinue $preparer }
if ($LASTEXITCODE -ne 0) { throw "Copie vers le Spark impossible : nom d'utilisateur ou mot de passe ? Rien n'a été changé sur le Spark." }
& ssh @optsSsh -t -o StrictHostKeyChecking=accept-new $cibleSsh "sudo bash ~/spark-preparer.sh '$pub' $ipTour; code=`$?; rm -f ~/spark-preparer.sh; exit `$code"
if ($LASTEXITCODE -ne 0) { throw 'La préparation du Spark a échoué : voir les messages ci-dessus.' }

# --- 4. Épingler l'empreinte du Spark et essayer --------------------------------
Write-Output ''
Write-Output '4/4  Empreinte du Spark et essai'
Write-Output "     Sélectionne à la souris la ligne « 256 SHA256:… » affichée ci-dessus par le Spark, copie-la."
& (Join-Path $PSScriptRoot 'spark-relier.ps1') -Spark $Spark -Port $Port -Epingler
Write-Output ''
Write-Output 'Fini. Étape suivante : powershell -ExecutionPolicy Bypass -File scripts\verifier-tour.ps1'
