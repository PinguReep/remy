// L'identité de Rémy, reprise de public/app/atelier.css : papier chaud, encre,
// une seule couleur de signal ; titres en Source Serif 4, texte en Inter,
// heures en JetBrains Mono. Les polices sont celles de l'app (public/fonts).
import React from "react";
import { continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";

export const C = {
  fond: "#F4EFE6",
  surface: "#FFFCF6",
  fond2: "#EDE5D8",
  fond3: "#E2D8C8",
  encre: "#221E18",
  encre2: "#564E43",
  encre3: "#6F675B",
  filet: "#E2D8C8",
  signal: "#F2541B",
  signalTexte: "#B43C10",
  danger: "#B2361D",
  succes: "#3E7A4C",
  bleu: "#3F6E95",
  ombre: "rgba(92, 70, 48, .10)",
  nuit: "#14120F",
  nuitSurface: "#1F1C18",
  nuitEncre: "#F3ECE1",
  nuitSignal: "#FF6A33",
};
export const SERIF = '"Source Serif 4", Georgia, serif';
export const TEXTE = '"Inter", system-ui, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, monospace';

// ---------- Polices ----------
const POLICES: [string, string, Partial<FontFaceDescriptors>][] = [
  ["Inter", "inter-latin.woff2", { weight: "300 800" }],
  ["Inter", "inter-latin-ext.woff2", { weight: "300 800", unicodeRange: "U+0100-02BA, U+1E00-1E9F, U+2020, U+20A0-20C0, U+2113" }],
  ["JetBrains Mono", "jbmono-latin.woff2", { weight: "400 600" }],
  ["Source Serif 4", "source-serif-4-latin-400.woff2", { weight: "400" }],
  ["Source Serif 4", "source-serif-4-latin-600.woff2", { weight: "600" }],
  ["Source Serif 4", "source-serif-4-latin-400-italic.woff2", { weight: "400", style: "italic" }],
];
let chargees = false;
export function chargerPolices() {
  if (chargees || typeof document === "undefined") return;
  chargees = true;
  const attente = delayRender("Polices de Rémy");
  Promise.all(
    POLICES.map(([famille, fichier, desc]) => {
      const f = new FontFace(famille, `url('${staticFile(`fonts/${fichier}`)}') format('woff2')`, desc);
      return f.load().then(() => (document.fonts as unknown as { add: (x: FontFace) => void }).add(f));
    }),
  ).then(() => continueRender(attente), (e) => { console.error(e); continueRender(attente); });
}

// ---------- Mouvement ----------
/** 0 → 1 en ressort, à partir de l'image `debut` (relative à la séquence). */
export function useRessort(debut: number, config: { damping?: number; stiffness?: number; mass?: number } = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - debut, fps, config: { damping: 18, stiffness: 140, mass: 0.8, ...config } });
}
/** Interpolation bornée, avec une courbe douce par défaut. */
export function entre(frame: number, a: number, b: number, de = 0, vers = 1, easing = Easing.bezier(0.22, 1, 0.36, 1)) {
  if (b <= a) return frame >= a ? vers : de;
  return interpolate(frame, [a, b], [de, vers], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
}
/** Apparition : fondu + petit glissement vertical. */
export function Apparait({ debut, dy = 24, dx = 0, echelle = 1, children, style }: { debut: number; dy?: number; dx?: number; echelle?: number; children: React.ReactNode; style?: React.CSSProperties }) {
  const p = useRessort(debut);
  const s = echelle === 1 ? 1 : interpolate(p, [0, 1], [echelle, 1]);
  return (
    <div style={{ opacity: Math.min(1, p * 1.4), transform: `translate(${(1 - p) * dx}px, ${(1 - p) * dy}px) scale(${s})`, ...style }}>{children}</div>
  );
}
/** Fondu d'entrée et de sortie d'une scène entière. */
export function FonduScene({ duree, children, entree = 8, sortie = 8, fond }: { duree: number; children: React.ReactNode; entree?: number; sortie?: number; fond?: string }) {
  const frame = useCurrentFrame();
  const o = Math.min(entre(frame, 0, entree), 1 - entre(frame, duree - sortie, duree));
  return <div style={{ position: "absolute", inset: 0, opacity: o, background: fond }}>{children}</div>;
}

// ---------- Briques ----------
export const carte: React.CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.filet}`,
  borderRadius: 22,
  boxShadow: `0 1px 2px ${C.ombre}, 0 12px 32px rgba(92, 70, 48, .08)`,
};
export function SurTitre({ children, couleur = C.signalTexte, taille = 20 }: { children: React.ReactNode; couleur?: string; taille?: number }) {
  return <div style={{ font: `500 ${taille}px/1.2 ${MONO}`, letterSpacing: "0.16em", textTransform: "uppercase", color: couleur }}>{children}</div>;
}
export function Titre({ children, taille = 64, couleur = C.encre, style }: { children: React.ReactNode; taille?: number; couleur?: string; style?: React.CSSProperties }) {
  return <div style={{ font: `600 ${taille}px/1.12 ${SERIF}`, color: couleur, letterSpacing: "-0.01em", ...style }}>{children}</div>;
}
/** La pastille de ce qui n'est pas encore livré. */
export function Pastille({ children = "Bientôt", style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 999, border: `2px solid ${C.signal}`, background: "rgba(242, 84, 27, .08)", color: C.signalTexte, font: `600 19px/1 ${MONO}`, letterSpacing: "0.12em", textTransform: "uppercase", whiteSpace: "nowrap", ...style }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: C.signal }} />
      {children}
    </div>
  );
}
export function Puce({ children, couleur = C.encre2, fond = C.fond2, style }: { children: React.ReactNode; couleur?: string; fond?: string; style?: React.CSSProperties }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 999, background: fond, color: couleur, font: `500 20px/1.2 ${TEXTE}`, whiteSpace: "nowrap", ...style }}>{children}</span>;
}
export function Point({ couleur = C.signal, taille = 12 }: { couleur?: string; taille?: number }) {
  return <span style={{ display: "inline-block", width: taille, height: taille, borderRadius: "50%", background: couleur, flex: "none" }} />;
}

/** Le logo : un R d'encre claire et le carré de signal (public/icons). */
export function Logo({ taille = 160, fond = C.nuit, lettre = "#F2EFE9" }: { taille?: number; fond?: string; lettre?: string }) {
  return (
    <div style={{ width: taille, height: taille, borderRadius: taille * 0.22, background: fond, position: "relative", flex: "none", boxShadow: "0 20px 50px rgba(20,18,15,.25)" }}>
      <div style={{ position: "absolute", left: taille * 0.235, top: taille * 0.255, font: `800 ${taille * 0.66}px/0.78 ${TEXTE}`, color: lettre, letterSpacing: "-0.04em" }}>R</div>
      <div style={{ position: "absolute", left: taille * 0.69, top: taille * 0.69, width: taille * 0.14, height: taille * 0.14, background: "#FF5500" }} />
    </div>
  );
}
/** La marque du rail du site : carré de signal, R en serif, mot « RÉMY ». */
export function MarqueSite({ taille = 30 }: { taille?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: taille * 0.4 }}>
      <div style={{ width: taille, height: taille, borderRadius: taille * 0.3, background: C.signal, color: "#fff", display: "grid", placeItems: "center", font: `700 ${taille * 0.58}px/1 ${SERIF}` }}>R</div>
      <div style={{ font: `800 ${taille * 0.62}px/1 ${TEXTE}`, letterSpacing: "-0.04em", color: C.encre }}>RÉMY</div>
    </div>
  );
}

// ---------- Icônes (traits simples, dessinées ici) ----------
const TRACES: Record<string, string> = {
  soleil: "M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  bulle: "M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  dossier: "M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17z",
  liste: "M5 6h14M5 12h14M5 18h9",
  reglages: "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4",
  horloge: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4.5l3 2",
  coche: "M5 12.5l4.5 4.5L19 7.5",
  cloche: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0",
  telephone: "M6.5 4h3l1.5 4-2 1.5a10 10 0 0 0 5.5 5.5l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A15.5 15.5 0 0 1 5 5.6 1.5 1.5 0 0 1 6.5 4z",
  lieu: "M12 21s-6.5-6-6.5-11a6.5 6.5 0 1 1 13 0c0 5-6.5 11-6.5 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  cadenas: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z",
  agent: "M7 8h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM12 4v4M9.5 13h.01M14.5 13h.01",
  eclair: "M13 3L5 13.5h6L10 21l8-10.5h-6z",
  fleche: "M5 12h14M13 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  boite: "M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 13h4.5l1 2h5l1-2H20",
  mouvement: "M4 17l5-5 4 4 7-8",
  ordi: "M4 5h16v11H4zM2 19h20",
  tour: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM10 7h4M10 10h4M12 16.5h.01",
  iphone: "M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2",
};
export function Icone({ nom, taille = 28, couleur = "currentColor", epaisseur = 1.8 }: { nom: keyof typeof TRACES | string; taille?: number; couleur?: string; epaisseur?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" style={{ flex: "none" }} fill="none" stroke={couleur} strokeWidth={epaisseur} strokeLinecap="round" strokeLinejoin="round">
      <path d={TRACES[nom] || ""} />
    </svg>
  );
}
