// 4. Il sait ce qui compte. Aujourd'hui : tes priorités déclarées et celles qui
// n'avancent plus (lib/priorites.js). Bientôt (maquette) : le classement qui se
// construit seul, ses indices, un geste pour confirmer, et tu corriges.
import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig, spring } from "remotion";
import type { SceneProps } from "../Presentation";
import { C, MONO, SERIF, TEXTE, carte, entre, FonduScene, Icone, Pastille, Puce, SurTitre, useRessort } from "../ui";

type Ligne = { cle: string; titre: string; pourquoi: string; indices: string[] };
const LIGNES: Ligne[] = [
  { cle: "album", titre: "Album « Été »", pourquoi: "parce que la musique compte pour moi", indices: [] },
  { cle: "boutiques", titre: "Boutiques", pourquoi: "la démo, c'est ce qui paie le reste", indices: ["14 échanges T3 cette semaine", "démo mardi"] },
  { cle: "porto", titre: "Voyage à Porto", pourquoi: "les billets montent chaque semaine", indices: ["billets avant le 20"] },
  { cle: "sante", titre: "Santé", pourquoi: "ne plus repousser les rendez-vous", indices: ["1 rappel cette semaine"] },
];
// Ordres successifs : déclaré → proposé par Rémy → corrigé par toi.
const DECLARE = ["album", "boutiques", "porto", "sante"];
const PROPOSE = ["boutiques", "porto", "album", "sante"];
const CORRIGE = ["boutiques", "album", "porto", "sante"];
const HAUT = 128;

export const Priorites: React.FC<SceneProps> = ({ s }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const r = s.reperes;
  const corrige = s.phrases[3].debut + 8;
  const confirme = entre(frame, r.geste, r.geste + 10);
  const pastille = useRessort(r.indices);
  const neglige = useRessort(r.neglige);

  const rang = (cle: string) => {
    const a = DECLARE.indexOf(cle);
    const b = PROPOSE.indexOf(cle);
    const c = CORRIGE.indexOf(cle);
    const p1 = spring({ frame: frame - r.reordonne, fps, config: { damping: 17, stiffness: 110 } });
    const p2 = spring({ frame: frame - corrige, fps, config: { damping: 17, stiffness: 110 } });
    return a + (b - a) * p1 + (c - b) * p2;
  };
  const leve = (cle: string) => (cle === "album" ? Math.sin(Math.PI * entre(frame, corrige - 4, corrige + 22)) : 0);

  return (
    <FonduScene duree={s.duree}>
      <div style={{ position: "absolute", left: 360, top: 56, width: 1200, ...carte, padding: "36px 44px 30px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <SurTitre>Ce qui compte</SurTitre>
            <div style={{ font: `600 54px/1.15 ${SERIF}`, marginTop: 10 }}>Tes priorités</div>
          </div>
          <div style={{ opacity: pastille, transform: `translateY(${(1 - pastille) * -10}px)` }}><Pastille>Bientôt · classement auto</Pastille></div>
        </div>
        <div style={{ position: "relative", height: HAUT * 4, marginTop: 22 }}>
          {LIGNES.map((l, i) => {
            const apparait = useRessortLocal(frame, r.liste + i * 5, fps);
            const y = rang(l.cle) * HAUT;
            const lev = leve(l.cle);
            const indicesVisibles = frame >= r.indices;
            const numero = Math.round(rang(l.cle)) + 1;
            return (
              <div key={l.cle} style={{ position: "absolute", left: 0, right: 0, top: y, height: HAUT - 12, display: "flex", alignItems: "center", gap: 26, padding: "0 24px", borderRadius: 18, background: lev > 0.05 ? C.surface : C.fond, boxShadow: lev > 0.05 ? `0 ${lev * 18}px ${lev * 40}px rgba(34,30,24,.18)` : "none", border: `1px solid ${lev > 0.05 ? C.signal : C.filet}`, opacity: apparait, transform: `translateX(${(1 - apparait) * 40}px) scale(${1 + lev * 0.02})`, zIndex: lev > 0.05 ? 2 : 1 }}>
                <div style={{ width: 54, font: `600 46px/1 ${SERIF}`, color: numero === 1 ? C.signalTexte : C.encre3, textAlign: "center" }}>{numero}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: `600 32px/1.2 ${TEXTE}` }}>{l.titre}</div>
                  <div style={{ font: `italic 400 24px/1.3 ${SERIF}`, color: C.encre2, marginTop: 4 }}>{l.pourquoi}</div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {l.cle === "album" ? (
                    <span style={{ opacity: neglige, transform: `scale(${0.9 + neglige * 0.1})` }}>
                      <Puce couleur={C.danger} fond="rgba(178,54,29,.09)"><Icone nom="horloge" taille={22} couleur={C.danger} />rien n'a bougé depuis 12 jours</Puce>
                    </span>
                  ) : null}
                  {indicesVisibles
                    ? l.indices.map((x, k) => {
                        const o = entre(frame, r.indices + 4 + k * 6 + i * 3, r.indices + 14 + k * 6 + i * 3);
                        return <span key={x} style={{ opacity: o, transform: `translateY(${(1 - o) * 10}px)` }}><Puce>{x}</Puce></span>;
                      })
                    : null}
                </div>
                <div style={{ display: "grid", gap: 4, opacity: 0.6 }}>
                  {[0, 1, 2].map((k) => <div key={k} style={{ width: 22, height: 3, borderRadius: 2, background: C.encre3 }} />)}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 14, opacity: entre(frame, r.indices + 10, r.indices + 20) }}>
          <div style={{ height: 62, padding: "0 30px", borderRadius: 14, background: confirme > 0 ? C.succes : C.encre, color: "#fff", display: "flex", alignItems: "center", gap: 12, font: `600 24px/1 ${TEXTE}`, transform: `scale(${1 - Math.sin(Math.PI * entre(frame, r.geste - 6, r.geste + 6)) * 0.05})` }}>
            <Icone nom="coche" taille={24} couleur="#fff" />{confirme > 0 ? "Classement confirmé" : "Confirmer le classement"}
          </div>
          <div style={{ font: `400 22px/1.3 ${TEXTE}`, color: C.encre3 }}>{frame >= corrige ? "Tu glisses une ligne : il retient ta correction." : "Proposé d'après tes fils, tes tâches et tes rappels."}</div>
        </div>
      </div>
      <Doigt x={interpolate(entre(frame, r.geste - 24, r.geste - 4), [0, 1], [760, 594])} y={interpolate(entre(frame, r.geste - 24, r.geste - 4), [0, 1], [900, 767])} visible={frame > r.geste - 26 && frame < r.geste + 18} presse={frame >= r.geste - 4 && frame < r.geste + 6} />
    </FonduScene>
  );
};

function useRessortLocal(frame: number, debut: number, fps: number) {
  return spring({ frame: frame - debut, fps, config: { damping: 18, stiffness: 140, mass: 0.8 } });
}

/** Un doigt (un disque doux) qui touche un bouton. */
export function Doigt({ x, y, visible, presse }: { x: number; y: number; visible: boolean; presse: boolean }) {
  if (!visible) return null;
  return (
    <div style={{ position: "absolute", left: x - 34, top: y - 34, width: 68, height: 68, borderRadius: "50%", background: "rgba(34,30,24,.22)", border: "3px solid rgba(255,252,246,.9)", transform: `scale(${presse ? 0.82 : 1})`, boxShadow: "0 6px 18px rgba(34,30,24,.25)" }} />
  );
}
