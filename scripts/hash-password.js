#!/usr/bin/env node
// Génère la valeur APP_PASSWORD_HASH à mettre dans les variables d'environnement Vercel.
// Usage : node scripts/hash-password.js "ton-mot-de-passe"

import crypto from "node:crypto";

const pwd = process.argv[2];
if (!pwd) {
  console.error('Usage : node scripts/hash-password.js "ton-mot-de-passe"');
  process.exit(1);
}
if (pwd.length < 12) {
  console.error("⚠️  Mot de passe court : vise au moins 12 caractères (une phrase de passe, c'est encore mieux).");
}

const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(pwd, salt, 64).toString("hex");

console.log("\nAjoute cette variable d'environnement dans Vercel :\n");
console.log(`APP_PASSWORD_HASH=scrypt:${salt}:${hash}\n`);
