// La palette de commandes (Ctrl+K) : aller à une vue, noter, ouvrir une
// conversation, une liste, un dossier, un réglage. ↑ ↓ pour choisir, Entrée
// pour lancer, Échap pour fermer. Rien n'est envoyé à la tour en tapant : les
// listes sont lues une fois à l'ouverture.
import { api, sait } from "./api.js";
import { h, vider, icone, appliquerTheme, local } from "./ui.js";

const ORDRE = ["Aller à", "Actions", "Listes", "Dossiers", "Conversations", "Réglages"];
const plier = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export async function ouvrir({ contexte, vues, vueCourante }) {
  if (document.querySelector("dialog.palette")) return;
  const champ = h("input", { class: "champ", type: "text", placeholder: "Aller à, noter, chercher un fil, un réglage…", "aria-label": "Commande", role: "combobox", "aria-expanded": "true", "aria-controls": "palette-liste", autocomplete: "off" });
  const liste = h("ul", { class: "palette-liste", id: "palette-liste", role: "listbox" });
  const d = h("dialog", { class: "feuille palette", "aria-label": "Palette de commandes" }, h("div", { class: "palette-champ" }, champ), liste);
  document.body.append(d);
  d.showModal();
  champ.focus();
  const fermer = () => {
    if (d.open) d.close();
    d.remove();
  };
  d.addEventListener("close", () => d.remove());
  d.addEventListener("click", (e) => {
    if (e.target === d) fermer();
  });

  const aller = (r) => () => contexte.aller(r);
  const base = [
    ...vues.map((v, i) => ({ groupe: "Aller à", titre: v.titre, icone: v.icone, detail: `Ctrl ${i + 1}`, faire: aller(v.id) })),
    { groupe: "Actions", titre: "Noter quelque chose", icone: "plus", detail: "N", faire: () => contexte.noter() },
    { groupe: "Actions", titre: "Nouvelle conversation", icone: "remy", faire: aller("remy/nouvelle") },
    { groupe: "Actions", titre: "Nouvelle conversation privée", icone: "cadenas", faire: () => { try { localStorage.setItem("remy-nouvelle-privee", "true"); } catch {} contexte.aller("remy/nouvelle"); } },
    { groupe: "Actions", titre: "Rafraîchir la vue", icone: "rafraichir", faire: () => vueCourante()?.module?.actualiser?.() },
    { groupe: "Actions", titre: "Rappels", icone: "cloche", faire: aller("projets/rappels") },
    // Les feuilles d'Aujourd'hui (#/aujourdhui/<quoi>, contrat B) et la journée préparée pour Rémy (contrat C).
    { groupe: "Actions", titre: "À voir avec Rémy", icone: "remy", mots: "boîte sujets nuit", faire: aller("aujourdhui/boite") },
    sait("rituel-v1") ? { groupe: "Actions", titre: "Briefing du matin", icone: "soleil", mots: "rituel matin", faire: aller("aujourdhui/briefing") } : null,
    sait("rituel-v1") ? { groupe: "Actions", titre: "Bilan du soir", icone: "lune", mots: "rituel soir", faire: aller("aujourdhui/bilan") } : null,
    sait("a-trancher-v1") ? { groupe: "Actions", titre: "À trancher", icone: "liste", mots: "trier tri ménage", faire: aller("aujourdhui/trancher") } : null,
    sait("a-trancher-v1") ? { groupe: "Actions", titre: "Revue de la semaine", icone: "calendrier", mots: "dimanche hebdo", faire: aller("aujourdhui/revue") } : null,
    sait("semaine-v1") ? { groupe: "Actions", titre: "Les 7 jours à l'échelle", icone: "horloge", mots: "semaine demain échelle", faire: aller("aujourdhui/echelle/7jours") } : null,
    { groupe: "Actions", titre: "Organiser ma journée avec Rémy", icone: "remy", mots: "journée planning organiser", faire: organiserLaJournee(contexte) },
    { groupe: "Actions", titre: "Thème clair", icone: "soleil", faire: () => appliquerTheme("light") },
    { groupe: "Actions", titre: "Thème sombre", icone: "lune", faire: () => appliquerTheme("dark") },
    { groupe: "Actions", titre: "Thème automatique", icone: "ecran", faire: () => appliquerTheme("auto") },
    { groupe: "Actions", titre: "Raccourcis clavier", icone: "clavier", detail: "?", faire: () => import("./main.js").then((m) => m.aideRaccourcis()) },
    { groupe: "Actions", titre: "Interface classique", icone: "externe", faire: () => { location.href = "/classique.html"; } },
  ].filter(Boolean);
  // Une souris immobile ne vole pas le choix du clavier : le navigateur
  // envoie un mousemove quand la liste se redessine sous le pointeur.
  let pointeur = null;
  const vraiMouvement = (ev) => {
    const avant = pointeur;
    pointeur = `${ev.screenX},${ev.screenY}`;
    return avant !== null && avant !== pointeur;
  };
  let elements = [...base];
  let choisi = 0;
  let affiches = [];
  // Le groupe Réglages : le même classement que la recherche de Réglages
  // (rechercherReglages : accents, ordre des mots, fautes de frappe), limité
  // à ce que la tour propose (indexVisible).
  let reglagesModule = null;

  const dessiner = () => {
    const q = plier(champ.value.trim());
    const mots = q.split(/\s+/).filter(Boolean);
    affiches = elements
      .map((e) => {
        const t = plier(`${e.titre} ${e.mots || ""}`);
        if (mots.length && !mots.every((m) => t.includes(m))) return null;
        const titre = plier(e.titre);
        const score = !mots.length ? 0 : titre === q ? 3 : titre.startsWith(mots[0]) ? 2 : t.includes(` ${mots[0]}`) ? 1 : 0;
        return { e, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || ORDRE.indexOf(a.e.groupe) - ORDRE.indexOf(b.e.groupe))
      .slice(0, 40)
      .map((x) => x.e);
    if (!mots.length) affiches = affiches.filter((e) => e.groupe === "Aller à" || e.groupe === "Actions");
    else if (reglagesModule?.rechercherReglages) {
      affiches.push(...reglagesModule.rechercherReglages(champ.value, contexte).slice(0, 8)
        .map((r) => ({ groupe: "Réglages", titre: r.titre, icone: "reglages", detail: r.chemin === "Réglages" ? null : r.chemin.replace(/^Réglages › /, ""), faire: r.faire })));
    }
    choisi = Math.min(choisi, Math.max(0, affiches.length - 1));
    if (!affiches.length) {
      vider(liste, h("li", { class: "palette-vide" }, `Rien pour « ${champ.value} ». Entrée : noter ce texte.`));
      return;
    }
    let groupe = null;
    vider(liste, affiches.flatMap((e, i) => {
      const lignes = [];
      if (e.groupe !== groupe) {
        groupe = e.groupe;
        lignes.push(h("li", { class: "palette-groupe", role: "presentation" }, groupe));
      }
      lignes.push(h("li", { class: "palette-item", role: "option", id: `palette-${i}`, "aria-selected": String(i === choisi), onclick: () => lancer(i), onmousemove: (ev) => { if (vraiMouvement(ev) && choisi !== i) { choisi = i; majChoix(); } } },
        icone(e.icone || "fleche"), h("span", null, e.titre), e.detail ? h("span", { class: "detail" }, e.detail) : null));
      return lignes;
    }));
    champ.setAttribute("aria-activedescendant", `palette-${choisi}`);
  };
  const majChoix = () => {
    for (const li of liste.querySelectorAll(".palette-item")) li.setAttribute("aria-selected", String(li.id === `palette-${choisi}`));
    champ.setAttribute("aria-activedescendant", `palette-${choisi}`);
    liste.querySelector(`#palette-${choisi}`)?.scrollIntoView({ block: "nearest" });
  };
  const lancer = (i) => {
    const e = affiches[i];
    fermer();
    if (e) e.faire();
    else if (champ.value.trim()) contexte.noter(champ.value.trim());
  };
  champ.addEventListener("input", () => {
    choisi = 0;
    dessiner();
  });
  champ.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      choisi = Math.min(affiches.length - 1, choisi + 1);
      majChoix();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      choisi = Math.max(0, choisi - 1);
      majChoix();
    } else if (e.key === "Enter") {
      e.preventDefault();
      lancer(choisi);
    }
  });
  dessiner();

  // Ce qui se cherche par son nom : conversations, listes, dossiers, réglages.
  // Recherche web, secours, circuits : la tour dit s'ils existent ; lus ici
  // quand Réglages n'a pas encore été ouvert (un échec n'enlève que ces lignes).
  const [convs, listes, dossiers, reglages] = await Promise.allSettled([
    api("/api/conversations", { delai: 8000 }),
    api("/api/listes", { delai: 8000 }),
    api("/api/dossiers", { delai: 8000 }),
    import("./vues/reglages.js").then(async (m) => {
      await m.prechargerReglages?.().catch(() => {});
      return m;
    }),
  ]);
  if (!d.isConnected) return;
  if (convs.status === "fulfilled" && Array.isArray(convs.value)) {
    elements.push(...convs.value.slice(0, 200).map((c) => ({ groupe: "Conversations", titre: c.title || "Sans titre", icone: c.prive ? "cadenas" : "remy", faire: aller(`remy/${encodeURIComponent(c.id)}`) })));
  }
  if (listes.status === "fulfilled") elements.push(...(listes.value.listes || []).map((l) => ({ groupe: "Listes", titre: l.nom, icone: "liste", mots: "liste", faire: aller(`projets/liste/${encodeURIComponent(l.id)}`) })));
  if (dossiers.status === "fulfilled") elements.push(...(dossiers.value.dossiers || []).map((x) => ({ groupe: "Dossiers", titre: x.nom, icone: "dossier", mots: "dossier projet", faire: aller(`projets/dossier/${encodeURIComponent(x.id)}`) })));
  if (reglages.status === "fulfilled") reglagesModule = reglages.value;
  dessiner();
}

/**
 * « Organiser ma journée avec Rémy » : le clic est le geste, la question part
 * dans une conversation neuve titrée « JJ/MM/AAAA · Journée » (contrat C).
 */
function organiserLaJournee(contexte) {
  return () => {
    const d = new Date();
    const titre = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} · Journée`;
    local.ecrire("remy-envoi", { texte: "Organise ma journée : regarde mon agenda et mes tâches, dis-moi par quoi commencer et ce qui est en retard. Pose tes questions d'un coup si tu en as.", a: Date.now(), titre });
    contexte.aller("remy/nouvelle");
  };
}
