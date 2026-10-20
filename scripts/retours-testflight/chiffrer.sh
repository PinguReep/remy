#!/usr/bin/env bash
# chiffrer.sh — chiffre un dossier pour UN destinataire, en CMS AuthEnvelopedData
# (AES-256-GCM, clé de contenu transportée en RSA-OAEP-SHA256), en flux depuis tar :
# aucune archive claire n'est écrite sur disque.
#
# Usage :
#   CLE_PUBLIQUE=<certificat> chiffrer.sh --verifier
#   CLE_PUBLIQUE=<certificat> chiffrer.sh [--supprimer-clair] <dossier_clair> <colis.p7m>
#
# CLE_PUBLIQUE : le certificat X.509 du destinataire (RSA-4096, non expiré) ; il ne
# contient que la clé PUBLIQUE (cms -recip exige un certificat). Formats acceptés :
# base64 du PEM (`base64 -w0 cert.pem`, format de la note), PEM (même aplati sur une
# ligne), ou base64 du DER.
#
# Journal : messages fixes seulement (pas de set -x, pas de tar -v, stderr de tar et
# d'openssl coupé, aucun nom de fichier). Ce qui reste visible : la taille du colis
# (à quelques octets près : GCM n'a pas de bourrage) et l'empreinte du certificat.
#
# Codes : 0 ok · 2 usage · 3 certificat refusé · 4 dossier ou fichier · 5 chiffrement.
set -euo pipefail
set +x
umask 077

echouer() { local code=$1; shift; printf 'chiffrer : %s\n' "$*" >&2; exit "$code"; }

verifier=0
supprimer=0
while [ $# -gt 0 ]; do
  case $1 in
    --verifier) verifier=1; shift ;;
    --supprimer-clair) supprimer=1; shift ;;
    --) shift; break ;;
    -*) echouer 2 "option inconnue (usage : [--verifier] [--supprimer-clair] <dossier_clair> <colis.p7m>)." ;;
    *) break ;;
  esac
done
if [ "$verifier" = 1 ]; then
  [ $# -eq 0 ] || echouer 2 "--verifier ne prend pas d'argument."
else
  [ $# -eq 2 ] || echouer 2 "usage : chiffrer.sh [--supprimer-clair] <dossier_clair> <colis.p7m>"
fi
command -v openssl >/dev/null 2>&1 || echouer 5 "openssl introuvable."

travail=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/chiffrer.XXXXXX")
partiel=
nettoyer() { rm -rf -- "$travail"; if [ -n "$partiel" ]; then rm -f -- "$partiel"; fi; }
trap nettoyer EXIT
trap 'exit 130' INT TERM HUP

# --- 1. Certificat : PEM, PEM aplati, base64 du PEM ou base64 du DER -> cert.pem
v=${CLE_PUBLIQUE:-}
[ -n "$v" ] || echouer 3 "CLE_PUBLIQUE est vide (certificat du destinataire attendu)."
[ "${#v}" -le 20000 ] || echouer 3 "CLE_PUBLIQUE est trop longue pour un certificat."
if [[ $v != *"-----BEGIN CERTIFICATE-----"* ]]; then
  printf '%s' "$v" | tr -d ' \t\r\n' | base64 -d > "$travail/decode" 2>/dev/null \
    || echouer 3 "CLE_PUBLIQUE n'est ni un PEM ni du base64 valide."
  if grep -aq -- "-----BEGIN CERTIFICATE-----" "$travail/decode"; then
    v=$(cat -- "$travail/decode")
  else
    mv -- "$travail/decode" "$travail/cert.der"
  fi
fi
if [[ $v == *"-----BEGIN CERTIFICATE-----"* ]]; then
  # Un champ de saisie d'une ligne peut avoir mangé les sauts de ligne : on ne garde
  # que le corps base64 du PREMIER certificat.
  plat=$(printf '%s' "$v" | tr -d ' \t\r\n')
  [[ $plat == *"-----ENDCERTIFICATE-----"* ]] || echouer 3 "certificat PEM tronqué."
  corps=${plat#*-----BEGINCERTIFICATE-----}
  corps=${corps%%-----ENDCERTIFICATE-----*}
  printf '%s' "$corps" | base64 -d > "$travail/cert.der" 2>/dev/null \
    || echouer 3 "certificat PEM illisible."
fi
openssl x509 -inform DER -in "$travail/cert.der" -out "$travail/cert.pem" 2>/dev/null \
  || echouer 3 "certificat illisible."

# --- 2. Contrôles : non expiré, clé RSA d'exactement 4096 bits.
# (La première ligne de « rsa -pubin -text » et elle seule : un grep sur tout
#  « x509 -text » se laisserait berner par un sujet CN="Public-Key: (4096 bit)".)
openssl x509 -in "$travail/cert.pem" -noout -checkend 0 >/dev/null 2>&1 \
  || echouer 3 "certificat expiré."
openssl x509 -in "$travail/cert.pem" -noout -pubkey > "$travail/pub.pem" 2>/dev/null \
  || echouer 3 "clé publique illisible."
texte=$(openssl rsa -pubin -in "$travail/pub.pem" -noout -text 2>/dev/null) \
  || echouer 3 "clé RSA-4096 attendue (la clé du certificat n'est pas RSA)."
[ "${texte%%$'\n'*}" = "Public-Key: (4096 bit)" ] || echouer 3 "clé RSA-4096 attendue."
empreinte=$(openssl x509 -in "$travail/cert.pem" -noout -fingerprint -sha256 2>/dev/null) \
  || echouer 3 "empreinte du certificat impossible."
echo "certificat accepté (RSA-4096, SHA-256 ${empreinte#*=})"
[ "$verifier" = 0 ] || exit 0

# --- 3. Chiffrement en flux.
clair=$1
colis=$2
[ -d "$clair" ] || echouer 4 "dossier clair introuvable."
[ -n "$(ls -A -- "$clair")" ] || echouer 4 "dossier clair vide."
[ ! -e "$colis" ] && [ ! -L "$colis" ] || echouer 4 "le fichier de sortie existe déjà."
mkdir -p -- "$(dirname -- "$colis")"
partiel=$(mktemp "$(dirname -- "$colis")/.colis.XXXXXX")
# -keyopt APRÈS -recip (sinon « No key specified »).
if ! tar -C "$clair" -czf - --owner=0 --group=0 --numeric-owner . 2>/dev/null \
  | openssl cms -encrypt -binary -aes-256-gcm -outform DER -out "$partiel" \
      -recip "$travail/cert.pem" -keyopt rsa_padding_mode:oaep \
      -keyopt rsa_oaep_md:sha256 -keyopt rsa_mgf1_md:sha256 2>/dev/null; then
  echouer 5 "chiffrement en échec."
fi
# Contrôle : c'est bien un AuthEnvelopedData (OID 1.2.840.113549.1.9.16.1.23), donc GCM.
entete=$(head -c 64 -- "$partiel" | od -An -v -tx1 | tr -d ' \n')
[[ $entete == *060b2a864886f70d0109100117* ]] || echouer 5 "colis inattendu (pas d'AuthEnvelopedData)."
mv -- "$partiel" "$colis"
partiel=
if [ "$supprimer" = 1 ]; then
  rm -rf -- "$clair"
fi
echo "colis chiffré prêt."
