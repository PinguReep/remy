// Copie des sauvegardes sur un DGX Spark (ou tout serveur SSH) par SFTP —
// destination secondaire, hors de la tour, en attendant le disque externe.
//
// L'archive est DÉJÀ chiffrée (AES-256-GCM) avant de partir, et la clé ne va
// jamais sur le Spark : qui lit le Spark ne lit que du chiffré.
//
// Côté tour : le client OpenSSH de Windows (`sftp`), une clé SSH dédiée
// (~/.remy/spark_ed25519) et l'empreinte du Spark épinglée
// (~/.remy/spark_hotes_connus) — jamais de mot de passe, jamais d'empreinte
// acceptée à l'aveugle. Côté Spark : un compte sans shell, enfermé dans son
// dossier (scripts/spark-preparer.sh).
//
// Chaque copie : place libre vérifiée, envoi sous un nom provisoire puis
// renommage (jamais d'archive à moitié écrite sous un vrai nom), relecture
// complète et déchiffrement, puis rétention (mêmes règles que la tour).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DELAI_MS = 10 * 60 * 1000;
// Le Spark garde de quoi respirer : jamais rempli au-delà de « archive + 2 Go ».
export const MARGE_OCTETS = 2 * 1024 ** 3;

// « utilisateur@hote:/dossier » (port en option : « utilisateur@hote:2222:/dossier »).
export function lireCible(texte) {
  const m = /^([a-z_][a-z0-9_.-]{0,31})@([A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(?::(\d{1,5}))?:(\/[A-Za-z0-9._\/-]*)$/.exec(String(texte || "").trim());
  if (!m) {
    throw new Error("REMY_SAUVEGARDES_SPARK attendu sous la forme utilisateur@hote:/dossier (ex. remy-sauvegarde@spark-1:/sauvegardes)");
  }
  const [, utilisateur, hote, port, dossier] = m;
  if (dossier.split("/").includes("..")) throw new Error("REMY_SAUVEGARDES_SPARK : « .. » refusé dans le dossier");
  return { utilisateur, hote, port: port ? Number(port) : 22, dossier: dossier.replace(/\/+$/, "") || "/" };
}

export function configSftp(env = process.env) {
  const dossierRemy = path.join(os.homedir(), ".remy");
  return {
    bin: env.REMY_SFTP_BIN || "sftp",
    cleSsh: env.REMY_SPARK_CLE_SSH || path.join(dossierRemy, "spark_ed25519"),
    hotesConnus: env.REMY_SPARK_HOTES_CONNUS || path.join(dossierRemy, "spark_hotes_connus"),
  };
}

// Les options qui font la sécurité : aucune n'est réglable de l'extérieur.
export function argumentsSftp(cible, config) {
  return [
    "-b", "-",
    "-P", String(cible.port),
    "-i", config.cleSsh,
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${config.hotesConnus}`,
    "-o", "IdentitiesOnly=yes",
    "-o", "PasswordAuthentication=no",
    "-o", "ConnectTimeout=15",
    "-o", "ServerAliveInterval=15",
    `${cible.utilisateur}@${cible.hote.replace(/^\[|\]$/g, "")}`,
  ];
}

// Ce que dit OpenSSH, en clair pour Sam. Code 255 : la connexion SSH
// elle-même ; sinon, c'est la DERNIÈRE commande qui a échoué qui compte.
export function expliquer(sortieErreur, code) {
  const e = String(sortieErreur || "");
  if (e === "ENOENT") return "client sftp introuvable sur la tour (OpenSSH)";
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|No .* host key is known/i.test(e)) {
    return "empreinte du Spark inconnue ou CHANGÉE — rien n'a été envoyé (voir docs/tour.md, « Spark »)";
  }
  if (/Permission denied \(publickey|Too many authentication failures/i.test(e)) return "le Spark refuse la clé SSH de la tour";
  if (code === 255 || /Could not resolve hostname|Connection refused|Connection timed out|No route to host|Network is unreachable/i.test(e)) {
    return "Spark injoignable (éteint, hors réseau ?)";
  }
  const lignes = e.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("sftp>"));
  const derniere = lignes.at(-1);
  if (!derniere) return `sftp a échoué (code ${code})`;
  if (/No such file/i.test(derniere)) return `introuvable sur le Spark (${derniere.slice(0, 160)})`;
  return derniere.slice(0, 200);
}

// Une session sftp en lot : les commandes partent sur l'entrée standard, la
// première qui échoue arrête tout (sauf celles préfixées « - »).
export function executer(cible, commandes, { config = configSftp(), dossierLocal = os.tmpdir(), delai = DELAI_MS } = {}) {
  return new Promise((resolve, reject) => {
    const args = argumentsSftp(cible, config);
    // Un faux sftp en JavaScript (tests) se lance avec Node, sur toutes les plateformes.
    const [prog, debut] = /\.m?js$/.test(config.bin) ? [process.execPath, [config.bin]] : [config.bin, []];
    let enfant;
    try {
      enfant = spawn(prog, [...debut, ...args], { cwd: dossierLocal, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      return reject(new Error(expliquer(err.message, -1)));
    }
    let sortie = "";
    let erreur = "";
    const minuteur = setTimeout(() => {
      enfant.kill("SIGKILL");
      reject(new Error("le Spark n'a pas répondu à temps"));
    }, delai);
    enfant.stdout.on("data", (c) => (sortie += c));
    enfant.stderr.on("data", (c) => (erreur += c));
    enfant.on("error", (err) => {
      clearTimeout(minuteur);
      reject(new Error(expliquer(err.code === "ENOENT" ? "ENOENT" : err.message, -1)));
    });
    enfant.on("close", (code) => {
      clearTimeout(minuteur);
      if (code !== 0) return reject(new Error(expliquer(erreur || sortie, code)));
      resolve({ sortie, erreur });
    });
    enfant.stdin.end(commandes.join("\n") + "\n");
  });
}

const guillemets = (p) => `"${p}"`;

// « df » de sftp : Size Used Avail (root) %Capacity, en Kio.
export function lireLibre(sortie) {
  const lignes = String(sortie).split(/\r?\n/);
  const i = lignes.findIndex((l) => /\bAvail\b/.test(l));
  if (i < 0) return null;
  const nombres = (lignes[i + 1] || "").trim().split(/\s+/);
  const kio = Number(nombres[2]);
  return Number.isFinite(kio) ? kio * 1024 : null;
}

// « ls -1 » : un nom par ligne, parfois avec le chemin ; l'écho « sftp> » ignoré.
export function lireListe(sortie, dossier) {
  return String(sortie)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("sftp>"))
    .map((l) => (l.startsWith(dossier + "/") ? l.slice(dossier.length + 1) : path.posix.basename(l)));
}

export const formatOctets = (n) =>
  n >= 1024 ** 4 ? `${(n / 1024 ** 4).toFixed(1)} To` : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(0)} Go` : `${Math.round(n / 1024 ** 2)} Mo`;

// La place libre et les archives présentes, sans rien écrire.
// (Deux sessions : chaque sortie se lit seule. « -df » : un serveur sans
// l'extension statvfs ne bloque pas la copie, la place est alors inconnue.)
export async function etatDistant(cible, options = {}) {
  const d = cible.dossier;
  const df = await executer(cible, [`-df ${guillemets(d)}`], options);
  const ls = await executer(cible, [`ls -1 ${guillemets(d)}`], options);
  return { libre: lireLibre(df.sortie), noms: lireListe(ls.sortie, d) };
}

// Envoie, relit, déchiffre, puis applique la rétention. `verifier(buf)` lève
// une erreur si l'archive relue n'est pas bonne ; `aGarder(noms)` dit quoi
// garder ; `dateArchive(nom)` reconnaît une archive de Rémy (sa date), et seules
// celles-là peuvent partir — jamais un fichier déposé à la main.
export async function copierSurSpark({ cible, nom, archive, verifier, aGarder, dateArchive, maintenant = new Date(), options = {} }) {
  if (!/^[a-z0-9.-]+$/.test(nom)) throw new Error(`nom d'archive refusé : ${nom}`);
  const etat = await etatDistant(cible, options);
  if (etat.libre != null && etat.libre < archive.length + MARGE_OCTETS) {
    throw new Error(`place insuffisante sur le Spark (${formatOctets(etat.libre)} libres) — rien n'a été envoyé`);
  }
  const local = fs.mkdtempSync(path.join(os.tmpdir(), "remy-spark-"));
  try {
    fs.writeFileSync(path.join(local, "envoi.bin"), archive, { mode: 0o600 });
    const distant = `${cible.dossier}/${nom}`;
    // (Un « .part » laissé par un envoi coupé est simplement réécrit.)
    await executer(
      cible,
      [
        `put envoi.bin ${guillemets(distant + ".part")}`,
        `rename ${guillemets(distant + ".part")} ${guillemets(distant)}`,
        `get ${guillemets(distant)} relu.bin`,
      ],
      { ...options, dossierLocal: local },
    );
    try {
      const relu = fs.readFileSync(path.join(local, "relu.bin"));
      if (!relu.equals(archive)) throw new Error("la copie relue sur le Spark ne correspond pas à l'archive envoyée");
      verifier(relu);
    } catch (err) {
      // Une copie qu'on ne sait pas relire n'est pas une sauvegarde : elle ne
      // reste pas sur le Spark sous un vrai nom.
      await executer(cible, [`-rm ${guillemets(distant)}`], { ...options, dossierLocal: local }).catch(() => {});
      throw err;
    }
    // Rétention : seules les archives de Rémy (nom reconnu) peuvent partir,
    // plus les « .part » d'envois coupés de plus d'un jour.
    const garder = aGarder([...new Set([...etat.noms, nom])]);
    const aSupprimer = etat.noms.filter((n) => {
      if (n === nom) return false;
      if (n.endsWith(".part")) {
        const d = dateArchive(n.slice(0, -".part".length));
        return Boolean(d) && maintenant - d > 86_400_000;
      }
      return Boolean(dateArchive(n)) && !garder.has(n);
    });
    if (aSupprimer.length) {
      await executer(cible, aSupprimer.map((n) => `-rm ${guillemets(`${cible.dossier}/${n}`)}`), { ...options, dossierLocal: local });
    }
    const libreApres = etat.libre != null ? etat.libre - archive.length : null;
    return { fichier: `${cible.utilisateur}@${cible.hote}:${distant}`, supprimees: aSupprimer.length, libre: libreApres };
  } finally {
    fs.rmSync(local, { recursive: true, force: true });
  }
}

// Récupère une archive du Spark (la plus récente si `nom` est absent) dans `vers`.
export async function telechargerDuSpark({ cible, nom = null, vers, options = {} }) {
  let choisi = nom;
  if (!choisi) {
    const { noms } = await etatDistant(cible, options);
    choisi = noms.filter((n) => /^remy-\d{8}-\d{6}-[a-z0-9-]+\.remy-sauvegarde$/.test(n)).sort().at(-1);
    if (!choisi) throw new Error("aucune sauvegarde sur le Spark");
  }
  if (!/^[a-z0-9.-]+$/.test(choisi)) throw new Error(`nom d'archive refusé : ${choisi}`);
  fs.mkdirSync(vers, { recursive: true });
  await executer(cible, [`get ${guillemets(`${cible.dossier}/${choisi}`)} ${guillemets(choisi)}`], { ...options, dossierLocal: vers });
  return path.join(vers, choisi);
}
