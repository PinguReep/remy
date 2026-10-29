// Les questions des mesures de la recherche web (29/10) : françaises,
// réalistes, sans rien de personnel — règles et montants officiels, horaires,
// prix, actualité, météo, produit. `references` : les sites qu'on attend en
// tête (sources officielles, ou le site de référence du sujet). `banc` : les 9
// que scripts/banc-recherche.mjs joue contre le vrai modèle, sur la tour.
// `attendu` : ce qu'une bonne réponse doit contenir (un montant de la bonne
// forme, une plage d'horaires, une date complète…), pour repérer les passages
// qui répondent — pas un corrigé. Resserré le 29/10 (contre-relecture) : plus
// aucun mot de la question (« conditions ») ni année seule ne suffit.
// `avant` : les messages qui précèdent — une SUITE de conversation, dont le
// sujet est plus haut ; jouée par le banc seulement (pas par les mesures).

export const QUESTIONS = [
  {
    id: "acre",
    type: "règle",
    question: "Quelles sont les conditions pour bénéficier de l'ACRE en 2026 ?",
    references: /(^|\.)(urssaf\.fr|service-public\.(gouv\.)?fr|economie\.gouv\.fr|bpifrance-creation\.fr|legifrance\.gouv\.fr)$/,
    // Une condition (pas « conditions », mot de la question) : les publics éligibles.
    attendu: /demandeurs? d.emploi|moins de 26 ans|18 (?:à|-) ?2[56] ans|\bRSA\b|\bASS\b/i,
    banc: true,
  },
  {
    id: "seuil-micro",
    type: "montant",
    question: "Quel est le seuil de chiffre d'affaires de la micro-entreprise pour les prestations de services en 2026 ?",
    references: /(^|\.)(urssaf\.fr|service-public\.(gouv\.)?fr|economie\.gouv\.fr|impots\.gouv\.fr)$/,
    attendu: /\b[78]\d[\s  .]?\d{3}\s?(€|euros)/i,
    banc: true,
  },
  {
    id: "smic",
    type: "montant",
    question: "Quel est le montant du SMIC horaire brut en 2026 ?",
    references: /(^|\.)(service-public\.(gouv\.)?fr|travail-emploi\.gouv\.fr|insee\.fr|economie\.gouv\.fr|urssaf\.fr|legifrance\.gouv\.fr)$/,
    attendu: /\b1[1-3][,.]\d{2}\s?(€|euros)/i, // l'horaire, pas le mensuel ni Mayotte
    banc: true,
  },
  {
    id: "pass",
    type: "montant",
    question: "Quel est le plafond annuel de la sécurité sociale en 2026 ?",
    references: /(^|\.)(urssaf\.fr|service-public\.(gouv\.)?fr|securite-sociale\.fr|legifrance\.gouv\.fr|economie\.gouv\.fr)$/,
    attendu: /\b4[6-9][\s  .]?\d{3}\s?(€|euros)/i,
  },
  {
    id: "taux-bnc",
    type: "taux",
    question: "Quel est le taux de cotisations sociales d'un micro-entrepreneur en prestations de services BNC ?",
    references: /(^|\.)(urssaf\.fr|service-public\.(gouv\.)?fr|economie\.gouv\.fr)$/,
    attendu: /\b2\d[,.]\d\s?%/i,
  },
  {
    id: "declaration",
    type: "date",
    question: "Quelle est la date limite de la déclaration de revenus en ligne en 2026 ?",
    references: /(^|\.)(impots\.gouv\.fr|service-public\.(gouv\.)?fr|economie\.gouv\.fr)$/,
    attendu: /\b\d{1,2}(er)?\s+(mai|juin)\b/i,
    banc: true,
  },
  {
    id: "mairie",
    type: "horaires",
    question: "Quels sont les horaires d'ouverture de la mairie de Nantes ?",
    references: /(^|\.)(nantes\.fr|metropole\.nantes\.fr|service-public\.(gouv\.)?fr)$/,
    attendu: /\d{1,2}\s?h\s?\d{2}.{0,15}?\d{1,2}\s?h\s?\d{0,2}/i, // une plage, pas une heure isolée
    banc: true,
  },
  {
    id: "gazole",
    type: "prix",
    question: "Quel est le prix moyen du litre de gazole en France cette semaine ?",
    references: /(^|\.)(prix-carburants\.gouv\.fr|ecologie\.gouv\.fr|economie\.gouv\.fr|insee\.fr)$/,
    attendu: /\b[12][,.]\d{2,3}\s?(€|euros)/i,
  },
  {
    id: "iphone",
    type: "produit",
    question: "Quel est le prix de l'iPhone 17 Pro en France ?",
    references: /(^|\.)(apple\.com)$/,
    attendu: /\b1[\s  .]?\d{3}(?:[,.]\d{2})?\s?(€|euros)/i,
    banc: true,
  },
  {
    id: "meteo",
    type: "météo",
    question: "Quelle météo est prévue à Lyon demain ?",
    references: /(^|\.)(meteofrance\.com|meteo-france\.fr)$/,
    attendu: /\d{1,2}\s?°/i,
    banc: true,
  },
  {
    id: "retraites",
    type: "actualité",
    question: "Quelles sont les dernières actualités sur la réforme des retraites ?",
    references: /(^|\.)(vie-publique\.fr|service-public\.(gouv\.)?fr|info\.gouv\.fr|gouvernement\.fr|franceinfo\.fr|lemonde\.fr|publicsenat\.fr|lefigaro\.fr|liberation\.fr|ouest-france\.fr)$/,
    // Une date complète (une année seule est sur toutes les pages).
    attendu: /\b\d{1,2}(er)?\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+20\d{2}\b/i,
    banc: true,
  },
  {
    id: "navigo",
    type: "prix",
    question: "Combien coûte le passe Navigo mensuel en 2026 ?",
    references: /(^|\.)(iledefrance-mobilites\.fr|ratp\.fr|service-public\.(gouv\.)?fr)$/,
    attendu: /\b\d{2}[,.]\d{2}\s?(€|euros)/i,
  },
  {
    // Une suite : la question seule n'a pas son sujet (la micro-entreprise).
    // La recherche directe ne part pas (raison « suite ») : le modèle écrit la
    // question complète — c'est ce que le banc mesure ici.
    id: "suite-vente",
    type: "suite",
    avant: [
      { role: "user", content: "Quel est le seuil de chiffre d'affaires de la micro-entreprise pour les prestations de services en 2026 ?" },
      { role: "assistant", content: "Pour les prestations de services, le seuil de la micro-entreprise est de 77 700 € de chiffre d'affaires annuel (source : Urssaf)." },
    ],
    question: "Et pour la vente de marchandises, c'est combien ?",
    references: /(^|\.)(urssaf\.fr|service-public\.(gouv\.)?fr|economie\.gouv\.fr|impots\.gouv\.fr)$/,
    attendu: /\b1[89]\d[\s  .]?\d{3}\s?(€|euros)/i,
    banc: true,
  },
];

export const hoteDe = (u) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
