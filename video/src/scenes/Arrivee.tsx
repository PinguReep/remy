// 2. Rémy arrive : tout se replie, le logo, puis un écran calme.
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import type { SceneProps } from "../Presentation";
import { C, SERIF, TEXTE, carte, entre, FonduScene, Logo, useRessort } from "../ui";
import { EcranAujourdhui } from "../ecrans";

// Des éclats du chaos (onglets, notifications) qui se replient vers le centre.
const ECLATS = Array.from({ length: 18 }, (_, i) => {
  const a = (i / 18) * Math.PI * 2 + (i % 3) * 0.3;
  const d = 520 + (i % 4) * 110;
  return { x: Math.cos(a) * d * 1.45, y: Math.sin(a) * d * 0.8, l: 180 + (i % 5) * 50, h: i % 2 ? 46 : 70, rot: ((i % 7) - 3) * 4 };
});

export const Arrivee: React.FC<SceneProps> = ({ s }) => {
  const frame = useCurrentFrame();
  const r = s.reperes;
  const repli = entre(frame, 0, r.logo, 0, 1, (t) => t * t * (3 - 2 * t));
  const logo = useRessort(r.logo, { damping: 12, stiffness: 120 });
  const sousTitre = useRessort(s.phrases[1].debut);
  const ecran = entre(frame, r.ecran + 4, r.ecran + 26);
  const depart = entre(frame, r.ecran - 2, r.ecran + 8);
  const echelleLogo = interpolate(logo, [0, 1], [0.4, 1]) * (1 + depart * 0.08);

  return (
    <FonduScene duree={s.duree} entree={1} sortie={10}>
      {/* L'écran calme, qui monte en dernier */}
      <div style={{ position: "absolute", inset: 0, opacity: ecran, transform: `scale(${1.04 - ecran * 0.04})` }}>
        <EcranAujourdhui />
      </div>
      {/* Les éclats */}
      {repli < 1
        ? ECLATS.map((e, i) => (
            <div key={i} style={{ position: "absolute", left: 960 - e.l / 2, top: 470 - e.h / 2, width: e.l, height: e.h, ...carte, borderRadius: 14, background: i % 4 === 0 ? C.fond3 : C.surface, opacity: 1 - repli, transform: `translate(${e.x * (1 - repli)}px, ${e.y * (1 - repli)}px) rotate(${e.rot * (1 - repli)}deg) scale(${1 - repli * 0.9})` }} />
          ))
        : null}
      {/* Le logo et son nom */}
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 34, paddingBottom: 120, opacity: Math.min(logo * 1.5, 1 - depart) }}>
        <div style={{ transform: `scale(${echelleLogo})` }}><Logo taille={220} /></div>
        <div style={{ textAlign: "center" }}>
          <div style={{ font: `800 104px/1 ${TEXTE}`, letterSpacing: "-0.045em", color: C.encre, opacity: logo }}>Rémy</div>
          <div style={{ font: `italic 400 52px/1.2 ${SERIF}`, color: C.encre2, marginTop: 18, opacity: sousTitre, transform: `translateY(${(1 - sousTitre) * 16}px)` }}>Ton directeur de cabinet.</div>
        </div>
      </div>
    </FonduScene>
  );
};
