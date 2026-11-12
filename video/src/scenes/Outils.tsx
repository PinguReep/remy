// 3. Il se branche à tes outils : T3 Code, Claude Code, les exports ChatGPT et
// Claude, Motion. Lecture seule pour les conversations ; Motion : il propose,
// tu valides.
import React from "react";
import { useCurrentFrame } from "remotion";
import type { SceneProps } from "../Presentation";
import { C, MONO, TEXTE, carte, entre, FonduScene, Icone, Logo, useRessort } from "../ui";

type Source = { cle: string; nom: string; genre: string; icone: string; x: number; y: number; exemple: React.ReactNode };
const SOURCES: Source[] = [
  { cle: "t3", nom: "T3 Code", genre: "tes fils d'agents", icone: "agent", x: 110, y: 96, exemple: <><b>boutique-démo</b> — « Le panier est prêt, je lance les tests ? »</> },
  { cle: "claude", nom: "Claude Code", genre: "tes sessions", icone: "bulle", x: 110, y: 468, exemple: <><b>site-vitrine</b> — formulaire de contact, deux options</> },
  { cle: "chatgpt", nom: "ChatGPT · Claude", genre: "par export", icone: "boite", x: 1310, y: 96, exemple: <>Export importé — « Idées de programme à Porto »</> },
  { cle: "motion", nom: "Motion", genre: "tes tâches", icone: "mouvement", x: 1310, y: 468, exemple: <>Finaliser la démo — mardi, 2 h, priorité haute</> },
];
const L = 500;
const H = 250;
const CENTRE = { x: 960, y: 330 };

export const Outils: React.FC<SceneProps> = ({ s }) => {
  const frame = useCurrentFrame();
  const r = s.reperes;
  const hub = useRessort(r.hub, { damping: 14 });
  const prop = useRessort(r.proposition);
  const valide = entre(frame, r.valide, r.valide + 8);

  return (
    <FonduScene duree={s.duree}>
      {/* Les liens, tracés à l'arrivée de chaque source */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {SOURCES.map((src) => {
          const t = entre(frame, r[src.cle], r[src.cle] + 18);
          const x1 = src.x < 960 ? src.x + L : src.x;
          const y1 = src.y + (src.y > 300 ? 70 : H / 2);
          const longueur = Math.hypot(CENTRE.x - x1, CENTRE.y - y1);
          const d = `M ${x1} ${y1} C ${(x1 + CENTRE.x) / 2} ${y1}, ${(x1 + CENTRE.x) / 2} ${CENTRE.y}, ${CENTRE.x} ${CENTRE.y}`;
          // un point qui voyage vers Rémy, en boucle, une fois branché
          const cycle = ((frame - r[src.cle] - 18) % 36) / 36;
          const voyage = frame > r[src.cle] + 18;
          const bx = (u: number) => (1 - u) ** 3 * x1 + 3 * (1 - u) ** 2 * u * ((x1 + CENTRE.x) / 2) + 3 * (1 - u) * u ** 2 * ((x1 + CENTRE.x) / 2) + u ** 3 * CENTRE.x;
          const by = (u: number) => (1 - u) ** 3 * y1 + 3 * (1 - u) ** 2 * u * y1 + 3 * (1 - u) * u ** 2 * CENTRE.y + u ** 3 * CENTRE.y;
          return (
            <g key={src.cle}>
              <path d={d} fill="none" stroke={C.fond3} strokeWidth={4} strokeDasharray={longueur * 1.3} strokeDashoffset={longueur * 1.3 * (1 - t)} strokeLinecap="round" />
              {voyage ? <circle cx={bx(cycle)} cy={by(cycle)} r={7} fill={C.signal} opacity={Math.sin(cycle * Math.PI)} /> : null}
            </g>
          );
        })}
      </svg>
      {/* Rémy au centre */}
      <div style={{ position: "absolute", left: CENTRE.x - 90, top: CENTRE.y - 90, transform: `scale(${hub})` }}><Logo taille={180} /></div>
      <div style={{ position: "absolute", left: 610, width: 700, top: CENTRE.y + 108, display: "flex", justifyContent: "center", opacity: hub }}>
        <div style={{ font: `500 20px/1.3 ${MONO}`, letterSpacing: "0.14em", color: C.encre2, background: C.fond, padding: "8px 16px", borderRadius: 10 }}>CONVERSATIONS : LECTURE SEULE, CHIFFRÉES</div>
      </div>
      {/* Les sources */}
      {SOURCES.map((src) => (
        <SourceCarte key={src.cle} src={src} debut={r[src.cle] - 6} />
      ))}
      {/* Une proposition pour Motion : il propose, tu valides */}
      <div style={{ position: "absolute", left: 650, top: 548, width: 620, ...carte, padding: "26px 30px", opacity: prop, transform: `translateY(${(1 - prop) * 30}px)`, borderColor: valide > 0 ? "rgba(62,122,76,.5)" : C.filet }}>
        <div style={{ font: `500 18px/1 ${MONO}`, letterSpacing: "0.14em", color: C.signalTexte }}>PROPOSITION · MOTION</div>
        <div style={{ font: `500 27px/1.35 ${TEXTE}`, marginTop: 12 }}>Ajouter « Envoyer les invitations à la démo », mercredi, 30 min.</div>
        <div style={{ display: "flex", gap: 14, marginTop: 20 }}>
          {valide > 0 ? (
            <div style={{ height: 56, padding: "0 24px", borderRadius: 14, background: C.succes, color: "#fff", display: "flex", alignItems: "center", gap: 10, font: `600 23px/1 ${TEXTE}`, transform: `scale(${0.94 + valide * 0.06})` }}><Icone nom="coche" taille={24} couleur="#fff" />Ajouté dans Motion</div>
          ) : (
            <>
              <div style={{ height: 56, padding: "0 30px", borderRadius: 14, background: C.encre, color: C.fond, display: "flex", alignItems: "center", font: `600 23px/1 ${TEXTE}`, transform: `scale(${1 - entre(frame, r.valide - 6, r.valide) * 0.06})` }}>Oui</div>
              <div style={{ height: 56, padding: "0 26px", borderRadius: 14, border: `1px solid ${C.filet}`, display: "flex", alignItems: "center", font: `600 23px/1 ${TEXTE}` }}>Ajuster</div>
            </>
          )}
          <div style={{ marginLeft: "auto", alignSelf: "center", font: `400 20px/1 ${TEXTE}`, color: C.encre3 }}>rien sans ton accord</div>
        </div>
      </div>
    </FonduScene>
  );
};

function SourceCarte({ src, debut }: { src: Source; debut: number }) {
  const p = useRessort(debut);
  return (
    <div style={{ position: "absolute", left: src.x, top: src.y, width: L, height: H, ...carte, padding: "26px 28px", display: "flex", flexDirection: "column", gap: 14, opacity: Math.min(1, p * 1.4), transform: `translateX(${(1 - p) * (src.x < 960 ? -40 : 40)}px)` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 58, height: 58, borderRadius: 16, background: C.fond2, display: "grid", placeItems: "center" }}><Icone nom={src.icone} taille={32} couleur={C.encre} /></div>
        <div>
          <div style={{ font: `600 32px/1.1 ${TEXTE}`, letterSpacing: "-0.01em" }}>{src.nom}</div>
          <div style={{ font: `400 21px/1.3 ${TEXTE}`, color: C.encre3 }}>{src.genre}</div>
        </div>
      </div>
      <div style={{ font: `400 22px/1.4 ${TEXTE}`, color: C.encre2, background: C.fond, borderRadius: 14, padding: "12px 16px" }}>{src.exemple}</div>
    </div>
  );
}
