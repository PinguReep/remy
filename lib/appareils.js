// Jetons d'appareil (Lot 0, J0.8b, D16) : l'iPhone ne vit plus d'un cookie de
// 30 jours. À la connexion, il reçoit un jeton à lui, rangé dans le Keychain ;
// la tour n'en garde que l'empreinte (SHA-256), avec un nom et une date de
// dernière visite. Sam voit ses appareils et en déconnecte un d'un geste.
// Le site, lui, garde son cookie.
//
//   Authorization: Bearer rmy_<43 caractères>

import crypto from "node:crypto";
import { db } from "./db.js";

const FORME = /^rmy_[A-Za-z0-9_-]{43}$/;
const empreinte = (jeton) => crypto.createHash("sha256").update(jeton).digest("hex");
const nomPropre = (nom) => String(nom || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Appareil";

// Le jeton d'APPAREIL présenté par la requête, s'il y en a un (le jeton du
// raccourci de capture voyage aussi en Bearer : il n'a pas cette forme).
export function jetonDe(req) {
  const h = req.headers?.authorization;
  const m = typeof h === "string" ? h.match(/^Bearer\s+(\S+)$/i) : null;
  return m && FORME.test(m[1]) ? m[1] : null;
}

// Un jeton neuf pour un appareil. Rendu UNE fois : la tour ne pourra plus le
// redonner (elle n'en garde que l'empreinte).
export function emettre(nom) {
  const jeton = `rmy_${crypto.randomBytes(32).toString("base64url")}`;
  const id = crypto.randomUUID();
  db().prepare("INSERT INTO appareils (id, nom, empreinte, cree_a, vu_a) VALUES (?, ?, ?, ?, ?)").run(id, nomPropre(nom), empreinte(jeton), Date.now(), Date.now());
  console.warn(`Appareil connecté : ${nomPropre(nom)} (${id.slice(0, 8)})`);
  return { id, nom: nomPropre(nom), jeton };
}

// L'appareil d'un jeton valide (non révoqué), sinon null. Comparaison sur
// l'empreinte : un jeton mal formé ne touche même pas la base.
export function appareilDuJeton(jeton) {
  if (!FORME.test(String(jeton || ""))) return null;
  let a;
  try {
    a = db().prepare("SELECT id, nom, cree_a, vu_a FROM appareils WHERE empreinte = ? AND revoque_a IS NULL").get(empreinte(jeton));
  } catch (err) {
    // Base indisponible : ce n'est PAS un jeton révoqué. L'appelant répond
    // 503 — l'iPhone garde son jeton au lieu de se croire déconnecté.
    throw new BaseAppareilsIndisponible(err);
  }
  if (!a) return null;
  // « Vu » à 5 minutes près : pas une écriture par requête.
  if (!a.vu_a || Date.now() - a.vu_a > 5 * 60_000) {
    try {
      db().prepare("UPDATE appareils SET vu_a = ? WHERE id = ?").run(Date.now(), a.id);
    } catch {}
  }
  return a;
}

export class BaseAppareilsIndisponible extends Error {
  constructor(cause) {
    super(`Base des appareils indisponible : ${cause?.message || cause}`);
    this.code = "BASE_APPAREILS";
  }
}

export function lister() {
  return db()
    .prepare("SELECT id, nom, cree_a, vu_a FROM appareils WHERE revoque_a IS NULL ORDER BY COALESCE(vu_a, cree_a) DESC")
    .all();
}

export function revoquer(id) {
  const n = db().prepare("UPDATE appareils SET revoque_a = ? WHERE id = ? AND revoque_a IS NULL").run(Date.now(), String(id || "")).changes;
  if (n) console.warn(`Appareil déconnecté : ${String(id).slice(0, 8)}`);
  return n === 1;
}
