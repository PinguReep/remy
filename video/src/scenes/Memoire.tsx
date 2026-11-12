// 6. Il se souvient : la mémoire de vos échanges et les sous-projets existent ;
// l'arbre qui dit « où on en est » est une maquette (pastille « Bientôt »).
import React from "react";
import { useCurrentFrame } from "remotion";
import type { SceneProps } from "../Presentation";
import { C, MONO, SERIF, TEXTE, carte, entre, FonduScene, Icone, Pastille, Point, SurTitre, useRessort } from "../ui";

const RACINE = { x: 90, y: 250, l: 440, h: 190 };
const BRANCHES = [
  { nom: "Billets", y: 70, feuilles: [["Aller : réservé", true], ["Retour : à choisir", false]] },
  { nom: "Logement", y: 300, feuilles: [["Deux quartiers en lice", false]] },
  { nom: "Programme", y: 530, feuilles: [["4 idées de Léa", true]] },
] as const;
const BX = 700;
const BL = 330;
const BH = 110;
const FX = 1160;

export const Memoire: React.FC<SceneProps> = ({ s }) => {
  const frame = useCurrentFrame();
  const r = s.reperes;
  const racine = useRessort(r.racine);
  const memoire = useRessort(s.phrases[1].debut + 4);
  const callout = useRessort(r.ouenest);
  const pastille = useRessort(r.feuilles);

  return (
    <FonduScene duree={s.duree}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {BRANCHES.map((b, i) => {
          const t = entre(frame, r.branches + i * 6, r.branches + i * 6 + 16);
          const x1 = RACINE.x + RACINE.l;
          const y1 = RACINE.y + RACINE.h / 2;
          const y2 = b.y + BH / 2;
          return (
            <g key={b.nom}>
              <path d={`M ${x1} ${y1} C ${x1 + 90} ${y1}, ${BX - 90} ${y2}, ${BX} ${y2}`} fill="none" stroke={C.fond3} strokeWidth={4} strokeDasharray={600} strokeDashoffset={600 * (1 - t)} />
              {b.feuilles.map((f, k) => {
                const u = entre(frame, r.feuilles + i * 5 + k * 4, r.feuilles + i * 5 + k * 4 + 12);
                const yf = b.y + k * 62 + 24;
                return <path key={k} d={`M ${BX + BL} ${y2} C ${BX + BL + 50} ${y2}, ${FX - 50} ${yf + 20}, ${FX} ${yf + 20}`} fill="none" stroke={C.fond3} strokeWidth={3} strokeDasharray={300} strokeDashoffset={300 * (1 - u)} />;
              })}
            </g>
          );
        })}
      </svg>
      {/* Le projet */}
      <div style={{ position: "absolute", left: RACINE.x, top: RACINE.y, width: RACINE.l, height: RACINE.h, ...carte, padding: "30px 32px", opacity: racine, transform: `scale(${0.92 + racine * 0.08})` }}>
        <SurTitre taille={18}>Projet Motion</SurTitre>
        <div style={{ font: `600 44px/1.15 ${SERIF}`, marginTop: 12 }}>Voyage à Porto</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, font: `400 22px/1 ${TEXTE}`, color: C.encre2 }}><Point couleur="#B07A2A" taille={10} />3 sous-projets · en attente</div>
      </div>
      {/* Ce que Rémy retient */}
      <div style={{ position: "absolute", left: RACINE.x, top: 500, width: RACINE.l + 60, ...carte, padding: "24px 28px", opacity: memoire, transform: `translateY(${(1 - memoire) * 24}px)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, font: `600 22px/1 ${TEXTE}` }}><Icone nom="bulle" taille={24} couleur={C.signal} />Rémy retient</div>
        {["Tu préfères le train à l'avion.", "Léa s'occupe du programme.", "Budget logement : à décider à deux."].map((t, i) => (
          <div key={t} style={{ font: `italic 400 24px/1.35 ${SERIF}`, color: C.encre2, marginTop: 12, opacity: entre(frame, s.phrases[1].debut + 10 + i * 6, s.phrases[1].debut + 20 + i * 6) }}>« {t} »</div>
        ))}
      </div>
      {/* Les sous-projets */}
      {BRANCHES.map((b, i) => (
        <Branche key={b.nom} nom={b.nom} y={b.y} debut={r.branches + i * 6 + 8} />
      ))}
      {/* Les feuilles : où en est chaque branche (maquette) */}
      {BRANCHES.flatMap((b, i) =>
        b.feuilles.map(([t, fait], k) => {
          const o = useRessortLocal(frame, r.feuilles + i * 5 + k * 4 + 6);
          return (
            <div key={t} style={{ position: "absolute", left: FX, top: b.y + k * 62 + 24 - 2, height: 46, display: "flex", alignItems: "center", gap: 12, padding: "0 18px", borderRadius: 999, background: fait ? "rgba(62,122,76,.1)" : C.fond2, color: fait ? C.succes : C.encre2, font: `500 22px/1 ${TEXTE}`, opacity: o, transform: `translateX(${(1 - o) * 20}px)` }}>
              {fait ? <Icone nom="coche" taille={22} couleur={C.succes} /> : <Point couleur={C.encre3} taille={9} />}
              {t}
            </div>
          );
        }),
      )}
      <div style={{ position: "absolute", left: 1500, top: 76, opacity: pastille }}><Pastille>Bientôt</Pastille></div>
      {/* Où on en est */}
      <div style={{ position: "absolute", left: 1000, top: 668, width: 820, ...carte, borderColor: "rgba(242,84,27,.5)", padding: "24px 30px", opacity: callout, transform: `translateY(${(1 - callout) * 30}px)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <SurTitre taille={18}>Où on en est</SurTitre>
          <span style={{ font: `400 18px/1 ${MONO}`, color: C.encre3 }}>· d'après vos échanges</span>
        </div>
        <div style={{ font: `400 26px/1.4 ${TEXTE}`, marginTop: 12 }}>L'aller est pris. Il reste le retour et le logement : tu hésitais entre deux quartiers, Léa en préférait un.</div>
      </div>
    </FonduScene>
  );
};

function useRessortLocal(frame: number, debut: number) {
  return entre(frame, debut, debut + 12);
}

function Branche({ nom, y, debut }: { nom: string; y: number; debut: number }) {
  const p = useRessort(debut);
  return (
    <div style={{ position: "absolute", left: BX, top: y, width: BL, height: BH, ...carte, padding: "0 26px", display: "flex", alignItems: "center", gap: 16, opacity: p, transform: `translateX(${(1 - p) * -30}px)` }}>
      <Icone nom="dossier" taille={30} couleur={C.encre2} />
      <div>
        <div style={{ font: `600 30px/1.1 ${TEXTE}` }}>{nom}</div>
        <div style={{ font: `400 19px/1.3 ${TEXTE}`, color: C.encre3 }}>sous-projet</div>
      </div>
    </div>
  );
}
