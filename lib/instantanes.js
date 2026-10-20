// Instantanés (Lot 1) : la dernière réponse utile d'un service lent ou limité,
// gardée dans remy.db avec son heure de lecture. Jamais bloquant : sans base
// (Vercel, test), on vit en mémoire et on le dit dans le journal de la tour.

import { db } from "./db.js";

export function lire(cle) {
  try {
    const r = db().prepare("SELECT json, lu_a FROM instantanes WHERE cle = ?").get(cle);
    return r ? { valeur: JSON.parse(r.json), luA: r.lu_a } : null;
  } catch (err) {
    console.warn(`Instantané « ${cle} » illisible :`, err.message);
    return null;
  }
}

export function ecrire(cle, valeur, luA = Date.now()) {
  try {
    db()
      .prepare(`INSERT INTO instantanes (cle, json, lu_a) VALUES (?, ?, ?)
        ON CONFLICT(cle) DO UPDATE SET json = excluded.json, lu_a = excluded.lu_a`)
      .run(cle, JSON.stringify(valeur), luA);
    return true;
  } catch (err) {
    console.warn(`Instantané « ${cle} » non gardé :`, err.message);
    return false;
  }
}
