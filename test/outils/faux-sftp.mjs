// Un faux client `sftp` (OpenSSH) pour les tests : il lit les commandes en
// lot sur l'entrée standard et les applique à un dossier local qui joue le
// Spark. Il note ses arguments, et sait simuler les pannes utiles.
//
//   FAUX_SFTP_RACINE   dossier qui tient lieu de racine du Spark
//   FAUX_SFTP_TRACE    fichier où noter les arguments reçus (JSON, une ligne par appel)
//   FAUX_SFTP_PANNE    "injoignable" | "empreinte" | "cle"
//   FAUX_SFTP_LIBRE    place libre annoncée par « df », en Kio
//   FAUX_SFTP_ABIMER   "1" : « get » rend une copie modifiée d'un octet

import fs from "node:fs";
import path from "node:path";

const racine = process.env.FAUX_SFTP_RACINE;
const args = process.argv.slice(2);
if (process.env.FAUX_SFTP_TRACE) fs.appendFileSync(process.env.FAUX_SFTP_TRACE, JSON.stringify({ args, cwd: process.cwd() }) + "\n");

const panne = process.env.FAUX_SFTP_PANNE;
if (panne === "injoignable") {
  process.stderr.write("ssh: connect to host spark-1 port 22: Connection refused\r\nConnection closed\r\n");
  process.exit(255);
}
if (panne === "empreinte") {
  process.stderr.write("No ED25519 host key is known for spark-1 and you have requested strict checking.\r\nHost key verification failed.\r\nConnection closed\r\n");
  process.exit(255);
}
if (panne === "cle") {
  process.stderr.write("remy-sauvegarde@spark-1: Permission denied (publickey).\r\nConnection closed\r\n");
  process.exit(255);
}

const distant = (p) => path.join(racine, ...p.replace(/^"|"$/g, "").split("/").filter(Boolean));
const local = (p) => path.resolve(process.cwd(), p.replace(/^"|"$/g, ""));
const mots = (ligne) => ligne.match(/"[^"]*"|\S+/g) || [];

let entree = "";
process.stdin.on("data", (c) => (entree += c));
process.stdin.on("end", () => {
  for (const brute of entree.split(/\r?\n/)) {
    const ligne = brute.trim();
    if (!ligne) continue;
    process.stdout.write(`sftp> ${ligne}\n`);
    const ignorer = ligne.startsWith("-");
    const [cmd, ...reste] = mots(ignorer ? ligne.slice(1) : ligne);
    try {
      if (cmd === "df") {
        const libre = Number(process.env.FAUX_SFTP_LIBRE || 900_000_000);
        process.stdout.write("        Size         Used        Avail       (root)    %Capacity\n");
        process.stdout.write(`  1000000000  ${1_000_000_000 - libre}  ${libre}  ${libre}  ${Math.round(100 - libre / 10_000_000)}%\n`);
      } else if (cmd === "ls") {
        const dossier = reste.filter((m) => !m.startsWith("-")).at(-1);
        const nom = dossier.replace(/^"|"$/g, "").replace(/\/+$/, "");
        for (const n of fs.readdirSync(distant(dossier)).sort()) process.stdout.write(`${nom}/${n}\n`);
      } else if (cmd === "put") {
        fs.copyFileSync(local(reste[0]), distant(reste[1]));
      } else if (cmd === "rename") {
        if (fs.existsSync(distant(reste[1]))) throw new Error("Couldn't rename file: Failure");
        fs.renameSync(distant(reste[0]), distant(reste[1]));
      } else if (cmd === "get") {
        const buf = fs.readFileSync(distant(reste[0]));
        if (process.env.FAUX_SFTP_ABIMER === "1") buf[buf.length - 1] ^= 1;
        fs.writeFileSync(local(reste[1]), buf);
      } else if (cmd === "rm") {
        fs.rmSync(distant(reste[0]));
      } else {
        throw new Error(`Invalid command.`);
      }
    } catch (err) {
      process.stderr.write(`${err.code === "ENOENT" ? "No such file or directory" : err.message}\n`);
      if (!ignorer) process.exit(1);
    }
  }
  process.exit(0);
});
