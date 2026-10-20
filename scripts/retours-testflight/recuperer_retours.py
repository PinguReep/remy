#!/usr/bin/env python3
"""Récupère les retours TestFlight (plantages et captures d'écran) par l'API
App Store Connect et les écrit dans un dossier, pour chiffrement immédiat.

Usage (CI ou poste) :
  ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_P8=<base64 du .p8> \\
    python3 -I recuperer_retours.py --sortie DOSSIER
        [--bundle-id com.pingureep.remy] [--app-id 1234567890]
        [--plafond 50] [--depuis AAAA-MM-JJ]
        [--signeur auto|cryptography|openssl] [--cle-individuelle]

Dossier produit (fichiers 0600, dossiers 0700) :
  resume.json                 compteurs et paramètres du run
  plantages/<id>.json         un retour de plantage (sans e-mail)
  plantages/<id>.crash|.ips   son journal (.ips si logText est du JSON)
  captures/<id>.json          un retour avec captures (sans e-mail ni URL)
  captures/<id>-<n>.<ext>     les images (extension d'après les octets)

Discrétion (dépôt public) : le terminal ne reçoit QUE des compteurs ; les
erreurs sont des messages fixes, jamais le corps d'une réponse ni le message
d'une exception (seulement son type). Le jeton ne quitte pas le processus.

Signature ES256 : avec le module « cryptography » s'il est importable, sinon
avec la commande openssl (clé passée par un tube, jamais écrite sur disque).

Codes de sortie : 0 ok · 1 inattendu · 2 configuration · 3 accès refusé
(401/403) · 4 introuvable (404, app absente) · 5 API ou réseau.
"""

import argparse
import base64
import binascii
import datetime as dt
import hashlib
import http.client
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API_HOTE = "api.appstoreconnect.apple.com"
API_BASE = "https://" + API_HOTE
AUDIENCE = "appstoreconnect-v1"
DUREE_JETON = 600          # s ; Apple refuse exp − iat > 1200
MARGE_JETON = 60           # on renouvelle une minute avant l'expiration
DELAI_RESEAU = 30          # s par requête
ESSAIS = 4                 # pour 429, 5xx et erreurs réseau
ATTENTE_MAX = 30           # s, plafond appliqué à Retry-After
PAGES_MAX = 100
LIMITE_API = 200           # maximum de « limit » (spec 4.5.1)
TAILLE_MAX_REPONSE = 64 * 1024 * 1024
TAILLE_MAX_IMAGE = 50 * 1024 * 1024
AGENT = "remy-retours/1"
UTC = dt.timezone.utc

OK, INATTENDU, CONFIG, ACCES, INTROUVABLE, API = 0, 1, 2, 3, 4, 5

# Les 20 attributs communs de la spec, MOINS « email » : liste blanche, appliquée
# à la requête (fields[…]) ET à l'écriture (au cas où une page suivante perdrait
# les fields et renverrait tout).
ATTRIBUTS = (
    "createdDate", "comment", "buildBundleId",
    "deviceModel", "osVersion", "deviceFamily", "architecture",
    "appPlatform", "devicePlatform", "pairedAppleWatch",
    "locale", "timeZone", "connectionType",
    "appUptimeInMilliseconds", "diskBytesAvailable", "diskBytesTotal",
    "batteryPercentage", "screenWidthInPoints", "screenHeightInPoints",
)
CHAMPS_PLANTAGES = ATTRIBUTS + ("build", "crashLog")
CHAMPS_CAPTURES = ATTRIBUTS + ("screenshots", "build")
STATUTS_A_REESSAYER = (429, 500, 502, 503, 504)
ERREURS_RESEAU = (urllib.error.URLError, http.client.HTTPException, OSError, ValueError)
NOM_SUR = re.compile(r"[A-Za-z0-9_-]{1,80}")
CODE_APPLE = re.compile(r"[A-Z][A-Z0-9_.]{0,79}")


class Echec(Exception):
    """Erreur au message FIXE, affichable tel quel (jamais de donnée de l'API)."""

    def __init__(self, message, code):
        super().__init__(message)
        self.message = message
        self.code = code


def avertir(message):
    print(f"Attention : {message}", file=sys.stderr)


# --------------------------------------------------------------------------
# Clé et jeton JWT (ES256)
# --------------------------------------------------------------------------

def decoder_cle(valeur):
    """ASC_KEY_P8 : base64 du fichier .p8 (format des secrets du dépôt) ou PEM brut."""
    v = (valeur or "").strip()
    if not v:
        raise Echec("ASC_KEY_P8 est vide.", CONFIG)
    if v.startswith("-----BEGIN"):
        return v.encode("utf-8", "replace")
    try:
        brut = base64.b64decode("".join(v.split()), validate=True)
    except (binascii.Error, ValueError):
        raise Echec("ASC_KEY_P8 n'est ni un PEM ni du base64 valide.", CONFIG) from None
    if not brut:
        raise Echec("ASC_KEY_P8 est vide une fois décodé.", CONFIG)
    return brut


def _est_pem(cle):
    return cle.lstrip().startswith(b"-----BEGIN")


def _en_pem(cle):
    """DER PKCS#8 -> PEM (pour openssl) ; un PEM est rendu tel quel."""
    if _est_pem(cle):
        return cle
    b64 = base64.b64encode(cle).decode("ascii")
    lignes = [b64[i:i + 64] for i in range(0, len(b64), 64)]
    return ("-----BEGIN PRIVATE KEY-----\n" + "\n".join(lignes)
            + "\n-----END PRIVATE KEY-----\n").encode("ascii")


_CRYPTOGRAPHY = []   # cache de la sonde : [] = pas encore sondé


def _importer_cryptography():
    """Modules de cryptography, ou None. Sonde MUETTE : un paquet système cassé écrit
    sa trace (pyo3/Rust) sur stderr à l'import ; on coupe le descripteur 2 le temps
    de l'essai, pour que le journal ne contienne que nos messages fixes."""
    if _CRYPTOGRAPHY:
        return _CRYPTOGRAPHY[0]
    resultat = None
    stderr_python = sys.stderr
    try:
        stderr_python.flush()
    except Exception:
        pass
    try:
        copie, nul = os.dup(2), os.open(os.devnull, os.O_WRONLY)
    except OSError:                    # descripteur 2 déjà fermé : rien à couper
        copie = nul = None
    try:
        if copie is not None:
            os.dup2(nul, 2)
        sys.stderr = open(os.devnull, "w")
        try:
            from cryptography.hazmat.primitives import hashes, serialization
            from cryptography.hazmat.primitives.asymmetric import ec, utils
            resultat = (hashes, serialization, ec, utils)
        except (KeyboardInterrupt, SystemExit):
            raise
        except BaseException:  # ImportError, mais aussi la PanicException (pyo3) d'un paquet cassé
            resultat = None
    finally:
        try:
            sys.stderr.close()
        finally:
            sys.stderr = stderr_python
            if copie is not None:
                os.dup2(copie, 2)
                os.close(copie)
                os.close(nul)
    _CRYPTOGRAPHY.append(resultat)
    return resultat


def signeur_cryptography(cle):
    modules = _importer_cryptography()
    if modules is None:
        raise Echec("Le module cryptography est absent ou inutilisable.", CONFIG)
    hashes, serialization, ec, utils = modules
    try:
        if _est_pem(cle):
            privee = serialization.load_pem_private_key(cle, password=None)
        else:
            privee = serialization.load_der_private_key(cle, password=None)
    except Exception:
        raise Echec("ASC_KEY_P8 : clé privée illisible.", CONFIG) from None
    if not isinstance(privee, ec.EllipticCurvePrivateKey) or privee.curve.name != "secp256r1":
        raise Echec("ASC_KEY_P8 : une clé EC P-256 est attendue (fichier .p8 d'App Store Connect).",
                    CONFIG)

    def signer(message):
        der = privee.sign(message, ec.ECDSA(hashes.SHA256()))
        r, s = utils.decode_dss_signature(der)
        return r.to_bytes(32, "big") + s.to_bytes(32, "big")

    return signer


def _openssl(arguments, entree, cle_pem):
    """Lance openssl ; la clé passe par un tube (/dev/fd/N), jamais par le disque."""
    if len(cle_pem) > 16384:
        raise Echec("ASC_KEY_P8 : clé trop longue.", CONFIG)
    lecture, ecriture = os.pipe()
    try:
        vue = memoryview(cle_pem)
        while vue:
            vue = vue[os.write(ecriture, vue):]
        os.close(ecriture)
        ecriture = -1
        chemin = f"/dev/fd/{lecture}"
        commande = ["openssl"] + [chemin if a == "{cle}" else a for a in arguments]
        try:
            fini = subprocess.run(commande, input=entree, pass_fds=(lecture,),
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                  timeout=30, check=False)
        except FileNotFoundError:
            raise Echec("Ni le module cryptography ni la commande openssl ne sont disponibles.",
                        CONFIG) from None
        except subprocess.TimeoutExpired:
            raise Echec("openssl ne répond pas.", CONFIG) from None
    finally:
        os.close(lecture)
        if ecriture >= 0:
            os.close(ecriture)
    return fini.returncode, fini.stdout


def der_vers_brut(der, taille=32):
    """Signature ECDSA DER (SEQUENCE {INTEGER r, INTEGER s}) -> r‖s brut (RFC 7518 §3.4)."""

    def longueur(i):
        if i >= len(der):
            raise ValueError
        n = der[i]
        if n < 0x80:
            return n, i + 1
        k = n & 0x7F
        if k == 0 or k > 2 or i + 1 + k > len(der):
            raise ValueError
        return int.from_bytes(der[i + 1:i + 1 + k], "big"), i + 1 + k

    def entier(i):
        if i >= len(der) or der[i] != 0x02:
            raise ValueError
        n, i = longueur(i + 1)
        if n == 0 or i + n > len(der):
            raise ValueError
        return int.from_bytes(der[i:i + n], "big"), i + n

    try:
        if not der or der[0] != 0x30:
            raise ValueError
        n, i = longueur(1)
        if i + n != len(der):
            raise ValueError
        r, i = entier(i)
        s, i = entier(i)
        borne = 1 << (8 * taille)
        if i != len(der) or not 0 < r < borne or not 0 < s < borne:
            raise ValueError
    except ValueError:
        raise Echec("Signature openssl inattendue.", CONFIG) from None
    return r.to_bytes(taille, "big") + s.to_bytes(taille, "big")


def signeur_openssl(cle):
    pem = _en_pem(cle)
    rc, texte = _openssl(["pkey", "-in", "{cle}", "-noout", "-text_pub"], b"", pem)
    if rc != 0:
        raise Echec("ASC_KEY_P8 : clé privée illisible (openssl).", CONFIG)
    if b"prime256v1" not in texte:
        raise Echec("ASC_KEY_P8 : une clé EC P-256 est attendue (fichier .p8 d'App Store Connect).",
                    CONFIG)

    def signer(message):
        rc, der = _openssl(["dgst", "-sha256", "-sign", "{cle}"], message, pem)
        if rc != 0 or not der:
            raise Echec("Signature du jeton impossible (openssl).", CONFIG)
        return der_vers_brut(der)

    return signer


def choisir_signeur(cle, mode="auto"):
    if mode == "cryptography":
        return signeur_cryptography(cle)
    if mode == "openssl":
        return signeur_openssl(cle)
    if _importer_cryptography() is not None:
        return signeur_cryptography(cle)
    return signeur_openssl(cle)


def _b64url(octets):
    return base64.urlsafe_b64encode(octets).rstrip(b"=")


def _json_compact(objet):
    return json.dumps(objet, separators=(",", ":")).encode("utf-8")


def creer_jwt(signer, key_id, issuer_id, maintenant, duree=DUREE_JETON, individuelle=False):
    """Jeton App Store Connect : en-tête {alg, kid, typ}, charge {iss|sub, iat, exp, aud}."""
    if not 0 < duree <= 1200:
        raise ValueError("durée hors limites")
    entete = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
    charge = {"sub": "user"} if individuelle else {"iss": issuer_id}
    charge.update(iat=int(maintenant), exp=int(maintenant) + duree, aud=AUDIENCE)
    message = _b64url(_json_compact(entete)) + b"." + _b64url(_json_compact(charge))
    return (message + b"." + _b64url(signer(message))).decode("ascii")


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

class SansRedirection(urllib.request.HTTPRedirectHandler):
    """L'API ne redirige pas : on refuse, pour ne jamais renvoyer le jeton ailleurs."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class RedirectionHttpsSansJeton(urllib.request.HTTPRedirectHandler):
    """Images : redirection suivie seulement vers https, et jamais avec le jeton."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https":
            return None
        nouvelle = super().redirect_request(req, fp, code, msg, headers, newurl)
        if nouvelle is not None:
            nouvelle.remove_header("Authorization")
        return nouvelle


def url_api(chemin, params=None):
    requete = urllib.parse.urlencode(list((params or {}).items()), safe="[],")
    return API_BASE + chemin + ("?" + requete if requete else "")


def _sur_l_api(parties):
    try:
        port = parties.port
    except ValueError:
        return False
    return (parties.scheme == "https" and parties.hostname == API_HOTE
            and port in (None, 443) and not parties.username and not parties.password)


def url_suivante(courante, suivant, imposes):
    """links.next -> URL absolue sur l'API, nos fields/include garantis ; None si refusée.

    La spec ne promet qu'une « uri-reference » (peut-être relative), et rien ne dit
    que le lien garde nos fields[…] : sans eux, « email » reviendrait.
    """
    if not isinstance(suivant, str) or not suivant.strip():
        return None
    try:
        absolue = urllib.parse.urljoin(courante, suivant.strip())
        parties = urllib.parse.urlsplit(absolue)
    except ValueError:
        return None
    if not _sur_l_api(parties) or not parties.path.startswith("/v1/"):
        return None
    paires = urllib.parse.parse_qsl(parties.query, keep_blank_values=True)
    if all(dict(paires).get(k) == v for k, v in imposes.items()):
        return urllib.parse.urlunsplit(("https", API_HOTE, parties.path, parties.query, ""))
    paires = [(k, v) for k, v in paires if k not in imposes] + list(imposes.items())
    return urllib.parse.urlunsplit(("https", API_HOTE, parties.path,
                                    urllib.parse.urlencode(paires, safe="[],"), ""))


def _lire_borne(reponse, maximum, quoi):
    corps = reponse.read(maximum + 1)
    if len(corps) > maximum:
        raise Echec(f"Réponse trop volumineuse pendant : {quoi}.", API)
    return corps


def _code_apple(erreur):
    """errors[0].code d'une réponse d'erreur (ex. NOT_AUTHORIZED), seulement s'il a la forme d'un code."""
    try:
        doc = json.loads(erreur.read(65536))
        code = doc["errors"][0]["code"]
    except Exception:
        return None
    return code if isinstance(code, str) and CODE_APPLE.fullmatch(code) else None


def _message_http(statut, etape, code_apple):
    if statut == 401:
        texte = (f"accès refusé (401) pendant : {etape}. Jeton rejeté : vérifier ASC_KEY_ID, "
                 "ASC_ISSUER_ID et ASC_KEY_P8 (clé révoquée ?), et l'horloge de la machine.")
    elif statut == 403:
        texte = (f"accès interdit (403) pendant : {etape}. Rôle de la clé insuffisant "
                 "(Admin, App Manager ou Developer requis) ou ressource interdite.")
    elif statut == 404:
        texte = (f"introuvable (404) pendant : {etape}. Vérifier --app-id ou --bundle-id, "
                 "et que la clé a accès à l'app.")
    elif statut == 429:
        texte = f"limite de débit de l'API (429) pendant : {etape}, même après {ESSAIS} essais."
    elif 300 <= statut < 400:
        texte = f"redirection inattendue ({statut}) pendant : {etape} : refusée."
    else:
        texte = f"l'API a répondu {statut} pendant : {etape}."
    return texte + (f" Code Apple : {code_apple}." if code_apple else "")


def _code_sortie(statut):
    if statut in (401, 403):
        return ACCES
    return INTROUVABLE if statut == 404 else API


def _fermer(erreur):
    try:
        erreur.close()
    except Exception:
        pass


class ClientASC:
    def __init__(self, fabrique_jeton, horloge=time.time, dormir=time.sleep):
        self._fabrique = fabrique_jeton
        self._horloge = horloge
        self._dormir = dormir
        self._api = urllib.request.build_opener(SansRedirection)
        self._fichiers = urllib.request.build_opener(RedirectionHttpsSansJeton)
        self._jeton = None
        self._expire = 0

    def maintenant(self):
        return dt.datetime.fromtimestamp(self._horloge(), UTC)

    def jeton(self, neuf=False):
        t = int(self._horloge())
        if neuf or self._jeton is None or t >= self._expire - MARGE_JETON:
            self._jeton = self._fabrique(t)
            self._expire = t + DUREE_JETON
        return self._jeton

    def _attendre(self, entetes, essai):
        attente = 2 ** essai
        valeur = entetes.get("Retry-After") if entetes is not None else None
        if valeur and str(valeur).strip().isdigit():
            attente = int(str(valeur).strip())
        self._dormir(max(1, min(attente, ATTENTE_MAX)))

    def lire_json(self, url, etape, accepter_404=False):
        if not _sur_l_api(urllib.parse.urlsplit(url)):
            raise Echec(f"URL hors de l'API refusée pendant : {etape}.", API)
        rejoue_401 = forcer = False
        essai = 0
        while True:
            essai += 1
            requete = urllib.request.Request(url, headers={
                "Authorization": "Bearer " + self.jeton(neuf=forcer),
                "Accept": "application/json", "User-Agent": AGENT})
            forcer = False
            try:
                with self._api.open(requete, timeout=DELAI_RESEAU) as reponse:
                    corps = _lire_borne(reponse, TAILLE_MAX_REPONSE, etape)
            except urllib.error.HTTPError as e:
                statut, entetes, code_apple = e.code, e.headers, _code_apple(e)
                _fermer(e)
                if statut == 404 and accepter_404:
                    return None
                if statut == 401 and not rejoue_401:      # un seul nouvel essai, jeton neuf
                    rejoue_401 = forcer = True
                    continue
                if statut in STATUTS_A_REESSAYER and essai < ESSAIS:
                    self._attendre(entetes, essai)
                    continue
                raise Echec(_message_http(statut, etape, code_apple), _code_sortie(statut)) from None
            except ERREURS_RESEAU as e:
                if essai < ESSAIS:
                    self._attendre(None, essai)
                    continue
                raise Echec(f"erreur réseau ({type(e).__name__}) pendant : {etape}.", API) from None
            try:
                doc = json.loads(corps)
            except ValueError:
                raise Echec(f"réponse illisible (pas du JSON) pendant : {etape}.", API) from None
            if not isinstance(doc, dict):
                raise Echec(f"réponse inattendue pendant : {etape}.", API)
            return doc

    def telecharger(self, url):
        """Image d'une capture : URL temporaire, a priori pré-signée -> SANS jeton.

        Seule exception : si l'URL pointe sur l'API elle-même, le jeton y est envoyé.
        """
        try:
            parties = urllib.parse.urlsplit(url)
        except ValueError:
            raise Echec("lien d'image illisible.", API) from None
        if parties.scheme != "https" or not parties.hostname:
            raise Echec("lien d'image refusé (https exigé).", API)
        entetes = {"Accept": "image/*", "User-Agent": AGENT}
        if _sur_l_api(parties):
            entetes["Authorization"] = "Bearer " + self.jeton()
        for essai in range(1, 4):
            try:
                with self._fichiers.open(urllib.request.Request(url, headers=entetes),
                                         timeout=60) as reponse:
                    corps = _lire_borne(reponse, TAILLE_MAX_IMAGE, "image")
                    return corps, reponse.headers.get("Content-Type")
            except urllib.error.HTTPError as e:
                statut, entetes_rep = e.code, e.headers
                _fermer(e)
                if statut in STATUTS_A_REESSAYER and essai < 3:
                    self._attendre(entetes_rep, essai)
                    continue
                raise Echec(f"image : HTTP {statut}.", API) from None
            except ERREURS_RESEAU as e:
                if essai < 3:
                    self._attendre(None, essai)
                    continue
                raise Echec(f"image : erreur réseau ({type(e).__name__}).", API) from None
        raise Echec("image : échec.", API)


# --------------------------------------------------------------------------
# Parcours des retours
# --------------------------------------------------------------------------

def lire_date(valeur):
    if not isinstance(valeur, str) or not valeur.strip():
        return None
    texte = valeur.strip()
    if texte.endswith(("Z", "z")):
        texte = texte[:-1] + "+00:00"
    try:
        date = dt.datetime.fromisoformat(texte)
    except ValueError:
        return None
    return date if date.tzinfo else date.replace(tzinfo=UTC)


def attributs(ressource):
    a = ressource.get("attributes")
    return a if isinstance(a, dict) else {}


def index_inclus(inclus):
    index = {}
    for r in inclus if isinstance(inclus, list) else []:
        if isinstance(r, dict) and isinstance(r.get("type"), str) and isinstance(r.get("id"), str):
            index[(r["type"], r["id"])] = r
    return index


def parcourir(client, chemin, params, etape, plafond, depuis=None):
    """Rend (ressource, inclus) du plus récent au plus ancien, jusqu'au plafond.

    S'arrête : plafond atteint, plus de page, page vide ou sans nouveauté, retour plus
    ancien que « depuis » (tri -createdDate), lien suivant hors de l'API, lien ou
    curseur déjà vu (boucle), PAGES_MAX.
    """
    imposes = {k: v for k, v in params.items() if k.startswith("fields[") or k == "include"}
    url = url_api(chemin, params)
    urls_vues, curseurs_vus, ids_vus = {url}, set(), set()
    rendus = 0
    for _ in range(PAGES_MAX):
        doc = client.lire_json(url, etape)
        donnees = doc.get("data")
        if not isinstance(donnees, list):
            raise Echec(f"réponse inattendue (data absent) pendant : {etape}.", API)
        inclus = index_inclus(doc.get("included"))
        trop_ancien = False
        nouveaux = 0
        for ressource in donnees:
            if not isinstance(ressource, dict):
                continue
            rid = ressource.get("id")
            if not isinstance(rid, str) or not rid or rid in ids_vus:
                continue
            date = lire_date(attributs(ressource).get("createdDate"))
            if depuis is not None and date is not None and date < depuis:
                trop_ancien = True
                continue
            ids_vus.add(rid)
            nouveaux += 1
            rendus += 1
            yield ressource, inclus
            if rendus >= plafond:
                return
        if trop_ancien or nouveaux == 0:
            return
        liens = doc.get("links") if isinstance(doc.get("links"), dict) else {}
        if liens.get("next") is None:
            return
        prochaine = url_suivante(url, liens.get("next"), imposes)
        if prochaine is None:
            avertir("lien de page suivante refusé (hors de l'API) : parcours arrêté.")
            return
        curseur = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(prochaine).query)).get("cursor")
        if prochaine in urls_vues or (curseur is not None and curseur in curseurs_vus):
            return
        urls_vues.add(prochaine)
        if curseur is not None:
            curseurs_vus.add(curseur)
        url = prochaine
    avertir(f"plus de {PAGES_MAX} pages : parcours arrêté.")


def trouver_app(client, bundle_id):
    doc = client.lire_json(url_api("/v1/apps", {
        "filter[bundleId]": bundle_id, "fields[apps]": "bundleId", "limit": str(LIMITE_API)}),
        "recherche de l'app")
    donnees = doc.get("data")
    if not isinstance(donnees, list):
        raise Echec("réponse inattendue pendant : recherche de l'app.", API)
    # Filtre exact ou par préfixe ? Non documenté : on compare nous-mêmes.
    ids = [r["id"] for r in donnees if isinstance(r, dict) and isinstance(r.get("id"), str)
           and attributs(r).get("bundleId") == bundle_id]
    if not ids:
        raise Echec("aucune app ne porte exactement ce bundle id (ou la clé n'y a pas accès).",
                    INTROUVABLE)
    if len(ids) > 1:
        raise Echec("plusieurs apps portent ce bundle id : préciser --app-id.", CONFIG)
    if not NOM_SUR.fullmatch(ids[0]):
        raise Echec("identifiant d'app inattendu.", API)
    return ids[0]


def nom_sur(rid):
    """Nom de fichier tiré de l'id ; haché s'il contient autre chose que [A-Za-z0-9_-]."""
    if NOM_SUR.fullmatch(rid):
        return rid
    return "id-" + hashlib.sha256(rid.encode("utf-8", "surrogatepass")).hexdigest()[:24]


def ecrire(chemin, octets):
    drapeaux = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(chemin, drapeaux, 0o600)
    except FileExistsError:
        raise Echec("deux retours donnent le même nom de fichier.", INATTENDU) from None
    with os.fdopen(fd, "wb") as f:
        f.write(octets)


def ecrire_json(chemin, objet):
    texte = json.dumps(objet, ensure_ascii=False, indent=2) + "\n"
    # backslashreplace : un demi-substitut isolé devient « \udxxx », échappement JSON valide.
    ecrire(chemin, texte.encode("utf-8", "backslashreplace"))


def fiche_retour(ressource, inclus, genre):
    a = attributs(ressource)
    fiche = {"id": ressource["id"], "type": ressource.get("type"), "genre": genre}
    for cle in ATTRIBUTS:              # liste blanche : jamais « email »
        if cle in a:
            fiche[cle] = a[cle]
    fiche["build"] = None
    relations = ressource.get("relationships")
    build = relations.get("build") if isinstance(relations, dict) else None
    lien = build.get("data") if isinstance(build, dict) else None
    if isinstance(lien, dict) and isinstance(lien.get("id"), str):
        version = attributs(inclus.get(("builds", lien["id"]), {})).get("version")
        fiche["build"] = {"id": lien["id"], "version": version if isinstance(version, str) else None}
    return fiche


def traiter_plantage(client, ressource, inclus, dossier, stats):
    nom = nom_sur(ressource["id"])
    fiche = fiche_retour(ressource, inclus, "plantage")
    chemin = ("/v1/betaFeedbackCrashSubmissions/"
              + urllib.parse.quote(ressource["id"], safe="") + "/crashLog")
    doc = client.lire_json(url_api(chemin, {"fields[betaCrashLogs]": "logText"}),
                           "journal de plantage", accepter_404=True)
    texte = None
    if doc is not None:
        donnees = doc.get("data")
        if isinstance(donnees, dict):
            log = attributs(donnees).get("logText")
            if isinstance(log, str) and log.strip():
                texte = log
    if texte is None:                  # 404 ou journal vide : comportement non documenté
        fiche["journal"] = None
        fiche["journal_absent"] = "404" if doc is None else "vide"
        stats["sans_journal"] += 1
    else:
        # Xcode n'accepte que .crash (texte) ou .ips (JSON) pour symboliser.
        fmt = "ips" if texte.lstrip().startswith("{") else "crash"
        fichier = f"{nom}.{fmt}"
        ecrire(os.path.join(dossier, fichier), texte.encode("utf-8", "replace"))
        fiche["journal"] = fichier
        fiche["journal_format"] = fmt
        stats["journaux"] += 1
    ecrire_json(os.path.join(dossier, f"{nom}.json"), fiche)
    stats["plantages"] += 1


TYPES_MIME = {"image/png": "png", "image/jpeg": "jpg", "image/heic": "heic",
              "image/heif": "heic", "image/webp": "webp", "image/gif": "gif"}


def extension_image(octets, type_mime):
    if octets.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if octets.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if octets[4:8] == b"ftyp" and octets[8:12] in (b"heic", b"heix", b"heim", b"heis", b"mif1"):
        return "heic"
    if octets[:4] == b"RIFF" and octets[8:12] == b"WEBP":
        return "webp"
    if octets[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    return TYPES_MIME.get((type_mime or "").split(";")[0].strip().lower(), "bin")


def traiter_capture(client, ressource, inclus, dossier, stats):
    nom = nom_sur(ressource["id"])
    fiche = fiche_retour(ressource, inclus, "capture")
    images = []
    liste = attributs(ressource).get("screenshots")
    for n, image in enumerate(liste if isinstance(liste, list) else [], 1):
        if not isinstance(image, dict):
            continue
        # L'URL n'est jamais recopiée : temporaire, et inutile une fois l'image enregistrée.
        entree = {k: image[k] for k in ("width", "height", "expirationDate") if k in image}
        expire = lire_date(image.get("expirationDate"))
        url = image.get("url")
        if expire is not None and expire <= client.maintenant():
            entree["etat"] = "expirée"
            stats["images_expirees"] += 1
        elif not isinstance(url, str) or not url:
            entree["etat"] = "sans lien"
            stats["images_echec"] += 1
        else:
            try:
                octets, type_mime = client.telecharger(url)
            except Echec as e:
                entree["etat"] = "échec"
                entree["detail"] = e.message
                stats["images_echec"] += 1
            else:
                fichier = f"{nom}-{n}.{extension_image(octets, type_mime)}"
                ecrire(os.path.join(dossier, fichier), octets)
                entree["fichier"] = fichier
                entree["octets"] = len(octets)
                stats["images"] += 1
        images.append(entree)
    fiche["images"] = images
    ecrire_json(os.path.join(dossier, f"{nom}.json"), fiche)
    stats["captures"] += 1


def preparer_sortie(chemin):
    try:
        os.makedirs(chemin, mode=0o700, exist_ok=True)
        if os.listdir(chemin):
            raise Echec("le dossier de sortie n'est pas vide.", CONFIG)
        dossiers = {}
        for sous in ("plantages", "captures"):
            dossiers[sous] = os.path.join(chemin, sous)
            os.mkdir(dossiers[sous], 0o700)
    except OSError as e:
        raise Echec(f"dossier de sortie inutilisable ({type(e).__name__}).", CONFIG) from None
    return dossiers


def _pluriel(n, mot, pluriel=None):
    return f"{n} {mot if n <= 1 else (pluriel or mot + 's')}"


def ligne_resume(s):
    return (f"{_pluriel(s['plantages'], 'plantage')} ({_pluriel(s['journaux'], 'journal', 'journaux')}, "
            f"{s['sans_journal']} sans journal), {_pluriel(s['captures'], 'capture')} "
            f"({_pluriel(s['images'], 'image')}, {s['images_echec']} en échec, "
            f"{_pluriel(s['images_expirees'], 'expirée')})")


# --------------------------------------------------------------------------
# Programme
# --------------------------------------------------------------------------

def _plafond(texte):
    try:
        n = int(texte)
    except ValueError:
        raise argparse.ArgumentTypeError("entier attendu") from None
    if not 1 <= n <= 1000:
        raise argparse.ArgumentTypeError("entre 1 et 1000")
    return n


def _jour(texte):
    try:
        return dt.datetime.strptime(texte, "%Y-%m-%d").replace(tzinfo=UTC)
    except ValueError:
        raise argparse.ArgumentTypeError("date AAAA-MM-JJ attendue") from None


def analyser_arguments(argv):
    p = argparse.ArgumentParser(
        description="Récupère les retours TestFlight (plantages, captures) sans rien afficher de personnel.")
    p.add_argument("--sortie", required=True, help="dossier à créer (ou vide)")
    p.add_argument("--bundle-id", default="com.pingureep.remy")
    p.add_argument("--app-id", help="identifiant numérique de l'app (évite la recherche)")
    p.add_argument("--plafond", type=_plafond, default=50,
                   help="nombre maximum de retours par type, les plus récents (défaut 50)")
    p.add_argument("--depuis", type=_jour, help="ignorer les retours créés avant ce jour (UTC)")
    p.add_argument("--signeur", choices=("auto", "cryptography", "openssl"), default="auto")
    p.add_argument("--cle-individuelle", action="store_true",
                   help="clé API individuelle (sub=user, pas d'issuer)")
    return p.parse_args(argv)


def executer(args, environ, horloge=time.time, dormir=time.sleep):
    key_id = environ.get("ASC_KEY_ID", "").strip()
    issuer = environ.get("ASC_ISSUER_ID", "").strip()
    p8 = environ.get("ASC_KEY_P8", "")
    requis = [("ASC_KEY_ID", key_id), ("ASC_KEY_P8", p8.strip())]
    if not args.cle_individuelle:
        requis.insert(1, ("ASC_ISSUER_ID", issuer))
    manquants = [nom for nom, valeur in requis if not valeur]
    if manquants:
        raise Echec("variables d'environnement absentes : " + ", ".join(manquants) + ".", CONFIG)
    if not re.fullmatch(r"[A-Za-z0-9]{1,64}", key_id):
        raise Echec("ASC_KEY_ID : format inattendu.", CONFIG)
    if not args.cle_individuelle and not re.fullmatch(r"[A-Za-z0-9-]{1,64}", issuer):
        raise Echec("ASC_ISSUER_ID : format inattendu.", CONFIG)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,154}", args.bundle_id):
        raise Echec("--bundle-id : format inattendu.", CONFIG)
    if args.app_id is not None and not re.fullmatch(r"[0-9]{1,20}", args.app_id):
        raise Echec("--app-id : identifiant numérique attendu.", CONFIG)

    signer = choisir_signeur(decoder_cle(p8), args.signeur)

    def fabrique(t):
        return creer_jwt(signer, key_id, issuer, t, individuelle=args.cle_individuelle)

    client = ClientASC(fabrique, horloge=horloge, dormir=dormir)
    client.jeton()                      # échoue tôt si la clé ne signe pas
    dossiers = preparer_sortie(args.sortie)
    app_id = args.app_id or trouver_app(client, args.bundle_id)
    app = urllib.parse.quote(app_id, safe="")
    limite = str(min(args.plafond, LIMITE_API))
    stats = dict.fromkeys(("plantages", "journaux", "sans_journal", "captures",
                           "images", "images_echec", "images_expirees"), 0)

    for ressource, inclus in parcourir(
            client, f"/v1/apps/{app}/betaFeedbackCrashSubmissions",
            {"sort": "-createdDate", "limit": limite, "include": "build",
             "fields[builds]": "version",
             "fields[betaFeedbackCrashSubmissions]": ",".join(CHAMPS_PLANTAGES)},
            "liste des plantages", args.plafond, args.depuis):
        traiter_plantage(client, ressource, inclus, dossiers["plantages"], stats)

    for ressource, inclus in parcourir(
            client, f"/v1/apps/{app}/betaFeedbackScreenshotSubmissions",
            {"sort": "-createdDate", "limit": limite, "include": "build",
             "fields[builds]": "version",
             "fields[betaFeedbackScreenshotSubmissions]": ",".join(CHAMPS_CAPTURES)},
            "liste des captures", args.plafond, args.depuis):
        traiter_capture(client, ressource, inclus, dossiers["captures"], stats)

    ecrire_json(os.path.join(args.sortie, "resume.json"), {
        "genere_le": client.maintenant().isoformat(timespec="seconds"),
        "bundle_id": args.bundle_id, "app_id": app_id, "plafond": args.plafond,
        "depuis": args.depuis.date().isoformat() if args.depuis else None, **stats})
    print(ligne_resume(stats))
    return OK


def main(argv=None, environ=None, **injections):
    os.umask(0o077)
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(errors="backslashreplace")
        except Exception:
            pass
    try:
        args = analyser_arguments(argv)
        return executer(args, os.environ if environ is None else environ, **injections)
    except Echec as e:
        print(f"Échec : {e.message}", file=sys.stderr)
        return e.code
    except KeyboardInterrupt:
        print("Interrompu.", file=sys.stderr)
        return 130
    except SystemExit:
        raise
    except BaseException as e:          # jamais le message : il peut contenir des données
        print(f"Échec inattendu ({type(e).__name__}).", file=sys.stderr)
        return INATTENDU


if __name__ == "__main__":
    sys.exit(main())
