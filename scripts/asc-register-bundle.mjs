// Enregistre le Bundle ID de l'app auprès d'Apple via l'API App Store Connect
// (idempotent : ne fait rien s'il existe déjà). Utilisé par le workflow iOS —
// évite l'étape manuelle « Identifiers » du portail développeur.
//
// Env requis : ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 (contenu .p8 en base64).

import crypto from "node:crypto";

const BUNDLE_ID = "com.pingureep.remy";
const NAME = "Remy";

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

const list = await api(`/bundleIds?filter[identifier]=${BUNDLE_ID}`);
const found = (await list.json()).data?.some((b) => b.attributes?.identifier === BUNDLE_ID);
if (found) {
  console.log(`Bundle ID ${BUNDLE_ID} déjà enregistré ✓`);
  process.exit(0);
}

const create = await api("/bundleIds", {
  method: "POST",
  body: JSON.stringify({
    data: {
      type: "bundleIds",
      attributes: { identifier: BUNDLE_ID, name: NAME, platform: "IOS" },
    },
  }),
});
if (create.ok) {
  console.log(`Bundle ID ${BUNDLE_ID} enregistré ✓`);
} else {
  console.error(`Échec (${create.status}) :`, (await create.text()).slice(0, 400));
  process.exit(1);
}
