// 9. Chez toi : l'iPhone, l'ordinateur (app Windows), ta tour (le serveur et le
// modèle local). Puis le logo, sur fond de nuit.
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import type { SceneProps } from "../Presentation";
import { C, MONO, SERIF, TEXTE, carte, entre, FonduScene, Icone, Logo, MarqueSite, Point, useRessort } from "../ui";
import { Telephone } from "../ecrans";

export const ChezToi: React.FC<SceneProps> = ({ s }) => {
  const frame = useCurrentFrame();
  const r = s.reperes;
  const tel = useRessort(r.appareils);
  const ordi = useRessort(r.appareils + 6);
  const tour = useRessort(r.appareils + 12);
  const liens = entre(frame, r.appareils + 18, r.appareils + 36);
  const puces = useRessort(r.tour);
  const nuit = entre(frame, r.logo - 10, r.logo + 8);
  const logo = useRessort(r.logo, { damping: 13, stiffness: 110 });
  const nom = useRessort(r.logo + 8);
  const devise = useRessort(s.phrases[2].debut + 18);
  const pied = useRessort(s.phrases[2].fin + 6);
  const pulse = 0.6 + 0.4 * Math.sin(frame / 6);

  return (
    <FonduScene duree={s.duree} sortie={1}>
      {/* Les appareils */}
      <div style={{ position: "absolute", inset: 0, opacity: 1 - nuit, transform: `scale(${1 - nuit * 0.04})` }}>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          {[[430, 470], [1010, 470]].map(([x, y], i) => (
            <path key={i} d={`M ${x} ${y} C ${x + 220} ${y + 220}, 1300 ${640}, 1460 ${560}`} fill="none" stroke={C.signal} strokeWidth={3} strokeDasharray="10 12" opacity={liens * 0.7} strokeDashoffset={-frame * 1.5} />
          ))}
        </svg>
        <div style={{ position: "absolute", left: 230, top: 100, opacity: tel, transform: `translateY(${(1 - tel) * 50}px)` }}>
          <Telephone largeur={300}>
            <div style={{ padding: "70px 22px 0" }}>
              <div style={{ font: `500 13px/1 ${MONO}`, letterSpacing: "0.14em", color: C.signalTexte }}>JEUDI</div>
              <div style={{ font: `600 36px/1.1 ${SERIF}`, marginTop: 6 }}>12 novembre</div>
              <div style={{ ...carte, borderRadius: 16, padding: 16, marginTop: 20 }}>
                <div style={{ font: `500 13px/1 ${TEXTE}`, color: C.encre2 }}>● Boutiques</div>
                <div style={{ font: `600 21px/1.2 ${SERIF}`, marginTop: 8 }}>Finaliser la démo de la boutique</div>
                <div style={{ font: `600 40px/1 ${SERIF}`, marginTop: 10 }}>43 <span style={{ font: `500 14px/1 ${TEXTE}`, color: C.encre2 }}>min restantes</span></div>
              </div>
              <div style={{ font: `500 12px/1 ${MONO}`, letterSpacing: "0.14em", color: C.encre2, marginTop: 22 }}>RAPPELS 2</div>
              {["Payer le loyer", "Rappeler Hugo"].map((t) => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, font: `500 16px/1.2 ${TEXTE}` }}>
                  <span style={{ width: 16, height: 16, borderRadius: "50%", border: `1.5px solid ${C.encre3}` }} />{t}
                </div>
              ))}
            </div>
          </Telephone>
        </div>
        <div style={{ position: "absolute", left: 640, top: 210, width: 560, opacity: ordi, transform: `translateY(${(1 - ordi) * 50}px)` }}>
          <div style={{ height: 350, borderRadius: 18, background: "#1b1916", padding: 12, boxShadow: "0 30px 70px rgba(34,30,24,.25)" }}>
            <div style={{ height: "100%", borderRadius: 10, background: C.fond, display: "flex", overflow: "hidden" }}>
              <div style={{ width: 120, borderRight: `1px solid ${C.filet}`, padding: 14 }}><MarqueSite taille={18} /></div>
              <div style={{ flex: 1, padding: 18 }}>
                <div style={{ font: `600 28px/1 ${SERIF}` }}>Bonjour</div>
                <div style={{ ...carte, borderRadius: 12, height: 110, marginTop: 14, padding: 12, font: `600 17px/1.2 ${SERIF}` }}>Finaliser la démo de la boutique</div>
                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  <div style={{ ...carte, borderRadius: 12, height: 80, flex: 1 }} />
                  <div style={{ ...carte, borderRadius: 12, height: 80, flex: 1 }} />
                </div>
              </div>
            </div>
          </div>
          <div style={{ width: 160, height: 34, margin: "0 auto", background: "#2B2722", clipPath: "polygon(15% 0, 85% 0, 100% 100%, 0 100%)" }} />
        </div>
        <div style={{ position: "absolute", left: 1410, top: 300, opacity: tour, transform: `translateY(${(1 - tour) * 50}px)` }}>
          <div style={{ width: 230, height: 420, borderRadius: 22, background: "linear-gradient(180deg, #2B2722, #1b1916)", position: "relative", boxShadow: "0 30px 70px rgba(34,30,24,.3)" }}>
            {[60, 90, 120].map((y) => <div key={y} style={{ position: "absolute", left: 40, right: 40, top: y, height: 6, borderRadius: 3, background: "#3a352e" }} />)}
            <div style={{ position: "absolute", left: 40, bottom: 40, display: "flex", alignItems: "center", gap: 10, font: `500 16px/1 ${MONO}`, color: "#C2B9AB" }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#8EC399", opacity: pulse }} />en ligne
            </div>
            <div style={{ position: "absolute", left: 72, top: 190 }}><Icone nom="cadenas" taille={86} couleur="#FF6A33" epaisseur={1.6} /></div>
          </div>
        </div>
        {/* Légendes */}
        {[[380, "iPhone", tel], [920, "Windows", ordi], [1525, "Ta tour", tour]].map(([x, t, o]) => (
          <div key={t as string} style={{ position: "absolute", left: (x as number) - 150, width: 300, top: 760, textAlign: "center", font: `500 24px/1 ${MONO}`, letterSpacing: "0.12em", color: C.encre2, textTransform: "uppercase", opacity: o as number }}>{t}</div>
        ))}
        <div style={{ position: "absolute", left: 1220, top: 140, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start", opacity: puces, transform: `translateY(${(1 - puces) * 16}px)` }}>
          {[["eclair", "Modèle local pour réfléchir"], ["cadenas", "Mémoire chiffrée, chez toi"]].map(([i, t]) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderRadius: 999, background: C.surface, border: `1px solid ${C.filet}`, font: `500 24px/1 ${TEXTE}` }}><Icone nom={i} taille={26} couleur={C.signal} />{t}</div>
          ))}
        </div>
      </div>
      {/* La nuit et le logo */}
      <div style={{ position: "absolute", inset: 0, background: C.nuit, opacity: nuit }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingBottom: 120, opacity: nuit }}>
        <div style={{ transform: `scale(${interpolate(logo, [0, 1], [0.6, 1])})`, opacity: logo }}><Logo taille={230} fond="#0D0C0A" /></div>
        <div style={{ font: `800 110px/1 ${TEXTE}`, letterSpacing: "-0.045em", color: C.nuitEncre, marginTop: 44, opacity: nom, transform: `translateY(${(1 - nom) * 20}px)` }}>Rémy</div>
        <div style={{ font: `italic 400 48px/1.2 ${SERIF}`, color: "#C2B9AB", marginTop: 18, opacity: devise }}>Ton directeur de cabinet.</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, font: `500 22px/1 ${MONO}`, letterSpacing: "0.14em", color: "#9A9286", marginTop: 44, opacity: pied, textTransform: "uppercase" }}>
          iPhone <Point couleur="#FF6A33" taille={7} /> Windows <Point couleur="#FF6A33" taille={7} /> ta tour <Point couleur="#FF6A33" taille={7} /> modèle local
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 34, textAlign: "center", font: `400 17px/1.4 ${MONO}`, color: "#9A9286", opacity: pied }}>
        Voix de synthèse : Piper, voix SIWIS (CC BY 4.0) · Musique et bruitages originaux · Données fictives
      </div>
      {/* Fin : fondu au noir (pas au papier, qui est le fond du film) */}
      <div style={{ position: "absolute", inset: 0, background: "#000", opacity: entre(frame, s.duree - 16, s.duree - 1) }} />
    </FonduScene>
  );
};
