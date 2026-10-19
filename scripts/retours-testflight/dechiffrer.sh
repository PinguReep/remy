#!/usr/bin/env bash
# dechiffrer.sh — ouvre un colis produit par chiffrer.sh avec la clé privée locale.
#
# Usage : dechiffrer.sh <colis.p7m> <prive.pem> <dossier_sortie>
#   <dossier_sortie> ne doit PAS exister : il n'apparaît que si tout a réussi.
#
# Sûreté :
#  - openssl cms -decrypt écrit le clair AVANT de vérifier le tag GCM (colis altéré :
#    clair non authentifié, et malléable, puis code 4). On déchiffre donc dans un
#    dossier temporaire voisin, effacé par un trap quoi qu'il arrive (échec, Ctrl-C),
#    et rien n'est gardé si openssl ne rend pas 0 (RFC 5083 §2).
#  - OpenSSL exigé : paquet Ubuntu >= 3.0.13-0ubuntu3.11, ou amont 3.0.x >= 3.0.21
#    (CVE-2025-15467 : débordement au décodage d'AuthEnvelopedData ; CVE-2026-34182 :
#    messages forgés acceptés). Autre version : refus, sauf OPENSSL_VERIFIE=1.
#  - Un CMS n'est pas signé : n'ouvrir que l'artefact du run qu'on a lancé soi-même.
#    L'archive est inspectée avant extraction : fichiers et dossiers seulement,
#    chemins relatifs sans « .. » ; extraction --no-same-owner --no-same-permissions.
#
# Messages fixes, aucun nom de fichier. Codes : 0 ok · 2 usage · 3 OpenSSL refusé ·
# 4 entrée ou sortie · 5 colis refusé.
set -euo pipefail
set +x
umask 077

echouer() { local code=$1; shift; printf 'dechiffrer : %s\n' "$*" >&2; exit "$code"; }

[ $# -eq 3 ] || echouer 2 "usage : dechiffrer.sh <colis.p7m> <prive.pem> <dossier_sortie>"
colis=$1
cle=$2
sortie=${3%/}
[ -n "$sortie" ] || echouer 2 "dossier de sortie invalide."

verifier_openssl() {
  local bin vers paquet etat
  bin=$(command -v openssl) || echouer 3 "openssl introuvable."
  [ "${OPENSSL_VERIFIE:-}" != 1 ] || return 0
  if [ "$(readlink -f -- "$bin")" = /usr/bin/openssl ] && command -v dpkg-query >/dev/null 2>&1; then
    for paquet in libssl3t64 libssl3; do
      etat=$(dpkg-query -W -f='${db:Status-Abbrev}|${Version}' "$paquet" 2>/dev/null) || continue
      case $etat in ii*) ;; *) continue ;; esac
      vers=${etat#*|}
      case $vers in
        3.0.13-0ubuntu*)
          if dpkg --compare-versions "$vers" ge 3.0.13-0ubuntu3.11; then return 0; fi
          echouer 3 "OpenSSL $vers trop ancien (CVE-2025-15467, CVE-2026-34182) : mettre à jour $paquet (>= 3.0.13-0ubuntu3.11)."
          ;;
      esac
      break
    done
  fi
  vers=$(openssl version 2>/dev/null) || echouer 3 "openssl ne répond pas."
  # « OpenSSL 3.0.13 30 Jan 2024 (Library: OpenSSL 3.0.13 30 Jan 2024) » : la bibliothèque compte.
  case $vers in *"(Library: "*) vers=${vers##*(Library: } ;; esac
  if [[ $vers =~ ^OpenSSL\ 3\.0\.([0-9]+)([^0-9]|$) ]] && [ "${BASH_REMATCH[1]}" -ge 21 ]; then
    return 0
  fi
  echouer 3 "OpenSSL non reconnu comme corrigé (CVE-2025-15467, CVE-2026-34182) : mettre à jour, ou OPENSSL_VERIFIE=1 après vérification."
}

[ -f "$colis" ] && [ -r "$colis" ] || echouer 4 "colis introuvable ou illisible."
[ -f "$cle" ] && [ -r "$cle" ] || echouer 4 "clé privée introuvable ou illisible."
# Testé AVANT de déchiffrer : sinon un mkdir en échec laisserait du clair derrière.
[ ! -e "$sortie" ] && [ ! -L "$sortie" ] || echouer 4 "le dossier de sortie existe déjà : rien n'est déchiffré."
parent=$(dirname -- "$sortie")
[ -d "$parent" ] && [ -w "$parent" ] || echouer 4 "le dossier parent de la sortie est absent ou protégé."
droits=$(stat -c %a -- "$cle" 2>/dev/null || echo 600)
case $droits in *00) ;; *) printf 'dechiffrer : attention, la clé privée est lisible par d'"'"'autres comptes (chmod 600).\n' >&2 ;; esac
verifier_openssl

# Dossier de travail VOISIN de la sortie : le mv final est un simple renommage.
travail=$(mktemp -d "$parent/.dechiffrer.XXXXXX")
trap 'rm -rf -- "$travail"' EXIT
trap 'exit 130' INT TERM HUP

rc=0
openssl cms -decrypt -binary -inform DER -in "$colis" -inkey "$cle" \
  -out "$travail/a.tgz" 2>/dev/null || rc=$?
if [ "$rc" -ne 0 ]; then
  rm -f -- "$travail/a.tgz"
  echouer 5 "colis refusé (altéré, mauvaise clé ou illisible ; openssl $rc) : rien n'est gardé."
fi

liste=$(tar -tvzf "$travail/a.tgz" 2>/dev/null) || echouer 5 "archive illisible : rien n'est gardé."
noms=$(tar -tzf "$travail/a.tgz" 2>/dev/null) || echouer 5 "archive illisible : rien n'est gardé."
while IFS= read -r ligne; do
  [ -n "$ligne" ] || continue
  case ${ligne:0:1} in
    -|d) ;;
    *) echouer 5 "archive refusée (lien ou fichier spécial) : rien n'est gardé." ;;
  esac
done <<< "$liste"
while IFS= read -r nom; do
  case $nom in
    /*|..|../*|*/..|*/../*) echouer 5 "archive refusée (chemin hors du dossier) : rien n'est gardé." ;;
  esac
done <<< "$noms"

mkdir -- "$travail/x"
tar -xzf "$travail/a.tgz" -C "$travail/x" --no-same-owner --no-same-permissions 2>/dev/null \
  || echouer 5 "extraction en échec : rien n'est gardé."
rm -f -- "$travail/a.tgz"
mv -T -- "$travail/x" "$sortie" || echouer 4 "impossible de créer le dossier de sortie : rien n'est gardé."
n=$(find "$sortie" -type f | wc -l)
echo "colis déchiffré : ${n// /} fichiers."
