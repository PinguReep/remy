// 1. Le problème : un écran saturé — onglets, notifications, agents qui attendent.
import React from "react";
import { useCurrentFrame } from "remotion";
import type { SceneProps } from "../Presentation";
import { C, MONO, SERIF, TEXTE, carte, entre, FonduScene, Icone, Point, useRessort } from "../ui";

const ONGLETS = ["Boîte mail (48)", "Agenda", "T3 Code", "Motion", "ChatGPT", "Claude", "Notes", "Budget 2027", "Billets Porto", "Facture Ondine", "Docs démo", "Site vitrine", "Messagerie", "Tableur", "Météo", "Cours"];
const NOTIFS = [
  { titre: "T3 Code", texte: "boutique-démo attend ta réponse", icone: "agent" },
  { titre: "Boîte mail", texte: "6 nouveaux messages", icone: "boite" },
  { titre: "Motion", texte: "2 tâches en retard", icone: "horloge" },
  { titre: "Rappel", texte: "Payer le loyer", icone: "cloche" },
  { titre: "Messagerie", texte: "Léa : « Tu as vu pour Porto ? »", icone: "bulle" },
  { titre: "T3 Code", texte: "site-vitrine attend ta réponse", icone: "agent" },
];
const CONVERSATIONS = [
  { app: "ChatGPT", titre: "Idées de programme à Porto", etat: "brouillon pas fini" },
  { app: "Claude", titre: "Relire le contrat de Hugo", etat: "réponse non lue" },
  { app: "Messagerie", titre: "Léa", etat: "3 messages" },
];
const AGENTS = [
  { nom: "boutique-démo", projet: "Boutiques", dernier: "Le panier est prêt. Je lance les tests, ou tu veux relire d'abord ?" },
  { nom: "site-vitrine", projet: "Boutiques", dernier: "Deux options pour le formulaire de contact : laquelle je garde ?" },
  { nom: "album-ete", projet: "Album « Été »", dernier: "Retouches faites sur 12 photos. Je continue sur les 30 autres ?" },
];

function Notification({ n, debut, rang }: { n: (typeof NOTIFS)[number]; debut: number; rang: number }) {
  const p = useRessort(debut, { damping: 16, stiffness: 170 });
  const frame = useCurrentFrame();
  if (frame < debut) return null;
  return (
    <div style={{ position: "absolute", right: 56, top: 120 + rang * 112, width: 520, transform: `translateX(${(1 - p) * 600}px)`, transition: "none", ...carte, borderRadius: 18, padding: "18px 22px", display: "flex", gap: 16, alignItems: "center", boxShadow: "0 14px 40px rgba(34,30,24,.18)" }}>
      <div style={{ width: 52, height: 52, borderRadius: 14, background: C.fond2, display: "grid", placeItems: "center", flex: "none" }}><Icone nom={n.icone} taille={28} couleur={C.encre2} /></div>
      <div style={{ minWidth: 0 }}>
        <div style={{ font: `600 22px/1.2 ${TEXTE}` }}>{n.titre} <span style={{ fontWeight: 400, color: C.encre3, fontSize: 18 }}>· maintenant</span></div>
        <div style={{ font: `400 22px/1.3 ${TEXTE}`, color: C.encre2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.texte}</div>
      </div>
    </div>
  );
}

export const Probleme: React.FC<SceneProps> = ({ s }) => {
  const frame = useCurrentFrame();
  const r = s.reperes;
  const notifsDebut = [r.notif1, r.notif2, r.notif3, r.notif4, r.notif5, r.notif6];
  const nbOnglets = Math.min(ONGLETS.length, 4 + Math.floor(frame / 7));
  const gel = entre(frame, r.gel, r.gel + 14);
  const tremble = (1 - gel) * Math.min(1, frame / 90);
  const dx = Math.sin(frame * 1.9) * 2.2 * tremble;
  const dy = Math.cos(frame * 2.3) * 1.6 * tremble;
  const ligne1 = useRessort(r.gel + 4);
  const ligne2 = useRessort(r.chef);
  const visibles = notifsDebut.filter((d) => frame >= d).length;

  return (
    <FonduScene duree={s.duree} entree={6} sortie={10}>
      <div style={{ position: "absolute", inset: 0, transform: `translate(${dx}px, ${dy}px)`, filter: `saturate(${1 - gel * 0.8}) blur(${gel * 5}px)` }}>
        {/* La fenêtre et sa barre d'onglets qui déborde */}
        <div style={{ position: "absolute", left: 48, top: 36, right: 48, bottom: 150, ...carte, borderRadius: 20, overflow: "hidden", background: C.fond }}>
          <div style={{ height: 64, background: C.fond3, display: "flex", alignItems: "flex-end", gap: 4, padding: "0 14px", overflow: "hidden" }}>
            {ONGLETS.slice(0, nbOnglets).map((o, i) => (
              <div key={o} style={{ flex: "1 1 0", minWidth: 0, height: 48, borderRadius: "12px 12px 0 0", background: i === nbOnglets - 1 ? C.surface : C.fond2, padding: "0 14px", display: "flex", alignItems: "center", gap: 8, font: `500 19px/1 ${TEXTE}`, color: C.encre2, whiteSpace: "nowrap", overflow: "hidden" }}>
                <Point couleur={i % 3 === 0 ? C.signal : C.encre3} taille={9} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{o}</span>
              </div>
            ))}
          </div>
          {/* Trois agents qui attendent */}
          <div style={{ position: "absolute", left: 40, top: 110, right: 640, display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ font: `500 20px/1 ${MONO}`, letterSpacing: "0.16em", color: C.encre2, opacity: entre(frame, r.agents - 40, r.agents - 30) }}>FILS EN ATTENTE · {Math.min(3, Math.max(0, Math.floor((frame - r.agents) / 6) + 1))}</div>
            {AGENTS.map((a, i) => {
              const debut = r.agents + i * 6;
              const pulse = 0.55 + 0.45 * Math.sin((frame - debut) / 4);
              return frame >= debut - 40 ? (
                <AgentCarte key={a.nom} a={a} debut={debut - 40 + i * 2} attente={frame >= debut} pulse={pulse} />
              ) : null;
            })}
          </div>
          <div style={{ position: "absolute", left: 40, right: 640, top: 640, display: "flex", gap: 20 }}>
            {CONVERSATIONS.map((c, i) => (
              <MiniFenetre key={c.titre} c={c} debut={40 + i * 22} />
            ))}
          </div>
        </div>
        {NOTIFS.map((n, i) => {
          const rang = visibles - 1 - i;
          return rang >= 0 ? <Notification key={i} n={n} debut={notifsDebut[i]} rang={Math.min(rang, 5)} /> : null;
        })}
      </div>
      {/* Le constat */}
      <div style={{ position: "absolute", inset: 0, background: `rgba(244, 239, 230, ${gel * 0.82})`, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 26, paddingBottom: 140 }}>
        <div style={{ font: `600 86px/1.1 ${SERIF}`, color: C.encre, opacity: ligne1, transform: `translateY(${(1 - ligne1) * 26}px)` }}>Tu ne manques pas d'outils.</div>
        <div style={{ font: `600 86px/1.1 ${SERIF}`, color: C.encre, opacity: ligne2, transform: `translateY(${(1 - ligne2) * 26}px)` }}>
          Tu manques d'un <span style={{ color: "#D9480F" }}>chef d'orchestre</span>.
        </div>
      </div>
    </FonduScene>
  );
};

function AgentCarte({ a, debut, attente, pulse }: { a: (typeof AGENTS)[number]; debut: number; attente: boolean; pulse: number }) {
  const p = useRessort(debut);
  return (
    <div style={{ ...carte, padding: "22px 26px", opacity: p, transform: `translateY(${(1 - p) * 30}px)`, borderColor: attente ? "rgba(242,84,27,.55)" : C.filet }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Icone nom="agent" taille={30} couleur={C.encre2} />
        <span style={{ font: `600 26px/1 ${TEXTE}` }}>{a.nom}</span>
        <span style={{ font: `400 20px/1 ${TEXTE}`, color: C.encre3 }}>· {a.projet}</span>
        {attente ? (
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, font: `500 18px/1 ${MONO}`, letterSpacing: "0.1em", color: C.signalTexte }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: C.signal, opacity: pulse }} />ATTEND TA RÉPONSE
          </span>
        ) : null}
      </div>
      <div style={{ font: `400 24px/1.4 ${TEXTE}`, color: C.encre2, marginTop: 12 }}>« {a.dernier} »</div>
    </div>
  );
}

function MiniFenetre({ c, debut }: { c: (typeof CONVERSATIONS)[number]; debut: number }) {
  const p = useRessort(debut, { damping: 15 });
  return (
    <div style={{ flex: 1, ...carte, padding: "18px 22px", opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 40}px) rotate(${(1 - p) * 3}deg)` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, font: `500 17px/1 ${MONO}`, letterSpacing: "0.1em", color: C.encre3, textTransform: "uppercase" }}><Icone nom="bulle" taille={20} couleur={C.encre3} />{c.app}</div>
      <div style={{ font: `600 24px/1.25 ${TEXTE}`, marginTop: 12 }}>{c.titre}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, font: `400 20px/1.3 ${TEXTE}`, color: C.signalTexte, marginTop: 8 }}><Point taille={8} />{c.etat}</div>
    </div>
  );
}
