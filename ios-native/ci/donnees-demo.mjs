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
    // Le cas de Sam (18/10) : une proposition à ajuster avant de dire oui (captures « 5e » à « 5g »).
    {
      id: "c10", title: "Abonnement de Tom", createdAt: now - 6 * 60_000, updatedAt: now - 5 * 60_000,
      messages: [
        { role: "user", content: "Faut que je pense à acheter l'abonnement Claude Code pour Tom." },
        { role: "assistant", model: "glm-5.3", tier: "local", usd: 0, content: "Je te l'ajoute dans Motion : c'est rapide, dix minutes suffisent.",
          // La jauge du chat (19/10) : ce que la tour a mesuré sur cette réponse.
          mesures: { jetons: 212, tps: 44.8, decodeMs: 4730, premierMs: 1700, contexte: 28_900, fenetre: 131_072, fenetreSource: "modele",
            repartition: { systeme: 26_400, conversation: 1_900, outils: 388, reponse: 212 } },
          proposal: { id: "p-tom", source: "motion", statut: "en_attente", resume: "Échéance proposée : jeudi soir.", actions: [
            { type: "creer", nom: "Acheter abonnement Claude Code pour Tom", duree: 10, echeance: new Date(now + 3 * 24 * H).toISOString().slice(0, 10) + "T21:00:00.000Z" },
          ] } },
      ],
    },
    { id: "c2", title: "Cette nuit · ce que j'ai remarqué", createdAt: now - 8 * H, updatedAt: now - 7 * H, messages: [{ role: "user", content: "x" }, { role: "assistant", content: "y" }] },
    // Un long fil (mesure de la frappe dans le vrai écran) : 30 échanges.
    { id: "c9", title: "Préparer la levée de fonds", createdAt: now - 330 * H, updatedAt: now - 329 * H,
      messages: Array.from({ length: 30 }, (_, i) => [
        { role: "user", content: `Question ${i + 1} : comment je présente la traction de la démo aux investisseurs, sans exagérer ?` },
        { role: "assistant", content: `#### Point ${i + 1}\n- Montre les **chiffres réels** : rendez-vous pris par la boutique, appels traités, taux de réponse.\n- Raconte un cas client précis, avec la date et le résultat.\n- Termine par ce que tu feras des fonds, en trois lignes.\n\nJe peux préparer la diapositive si tu veux : dis-moi les trois chiffres que tu as.` },
      ]).flat() },
    // Pour le test d'intégration (ajuster, ranger en rappel, puis « Oui ») : un vieux fil.
    {
      id: "c11", title: "Vidange de la Twingo", createdAt: now - 700 * H, updatedAt: now - 700 * H,
      messages: [
        { role: "user", content: "Il faut que je fasse la vidange de la Twingo." },
        { role: "assistant", model: "glm-5.3", tier: "local", usd: 0, content: "Je te propose deux tâches.",
          proposal: { id: "p-vidange", source: "motion", statut: "en_attente", resume: "La vidange en deux temps.", actions: [
            { type: "creer", nom: "Prendre rendez-vous pour la vidange", duree: 10 },
            { type: "creer", nom: "Acheter du liquide de refroidissement", duree: 20 },
          ] } },
      ],
    },
    // Une partie seulement d'une proposition (24/10) : une case par ligne — capture « 5e2 ».
    {
      id: "c13", title: "Salon des créateurs", createdAt: now - 30 * H, updatedAt: now - 30 * H,
      messages: [
        { role: "user", content: "Pour le salon des créateurs samedi, il faut que je m'organise." },
        { role: "assistant", model: "glm-5.3", tier: "local", usd: 0, content: "Je te propose trois tâches pour être prêt samedi.",
          proposal: { id: "p-salon", source: "motion", statut: "en_attente", resume: "Trois tâches avant samedi.", actions: [
            { type: "creer", nom: "Imprimer les étiquettes de prix", duree: 30 },
            { type: "creer", nom: "Appeler Léa pour le stand", duree: 10 },
            { type: "creer", nom: "Préparer la caisse de bougies", duree: 45 },
          ] } },
      ],
    },
    // Pour le test d'intégration (une partie seulement, puis « Annuler ») : un vieux fil.
    {
      id: "c14", title: "Rangement de l'atelier", createdAt: now - 720 * H, updatedAt: now - 720 * H,
      messages: [
        { role: "user", content: "Il faut ranger l'atelier ce week-end." },
        { role: "assistant", model: "glm-5.3", tier: "local", usd: 0, content: "Deux tâches pour l'atelier.",
          proposal: { id: "p-atelier", source: "motion", statut: "en_attente", resume: "L'atelier en deux temps.", actions: [
            { type: "creer", nom: "Trier les chutes de cire", duree: 20 },
            { type: "creer", nom: "Commander des bocaux", duree: 10 },
          ] } },
      ],
    },
    // Un tableau dans une réponse (19/10 : il s'affichait en lignes de « | ») — capture « 5k ».
    {
      id: "c12", title: "Comparatif des offres", createdAt: now - 900 * H, updatedAt: now - 900 * H,
      messages: [
        { role: "user", content: "Tu peux me comparer les trois formules de la boutique ?" },
        { role: "assistant", model: "glm-5.3", tier: "local", usd: 0, content: "Voici le comparatif :\n\n| Formule | Prix / mois | Rendez-vous | Délai |\n|:--|--:|:--:|:--|\n| Essentiel | 49 € | — | 1 semaine |\n| **Boutique** | 89 € | ✓ | 2 semaines |\n| Boutique + relances SMS | 129 € | ✓ | 3 semaines, selon le volume de contacts |\n\n---\nLa formule **Boutique** couvre l'essentiel ; les relances SMS se justifient au-delà de 200 clients." },
      ],
    },
    { id: "c8", title: "23/09/2026 · Nocturne", createdAt: now - 600 * H, updatedAt: now - 599 * H, messages: [{ role: "user", content: "x" }, { role: "assistant", content: "y" }] },
    { id: "c7", title: "Idées de cadeaux pour Léa", createdAt: now - 300 * H, updatedAt: now - 299 * H, messages: [{ role: "user", content: "x" }, { role: "assistant", content: "y" }] },
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
    // 24/10 : des courses et un rappel proposés par Rémy (test d'intégration du carnet).
    {
      id: "c-carnet", title: "Courses de la semaine", createdAt: now - 160 * H, updatedAt: now - 159 * H,
      messages: [
        { role: "user", content: "Ajoute des bougies chauffe-plat, et rappelle-moi d'appeler Léa." },
        { role: "assistant", model: "glm-5.3", tier: "local", usd: 0, content: "Je te propose ça : les bougies dans tes courses, et un rappel.",
          proposal: { id: "p-carnet-demo", source: "carnet", statut: "en_attente", resume: "", actions: [
            { type: "liste", liste: "Courses", articles: ["Bougies chauffe-plat"] },
            { type: "rappel", texte: "Appeler Léa pour le marché de Noël" },
          ] } },
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
// J1.5 : le carnet (listes, rappels, tâche bloquée) vit dans remy.db.
process.env.REMY_DATA_DIR ||= D;
const carnet = await import("../../lib/carnet.js");
const listes = [
  ["l-courses", "Courses", ["Tomates", "Lait d'avoine", "Œufs", "Pain complet", ["Café", true], ["Lessive", true]]],
  ["l-anniv", "Anniversaires", ["Léa — 14 mars", "Hugo — 2 juin", "Maman — 27 novembre"]],
  ["l-porto", "Valise Porto", ["Adaptateur", "Crème solaire", "Carnet de croquis pour dessiner les azulejos du quartier de l'Alfama", "Chargeur"]],
  ["l-idees", "Idées", ["Nom de la boîte : Accueil & Cie ?", "Démo vocale en anglais"]],
];
listes.forEach(([id, nom, elements], ordre) => {
  carnet.ecrireListe(id, { nom, ordre });
  carnet.ecrireElements(id, elements.map((e, i) => {
    const [texte, fait] = Array.isArray(e) ? e : [e, false];
    return { id: `${id}-${i}`, texte, fait, ordre: i };
  }));
});
const M = 60_000;
// P2 : les catégories proposées par défaut, comme après l'étape 1 du mini-onboarding.
const etiquettes = [["et-perso", "Personnel"], ["et-pro", "Professionnel"], ["et-sante", "Santé"], ["et-voiture", "Voiture"],
  ["et-admin", "Administratif"], ["et-proches", "Famille et amis"], ["et-anniv", "Anniversaire"]];
etiquettes.forEach(([id, nom], ordre) => carnet.ecrireEtiquette(id, { nom, ordre }));
carnet.ecrireRappels([
  { id: "r1", texte: "Appeler le garage pour le contrôle technique", quand: now + 2 * H },
  { id: "r2", texte: "Rappeler Hugo", quand: now + 20 * H, etiquettes: ["et-pro"] },
  { id: "r3", texte: "Renouveler le passeport", quand: now + 3 * 24 * H, etiquettes: ["et-admin"] },
  { id: "r4", texte: "Payer le loyer", quand: now - 50 * M },
  { id: "r5", texte: "Rendre le livre à Léa" },
  { id: "r6", texte: "Réserver le tennis", quand: now - 26 * H, fait: true },
]);
carnet.marquerTache("t3", { bloquee: true, raison: "J'attends le bon de commande d'Ondine" });
// Catégories des tâches (18/10) : gardées par Remy, Motion n'en sait rien.
carnet.categoriserTache("t1", ["et-pro"]);
carnet.categoriserTache("t4", ["et-admin"]);
carnet.categoriserTache("t5", ["et-perso"]);
// P3 : des sous-projets dans Remy (Motion n'a pas de hiérarchie), sous un
// projet Motion ou à part, avec des idées et une tâche rangée.
carnet.ecrireDossier("d-demo", { nom: "Démo client", parent: "motion:p1", ordre: 0 });
carnet.ecrireDossier("d-site", { nom: "Site vitrine", parent: "motion:p1", ordre: 1 });
carnet.ecrireDossier("d-maison", { nom: "Maison", parent: null, ordre: 0 });
carnet.ecrireDossier("d-cuisine", { nom: "Travaux cuisine", parent: "d-maison", ordre: 0 });
carnet.ecrireNotes("d-site", [
  { id: "n1", texte: "Maquette de la page d'accueil" },
  { id: "n2", texte: "Trois témoignages de clients pilotes" },
  { id: "n3", texte: "Demander le logo à Hugo", fait: true },
]);
carnet.ecrireNotes("d-cuisine", [{ id: "n4", texte: "Devis plombier" }]);
carnet.rattacher("t1", "d-demo");
// 24/10 : de quoi trancher (un rappel redit, un vieux rappel sans date, des
// idées) et une semaine à revoir (trois coches, deux hypothèses de la nuit).
// Le rappel redit, laissé par une tour d'avant l'anti-doublon du carnet (qui
// le fondrait aujourd'hui dans r2) : posé directement en base.
const { db } = await import("../../lib/db.js");
db().prepare("INSERT INTO rappels (id, texte, quand, fait, source, supprime, cree_a, maj_a) VALUES ('r7', 'Rappeler Hugo', NULL, 0, 'remy', 0, ?, ?)").run(now, now);
db().prepare("UPDATE rappels SET cree_a = ? WHERE id IN ('r5', 'r7')").run(now - 10 * 24 * H);
carnet.ecrireDossier("idees", { nom: "Idées", parent: null, ordre: -2 });
carnet.ecrireNotes("idees", [
  { id: "n-idee-1", texte: "Un atelier bougies parfumées pour les fêtes" },
  { id: "n-idee-2", texte: "Proposer la démo vocale aux salons de coiffure" },
]);
const coche = db().prepare("INSERT INTO journal (id, ts, source, origine, resume, etat, actions, results, annulations, annule, maj_a) VALUES (?, ?, 'motion', 'tap', 'Coché depuis l''app', 'appliquee', '[]', ?, '{}', 0, ?)");
[["j-demo-1", 2, "Écrire la fiche produit", "Boutiques", 45], ["j-demo-2", 3, "Photos des bougies", "Boutiques", 30], ["j-demo-3", 4, "Arroser les plantes", null, 10]]
  .forEach(([id, jours, nom, projet, duree]) => coche.run(id, now - jours * 24 * H, JSON.stringify([{ ok: true, type: "terminer", nom, projet, avant: { duration: duree } }]), now - jours * 24 * H));
w("briefings.json", [{ text: "- Tu avances mieux sur la boutique le matin que le soir (70 %)\n- Les tâches du vendredi glissent souvent au lundi (60 %)\n- Question douce : la démo avant le site ?", generatedAt: now - 2 * 24 * H }]);
// 24/10 : les priorités déclarées de Sam (fictives), la première il y a 3 semaines.
const priorites = await import("../../lib/priorites.js");
priorites.enregistrerPriorites([
  { id: "p-musique", titre: "La musique", pourquoi: "Jouer me rend calme toute la semaine", mots: ["musique", "guitare", "répétition"] },
  { id: "p-boutique", titre: "Lancer la boutique de bougies", pourquoi: "C'est mon revenu de l'an prochain", mots: ["boutique", "bougies", "démo"] },
  { id: "p-proches", titre: "Voir Léa et Hugo", pourquoi: "Je les vois trop peu depuis la rentrée", mots: ["Léa", "Hugo"] },
], { base: 0, maintenant: now - 21 * 24 * H });
console.log("seed ok");
