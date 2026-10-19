// Bac à sable (Lot 0, J0.5) : en test (REMY_ENV=test, posé par `npm test`),
// aucune requête ne part vers un vrai Motion ou un vrai Google. Ce n'est pas
// une convention de test, c'est le code qui refuse : un test qui oublierait
// de brancher le faux service échoue au lieu de toucher le planning de Sam
// (cahier des charges, §14.2.6 : jamais les comptes de production en test).

const LOCAUX = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function exigerBacASable(url, service) {
  if (process.env.REMY_ENV !== "test") return;
  let hote;
  try {
    hote = new URL(url).hostname;
  } catch {
    return;
  }
  if (!LOCAUX.has(hote)) {
    throw new Error(`REMY_ENV=test : requête vers ${service} RÉEL refusée (${hote}). Les tests n'utilisent que de faux services.`);
  }
}
