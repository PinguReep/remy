// 7. Il vient te chercher : le rappel qui sonne en arrivant (iPhone) et la
// notification au bon moment (app Windows) existent ; l'appel par T3 Code et
// l'agent qui a fini mis en avant sont annoncés (pastilles « Bientôt »).
import React from "react";
import { useCurrentFrame } from "remotion";
import type { SceneProps } from "../Presentation";
import { C, MONO, SERIF, TEXTE, carte, entre, FonduScene, Icone, Logo, Pastille, Point, SurTitre, useRessort } from "../ui";
import { Telephone } from "../ecrans";

const AGENTS = [
  { nom: "site-vitrine", etat: "en cours · formulaire de contact", fini: false },
  { nom: "album-ete", etat: "en cours · retouches 12/42", fini: false },
  { nom: "boutique-démo", etat: "a fini · tests verts, à relire", fini: true },
];

export const Chercher: React.FC<SceneProps> = ({ s }) => {
  const frame = useCurrentFrame();
  const r = s.reperes;
  const tel = useRessort(r.telephone - 4);
  const rappel = useRessort(r.rappel, { damping: 15 });
  const appel = entre(frame, r.appel, r.appel + 12);
  const toast = useRessort(r.notif);
  const agents = useRessort(r.agent - 30);
  const monte = entre(frame, r.agent, r.agent + 20);
  const sonne = frame >= r.appel ? Math.sin((frame - r.appel) / 2.2) : 0;

  return (
    <FonduScene duree={s.duree}>
      {/* L'iPhone */}
      <div style={{ position: "absolute", left: 180, top: 40, opacity: tel, transform: `translateY(${(1 - tel) * 60}px) rotate(${sonne * 0.5 * appel}deg)` }}>
        <Telephone largeur={410}>
          {/* Écran verrouillé */}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, #2B2722 0%, #14120F 100%)", opacity: 1 - appel }}>
            <div style={{ textAlign: "center", marginTop: 110, color: "#F3ECE1" }}>
              <div style={{ font: `500 22px/1 ${TEXTE}`, opacity: 0.8 }}>jeudi 12 novembre</div>
              <div style={{ font: `600 104px/1.05 ${TEXTE}`, letterSpacing: "-0.03em", marginTop: 8 }}>18:42</div>
            </div>
            <div style={{ position: "absolute", left: 16, right: 16, top: 330, borderRadius: 26, background: "rgba(243,236,225,.9)", padding: "18px 20px", opacity: rappel, transform: `translateY(${(1 - rappel) * -40}px) scale(${0.94 + rappel * 0.06})` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Logo taille={34} />
                <span style={{ font: `600 18px/1 ${TEXTE}`, color: C.encre2, letterSpacing: "0.04em" }}>RÉMY</span>
                <span style={{ marginLeft: "auto", font: `400 17px/1 ${TEXTE}`, color: C.encre3 }}>maintenant</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, font: `600 22px/1.3 ${TEXTE}`, color: C.encre, marginTop: 12 }}><Icone nom="lieu" taille={22} couleur={C.signal} />En arrivant : Bureau</div>
              <div style={{ font: `400 22px/1.35 ${TEXTE}`, color: C.encre2, marginTop: 4 }}>Rappeler Hugo pour le contrat.</div>
            </div>
          </div>
          {/* L'appel (annoncé) */}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, #3a2a1f 0%, #14120F 75%)", opacity: appel, color: "#F3ECE1", textAlign: "center" }}>
            <div style={{ marginTop: 120, font: `500 22px/1 ${MONO}`, letterSpacing: "0.12em", opacity: 0.75 }}>APPEL · T3 CODE</div>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 40 }}>
              <div style={{ borderRadius: 44, boxShadow: `0 0 0 ${10 + Math.abs(sonne) * 18}px rgba(255,106,51,${0.18 * appel})` }}><Logo taille={150} fond="#221E18" /></div>
            </div>
            <div style={{ font: `600 54px/1.1 ${TEXTE}`, marginTop: 34 }}>Rémy</div>
            <div style={{ font: `400 24px/1.35 ${TEXTE}`, opacity: 0.85, margin: "16px 36px 0" }}>Boutiques : la démo attend ta décision.</div>
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 90, display: "flex", justifyContent: "space-around" }}>
              {[["#C9432A", "Plus tard"], ["#3E7A4C", "Répondre"]].map(([c, t]) => (
                <div key={t} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 92, height: 92, borderRadius: "50%", background: c, display: "grid", placeItems: "center" }}><Icone nom="telephone" taille={40} couleur="#fff" /></div>
                  <span style={{ font: `500 20px/1 ${TEXTE}` }}>{t}</span>
                </div>
              ))}
            </div>
          </div>
        </Telephone>
      </div>
      <div style={{ position: "absolute", left: 240, top: 884, width: 300, display: "flex", justifyContent: "center", opacity: appel }}>
        <Pastille>Bientôt</Pastille>
      </div>
      {/* La notification de l'app Windows */}
      <div style={{ position: "absolute", left: 760, top: 70, width: 1080, ...carte, borderRadius: 18, padding: "22px 26px", display: "flex", gap: 20, alignItems: "center", opacity: toast, transform: `translateX(${(1 - toast) * 120}px)` }}>
        <Logo taille={60} />
        <div style={{ flex: 1 }}>
          <div style={{ font: `600 24px/1.2 ${TEXTE}` }}>Rémy <span style={{ fontWeight: 400, color: C.encre3 }}>· briefing du matin</span></div>
          <div style={{ font: `400 24px/1.35 ${TEXTE}`, color: C.encre2, marginTop: 4 }}>Ce qui compte : « Finaliser la démo de la boutique », avant 14:45.</div>
        </div>
        <span style={{ font: `400 18px/1 ${MONO}`, color: C.encre3 }}>Windows</span>
      </div>
      {/* Les agents de T3 Code : celui qui a fini passe devant (annoncé) */}
      <div style={{ position: "absolute", left: 760, top: 290, width: 1080, ...carte, padding: "28px 34px", opacity: agents, transform: `translateY(${(1 - agents) * 30}px)` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <SurTitre taille={18}>Tes agents · T3 Code</SurTitre>
            <div style={{ font: `600 40px/1.15 ${SERIF}`, marginTop: 8 }}>Qui a besoin de toi</div>
          </div>
          <div style={{ opacity: monte }}><Pastille>Bientôt</Pastille></div>
        </div>
        <div style={{ position: "relative", height: 3 * 100, marginTop: 20 }}>
          {AGENTS.map((a, i) => {
            const y = a.fini ? (2 - monte * 2) * 100 : (i + monte) * 100;
            return (
              <div key={a.nom} style={{ position: "absolute", left: 0, right: 0, top: y, height: 88, display: "flex", alignItems: "center", gap: 18, padding: "0 22px", borderRadius: 16, border: `${a.fini ? 2 : 1}px solid ${a.fini && monte > 0.5 ? C.signal : C.filet}`, background: a.fini && monte > 0.5 ? "rgba(242,84,27,.06)" : C.fond }}>
                <Icone nom="agent" taille={30} couleur={C.encre2} />
                <span style={{ font: `600 27px/1 ${TEXTE}` }}>{a.nom}</span>
                <span style={{ font: `400 23px/1 ${TEXTE}`, color: a.fini ? C.succes : C.encre3 }}>{a.etat}</span>
                {a.fini ? (
                  <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, font: `500 18px/1 ${MONO}`, letterSpacing: "0.1em", color: C.signalTexte, opacity: monte }}><Point taille={10} />MIS EN AVANT</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </FonduScene>
  );
};
