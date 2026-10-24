// Enregistre les Bundle ID de l'app et de ses extensions (widgets, feuille de
// partage — 24/10) auprès d'Apple via l'API App Store Connect (idempotent : ne
// fait rien pour ceux qui existent déjà). Utilisé par le workflow iOS — évite
// l'étape manuelle « Identifiers » du portail développeur. Aucune capacité à
// activer : le trousseau partagé est couvert par tout profil de l'équipe.
//
// Env requis : ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 (contenu .p8 en base64).

import crypto from "node:crypto";

// L'app d'abord : ses extensions n'ont de sens qu'avec elle.
const BUNDLES = [
  { id: "com.pingureep.remy", nom: "Remy" },
  { id: "com.pingureep.remy.widgets", nom: "Remy Widgets" },
  { id: "com.pingureep.remy.partage", nom: "Remy Partage" },
];

const keyId = process.env.ASC_KEY_ID;
const issuerId = process.env.ASC_ISSUER_ID;
const p8 = Buffer.from(process.env.ASC_KEY_P8 || "", "base64").toString("utf8");
if (!keyId || !issuerId || !p8) {
  console.error("Secrets ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_P8 manquants.");
  process.exit(1);
}

// JWT ES256 signé à la main (aucune dépendance).
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
const now = Math.floor(Date.now() / 1000);
const payload = b64url(
  JSON.stringify({ iss: issuerId, iat: now, exp: now + 600, aud: "appstoreconnect-v1" })
);
const signature = crypto
  .sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: p8,
    dsaEncoding: "ieee-p1363",
  })
  .toString("base64url");
const jwt = `${header}.${payload}.${signature}`;

const api = (path, opts = {}) =>
  fetch(`https://api.appstoreconnect.apple.com/v1${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });

async function enregistrer({ id, nom }) {
  const list = await api(`/bundleIds?filter[identifier]=${encodeURIComponent(id)}`);
  if (!list.ok) {
    console.error(`Lecture des Bundle ID impossible (${list.status}) :`, (await list.text()).slice(0, 400));
    return false;
  }
  // Le filtre d'Apple est un préfixe : on compare l'identifiant exact.
  const found = (await list.json()).data?.some((b) => b.attributes?.identifier === id);
  if (found) {
    console.log(`Bundle ID ${id} déjà enregistré ✓`);
    return true;
  }
  const create = await api("/bundleIds", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "bundleIds",
        attributes: { identifier: id, name: nom, platform: "IOS" },
      },
    }),
  });
  if (create.ok) {
    console.log(`Bundle ID ${id} enregistré ✓`);
    return true;
  }
  console.error(`Échec pour ${id} (${create.status}) :`, (await create.text()).slice(0, 400));
  return false;
}

let echecs = 0;
for (const b of BUNDLES) {
  if (!(await enregistrer(b))) echecs++;
}
if (echecs) process.exit(1);
