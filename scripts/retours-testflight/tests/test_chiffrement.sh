#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2059  # guillemets simples voulus (cales), format printf construit exprès
# Tests de chiffrer.sh / dechiffrer.sh : aller-retour, formats du certificat, refus,
# colis altérés, archive piégée, version d'OpenSSL, interruption, journaux.
# Usage : bash test_chiffrement.sh [python_avec_cryptography]   (pour le certificat expiré)
set -uo pipefail
ICI=$(cd "$(dirname "$0")" && pwd)
B=$(dirname "$ICI")
C="$B/chiffrer.sh"
D="$B/dechiffrer.sh"
PY=${1:-}
T=$(mktemp -d "${TMPDIR:-/tmp}/test-chiffrement.XXXXXX")
trap 'rm -rf -- "$T"' EXIT        # clés privées de test comprises
mkdir -p "$T/j"
ok=0; ko=0
verifier() { local d=$1; shift; if "$@"; then ok=$((ok+1)); printf '  ok    %s\n' "$d"; else ko=$((ko+1)); printf '  ÉCHEC %s\n' "$d"; fi; }
executer() { local n=$1; shift; "$@" >"$T/j/$n.out" 2>"$T/j/$n.err"; RC=$?; }
sortie() { cat "$T/j/$1.out" "$T/j/$1.err"; }
contient() { grep -q -- "$2" "$T/j/$1.out" "$T/j/$1.err"; }
sans_reste() { [ -z "$(find "$1" -maxdepth 1 \( -name '.dechiffrer.*' -o -name '.colis.*' \) | head -1)" ]; }
egal() { [ "$1" = "$2" ]; }

echo "== préparation (RSA-4096 comme dans la note)"
openssl version
dpkg-query -W -f='libssl3t64 ${Version}\n' libssl3t64 2>/dev/null || true
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out "$T/prive.pem" 2>/dev/null
openssl req -new -x509 -key "$T/prive.pem" -subj /CN=colis -days 2 -out "$T/cert.pem" 2>/dev/null
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out "$T/autre.pem" 2>/dev/null
openssl req -new -x509 -newkey rsa:2048 -nodes -keyout "$T/k2048.pem" \
  -subj "/CN=Public-Key: (4096 bit)" -days 2 -out "$T/piege2048.pem" 2>/dev/null
openssl req -new -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout "$T/kec.pem" \
  -subj /CN=ec -days 2 -out "$T/ec.pem" 2>/dev/null
B64=$(base64 -w0 "$T/cert.pem")
echo "   certificat : $(stat -c %s "$T/cert.pem") octets -> base64 -w0 : ${#B64} caractères ; prive.pem en $(stat -c %a "$T/prive.pem")"
mkdir -p "$T/src/plantages" "$T/src/captures"
echo '{"comment":"CONTENU_SECRET"}' > "$T/src/plantages/NOM_SECRET_c1.json"
printf 'Incident Identifier: X\nCONTENU_SECRET\n' > "$T/src/plantages/NOM_SECRET_c1.crash"
head -c 300000 /dev/urandom > "$T/src/captures/s1-1.png"
echo '{"plantages":1}' > "$T/src/resume.json"

echo "== certificat : formats acceptés"
executer v1 env CLE_PUBLIQUE="$B64" bash "$C" --verifier
attendu="certificat accepté (RSA-4096, SHA-256 $(openssl x509 -in "$T/cert.pem" -noout -fingerprint -sha256 | cut -d= -f2))"
verifier "base64 -w0 du PEM (format de la note) : rc=$RC" egal "$RC" 0
verifier "message = empreinte SHA-256 du certificat" egal "$(cat "$T/j/v1.out")" "$attendu"
executer v2 env CLE_PUBLIQUE="$(cat "$T/cert.pem")" bash "$C" --verifier
verifier "PEM sur plusieurs lignes : rc=$RC" egal "$RC" 0
executer v3 env CLE_PUBLIQUE="$(tr '\n' ' ' < "$T/cert.pem")" bash "$C" --verifier
verifier "PEM aplati sur une ligne (champ de saisie) : rc=$RC" egal "$RC" 0
executer v4 env CLE_PUBLIQUE="$(openssl x509 -in "$T/cert.pem" -outform DER | base64 -w0)" bash "$C" --verifier
verifier "base64 du DER : rc=$RC" egal "$RC" 0

echo "== certificat : refus"
refus() { # refus <nom> <motif attendu> <valeur>
  executer "$1" env CLE_PUBLIQUE="$3" bash "$C" --verifier
  verifier "$1 -> rc=$RC « $(head -1 "$T/j/$1.err") »" test "$RC" -eq 3 -a -z "$(cat "$T/j/$1.out")"
  verifier "$1 : motif « $2 »" contient "$1" "$2"
}
refus vide "vide" ""
refus charabia "ni un PEM ni du base64" "pas du base64 !!"
refus base64_pas_cert "certificat illisible" "$(printf 'bonjour' | base64 -w0)"
refus rsa2048_cn_piege "RSA-4096 attendue" "$(base64 -w0 "$T/piege2048.pem")"
refus ec "n'est pas RSA" "$(base64 -w0 "$T/ec.pem")"
refus tronque "tronqué" "$(head -5 "$T/cert.pem")"
if [ -n "$PY" ]; then
  "$PY" - "$T/prive.pem" "$T/expire.pem" <<'EOF'
import datetime as dt, sys
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
k = serialization.load_pem_private_key(open(sys.argv[1], "rb").read(), None)
n = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "colis-expire")])
c = (x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key())
     .serial_number(1).not_valid_before(dt.datetime(2026, 1, 1)).not_valid_after(dt.datetime(2026, 1, 3))
     .sign(k, hashes.SHA256()))
open(sys.argv[2], "wb").write(c.public_bytes(serialization.Encoding.PEM))
EOF
  refus expire "expiré" "$(base64 -w0 "$T/expire.pem")"
fi
verifier "la vérification du RSA-2048 piégé : la première ligne vaut bien 2048" \
  egal "$(openssl x509 -in "$T/piege2048.pem" -noout -pubkey | openssl rsa -pubin -noout -text 2>/dev/null | head -1)" "Public-Key: (2048 bit)"

echo "== chiffrement en flux"
cp -a "$T/src" "$T/clair"
executer c1 env CLE_PUBLIQUE="$B64" bash "$C" --supprimer-clair "$T/clair" "$T/colis/colis.p7m"
verifier "chiffrer.sh : rc=$RC" egal "$RC" 0
echo "   journal complet du chiffrement :"; sed 's/^/   | /' "$T/j/c1.out" "$T/j/c1.err"
verifier "journal = 2 lignes fixes, stderr vide" test "$(wc -l < "$T/j/c1.out")" -eq 2 -a ! -s "$T/j/c1.err"
verifier "aucun nom de fichier ni contenu dans le journal" bash -c "! grep -qE 'NOM_SECRET|CONTENU_SECRET|plantages|captures' '$T/j/c1.out' '$T/j/c1.err'"
verifier "dossier clair supprimé (--supprimer-clair)" test ! -e "$T/clair"
verifier "pas de fichier partiel .colis.* restant" sans_reste "$T/colis"
verifier "aucun clair lisible dans le colis" bash -c "! grep -aqE 'CONTENU_SECRET|NOM_SECRET' '$T/colis/colis.p7m'"
openssl cms -cmsout -print -inform DER -in "$T/colis/colis.p7m" -noout 2>/dev/null \
  | grep -oE 'id-smime-ct-authEnvelopedData|rsaesOaep|algorithm: sha256|mgf1|aes-256-gcm' | sort | uniq -c | sed 's/^/   cms -print : /'
tgz=$(tar -C "$T/src" -czf - --owner=0 --group=0 --numeric-owner . | wc -c)
echo "   taille : tar.gz ≈ $tgz octets -> colis $(stat -c %s "$T/colis/colis.p7m") octets (écart $(( $(stat -c %s "$T/colis/colis.p7m") - tgz )) : GCM sans bourrage, la taille fuit)"
executer c2 env CLE_PUBLIQUE="$B64" bash "$C" "$T/src" "$T/colis/colis.p7m"
verifier "sortie existante refusée : rc=$RC" egal "$RC" 4
mkdir "$T/vide"
executer c3 env CLE_PUBLIQUE="$B64" bash "$C" "$T/vide" "$T/x.p7m"
verifier "dossier clair vide refusé : rc=$RC" egal "$RC" 4
executer c4 env CLE_PUBLIQUE="$B64" bash "$C" --bavard "$T/src" "$T/x.p7m"
verifier "option inconnue : rc=$RC" egal "$RC" 2
executer c5 env CLE_PUBLIQUE="$B64" bash -x "$C" "$T/src" "$T/colis/trace.p7m"
verifier "bash -x : la trace s'arrête à « set +x » (rc=$RC, $(grep -c '^+' "$T/j/c5.err") lignes tracées), aucun nom de fichier" \
  bash -c "[ $RC -eq 0 ] && [ \$(grep -c '^+' '$T/j/c5.err') -le 2 ] && ! grep -q NOM_SECRET '$T/j/c5.err'"
verifier "le clair source est intact sans --supprimer-clair" test -f "$T/src/resume.json"

echo "== déchiffrement"
executer d1 bash "$D" "$T/colis/colis.p7m" "$T/prive.pem" "$T/sortie"
verifier "dechiffrer.sh : rc=$RC « $(cat "$T/j/d1.out") »" egal "$RC" 0
verifier "diff -r : identique à la source" diff -r "$T/src" "$T/sortie"
verifier "droits 0700 / 0600 après extraction" bash -c "[ -z \"\$(find '$T/sortie' \\( -type d ! -perm 700 \\) -o \\( -type f ! -perm 600 \\))\" ]"
verifier "aucun nom de fichier dans le journal" bash -c "! grep -q NOM_SECRET '$T/j/d1.out' '$T/j/d1.err'"
verifier "pas de dossier .dechiffrer.* restant" sans_reste "$T"

echo "== colis refusés (rien ne doit rester)"
taille=$(stat -c %s "$T/colis/colis.p7m")
for off in 2 40 300 700 $((taille / 2)) $((taille - 1)); do
  cp "$T/colis/colis.p7m" "$T/altere.p7m"
  octet=$(od -An -tu1 -j "$off" -N1 "$T/altere.p7m" | tr -d ' ')
  printf "$(printf '\\%03o' $(( octet ^ 1 )))" | dd of="$T/altere.p7m" bs=1 seek="$off" conv=notrunc status=none
  executer "alt$off" bash "$D" "$T/altere.p7m" "$T/prive.pem" "$T/sortie-alt"
  verifier "octet $off altéré -> rc=$RC « $(cat "$T/j/alt$off.err") »" \
    bash -c "[ $RC -eq 5 ] && [ ! -e '$T/sortie-alt' ]"
  verifier "  … aucun reste" sans_reste "$T"
done
executer mk bash "$D" "$T/colis/colis.p7m" "$T/autre.pem" "$T/sortie-mk"
verifier "mauvaise clé -> rc=$RC « $(cat "$T/j/mk.err") »" bash -c "[ $RC -eq 5 ] && [ ! -e '$T/sortie-mk' ]"
mkdir "$T/existe"
executer ex bash "$D" "$T/colis/colis.p7m" "$T/prive.pem" "$T/existe"
verifier "sortie déjà présente -> rc=$RC, refus AVANT déchiffrement" \
  bash -c "[ $RC -eq 4 ] && [ -z \"\$(ls -A '$T/existe')\" ]"
verifier "  … aucun reste" sans_reste "$T"

echo "== archives piégées (un CMS n'est pas signé : quiconque a le certificat peut forger)"
mkdir -p "$T/piege1"; echo x > "$T/piege1/a"; ln -s /etc/passwd "$T/piege1/lien"
executer p1 env CLE_PUBLIQUE="$B64" bash "$C" "$T/piege1" "$T/piege1.p7m"
executer p1d bash "$D" "$T/piege1.p7m" "$T/prive.pem" "$T/sortie-p1"
verifier "lien symbolique -> rc=$RC « $(cat "$T/j/p1d.err") »" bash -c "[ $RC -eq 5 ] && [ ! -e '$T/sortie-p1' ]"
mkdir -p "$T/abs"; echo x > "$T/abs/f"
tar -czPf - "$T/abs/f" 2>/dev/null | openssl cms -encrypt -binary -aes-256-gcm -outform DER \
  -out "$T/piege2.p7m" -recip "$T/cert.pem" -keyopt rsa_padding_mode:oaep -keyopt rsa_oaep_md:sha256 \
  -keyopt rsa_mgf1_md:sha256 2>/dev/null
executer p2d bash "$D" "$T/piege2.p7m" "$T/prive.pem" "$T/sortie-p2"
verifier "chemin absolu -> rc=$RC « $(cat "$T/j/p2d.err") »" bash -c "[ $RC -eq 5 ] && [ ! -e '$T/sortie-p2' ]"
head -c 5000 /dev/urandom | openssl cms -encrypt -binary -aes-256-gcm -outform DER -out "$T/piege3.p7m" \
  -recip "$T/cert.pem" -keyopt rsa_padding_mode:oaep -keyopt rsa_oaep_md:sha256 -keyopt rsa_mgf1_md:sha256 2>/dev/null
executer p3d bash "$D" "$T/piege3.p7m" "$T/prive.pem" "$T/sortie-p3"
verifier "contenu authentique mais pas une archive -> rc=$RC « $(cat "$T/j/p3d.err") »" \
  bash -c "[ $RC -eq 5 ] && [ ! -e '$T/sortie-p3' ]"
verifier "  … aucun reste (tar.gz déchiffré effacé par le trap)" sans_reste "$T"

echo "== version d'OpenSSL exigée au déchiffrement"
mkdir -p "$T/shim-dpkg" "$T/shim-v"
printf '#!/bin/sh\nprintf "ii |3.0.13-0ubuntu3.7"\n' > "$T/shim-dpkg/dpkg-query"
printf '#!/bin/sh\nif [ "$1" = version ]; then echo "OpenSSL 3.5.1 1 Jul 2025 (Library: OpenSSL 3.5.1 1 Jul 2025)"; exit 0; fi\nexec /usr/bin/openssl "$@"\n' > "$T/shim-v/openssl"
chmod +x "$T/shim-dpkg/dpkg-query" "$T/shim-v/openssl"
executer o1 env PATH="$T/shim-dpkg:$PATH" bash "$D" "$T/colis/colis.p7m" "$T/prive.pem" "$T/sortie-o1"
verifier "paquet Ubuntu 3.0.13-0ubuntu3.7 -> rc=$RC « $(cat "$T/j/o1.err") »" bash -c "[ $RC -eq 3 ] && [ ! -e '$T/sortie-o1' ]"
executer o2 env PATH="$T/shim-v:$PATH" bash "$D" "$T/colis/colis.p7m" "$T/prive.pem" "$T/sortie-o2"
verifier "OpenSSL 3.5.1 non reconnu -> rc=$RC" bash -c "[ $RC -eq 3 ] && [ ! -e '$T/sortie-o2' ]"
executer o3 env PATH="$T/shim-v:$PATH" OPENSSL_VERIFIE=1 bash "$D" "$T/colis/colis.p7m" "$T/prive.pem" "$T/sortie-o3"
verifier "… accepté avec OPENSSL_VERIFIE=1 : rc=$RC" egal "$RC" 0

echo "== interruption pendant le déchiffrement (le clair temporaire doit disparaître)"
mkdir -p "$T/shim-lent"
printf '#!/bin/sh\n/usr/bin/openssl "$@"; rc=$?\n[ "$1" = cms ] && sleep 4\nexit $rc\n' > "$T/shim-lent/openssl"
chmod +x "$T/shim-lent/openssl"
for sig in INT TERM; do
  # set -m : job dans son propre groupe, SIGINT non ignoré (sans contrôle de job, un
  # « & » démarre avec SIGINT ignoré et bash ne peut plus le piéger).
  set -m
  PATH="$T/shim-lent:$PATH" OPENSSL_VERIFIE=1 bash "$D" "$T/colis/colis.p7m" "$T/prive.pem" "$T/sortie-$sig" \
    >"$T/j/int-$sig.out" 2>"$T/j/int-$sig.err" &
  pid=$!
  set +m
  for _ in $(seq 50); do [ -n "$(find "$T" -maxdepth 2 -path '*/.dechiffrer.*/a.tgz' -size +1k | head -1)" ] && break; sleep 0.1; done
  present=$([ -n "$(find "$T" -maxdepth 2 -path '*/.dechiffrer.*/a.tgz' | head -1)" ] && echo oui || echo non)
  kill "-$sig" -- "-$pid" 2>/dev/null   # comme Ctrl-C : tout le groupe de premier plan
  wait "$pid"; RC=$?
  verifier "SIG$sig : clair temporaire présent au moment du signal : $present" egal "$present" oui
  verifier "SIG$sig -> rc=$RC, sortie absente" bash -c "[ $RC -eq 130 ] && [ ! -e '$T/sortie-$sig' ]"
  verifier "  … temporaire effacé par le trap" sans_reste "$T"
done

chmod 644 "$T/prive.pem"
executer perm bash "$D" "$T/colis/colis.p7m" "$T/prive.pem" "$T/sortie-perm"
verifier "clé lisible par tous : avertissement, rc=$RC" bash -c "[ $RC -eq 0 ] && grep -q 'chmod 600' '$T/j/perm.err'"

echo
echo "chiffrement : $ok vérifications réussies, $ko en échec"
[ "$ko" -eq 0 ]
