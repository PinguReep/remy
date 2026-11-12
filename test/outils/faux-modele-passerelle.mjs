// Un faux modèle local pour la passerelle des outils de code : à UNE place
// (une requête attend que la précédente finisse, ou que son client coupe), qui
// sait répondre avec ou sans flux, et qui garde ce qu'il a reçu (corps et
// en-têtes) pour vérifier ce que la passerelle laisse passer. Données fictives.
//
//   const m = await fauxModelePasserelle({ duree: (texte) => (/LONG/.test(texte) ? 400 : 20) });
//   process.env.REMY_GLM_URL = m.url;  …  m.etat.recus, m.etat.coupes, await m.fermer()

import http from "node:http";

export async function fauxModelePasserelle({ duree = () => 30, morceaux = 4, statut = () => 200 } = {}) {
  const etat = { recus: [], servis: [], coupes: [], file: [], actif: null, modeles: 0 };
  const texteDe = (corps) => {
    const c = corps.messages?.at(-1)?.content;
    return typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p.text || "").join(" ") : "";
  };
  const servir = (e) => {
    const { res, corps, texte } = e;
    const s = statut(texte);
    if (s !== 200) {
      e.fini = true;
      etat.actif = null;
      res.writeHead(s, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: `refus d'essai ${s}` } })), suivant();
    }
    const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
    if (!corps.stream) {
      e.minuteur = setTimeout(() => {
        etat.actif = null;
        if (!e.ferme) {
          e.fini = true;
          etat.servis.push(texte);
          res.writeHead(200, { "Content-Type": "application/json", "X-Moteur-Interne": "essai" });
          res.end(JSON.stringify({ id: "x", object: "chat.completion", model: corps.model, choices: [{ index: 0, message: { role: "assistant", content: `Réponse à « ${texte.slice(0, 40)} »` }, finish_reason: "stop" }], usage }));
        }
        suivant();
      }, e.duree);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    let i = 0;
    const pas = Math.max(1, Math.floor(e.duree / (morceaux + 1)));
    const ecrire = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const tic = () => {
      if (e.ferme) return;
      if (i < morceaux) {
        ecrire({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: `m${i} ` }, finish_reason: null }] });
        i++;
        e.minuteur = setTimeout(tic, pas);
        return;
      }
      ecrire({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      if (corps.stream_options?.include_usage) ecrire({ id: "x", object: "chat.completion.chunk", choices: [], usage });
      res.write("data: [DONE]\n\n");
      e.fini = true;
      etat.servis.push(texte);
      etat.actif = null;
      res.end();
      suivant();
    };
    e.minuteur = setTimeout(tic, pas);
  };
  function suivant() {
    if (etat.actif) return;
    let e;
    do e = etat.file.shift();
    while (e && e.ferme);
    if (!e) return;
    etat.actif = e;
    e.debut = Date.now();
    servir(e);
  }
  const serveur = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      if (req.url.endsWith("/models")) {
        etat.modeles++;
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ data: [{ id: "Modele-Essai", max_model_len: 32768 }, { id: "Autre-Modele" }] }));
      }
      let corps = {};
      try {
        corps = JSON.parse(b || "{}");
      } catch {}
      const texte = texteDe(corps);
      const e = { res, corps, texte, duree: duree(texte), ferme: false, fini: false, arrivee: Date.now() };
      etat.recus.push({ texte, corps, entetes: { ...req.headers }, url: req.url, a: Date.now() });
      res.on("close", () => {
        if (e.fini || e.ferme) return;
        e.ferme = true;
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
    async enCalcul(re, maxMs = 5_000) {
      const fin = Date.now() + maxMs;
      while (!(etat.actif && re.test(etat.actif.texte))) {
        if (Date.now() > fin) throw new Error(`aucune requête ${re} en calcul`);
        await new Promise((r) => setTimeout(r, 5));
      }
    },
    vider() {
      etat.recus.length = etat.servis.length = etat.coupes.length = 0;
    },
    fermer: () => new Promise((r) => (serveur.closeAllConnections?.(), serveur.close(() => r()))),
  };
}
