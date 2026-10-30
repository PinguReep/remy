// Les tâches cochées du site (public/app/vues/gerer.js et file-envoi.js),
// telles que la contre-relecture du lot « aujourdhui » les a prises en défaut :
// - « Annuler » sur une coche EN ROUTE (envoi direct ou file en vol) ne la
//   retient plus, mais la fait rouvrir dès qu'elle arrive (avant : la ligne
//   disparaissait et Motion la marquait faite quand même, sans un mot) ;
// - une coche partie par la file pendant qu'Aujourd'hui n'était pas affiché
//   (fenêtre rechargée sur Rémy) se conclut quand même : le registre des
//   envois garde son ledgerId, « sera rouverte » est tenu ;
// - la vidange relit la file : un envoi retiré pendant qu'un autre est en vol
//   ne part plus ;
// - h() pose les propriétés personnalisées (--couleur) que les blocs de la
//   frise attendent.
// Un DOM minimal suffit : ces modules ne touchent la page que par h() et dire().
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";

// --- localStorage en mémoire, et un DOM minimal pour les bandeaux ---
const magasin = new Map();
globalThis.localStorage = {
  getItem: (k) => (magasin.has(k) ? magasin.get(k) : null),
  setItem: (k, v) => magasin.set(k, String(v)),
  removeItem: (k) => magasin.delete(k),
  clear: () => magasin.clear(),
};
/** Comme CSSStyleDeclaration : une propriété « --x » affectée directement n'est pas posée. */
function fauxStyle() {
  const props = {};
  const cible = { setProperty: (k, v) => { props[k] = String(v); }, getPropertyValue: (k) => props[k] ?? "" };
  return new Proxy(cible, {
    set(_t, k, v) {
      if (typeof k === "string" && !k.startsWith("--")) props[k] = String(v);
      return true;
    },
    get(t, k) {
      return k in t ? t[k] : props[k] ?? "";
    },
  });
}
class FauxNoeud {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributs = {};
    this.dataset = {};
    this.className = "";
    this.textContent = "";
    this.style = fauxStyle();
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    this.ecouteurs = {};
  }
  get isConnected() {
    let n = this;
    while (n.parentElement) n = n.parentElement;
    return n === globalThis.document?.body;
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  append(...noeuds) {
    for (const n of noeuds) {
      n.parentElement = this;
      this.children.push(n);
    }
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((x) => x !== this);
    this.parentElement = null;
  }
  setAttribute(k, v) {
    this.attributs[k] = v;
  }
  getAttribute(k) {
    return this.attributs[k] ?? null;
  }
  addEventListener(t, f) {
    (this.ecouteurs[t] ||= []).push(f);
  }
  replaceChildren(...n) {
    for (const x of this.children) x.parentElement = null;
    this.children = [];
    this.append(...n);
  }
  get texte() {
    return this.data ?? [this.textContent, ...this.children.map((c) => c.texte)].join("");
  }
}
globalThis.Node = FauxNoeud;
globalThis.document = {
  createElement: (t) => new FauxNoeud(t),
  createElementNS: (_ns, t) => new FauxNoeud(t),
  createTextNode: (d) => Object.assign(new FauxNoeud("#text"), { data: String(d) }),
  querySelectorAll: () => [],
  body: new FauxNoeud("body"),
  documentElement: { dataset: {} },
};
globalThis.matchMedia = () => ({ matches: false });
/** Les phrases des bandeaux affichés (le texte de leur message). */
const bandeaux = () => document.body.children.flatMap((pile) => pile.children.map((b) => b.children[0]?.texte || ""));
const viderBandeaux = () => document.body.replaceChildren();

const fileEnvoi = await import("../public/app/file-envoi.js");
const G = await import("../public/app/vues/gerer.js");
const { h } = await import("../public/app/ui.js");
const { jourISO } = await import("../public/app/analyse/journee.js");

// --- Une fausse tour : /api/motion/apply retenu à la demande, /api/motion/undo noté ---
const vraiFetch = globalThis.fetch;
const recues = [];
let retenir = false;
let enAttente = []; // les « apply » retenus : (réponse) → void
let numero = 0;
globalThis.fetch = async (url, init = {}) => {
  const chemin = String(url);
  const corps = init.body ? JSON.parse(init.body) : null;
  recues.push({ chemin, corps });
  const repondre = (json) => new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
  if (chemin === "/api/motion/apply") {
    const r = { ok: true, results: [{ ok: true }], echecs: 0, ledgerId: `L-${corps.idCommande}` };
    if (!retenir) return repondre(r);
    return new Promise((ok) => enAttente.push(() => ok(repondre(r))));
  }
  if (chemin === "/api/motion/undo") return repondre({ ok: true, id: corps.id });
  return repondre({ ok: true });
};
test.after(() => {
  globalThis.fetch = vraiFetch;
});
const relacher = () => {
  const a = enAttente;
  enAttente = [];
  a.forEach((f) => f());
};
const pause = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const attendreQue = async (cond, ms = 2000) => {
  const fin = Date.now() + ms;
  while (!cond() && Date.now() < fin) await pause(10);
  return cond();
};

/** Une coche telle que gerer.js la garde, et sa commande dans la file (mettreEnFile). */
function cocheEnFile(id, titre, { envoi = "attente", defaire = false } = {}) {
  const idCommande = `cmd-${id}-${++numero}`;
  const c = { id, titre, ledgerId: null, a: Date.now(), envoi, idCommande, ...(defaire ? { defaire: true } : {}) };
  const etat = JSON.parse(localStorage.getItem("remy-cochees") || "null");
  const liste = etat?.jour === jourISO() ? etat.liste : [];
  localStorage.setItem("remy-cochees", JSON.stringify({ jour: jourISO(), liste: [...liste, c] }));
  fileEnvoi.ajouter({ id: idCommande, resume: `Terminer « ${titre} »`, genre: "terminer", requetes: [{ chemin: "/api/motion/apply", methode: "POST", corps: { actions: [{ type: "terminer", nom: titre, id }], resume: "Coché depuis le site", idCommande } }] });
  return c;
}
const coche = (id) => G.cochees.liste().find((c) => c.id === id) || null;
const annulations = () => recues.filter((r) => r.chemin === "/api/motion/undo").map((r) => r.corps.id);

// L'ordre compte : le suivi de la file (suivreFileCochees) n'est lancé qu'au deuxième test,
// comme une fenêtre rechargée sur Rémy qui revient ensuite sur Aujourd'hui.

test("RÉGRESSION : partie par la file pendant qu'Aujourd'hui n'était pas affiché, « sera rouverte » est tenu", async () => {
  magasin.clear();
  viderBandeaux();
  const c = cocheEnFile("t6", "Trier la boîte mail", { envoi: "tentee", defaire: true });
  // La file part seule (programmer(), retour de la tour) : personne ne suit les coches.
  const bilan = await fileEnvoi.vider({ sansAttendre: true });
  assert.deepEqual(bilan.envoyes, ["Terminer « Trier la boîte mail »"]);
  assert.equal(fileEnvoi.envoye(c.idCommande)?.ledgerId, `L-${c.idCommande}`, "le registre garde ce qui est parti, avec son ledgerId");
  assert.ok(coche("t6"), "la coche attend d'être conclue");
  // Retour sur Aujourd'hui (ou démarrage du site) : le suivi la conclut, et la rouvre.
  G.suivreFileCochees();
  assert.ok(await attendreQue(() => annulations().includes(`L-${c.idCommande}`)), "POST /api/motion/undo avec son ledgerId");
  assert.ok(await attendreQue(() => !coche("t6")), "rouverte : elle quitte « Cochées »");
  assert.ok(bandeaux().some((t) => t === "Annulé : « Trier la boîte mail » est de retour."), bandeaux().join(" | "));
});

test("une coche partie par la file se dit « Envoyé », avec son « Annuler »", async () => {
  viderBandeaux();
  const c = cocheEnFile("t9", "Relancer le comptable");
  await fileEnvoi.vider({ sansAttendre: true });
  assert.ok(await attendreQue(() => coche("t9")?.envoi === "fait"));
  assert.equal(coche("t9").ledgerId, `L-${c.idCommande}`, "son ledgerId relu du registre : Annuler possible depuis sa ligne");
  assert.ok(bandeaux().includes("Envoyé : « Relancer le comptable » est marqué fait."), bandeaux().join(" | "));
  assert.ok(!annulations().includes(`L-${c.idCommande}`));
});

test("RÉGRESSION : « Annuler » pendant que la file envoie la coche : défaite dès son arrivée", async () => {
  viderBandeaux();
  retenir = true;
  const c = cocheEnFile("t7", "Arroser les plantes");
  assert.equal(coche("t7").enCours, false, "dans la file, pas encore partie : « pas encore envoyée · Annuler »");
  const vidange = fileEnvoi.vider({ sansAttendre: true });
  assert.ok(await attendreQue(() => enAttente.length === 1));
  assert.equal(fileEnvoi.enEnvoi(c.idCommande), true);
  assert.equal(coche("t7").enCours, true, "en vol : la ligne tourne");
  G.renoncerCochee("t7");
  assert.ok(coche("t7"), "toujours listée : la retirer perdrait le geste");
  assert.equal(coche("t7").defaire, true);
  assert.ok(bandeaux().includes("« Arroser les plantes » partait déjà : elle sera rouverte dès qu'elle sera arrivée."), bandeaux().join(" | "));
  retenir = false;
  relacher();
  await vidange;
  assert.ok(await attendreQue(() => annulations().includes(`L-${c.idCommande}`)), "défaite dès son arrivée");
  assert.ok(await attendreQue(() => !coche("t7")));
});

test("RÉGRESSION : « Annuler » pendant l'envoi direct (après les 2 s) : défaite dès son arrivée", async () => {
  viderBandeaux();
  retenir = true;
  G.terminer({ type: "tache", id: "t8", titre: "Finaliser la démo de la boutique" }, {});
  assert.equal(coche("t8")?.envoi, "delai");
  await pause(2100);
  assert.ok(await attendreQue(() => enAttente.length === 1), "le POST est parti");
  const enRoute = coche("t8");
  assert.equal(enRoute.envoi, "attente");
  assert.equal(enRoute.enCours, true, "la ligne tourne (spinner), elle n'affiche plus « pas encore envoyée »");
  G.renoncerCochee("t8");
  assert.equal(coche("t8")?.defaire, true);
  retenir = false;
  relacher();
  assert.ok(await attendreQue(() => annulations().includes(`L-${enRoute.idCommande}`)), "POST /api/motion/undo");
  assert.ok(await attendreQue(() => !coche("t8")));
  assert.ok(bandeaux().includes("Annulé : « Finaliser la démo de la boutique » est de retour."), bandeaux().join(" | "));
  assert.ok(!bandeaux().some((t) => /est marqué fait dans Motion/.test(t)), "pas de « marqué fait » trompeur");
});

test("« Annuler » sur une coche dans la file, jamais partie : elle en sort, rien n'est envoyé", async () => {
  const avant = recues.length;
  const c = cocheEnFile("t10", "Ranger le garage");
  G.renoncerCochee("t10");
  assert.equal(coche("t10"), null);
  assert.ok(!fileEnvoi.liste().some((x) => x.id === c.idCommande));
  await fileEnvoi.vider({ sansAttendre: true });
  assert.equal(recues.length, avant, "aucune requête");
});

test("la vidange relit la file : un envoi retiré pendant qu'un autre est en vol ne part plus", async () => {
  magasin.clear();
  retenir = true;
  const a = cocheEnFile("t11", "Premier");
  const b = cocheEnFile("t12", "Second");
  const vidange = fileEnvoi.vider({ sansAttendre: true });
  assert.ok(await attendreQue(() => enAttente.length === 1));
  G.renoncerCochee("t12"); // jamais partie : elle sort de la file
  retenir = false;
  relacher();
  await vidange;
  const envoyees = recues.filter((r) => r.chemin === "/api/motion/apply").map((r) => r.corps.idCommande);
  assert.ok(envoyees.includes(a.idCommande));
  assert.ok(!envoyees.includes(b.idCommande), "le second, retiré, n'est jamais parti");
});

test("une coche ni dans la file ni partie (retirée dans Réglages) revient dans la journée", async () => {
  const c = cocheEnFile("t13", "Payer la facture");
  fileEnvoi.retirer(c.idCommande); // Réglages › Envoi en attente › Retirer
  assert.ok(await attendreQue(() => !coche("t13")));
  assert.ok(!annulations().includes(`L-${c.idCommande}`));
});

test("RÉGRESSION : h() pose les propriétés personnalisées (la couleur de projet des blocs)", () => {
  const bloc = h("div", { style: { top: "10px", "--couleur": "#3D6A8A", "--vide": null } });
  assert.equal(bloc.style.getPropertyValue("--couleur"), "#3D6A8A", "Object.assign l'ignorait : bordure grise pour tous");
  assert.equal(bloc.style.top, "10px");
  assert.equal(bloc.style.getPropertyValue("--vide"), "");
});
