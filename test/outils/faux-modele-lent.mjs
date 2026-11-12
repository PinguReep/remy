// Un faux modèle local LENT, à une seule place (comme un moteur qui sert une
// requête à la fois) : une requête attend que la précédente finisse — ou que
// son client coupe la connexion, auquel cas le calcul s'arrête et la place se
// libère (ce que fait un moteur qui sait annuler une requête abandonnée).
// Parle « chat completions » d'OpenAI, sans flux. Données fictives.
//
//   const m = await fauxModeleLent({ duree: (texte) => (/FOND/.test(texte) ? 800 : 20) });
//   process.env.REMY_GLM_URL = m.url;  …  m.etat.coupes, m.etat.recus, await m.fermer()

import http from "node:http";

export async function fauxModeleLent({ duree = () => 50, reponse = (texte) => `Réponse à « ${texte.slice(0, 40)} »` } = {}) {
  const etat = { recus: [], servis: [], coupes: [], file: [], actif: null };
  const suivant = () => {
    if (etat.actif) return;
    let e;
    do e = etat.file.shift();
    while (e && e.ferme);
    if (!e) return;
    etat.actif = e;
    e.debut = Date.now();
    e.minuteur = setTimeout(() => {
      etat.actif = null;
      if (!e.ferme) {
        e.fini = true;
        etat.servis.push(e.texte);
        e.res.writeHead(200, { "Content-Type": "application/json" });
        e.res.end(JSON.stringify({ choices: [{ message: { content: reponse(e.texte) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
      }
      suivant();
    }, e.duree);
  };
  const serveur = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      if (req.url.endsWith("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ data: [{ id: "Modele-Essai", max_model_len: 32768 }] }));
      }
      let corps = {};
      try {
        corps = JSON.parse(b || "{}");
      } catch {}
      const texte = String(corps.messages?.at(-1)?.content || "");
      const e = { res, texte, duree: duree(texte), ferme: false, fini: false, arrivee: Date.now() };
      etat.recus.push(texte);
      res.on("close", () => {
        if (e.fini || e.ferme) return;
        e.ferme = true; // le client a coupé : le calcul s'arrête, la place se libère
        etat.coupes.push(texte);
        if (etat.actif === e) {
          clearTimeout(e.minuteur);
          etat.actif = null;
          suivant();
        }
      });
      etat.file.push(e);
      suivant();
    });
  });
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${serveur.address().port}/v1`,
    etat,
    // Attend qu'une requête dont le texte correspond soit en cours de calcul.
    async enCalcul(re, maxMs = 5_000) {
      const fin = Date.now() + maxMs;
      while (!(etat.actif && re.test(etat.actif.texte))) {
        if (Date.now() > fin) throw new Error(`aucune requête ${re} en calcul`);
        await new Promise((r) => setTimeout(r, 5));
      }
    },
    fermer: () => new Promise((r) => (serveur.closeAllConnections?.(), serveur.close(() => r()))),
  };
}
