import React from "react";
import { AbsoluteFill, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import { C, TEXTE, chargerPolices, entre } from "./ui";
import { Probleme } from "./scenes/Probleme";
import { Arrivee } from "./scenes/Arrivee";
import { Outils } from "./scenes/Outils";
import { Priorites } from "./scenes/Priorites";
import { Pourquoi } from "./scenes/Pourquoi";
import { Memoire } from "./scenes/Memoire";
import { Chercher } from "./scenes/Chercher";
import { Temps } from "./scenes/Temps";
import { ChezToi } from "./scenes/ChezToi";

chargerPolices();

export type Phrase = { texte: string; debut: number; fin: number; sousTitre?: boolean };
export type SceneMontage = { id: string; debut: number; duree: number; voix: { debut: number; fichier: string | null }; phrases: Phrase[]; reperes: Record<string, number> };
export type Montage = { fps: number; total: number; scenes: SceneMontage[] };
export type PresentationProps = { montage: Montage | null; sousTitres: boolean; sons: boolean };
export type SceneProps = { s: SceneMontage };

const SCENES: Record<string, React.FC<SceneProps>> = {
  "01-probleme": Probleme,
  "02-arrivee": Arrivee,
  "03-outils": Outils,
  "04-priorites": Priorites,
  "05-pourquoi": Pourquoi,
  "06-memoire": Memoire,
  "07-chercher": Chercher,
  "08-temps": Temps,
  "09-chez-toi": ChezToi,
};

/** Les sous-titres : la phrase en cours, tenue jusqu'à la suivante (ou 0,6 s). */
function SousTitres({ montage }: { montage: Montage }) {
  const frame = useCurrentFrame();
  const toutes = montage.scenes.flatMap((s) => s.phrases.filter((p) => p.sousTitre !== false).map((p) => ({ ...p, debut: s.debut + p.debut, fin: s.debut + p.fin })));
  const i = toutes.findIndex((p, k) => frame >= p.debut - 3 && frame < Math.min(toutes[k + 1] ? toutes[k + 1].debut - 3 : Infinity, p.fin + 18));
  if (i < 0) return null;
  const p = toutes[i];
  const o = Math.min(entre(frame, p.debut - 3, p.debut + 3), 1 - entre(frame, p.fin + 12, p.fin + 18));
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 54, pointerEvents: "none" }}>
      <div style={{ maxWidth: 1560, padding: "14px 30px 16px", borderRadius: 16, background: "rgba(28, 25, 21, .88)", color: "#FFFCF6", font: `500 38px/1.3 ${TEXTE}`, textAlign: "center", opacity: o, textWrap: "balance", letterSpacing: "-0.005em" }}>
        {p.texte}
      </div>
    </AbsoluteFill>
  );
}

export const Presentation: React.FC<PresentationProps> = ({ montage, sousTitres, sons }) => {
  if (!montage) return <AbsoluteFill style={{ background: C.fond }} />;
  return (
    <AbsoluteFill style={{ background: C.fond, fontFamily: TEXTE, color: C.encre }}>
      {montage.scenes.map((s) => {
        const Scene = SCENES[s.id];
        return (
          <Sequence key={s.id} from={s.debut} durationInFrames={s.duree} name={s.id} premountFor={15}>
            {Scene ? <Scene s={s} /> : null}
            {sons && s.voix.fichier ? (
              <Sequence from={s.voix.debut} name={`voix ${s.id}`} layout="none">
                <Audio src={staticFile(s.voix.fichier)} volume={0.7} />
              </Sequence>
            ) : null}
          </Sequence>
        );
      })}
      {sons ? <Audio src={staticFile("sons/musique.wav")} volume={0.45} /> : null}
      {sons ? <Audio src={staticFile("sons/bruitages.wav")} volume={0.38} /> : null}
      {sousTitres ? <SousTitres montage={montage} /> : null}
    </AbsoluteFill>
  );
};
