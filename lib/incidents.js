// Les codes d'erreur (Sam, 19/10) : chaque échec d'une réponse reçoit un code
// court (« R-7KQ2M ») que Sam peut copier et transmettre. La tour garde
// l'incident : quand, à quelle étape, quelle erreur technique, combien de
// temps, quelles tailles — JAMAIS le contenu des messages (ni question, ni
// réponse, ni mémoire). Lisible par l'app (« Copier le diagnostic ») et sur la
// tour : node scripts/incident.mjs R-7KQ2M
//
// Fichier `<base>/incidents.jsonl`, les 300 derniers.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dossierBase } from "./store.js";
import { versionServeur } from "./version.js";

const GARDER = 300;
// Sans 0/O ni 1/I/L : un code se lit et se dicte sans ambiguïté.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const FORME = /^R-[2-9A-HJKMNP-Z]{5}$/;

export const cheminIncidents = () => path.join(dossierBase(), "incidents.jsonl");

export function nouveauCode() {
  let c = "R-";
  for (let i = 0; i < 5; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return c;
}

export const codeValide = (c) => FORME.test(String(c || "").toUpperCase());

// Un message technique, borné : un serveur de modèle peut citer un bout de ce
// qu'on lui a envoyé dans son erreur — on n'en garde que le début.
const technique = (m) => String(m || "").replace(/\s+/g, " ").slice(0, 300);

// Enregistre un incident et rend son code. Ne lève jamais : un journal
// d'incidents en panne ne doit pas masquer l'erreur d'origine.
export function noterIncident(details = {}) {
  const code = nouveauCode();
  const err = details.erreur;
  const entree = {
    code,
    a: new Date().toISOString(),
    serveur: (() => {
      try {
        const v = versionServeur();
        return { version: v.serveur, commit: v.commit || null };
      } catch {
        return null;
      }
    })(),
    ...details,
    ...(err
      ? {
          erreur: {
            nom: err.name || "Error",
            nature: err.nature || null,
            statut: err.status ?? null,
            message: technique(err.message),
          },
        }
      : {}),
  };
  try {
    const f = cheminIncidents();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify(entree) + "\n");
    elaguer(f);
  } catch (e) {
    console.warn(`Incident ${code} non enregistré : ${e.code || e.message}`);
  }
  console.warn(`Incident ${code} : ${entree.erreur?.message || entree.type || "?"}`);
  return code;
}

function elaguer(f) {
  const st = fs.statSync(f);
  if (st.size < 400 * 1024) return;
  const lignes = fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
  if (lignes.length <= GARDER) return;
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, lignes.slice(-GARDER).join("\n") + "\n");
  fs.renameSync(tmp, f);
}

function toutes() {
  try {
    return fs
      .readFileSync(cheminIncidents(), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function lireIncident(code) {
  const c = String(code || "").toUpperCase();
  return toutes().find((e) => e.code === c) || null;
}

export const derniersIncidents = (n = 30) => toutes().slice(-n).reverse();
