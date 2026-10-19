# État de BitLocker et de ses prérequis sur la tour — LECTURE SEULE.
#
#   PowerShell « en tant qu'administrateur », dans le dépôt :
#   powershell -ExecutionPolicy Bypass -File scripts\bitlocker-etat.ps1
#
# N'active, ne suspend, ne chiffre, ne déchiffre rien ; ne redémarre pas ; ne
# crée ni ne supprime aucune clé. N'affiche JAMAIS une clé de récupération :
# seulement le TYPE et l'IDENTIFIANT {…} de chaque protecteur (l'identifiant
# sert à retrouver la bonne clé dans 1Password ou un compte Microsoft, il ne
# déverrouille rien). Sortie à m'envoyer telle quelle.
param()

$ErrorActionPreference = 'Continue'
function Ok($t) { Write-Output "  [OK] $t" }
function Info($t) { Write-Output "  [i]  $t" }
function Ko($t) { Write-Output "  [KO] $t" }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Output "Relance ce script dans un PowerShell « en tant qu'administrateur » (clic droit sur PowerShell) : BitLocker et la puce TPM ne se lisent qu'ainsi. Rien n'a été fait."
  exit 1
}

# --- Windows et micrologiciel ------------------------------------------------------
Write-Output 'Windows'
$os = Get-CimInstance Win32_OperatingSystem
Info "$($os.Caption) $($os.Version)"
if ($os.Caption -match 'Famille|Home') { Ko "Édition Famille : pas de BitLocker complet (seulement le « chiffrement de l'appareil »)" }
else { Ok 'Édition compatible BitLocker' }
if ($env:firmware_type -eq 'UEFI') { Ok 'Démarrage UEFI' } else { Ko "Démarrage : $($env:firmware_type) (UEFI attendu)" }
try {
  if (Confirm-SecureBootUEFI -ErrorAction Stop) { Ok 'Démarrage sécurisé (Secure Boot) : actif' } else { Info 'Démarrage sécurisé (Secure Boot) : inactif' }
} catch { Info 'Démarrage sécurisé (Secure Boot) : non lisible ici' }

# --- Puce TPM --------------------------------------------------------------------------
Write-Output ''
Write-Output 'Puce TPM'
try {
  $tpm = Get-Tpm -ErrorAction Stop
  if (-not $tpm.TpmPresent) { Ko 'Aucune puce TPM visible (à activer dans le BIOS : « fTPM » AMD ou « PTT » Intel)' }
  else {
    $spec = (Get-CimInstance -Namespace 'root\cimv2\security\microsofttpm' -ClassName Win32_Tpm -ErrorAction SilentlyContinue).SpecVersion
    $version = if ($spec) { ($spec -split ',')[0].Trim() } else { '?' }
    if ($version -eq '2.0') { Ok "TPM $version ($($tpm.ManufacturerIdTxt) $($tpm.ManufacturerVersion))" } else { Ko "TPM $version : 2.0 attendu" }
    if ($tpm.TpmReady) { Ok 'TPM prêt' } else { Ko "TPM pas prêt (activé : $($tpm.TpmEnabled), activé/possédé : $($tpm.TpmActivated)/$($tpm.TpmOwned))" }
    if ($tpm.LockedOut) { Ko 'TPM verrouillé (trop d''essais) : à régler avant toute activation' }
  }
} catch { Ko "TPM illisible : $($_.Exception.Message)" }

# --- Environnement de récupération ------------------------------------------------------
Write-Output ''
Write-Output 'Récupération Windows (WinRE)'
# La ligne d'ÉTAT (pas celle de la version) : « Enabled » / « Disabled » restent
# en anglais même sous Windows en français.
$re = (& reagentc /info) | Where-Object { $_ -match 'Windows RE' -and $_ -match 'Enabled|Disabled' } | Select-Object -First 1
if ($re -match 'Enabled') { Ok 'WinRE : activé (l''écran de récupération au démarrage fonctionnera)' }
elseif ($re) { Ko 'WinRE : désactivé (à réactiver avant BitLocker : reagentc /enable)' }
else { Info 'WinRE : état non lisible' }

# --- BitLocker, volume par volume ------------------------------------------------------
Write-Output ''
Write-Output 'BitLocker'
$volumes = $null
try { $volumes = @(Get-BitLockerVolume -ErrorAction Stop) } catch { Ko "BitLocker illisible : $($_.Exception.Message)" }
foreach ($v in @($volumes)) {
  if (-not $v) { continue }
  # Le type et l'identifiant seulement : jamais .RecoveryPassword ni .KeyFileName.
  $protecteurs = @($v.KeyProtector | ForEach-Object { "$($_.KeyProtectorType) $($_.KeyProtectorId)" })
  $etat = "$($v.MountPoint) [$($v.VolumeType)] : $($v.VolumeStatus), protection $($v.ProtectionStatus), $($v.EncryptionPercentage) %, méthode $($v.EncryptionMethod)"
  if ($v.ProtectionStatus -eq 'On') { Ok "$etat — PROTÉGÉ" }
  elseif ($v.LockStatus -eq 'Locked') { Info "$etat — verrouillé (chiffré, pas ouvert en ce moment)" }
  elseif ($v.VolumeStatus -eq 'FullyDecrypted' -and -not $protecteurs.Count) { Info "$etat — pas chiffré, aucune configuration commencée" }
  elseif ($v.VolumeStatus -ne 'FullyDecrypted' -and -not $protecteurs.Count) { Ko "$etat — chiffré mais clé en clair sur le disque (« en attente d'activation ») : PAS protégé" }
  elseif ($v.VolumeStatus -eq 'FullyDecrypted') { Info "$etat — pas chiffré, mais des protecteurs existent déjà (configuration commencée)" }
  else { Ko "$etat — protection SUSPENDUE : chiffré mais pas protégé" }
  if ($protecteurs.Count) { foreach ($p in $protecteurs) { Write-Output "         protecteur : $p" } }
  else { Write-Output '         protecteurs : aucun' }
}

# Une configuration déjà commencée, une clé déjà sauvegardée par Windows
# (compte Microsoft, Entra ID…) ? Le journal BitLocker le dit — ses messages
# ne contiennent jamais de clé.
$journal = @()
try { $journal = @(Get-WinEvent -LogName 'Microsoft-Windows-BitLocker/BitLocker Management' -MaxEvents 300 -ErrorAction Stop) } catch {}
$court = { param($e) $m = (($e.Message -split "`r?`n") -join ' ') -replace '\s+', ' '; if ($m.Length -gt 200) { $m = $m.Substring(0, 200) + '…' }; "         $($e.TimeCreated.ToString('yyyy-MM-dd HH:mm')) [$($e.Id)] $m" }
$sauvees = @($journal | Where-Object { $_.Message -match 'backed up|sauvegard' } | Select-Object -First 4)
if ($sauvees.Count) {
  Info 'Clé de récupération déjà sauvegardée par Windows (ou tentative) :'
  foreach ($e in $sauvees) { & $court $e }
} else { Info 'Aucune trace de clé sauvegardée par Windows (compte Microsoft, Entra ID…)' }
if ($journal.Count) {
  Info "Journal BitLocker : $($journal.Count) évènement(s), les plus récents :"
  foreach ($e in ($journal | Select-Object -First 5)) { & $court $e }
} else { Info 'Journal BitLocker : vide (rien n''a jamais été tenté)' }
$compte = Get-LocalUser -Name $env:USERNAME -ErrorAction SilentlyContinue
# Avec BitLocker « TPM seul », le disque s'ouvre tout seul au démarrage : c'est
# le mot de passe de session qui garde la porte. Une ouverture de session
# automatique la laisserait grande ouverte. (On ne lit JAMAIS la valeur d'un
# mot de passe enregistré, seulement s'il y en a un.)
$winlogon = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -ErrorAction SilentlyContinue
if ("$($winlogon.AutoAdminLogon)" -eq '1') {
  $mdpStocke = if ($null -ne $winlogon.DefaultPassword) { ', mot de passe stocké en clair dans le registre' } else { '' }
  Ko "Ouverture de session automatique : ACTIVE ($($winlogon.DefaultUserName)$mdpStocke) — avec BitLocker, un voleur démarrerait droit dans ta session"
} else { Ok 'Ouverture de session automatique : désactivée' }
if ($compte) {
  if ($compte.PasswordRequired -eq $false -or -not $compte.PasswordLastSet) { Ko "Compte « $($compte.Name) » : pas de mot de passe défini (c'est lui qui gardera la porte)" }
  else { Info "Compte « $($compte.Name) » : mot de passe défini le $($compte.PasswordLastSet.ToString('yyyy-MM-dd'))" }
}
if ($compte) {
  if ("$($compte.PrincipalSource)" -eq 'MicrosoftAccount') { Info 'Session Windows : compte Microsoft (Windows a pu y déposer une clé : account.microsoft.com/devices/recoverykey)' }
  else { Info "Session Windows : compte $($compte.PrincipalSource) (pas de dépôt automatique de clé chez Microsoft par ce biais)" }
}

$fve = 'HKLM:\SOFTWARE\Policies\Microsoft\FVE'
if (Test-Path $fve) {
  $regles = (Get-ItemProperty $fve).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { "$($_.Name)=$($_.Value)" }
  Info "Stratégies BitLocker posées : $($regles -join ', ')"
} else { Info 'Stratégies BitLocker : aucune (réglages par défaut de Windows)' }

# --- Où sont les données de Rémy -----------------------------------------------------------
Write-Output ''
Write-Output 'Données de Rémy'
$envFile = Join-Path $env:USERPROFILE '.remy\remy.env'
$coffre = $null
if (Test-Path $envFile) {
  # Seulement REMY_VAULT : aucune autre valeur de remy.env n'est lue.
  $ligne = Get-Content -Encoding UTF8 $envFile | Where-Object { $_ -match '^\s*REMY_VAULT\s*=' } | Select-Object -First 1
  if ($ligne) { $coffre = ($ligne -replace '^\s*REMY_VAULT\s*=\s*', '').Trim().Trim('"') }
}
$lieux = [ordered]@{ 'Réglages et sauvegardes locales (.remy)' = (Join-Path $env:USERPROFILE '.remy') }
if ($coffre) { $lieux['Coffre'] = $coffre }
foreach ($nom in $lieux.Keys) {
  $chemin = $lieux[$nom]
  $lecteur = (Split-Path -Qualifier $chemin) + '\'
  $v = @($volumes) | Where-Object { $_ -and $_.MountPoint -eq (Split-Path -Qualifier $chemin) } | Select-Object -First 1
  $prot = if ($v) { "BitLocker $($v.ProtectionStatus)" } else { 'BitLocker ?' }
  Info "$nom : $chemin (lecteur $lecteur, $prot)"
  if ($env:OneDrive -and $chemin.StartsWith($env:OneDrive, [StringComparison]::OrdinalIgnoreCase)) { Ko "$nom est DANS OneDrive : synchronisé chez Microsoft" }
}
$docs = [Environment]::GetFolderPath('MyDocuments')
if ($env:OneDrive -and $docs.StartsWith($env:OneDrive, [StringComparison]::OrdinalIgnoreCase)) { Info "« Documents » est redirigé dans OneDrive ($docs)" }
else { Info "« Documents » n'est pas redirigé dans OneDrive ($docs)" }

# --- Ce qui compte pour un redémarrage ------------------------------------------------------
Write-Output ''
Write-Output 'Redémarrage (pour plus tard)'
$tache = Get-ScheduledTask -TaskName 'Rémy' -ErrorAction SilentlyContinue
if ($tache) {
  $declencheurs = ($tache.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace '^MSFT_Task|Trigger$', '' }) -join ', '
  Info "Tâche « Rémy » : démarre à $declencheurs (« Logon » : Rémy repart quand tu ouvres ta session)"
} else { Info 'Tâche « Rémy » : absente' }
Get-Volume -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' } | ForEach-Object {
  Info ("Lecteur {0}: {1} — {2:N0} Go, {3:N0} Go libres" -f $_.DriveLetter, $_.FileSystemLabel, ($_.Size / 1GB), ($_.SizeRemaining / 1GB))
}

Write-Output ''
Write-Output 'Fin : rien n''a été modifié. Aucune clé affichée.'
exit 0
