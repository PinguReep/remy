// Des maquettes qui ressemblent à l'app (site « Atelier », app iPhone) — avec
// les données de démonstration fictives (Sam, Léa, Hugo, Boutiques, Porto).
import React from "react";
import { C, MONO, SERIF, TEXTE, carte, Icone, MarqueSite, Point } from "./ui";

/** L'écran « Aujourd'hui » du site, calme, en 1920 × 1080. */
export function EcranAujourdhui({ progres = 0.42 }: { progres?: number }) {
  const lien = (nom: string, icone: string, actif = false) => (
    <div style={{ display: "flex", alignItems: "center", gap: 16, height: 58, padding: "0 16px", borderRadius: 14, color: actif ? C.encre : C.encre2, background: actif ? C.surface : "transparent", boxShadow: actif ? `inset 0 0 0 1px ${C.filet}` : "none", font: `500 24px/1 ${TEXTE}` }}>
      <Icone nom={icone} taille={26} couleur={actif ? C.signal : C.encre2} />
      {nom}
    </div>
  );
  return (
    <div style={{ position: "absolute", inset: 0, background: C.fond, display: "flex" }}>
      <div style={{ width: 300, borderRight: `1px solid ${C.filet}`, padding: "30px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ padding: "4px 12px 22px" }}><MarqueSite taille={40} /></div>
        <div style={{ height: 60, borderRadius: 14, background: C.encre, color: C.fond, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, font: `600 24px/1 ${TEXTE}`, marginBottom: 16 }}>
          <Icone nom="plus" taille={24} couleur={C.fond} /> Noter
        </div>
        {lien("Aujourd'hui", "soleil", true)}
        {lien("Rémy", "bulle")}
        {lien("Projets", "dossier")}
        {lien("Conversations", "liste")}
        {lien("Réglages", "reglages")}
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10, padding: "0 16px", font: `500 18px/1 ${MONO}`, color: C.encre3 }}>
          <Point couleur={C.succes} taille={10} /> Tour en ligne
        </div>
      </div>
      <div style={{ flex: 1, padding: "40px 48px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div>
          <div style={{ font: `500 22px/1 ${MONO}`, letterSpacing: "0.16em", color: C.signalTexte }}>JEUDI 12 NOVEMBRE</div>
          <div style={{ font: `600 62px/1.15 ${SERIF}`, marginTop: 10 }}>Bonjour</div>
        </div>
        <div style={{ display: "flex", gap: 32 }}>
          <div style={{ ...carte, flex: 1.35, padding: 34 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "6px 16px", borderRadius: 999, background: C.fond2, font: `500 21px/1.2 ${TEXTE}`, color: C.encre2 }}><Point couleur={C.bleu} taille={10} />Boutiques</span>
              <span style={{ font: `500 19px/1 ${MONO}`, letterSpacing: "0.12em", color: C.signalTexte, display: "flex", alignItems: "center", gap: 8 }}><Point taille={9} />EN COURS</span>
            </div>
            <div style={{ font: `600 44px/1.15 ${SERIF}`, marginTop: 22 }}>Finaliser la démo de la boutique</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 18 }}>
              <span style={{ font: `600 92px/1 ${SERIF}` }}>43</span>
              <span style={{ font: `500 26px/1 ${TEXTE}`, color: C.encre2 }}>min restantes · sur 1 h 15</span>
            </div>
            <div style={{ position: "relative", height: 8, borderRadius: 4, background: C.fond2, marginTop: 26 }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${progres * 100}%`, borderRadius: 4, background: C.bleu }} />
              <div style={{ position: "absolute", left: `${progres * 100}%`, top: -5, width: 4, height: 18, borderRadius: 2, background: C.signal }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", font: `400 19px/1 ${MONO}`, color: C.encre3, marginTop: 12 }}><span>09:45</span><span>11:00</span></div>
            <div style={{ display: "flex", gap: 14, marginTop: 26 }}>
              <div style={{ flex: 2, height: 62, borderRadius: 14, background: C.encre, color: C.fond, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, font: `600 24px/1 ${TEXTE}` }}><Icone nom="coche" taille={24} couleur={C.fond} />Terminer</div>
              <div style={{ flex: 1, height: 62, borderRadius: 14, border: `1px solid ${C.filet}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, font: `600 24px/1 ${TEXTE}` }}><Icone nom="horloge" taille={24} />Décaler</div>
            </div>
          </div>
          <div style={{ ...carte, flex: 1, padding: 34 }}>
            <div style={{ borderLeft: `4px solid ${C.signal}`, paddingLeft: 22 }}>
              <div style={{ font: `600 21px/1 ${TEXTE}`, color: C.encre }}>Rémy <span style={{ fontWeight: 400, color: C.encre3 }}>· conseil réfléchi</span></div>
              <div style={{ font: `italic 400 31px/1.35 ${SERIF}`, marginTop: 14 }}>Reste sur « Finaliser la démo de la boutique » jusqu'à 11:00, puis prépare « Déjeuner avec Léa » (12:30).</div>
              <div style={{ font: `400 22px/1.5 ${TEXTE}`, color: C.encre2, marginTop: 18 }}>• Rendez-vous fixe à 12:30<br />• 1 tâche en attente laissée de côté</div>
            </div>
          </div>
        </div>
        <div style={{ ...carte, padding: "26px 34px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ font: `500 20px/1 ${MONO}`, letterSpacing: "0.16em", color: C.encre2 }}>RAPPELS DU JOUR 2</div>
          {[["Payer le loyer", "aujourd'hui 09:27"], ["Appeler le garage pour le contrôle technique", "aujourd'hui 12:17"]].map(([t, h]) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, border: `2px solid ${C.encre3}` }} />
              <div><div style={{ font: `500 25px/1.2 ${TEXTE}` }}>{t}</div><div style={{ font: `400 19px/1.4 ${MONO}`, color: C.encre3 }}>{h}</div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Un iPhone (cadre sobre), avec son contenu. */
export function Telephone({ children, largeur = 400, style }: { children: React.ReactNode; largeur?: number; style?: React.CSSProperties }) {
  const hauteur = largeur * 2.03;
  return (
    <div style={{ width: largeur, height: hauteur, borderRadius: largeur * 0.15, background: "#1b1916", padding: largeur * 0.035, boxShadow: "0 30px 80px rgba(34,30,24,.28)", ...style }}>
      <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: largeur * 0.12, overflow: "hidden", background: C.fond }}>
        {children}
        <div style={{ position: "absolute", top: largeur * 0.03, left: "50%", transform: "translateX(-50%)", width: largeur * 0.3, height: largeur * 0.085, borderRadius: 999, background: "#000" }} />
      </div>
    </div>
  );
}
