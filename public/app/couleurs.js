// Une couleur par projet, la même que sur l'iPhone (`Palette.projet`,
// Design.swift) : hachage FNV-1a sur le nom en minuscules (UTF-8), puis le
// même brassage final. L'urgence se dit par une forme, jamais par ces couleurs.

const TEINTES = [
  ["#3D6A8A", "#82AACB"], ["#7B4E90", "#BA94CF"], ["#C0603D", "#E89878"],
  ["#4F855A", "#8EC399"], ["#A67A28", "#DDB466"], ["#5B7882", "#9AB5BC"],
];

/** L'index de teinte (0 à 5) d'un nom de projet, ou -1 sans nom. */
export function indexProjet(nom) {
  if (!nom) return -1;
  let h = 2166136261;
  for (const o of new TextEncoder().encode(String(nom).toLowerCase())) h = Math.imul(h ^ o, 16777619) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h % TEINTES.length;
}

const sombre = () => {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return matchMedia("(prefers-color-scheme: dark)").matches;
};

/** La couleur CSS d'un projet (thème courant) ; l'encre 3 sans projet. */
export function couleurProjet(nom) {
  const i = indexProjet(nom);
  if (i < 0) return "var(--encre-3)";
  return TEINTES[i][sombre() ? 1 : 0];
}
