// 8. Il te rend du temps : moins de tri, plus de travail qui compte.
// Qualitatif, sans aucun chiffre de temps gagné.
import React from "react";
import { useCurrentFrame } from "remotion";
import type { SceneProps } from "../Presentation";
import { C, SERIF, TEXTE, carte, entre, FonduScene, Icone, Point, useRessort } from "../ui";

const A_TRIER = ["6 nouveaux messages", "boutique-démo attend", "2 tâches en retard", "Onglet : Billets Porto", "Rappel : payer le loyer", "site-vitrine attend", "Onglet : Budget 2027"];

export const Temps: React.FC<SceneProps> = ({ s }) => {
  const frame = useCurrentFrame();
  const r = s.reperes;
  const titre1 = useRessort(r.tri);
  const titre2 = useRessort(r.focus);
  const focus = useRessort(r.focus - 4, { damping: 16 });
  const progres = entre(frame, r.focus, s.duree - 4, 0.15, 0.82);

  return (
    <FonduScene duree={s.duree}>
      {/* Ce qui part du tri */}
      {A_TRIER.map((t, i) => {
        const depart = r.tri + i * 3;
        const o = entre(frame, depart, depart + 16);
        return (
          <div key={t} style={{ position: "absolute", left: 140 + (i % 2) * 70, top: 300 + i * 72, height: 60, display: "flex", alignItems: "center", gap: 12, padding: "0 22px", borderRadius: 14, background: C.surface, border: `1px solid ${C.filet}`, font: `500 25px/1 ${TEXTE}`, color: C.encre2, opacity: 1 - o, transform: `translateX(${-o * 260}px) rotate(${-o * 6}deg)` }}>
            <Point couleur={i % 3 ? C.encre3 : C.signal} taille={9} />
            {t}
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 0, right: 0, top: 80, textAlign: "center" }}>
        <div style={{ font: `600 80px/1.1 ${SERIF}`, opacity: titre1, transform: `translateY(${(1 - titre1) * 20}px)` }}>Moins de tri.</div>
        <div style={{ font: `600 80px/1.1 ${SERIF}`, color: "#D9480F", opacity: titre2, transform: `translateY(${(1 - titre2) * 20}px)` }}>Plus de travail qui compte.</div>
      </div>
      {/* Ce qui compte, en grand */}
      <div style={{ position: "absolute", left: 660, top: 360 + (1 - focus) * 40, width: 1100, ...carte, padding: "34px 40px", opacity: focus, transform: `scale(${0.94 + focus * 0.06})` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, font: `500 21px/1.2 ${TEXTE}`, color: C.encre2 }}><Point couleur={C.bleu} taille={10} />Boutiques · priorité n° 1</div>
        <div style={{ font: `600 48px/1.15 ${SERIF}`, marginTop: 16 }}>Finaliser la démo de la boutique</div>
        <div style={{ position: "relative", height: 10, borderRadius: 5, background: C.fond2, marginTop: 30 }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${progres * 100}%`, borderRadius: 5, background: C.bleu }} />
          <div style={{ position: "absolute", left: `${progres * 100}%`, top: -6, width: 4, height: 22, borderRadius: 2, background: C.signal }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 24, font: `500 23px/1.3 ${TEXTE}`, color: C.encre2 }}><Icone nom="cloche" taille={24} couleur={C.encre3} />Le reste attend son tour.</div>
      </div>
    </FonduScene>
  );
};
