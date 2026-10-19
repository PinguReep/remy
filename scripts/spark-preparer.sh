#!/usr/bin/env bash
# Prépare un DGX Spark pour recevoir les sauvegardes CHIFFRÉES de Rémy, en
# attendant le disque externe (Lot 0). À lancer SUR LE SPARK, une fois :
#
#   sudo bash spark-preparer.sh "<clé publique affichée par spark-relier.ps1>" [<IP de la tour>]
#
# Ce que ça crée :
#   - un compte « remy-sauvegarde » sans mot de passe ni shell, qui ne peut
#     QUE déposer et relire des fichiers en SFTP, enfermé dans
#     /srv/remy-sauvegarde (il ne voit rien d'autre du Spark) ;
#   - l'accès par la seule clé de la tour (et, si l'IP est donnée, depuis la
#     seule tour), sans redirection de port, d'agent ni de terminal ;
#   - un « gel » : chaque nuit, root recopie les nouvelles archives dans un
#     dossier que la tour ne peut ni lire ni effacer (/srv/remy-sauvegarde-gel,
#     120 jours, et toujours les 30 plus récentes). Une tour compromise ne peut
#     donc pas détruire ces copies-là. Le compte ne peut créer ni lien
#     symbolique ni lien dur (rien qui pointe ailleurs que ses fichiers).
#
# Les archives arrivent déjà chiffrées (AES-256-GCM) : la clé de chiffrement
# ne vient JAMAIS sur le Spark. Rien d'autre du Spark n'est modifié.
set -euo pipefail

UTIL=remy-sauvegarde
PRISON=/srv/remy-sauvegarde
GEL=/srv/remy-sauvegarde-gel
CLES=/etc/ssh/remy-sauvegarde
CONF=/etc/ssh/sshd_config.d/remy-sauvegarde.conf

[ "$(id -u)" -eq 0 ] || { echo "❌ À lancer avec sudo." >&2; exit 1; }
CLE_PUB="${1:-}"
DEPUIS="${2:-}"
if ! [[ "$CLE_PUB" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ [A-Za-z0-9._@-]+)?$ ]]; then
  echo "❌ Clé publique attendue (une ligne « ssh-ed25519 AAAA… remy-tour »), entre guillemets." >&2
  exit 1
fi
if [ -n "$DEPUIS" ] && ! [[ "$DEPUIS" =~ ^[0-9a-fA-F.:/]+$ ]]; then
  echo "❌ IP de la tour illisible : $DEPUIS" >&2
  exit 1
fi
grep -qE '^\s*Include\s+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config || {
  echo "❌ /etc/ssh/sshd_config n'inclut pas sshd_config.d : rien n'a été changé (à régler à la main)." >&2
  exit 1
}

# 1. Le compte : pas de shell, pas de mot de passe.
if ! id "$UTIL" >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir / --shell /usr/sbin/nologin "$UTIL"
fi
passwd -l "$UTIL" >/dev/null

# 2. La prison : root possède la racine (exigence de sshd), le compte ne peut
#    écrire que dans « sauvegardes ».
install -d -o root -g root -m 755 "$PRISON"
install -d -o "$UTIL" -g "$UTIL" -m 700 "$PRISON/sauvegardes"
install -d -o root -g root -m 700 "$GEL"

# 3. La clé de la tour, hors de portée du compte (il ne peut pas en ajouter).
install -d -o root -g root -m 755 "$CLES"
OPTIONS="restrict"
[ -n "$DEPUIS" ] && OPTIONS="restrict,from=\"$DEPUIS\""
printf '%s %s\n' "$OPTIONS" "$CLE_PUB" > "$CLES/authorized_keys"
chown root:root "$CLES/authorized_keys"
chmod 644 "$CLES/authorized_keys"

# 4. sshd : SFTP seul, enfermé, fichiers créés en 600.
cat > "$CONF" <<EOF
# Rémy (sauvegardes chiffrées de la tour) — créé par spark-preparer.sh
Match User $UTIL
    AuthorizedKeysFile $CLES/authorized_keys
    ChrootDirectory $PRISON
    ForceCommand internal-sftp -d /sauvegardes -u 0077 -P symlink,hardlink
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowTcpForwarding no
    AllowStreamLocalForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTunnel no
    PermitTTY no
# Fin du bloc : ce qui suit dans sshd_config redevient valable pour tous.
Match all
EOF
chmod 644 "$CONF"
if ! sshd -t; then
  rm -f "$CONF"
  echo "❌ Configuration sshd refusée : retirée, rien n'a changé pour SSH." >&2
  exit 1
fi
# (Ubuntu 24.04 lance sshd à chaque connexion : un « reload » peut ne rien
# avoir à recharger, ce n'est pas une erreur.)
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true

# 5. Le gel de la nuit (04:17), hors de portée de la tour. Root ne travaille
#    que sur de vrais fichiers (jamais un lien), compare avant de copier, ne
#    remplit pas le disque (GLM en dépend) et dit ce qu'il a fait (journal).
cat > /usr/local/sbin/remy-sauvegarde-gel <<'GEL'
#!/usr/bin/env bash
# Gel des sauvegardes de Rémy (root, chaque nuit) — créé par spark-preparer.sh.
set -u
SRC=/srv/remy-sauvegarde/sauvegardes
GEL=/srv/remy-sauvegarde-gel
GARDER_JOURS=120
GARDER_MIN=30
log() { logger -t remy-gel "$*" 2>/dev/null || echo "remy-gel: $*"; }

plein=$(df --output=pcent "$GEL" | tail -1 | tr -dc 0-9)
if [ "${plein:-100}" -ge 90 ]; then
  log "disque plein à ${plein} % : rien copié"
  exit 0
fi

copiees=0
while IFS= read -r -d '' f; do
  n=${f##*/}
  d="$GEL/$n"
  if [ -e "$d" ]; then
    cmp -s "$f" "$d" && continue
    # Même nom, autre contenu (nom réutilisé, ou piégé) : on garde les deux.
    d="$GEL/$n.$(date +%Y%m%d%H%M%S)"
  fi
  cp -P --no-preserve=all "$f" "$d" && copiees=$((copiees + 1))
done < <(find "$SRC" -maxdepth 1 -type f -name '*.remy-sauvegarde' -size -4G -print0)

# Rétention : jamais les GARDER_MIN plus récentes ; les autres après GARDER_JOURS jours.
supprimees=0
while IFS= read -r -d '' ligne; do
  f=${ligne#* }
  if [ -n "$(find "$f" -maxdepth 0 -type f -mtime +"$GARDER_JOURS" -print -delete)" ]; then
    supprimees=$((supprimees + 1))
  fi
done < <(find "$GEL" -maxdepth 1 -type f -printf '%T@ %p\0' | sort -z -rn | tail -z -n +$((GARDER_MIN + 1)))
log "gel : $copiees copiée(s), $supprimees supprimée(s), disque à ${plein} %"
GEL
chown root:root /usr/local/sbin/remy-sauvegarde-gel
chmod 755 /usr/local/sbin/remy-sauvegarde-gel
cat > /etc/cron.d/remy-sauvegarde-gel <<EOF
# Rémy : copie des archives que la tour ne peut ni lire ni effacer.
17 4 * * * root /usr/local/sbin/remy-sauvegarde-gel
EOF
chmod 644 /etc/cron.d/remy-sauvegarde-gel

# 6. Ce que Sam doit comparer et noter.
echo
echo "✅ Spark prêt pour les sauvegardes de Rémy."
echo
echo "Empreinte de CE Spark — à comparer avec celle que montre spark-relier.ps1 :"
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
echo
echo "Place libre pour les sauvegardes :"
df -h "$PRISON" | tail -1
echo
echo "Accès : $UTIL (SFTP seul, enfermé dans $PRISON)${DEPUIS:+, depuis $DEPUIS seulement}."
echo "Gel nocturne : $GEL (root seul, 120 jours, toujours les 30 plus récentes) — journal : journalctl -t remy-gel"
echo "Limite : une tour compromise pourrait remplir le disque par SFTP (le gel, lui, s'arrête à 90 %)."
echo "Pour tout retirer : sudo rm $CONF /etc/cron.d/remy-sauvegarde-gel /usr/local/sbin/remy-sauvegarde-gel && sudo systemctl reload ssh"
