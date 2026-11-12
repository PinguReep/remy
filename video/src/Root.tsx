import React from "react";
import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { Presentation, PresentationProps } from "./Presentation";
import { FPS, HAUTEUR, LARGEUR, construire } from "./montage.js";

// La durée vient de la voix : public/minutage.json, écrit par
// scripts/minutage.mjs à partir des fichiers de public/voix/.
const calculer: CalculateMetadataFunction<PresentationProps> = async ({ props, abortSignal }) => {
  const r = await fetch(staticFile("minutage.json"), { signal: abortSignal });
  if (!r.ok) throw new Error("public/minutage.json introuvable : lance « npm run minutage ».");
  const minutage = await r.json();
  const montage = construire(minutage);
  return { durationInFrames: montage.total, props: { ...props, montage } };
};

export const Racine: React.FC = () => (
  <Composition
    id="Presentation"
    component={Presentation}
    durationInFrames={FPS * 90}
    fps={FPS}
    width={LARGEUR}
    height={HAUTEUR}
    defaultProps={{ montage: null, sousTitres: true, sons: true } as PresentationProps}
    calculateMetadata={calculer}
  />
);
