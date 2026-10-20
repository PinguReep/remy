// Certificats Apple du compte, via l'API App Store Connect (workflow TestFlight).
//
//   node scripts/asc-certificats.mjs              liste (type, nom, expiration)
//   node scripts/asc-certificats.mjs --nettoyer   révoque les certificats de
//                                                 DÉVELOPPEMENT créés par la CI
//
// Pourquoi : chaque build TestFlight tourne sur une machine neuve ; la signature
// automatique y crée un certificat « Apple Development » dont la clé privée
// disparaît avec la machine. Apple en plafonne le nombre : le 15/10/2026, le
// build 14 a été refusé (« maximum number of certificates »). Ces certificats ne
// servent plus à rien ; les révoquer ne touche à aucun build déjà envoyé.
// Jamais un certificat de distribution, jamais un certificat fait à la main
// (seuls ceux nommés « Created via API », le nom que leur donne Xcode).
//
// Env : ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 (contenu .p8 en base64).
// ASC_API_URL : un autre serveur (tests seulement). N'affiche jamais de secret.

import crypto from "node:crypto";

const DEVELOPPEMENT = new Set(["DEVELOPMENT", "IOS_DEVELOPMENT"]);
const PAR_LA_CI = /created via api/i;

const keyId = process.env.ASC_KEY_ID;
const issuerId = process.env.ASC_ISSUER_ID;
const p8 = Buffer.from(process.env.ASC_KEY_P8 || "", "base64").toString("utf8");
const base = process.env.ASC_API_URL || "https://api.appstoreconnect.apple.com/v1";
const nettoyer = process.argv.includes("--nettoyer");

if (!keyId || !issuerId || !p8) {
  console.error("Secrets ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_P8 manquants.");
  process.exit(1);
}

// JWT ES256 signé à la main (aucune dépendance), comme asc-register-bundle.mjs.
const b64url = (x) => Buffer.from(x).toString("base64url");
const entete = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
const t = Math.floor(Date.now() / 1000);
const charge = b64url(JSON.stringify({ iss: issuerId, iat: t, exp: t + 600, aud: "appstoreconnect-v1" }));
const signature = crypto.sign("sha256", Buffer.from(`${entete}.${charge}`), { key: p8, dsaEncoding: "ieee-p1363" }).toString("base64url");
const jwt = `${entete}.${charge}.${signature}`;

const api = (chemin, opts = {}) =>
  fetch(`${base}${chemin}`, { ...opts, headers: { Authorization: `Bearer ${jwt}`, ...(opts.headers || {}) } });

const champs = "fields[certificates]=certificateType,displayName,name,platform,expirationDate";
const liste = await api(`/certificates?limit=200&${champs}`);
if (!liste.ok) {
  console.error(`Liste des certificats impossible (${liste.status}) :`, (await liste.text()).slice(0, 300));
  process.exit(1);
}
const certificats = ((await liste.json()).data || []).map((c) => ({
  id: c.id,
  type: c.attributes?.certificateType || "?",
  nom: c.attributes?.displayName || c.attributes?.name || "?",
  complet: `${c.attributes?.displayName || ""} ${c.attributes?.name || ""}`,
  expire: String(c.attributes?.expirationDate || "").slice(0, 10) || "?",
}));

const ligne = (c) => `  ${c.type.padEnd(16)} ${c.nom.padEnd(28)} expire ${c.expire}  (${c.id.slice(0, 6)}…)`;
console.log(`${certificats.length} certificat(s) sur le compte :`);
for (const c of certificats) console.log(ligne(c));

if (!nettoyer) process.exit(0);

const aRevoquer = certificats.filter((c) => DEVELOPPEMENT.has(c.type) && PAR_LA_CI.test(c.complet));
if (!aRevoquer.length) {
  console.log("Rien à révoquer : aucun certificat de développement créé par la CI.");
  process.exit(0);
}
let echecs = 0;
for (const c of aRevoquer) {
  const r = await api(`/certificates/${encodeURIComponent(c.id)}`, { method: "DELETE" });
  if (r.ok) {
    console.log(`Révoqué :${ligne(c)}`);
  } else {
    echecs++;
    console.log(`::warning::Pas révoqué (${r.status}) :${ligne(c)} — ${(await r.text()).slice(0, 200)}`);
  }
}
console.log(`${aRevoquer.length - echecs} certificat(s) de développement de la CI révoqué(s), ${echecs} échec(s). Aucun certificat de distribution touché.`);
process.exit(echecs ? 1 : 0);
