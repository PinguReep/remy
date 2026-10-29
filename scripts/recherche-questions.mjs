// Les questions des mesures de la recherche web (29/10) : françaises,
// réalistes, sans rien de personnel — règles et montants officiels, horaires,
// prix, actualité, météo, produit. `references` : les sites qu'on attend en
// tête (sources officielles, ou le site de référence du sujet). `banc` : les 8
// que scripts/banc-recherche.mjs joue contre le vrai modèle, sur la tour.
// `attendu` : ce qu'une bonne réponse doit contenir (un chiffre, une heure…),
// pour repérer les passages qui répondent — pas un corrigé.

export const QUESTIONS = [
  {
    id: "acre",
    type: "règle",
    question: "Quelles sont les conditions pour bénéficier de l'ACRE en 2026 ?",
    references: /(^|\.)(urssaf\.fr|service-public\.(gouv\.)?fr|economie\.gouv\.fr|bpifrance-creation\.fr|legifrance\.gouv\.fr)$/,
    attendu: /exon[ée]r|50 ?%|25 ?%|conditions?/i,
    banc: true,
  },
  {
    id: "seuil-micro",
    type: "montant",
    question: "Quel est le seuil de chiffre d'affaires de la micro-entreprise pour les prestations de services en 2026 ?",
    references: /(^|\.)(urssaf\.fr|service-public\.(gouv\.)?fr|economie\.gouv\.fr|impots\.gouv\.fr)$/,
    attendu: /\d{2}[\s  .]?\d{3}\s?(€|euros)/i,
    banc: true,
  },
  {
    id: "smic",
    type: "montant",
    question: "Quel est le montant du SMIC horaire brut en 2026 ?",
    references: /(^|\.)(service-public\.(gouv\.)?fr|travail-emploi\.gouv\.fr|insee\.fr|economie\.gouv\.fr|urssaf\.fr|legifrance\.gouv\.fr)$/,
    attendu: /1\d[,.]\d{2}\s?(€|euros)/i,
    banc: true,
  },
  {
    id: "pass",
    type: "montant",
    question: "Quel est le plafond annuel de la sécurité sociale en 2026 ?",
    references: /(^|\.)(urssaf\.fr|service-public\.(gouv\.)?fr|securite-sociale\.fr|legifrance\.gouv\.fr|economie\.gouv\.fr)$/,
    attendu: /4\d[\s  .]?\d{3}\s?(€|euros)/i,
  },
  {
    id: "taux-bnc",
    type: "taux",
    question: "Quel est le taux de cotisations sociales d'un micro-entrepreneur en prestations de services BNC ?",
    references: /(^|\.)(urssaf\.fr|service-public\.(gouv\.)?fr|economie\.gouv\.fr)$/,
    attendu: /\d{1,2}[,.]\d\s?%/i,
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
    attendu: /\b\d{1,2}\s?h\s?\d{0,2}\b/i,
    banc: true,
  },
  {
    id: "gazole",
    type: "prix",
    question: "Quel est le prix moyen du litre de gazole en France cette semaine ?",
    references: /(^|\.)(prix-carburants\.gouv\.fr|ecologie\.gouv\.fr|economie\.gouv\.fr|insee\.fr)$/,
    attendu: /1[,.]\d{2,3}\s?(€|euros)/i,
  },
  {
    id: "iphone",
    type: "produit",
    question: "Quel est le prix de l'iPhone 17 Pro en France ?",
    references: /(^|\.)(apple\.com)$/,
    attendu: /\d[\s  .]?\d{3}\s?(€|euros)/i,
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
    attendu: /\b(20\d{2}|\d{1,2}\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre))\b/i,
    banc: true,
  },
  {
    id: "navigo",
    type: "prix",
    question: "Combien coûte le passe Navigo mensuel en 2026 ?",
    references: /(^|\.)(iledefrance-mobilites\.fr|ratp\.fr|service-public\.(gouv\.)?fr)$/,
    attendu: /\d{2}[,.]\d{2}\s?(€|euros)|\d{2}\s?(€|euros)/i,
  },
];

export const hoteDe = (u) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
