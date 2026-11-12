// 5. Il explique ses choix : la feuille « Prochaines heures » (touche H), une
// ligne de pourquoi sous chaque tâche. En préparation (branche
// claude/classement-prochaines-heures) : maquette animée.
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import type { SceneProps } from "../Presentation";
import { C, MONO, SERIF, TEXTE, carte, entre, FonduScene, Pastille, SurTitre, useRessort } from "../ui";
import { EcranAujourdhui } from "../ecrans";

type Rang = { h: string; titre: string; pourquoi: string; alerte?: boolean };
const TRANCHES: { titre: string; lignes: Rang[] }[] = [
  {
    titre: "Cet après-midi",
    lignes: [
      { h: "14:00", titre: "Relire le contrat de Hugo", pourquoi: "Rendez-vous fixe" },
      { h: "14:45", titre: "Finaliser la démo de la boutique", pourquoi: "Échéance ferme mardi · sert ta priorité n° 1" },
      { h: "16:30", titre: "Préparer la facture Ondine", pourquoi: "Due à 17:00 : placée juste avant", alerte: true },
    ],
  },
  { titre: "Ce soir", lignes: [{ h: "18:30", titre: "Réserver le logement à Porto", pourquoi: "Pas avant aujourd'hui · sert ta priorité n° 2" }] },
  { titre: "Demain matin", lignes: [{ h: "09:00", titre: "Retoucher les photos de l'album", pourquoi: "Rien ne la distingue : Motion l'a placée là" }] },
];

export const Pourquoi: React.FC<SceneProps> = ({ s }) => {
  const frame = useCurrentFrame();
  const r = s.reperes;
  const presse = frame >= r.touche && frame < r.touche + 5;
  const touche = useRessort(s.phrases[0].debut + 6);
  const feuille = useRessort(r.feuille, { damping: 20, stiffness: 120 });
  const voile = entre(frame, r.feuille, r.feuille + 14);
  const accent = entre(frame, r.accent, r.accent + 16);
  const toucheX = interpolate(feuille, [0, 1], [960, 470]);
  let n = 0;

  return (
    <FonduScene duree={s.duree}>
      <div style={{ position: "absolute", inset: 0, filter: `blur(${voile * 4}px)` }}><EcranAujourdhui progres={0.5} /></div>
      <div style={{ position: "absolute", inset: 0, background: `rgba(34,30,24,${0.12 + voile * 0.22})` }} />
      {/* La touche H */}
      <div style={{ position: "absolute", left: toucheX - 95, top: 330, width: 190, opacity: touche, transform: `scale(${(0.8 + touche * 0.2) * (presse ? 0.92 : 1)})`, textAlign: "center" }}>
        <div style={{ width: 190, height: 190, borderRadius: 34, background: C.surface, border: `2px solid ${C.fond3}`, boxShadow: presse ? `0 4px 0 ${C.fond3}` : `0 14px 0 ${C.fond3}, 0 24px 50px rgba(34,30,24,.25)`, transform: `translateY(${presse ? 10 : 0}px)`, display: "grid", placeItems: "center", font: `600 110px/1 ${MONO}`, color: C.encre }}>H</div>
        <div style={{ font: `500 26px/1.3 ${TEXTE}`, color: "#FFFCF6", marginTop: 34, opacity: feuille, textShadow: "0 2px 10px rgba(0,0,0,.35)" }}>Prochaines heures</div>
      </div>
      {/* La feuille */}
      <div style={{ position: "absolute", top: 36, bottom: 166, right: 56, width: 1000, ...carte, borderRadius: 26, padding: "34px 44px", transform: `translateX(${(1 - feuille) * 1100}px)`, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <SurTitre>De maintenant à demain midi</SurTitre>
            <div style={{ font: `600 50px/1.15 ${SERIF}`, marginTop: 8 }}>Prochaines heures</div>
          </div>
          <Pastille>En préparation</Pastille>
        </div>
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
          {TRANCHES.map((t) => (
            <div key={t.titre}>
              <div style={{ font: `500 19px/1 ${MONO}`, letterSpacing: "0.16em", color: C.encre2, textTransform: "uppercase", margin: "14px 0 8px" }}>{t.titre}</div>
              {t.lignes.map((l) => {
                const k = n++;
                const o = entre(frame, r.pourquoi + k * 9, r.pourquoi + k * 9 + 12);
                return (
                  <div key={l.titre} style={{ display: "flex", gap: 24, padding: "10px 0", borderTop: `1px solid ${C.filet}` }}>
                    <div style={{ width: 86, font: `500 25px/1.5 ${MONO}`, color: C.encre3 }}>{l.h}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ font: `600 28px/1.3 ${TEXTE}` }}>{l.titre}</div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginTop: 4, font: `400 23px/1.3 ${TEXTE}`, color: l.alerte ? C.danger : C.encre2, opacity: o, transform: `translateX(${(1 - o) * 14}px)`, background: `rgba(242,84,27,${accent * 0.1})`, borderRadius: 8, padding: "2px 8px", marginLeft: -8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: l.alerte ? C.danger : C.signal, flex: "none" }} />
                        {l.pourquoi}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </FonduScene>
  );
};
