// Données de démonstration dans data/ (ignoré par git) — fictives, pour la CI.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const D = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
fs.mkdirSync(D, { recursive: true });
const w = (f, v) => fs.writeFileSync(`${D}/${f}`, JSON.stringify(v, null, 2));
const now = Date.now();
const H = 3600_000;

w("conversations.json", {
  conversations: [
    {
      id: "c1", title: "Stratégie de lancement — boutiques IA", createdAt: now - 3 * H, updatedAt: now - 20 * 60_000, pinned: true,
      messages: [
        { role: "user", content: "Je veux lancer la démo de la boutique la semaine prochaine. Tu peux caler ça dans Motion ?" },
        { role: "assistant", model: "claude-sonnet-5", tier: "standard", usd: 0.012, content: "Bonne idée de fixer une date — c'est la **troisième fois** que tu en parles sans échéance.\n\n#### Ce que je propose\n- Une tâche *Finaliser la démo* mardi, 2 h, priorité haute\n- Une tâche *Envoyer les invitations* mercredi\n- Un point de contrôle vendredi\n\nLe reste de ta semaine est déjà chargé : je n'ai rien mis avant 10 h.",
          proposal: { source: "motion", resume: "Deux tâches pour tenir la date de la démo.", actions: [
            { type: "creer", nom: "Finaliser la démo de la boutique", echeance: new Date(now + 5 * 24 * H).toISOString(), duree: 120, priorite: "HIGH" },
            { type: "creer", nom: "Envoyer les invitations à la démo", echeance: new Date(now + 6 * 24 * H).toISOString(), duree: 30 },
            { type: "terminer", nom: "Brouillon du pitch" },
          ] } },
        { role: "user", content: "Parfait. Et pour le déjeuner avec Léa, on garde 12h30 ?" },
        { role: "assistant", model: "claude-sonnet-5", tier: "rapide", usd: 0.003, content: "Oui : **12 h 30 chez Paulette**, c'est déjà dans ton agenda. Tu as ensuite la relecture du contrat de Hugo à 14 h — ça laisse 15 minutes de marge." },
      ],
    },
    { id: "c2", title: "23/09/2026 · Nocturne", createdAt: now - 8 * H, updatedAt: now - 7 * H, messages: [{ role: "user", content: "x" }, { role: "assistant", content: "y" }] },
    { id: "c3", title: "Budget tennis 2027", createdAt: now - 30 * H, updatedAt: now - 28 * H, messages: [{ role: "user", content: "x" }] },
    { id: "c4", title: "Idées de nom pour la boîte", createdAt: now - 80 * H, updatedAt: now - 79 * H, messages: [{ role: "user", content: "x" }] },
    { id: "c5", title: "Pitch — version investisseurs", createdAt: now - 130 * H, updatedAt: now - 129 * H, messages: [{ role: "user", content: "x" }] },
    // V8 : une recherche web en attente d'accord (capture « 4c »).
    {
      id: "c6", title: "Piscine de Valmont ce soir", createdAt: now - 150 * H, updatedAt: now - 149 * H,
      messages: [
        { role: "user", content: "La piscine de Valmont est ouverte ce soir ?" },
        { role: "assistant", model: "remy", tier: "autorisation", usd: 0,
          content: "Pour te répondre, il faut chercher sur le web, et la recherche passe par Claude (Anthropic) : seule ta question partirait chez eux — ni la conversation, ni ta mémoire, ni ton planning. Tu autorises ?",
          autorisation: { id: "a-demo", type: "web", statut: "en_attente", contexte: false, requete: "La piscine de Valmont est ouverte ce soir ?" } },
      ],
    },
  ],
});
w("memory.json", { text: "## Identité & contexte\nSam, 31 ans, Lyon. Monte une boutique de bougies.\n\n## Objectifs\n- Lancer la démo avant octobre\n\n## Préférences\n- Réponses courtes\n\n## Personnes\n- Léa, sa compagne\n- Hugo, associé\n\n## Projets en cours\n- Boutique de bougies\n\n## Habitudes & fonctionnement\n- Travaille tard\n\n## Hypothèses\n", updatedAt: now - 2 * H });
w("briefing.json", { text: "Voici ce que j'ai vu cette nuit.\n\n- Tu as parlé trois fois de la démo de la boutique sans fixer de date. Je propose mardi.\n- Le comptable attend ta réponse depuis quatre jours : c'est la tâche la plus ancienne en retard.\n- Léa t'a demandé une réponse pour le week-end du 3 octobre.", generatedAt: now - 7 * H });
w("setup.json", { etats: { tete: "faite", projets: "en_cours" }, convs: {}, couverture: { projets: ["actifs", "fini-a-quoi"] }, updatedAt: now - H });
const costs = [];
for (let i = 0; i < 30; i++) costs.push({ ts: now - i * 7 * H, usd: 0.004 + (i % 5) * 0.011, kind: "conversation", model: "claude-sonnet-5", in: 3000, out: 400, label: "Message" });
w("costs.json", costs);
const act = {};
const fmt = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const motif = [34, 12, 0, 48, 20, 0, 0, 60, 18, 26, 0, 9, 40, 22];
motif.forEach((n, i) => {
  const jour = fmt.format(new Date(now - i * 24 * H));
  const creneaux = Array.from({ length: n }, (_, k) => 100 + k);
  act[jour] = { jour, creneaux, messages: n ? Math.round(n / 4) : 0, premier: null, dernier: null };
});
w("activite.json", act);
w("google.json", { refresh_token: "faux", access_token: "faux", expire_a: now + 30 * 24 * H });
console.log("seed ok");
