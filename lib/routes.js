// Table de routage unique de l'API, partagée entre le serveur local (server.js)
// et la fonction Vercel attrape-tout (api/[...slug].js). Une seule fonction
// serverless : le plan Vercel Hobby en limite le nombre à 12 par déploiement.

import * as h from "./handlers.js";
import * as hc from "./connaissances/handlers.js";
import { reparerRequete, sendJSON } from "./http.js";
import { controlerApp, infosVersion } from "./version.js";
import { estAutorise } from "./auth.js";
import { noterIncident } from "./incidents.js";

// La promesse du handler est ATTENDUE : avant, `return h.x(req, res), true`
// la laissait filer, et une erreur devenait un rejet non géré qui arrêtait
// le serveur (la tâche planifiée le relançait une minute plus tard, en
// laissant l'action à moitié faite et le client sans réponse).
const fini = async (promesse) => {
  await promesse;
  return true;
};

// Renvoie true si la requête a été prise en charge. Une erreur ne quitte
// jamais cette fonction : elle devient une réponse claire, et le serveur
// continue de tourner.
export async function routeApi(req, res) {
  try {
    return await aiguiller(req, res);
  } catch (err) {
    console.error(err);
    // Un code à transmettre (lib/incidents.js) ; le chemin sans sa requête
    // (« ?q=… » peut porter ce que Sam cherchait).
    const route = `${req.method} ${String(req.url || "").split("?")[0].slice(0, 120)}`;
    const code = noterIncident({ type: "route", route, erreur: err });
    if (!res.headersSent) {
      // Une base illisible n'est pas « une erreur serveur » de plus : Sam
      // doit savoir laquelle, et que rien n'a été écrasé.
      if (err.code === "BASE_ILLISIBLE") sendJSON(res, 503, { error: "base_illisible", message: err.message, code });
      else sendJSON(res, 500, { error: "Erreur serveur", code });
    } else if (!res.writableEnded) {
      res.end();
    }
    return true;
  }
}

async function aiguiller(req, res) {
  reparerRequete(req);
  const url = new URL(req.url, `http://${req.headers.host || "local"}`);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api") return false;
  const m = req.method;

  // Version : toujours servie, même à une app trop ancienne (c'est ce qui lui
  // permet de dire « mets-moi à jour »).
  // Sans session : de quoi savoir si l'app est trop ancienne, rien de plus
  // (ni version exacte ni commit, comme /api/health).
  if (parts[1] === "version" && parts.length === 2 && m === "GET") {
    const v = infosVersion();
    return sendJSON(res, 200, estAutorise(req) ? v : { api: v.api, appMin: v.appMin }), true;
  }
  const tropAncienne = controlerApp(req);
  if (tropAncienne) return sendJSON(res, 426, tropAncienne), true;

  if (parts[1] === "login" && m === "POST") return fini(h.login(req, res));
  if (parts[1] === "logout" && m === "POST") return fini(h.logout(req, res));

  if (parts[1] === "memory" && parts.length === 2) {
    if (m === "GET") return fini(h.getMemory(req, res));
    if (m === "PUT") return fini(h.putMemory(req, res));
  }
  if (parts[1] === "costs" && m === "GET") return fini(h.getCosts(req, res));
  if (parts[1] === "appareils") {
    if (parts.length === 2 && m === "GET") return fini(h.getAppareils(req, res));
    if (parts.length === 2 && m === "POST") return fini(h.postAppareil(req, res));
    if (parts.length === 3 && m === "DELETE") return fini(h.deleteAppareil(req, res, parts[2]));
  }
  if (parts[1] === "modeles" && parts.length === 2) {
    if (m === "GET") return fini(h.getModeles(req, res));
    if (m === "PUT") return fini(h.putModeles(req, res));
  }
  if (parts[1] === "reglages" && parts.length === 2) {
    if (m === "GET") return fini(h.getReglagesHandler(req, res));
    if (m === "PUT") return fini(h.putReglagesHandler(req, res));
  }
  if (parts[1] === "briefing" && parts.length === 2 && m === "GET") return fini(h.getBriefing(req, res));
  if (parts[1] === "briefing" && parts[2] === "etat" && parts.length === 3 && m === "PUT") {
    return fini(h.setBriefingEtat(req, res));
  }
  if (parts[1] === "rituel" && parts.length === 2 && m === "GET") return fini(h.getRituel(req, res));
  if (parts[1] === "rituel" && parts[2] === "bilan" && parts.length === 3 && m === "POST") return fini(h.postBilanSoir(req, res));
  if (parts[1] === "today" && m === "GET") return fini(h.getToday(req, res));
  if (parts[1] === "dashboard" && parts.length === 2 && m === "GET") return fini(h.getDashboard(req, res));
  if (parts[1] === "reflection-focus" && parts.length === 2) {
    if (m === "GET") return fini(h.getReflectionFocusState(req, res));
    if (m === "PUT") return fini(h.putReflectionFocusState(req, res));
  }
  if (parts[1] === "projets" && parts.length === 2 && m === "GET") return fini(h.getProjets(req, res));
  if (parts[1] === "mesures" && parts.length === 2 && m === "GET") return fini(h.getMesures(req, res));
  if (parts[1] === "lieux") {
    if (parts.length === 2 && m === "GET") return fini(h.getLieux(req, res));
    if (parts.length === 2 && m === "POST") return fini(h.changerLieu(req, res));
    if (parts.length === 3 && parts[2] === "evenements" && m === "POST") return fini(h.postEvenementsLieux(req, res));
    if (parts.length === 3 && (m === "PATCH" || m === "DELETE")) return fini(h.changerLieu(req, res, parts[2]));
  }
  if (parts[1] === "regles") {
    if (parts.length === 2 && m === "GET") return fini(h.getRegles(req, res));
    if (parts.length === 3 && parts[2] === "verifier" && m === "POST") return fini(h.verifierReglesHandler(req, res));
    if (parts.length === 3 && (m === "PATCH" || m === "DELETE")) return fini(h.changerRegle(req, res, parts[2]));
  }
  if (parts[1] === "incidents" && m === "GET") {
    if (parts.length === 2) return fini(h.getIncidents(req, res));
    if (parts.length === 3) return fini(h.getIncident(req, res, parts[2]));
  }
  if (parts[1] === "conseil" && parts.length === 2 && m === "GET") return fini(h.getConseil(req, res));
  if (parts[1] === "conseil" && parts[2] === "renouveler" && parts.length === 3 && m === "POST") return fini(h.postConseilRenouveler(req, res));
  if (parts[1] === "listes") {
    if (parts.length === 2 && m === "GET") return fini(h.getListes(req, res));
    if (parts.length === 3 && m === "PUT") return fini(h.putListe(req, res, parts[2]));
    if (parts.length === 3 && m === "DELETE") return fini(h.deleteListe(req, res, parts[2]));
    if (parts.length === 4 && parts[3] === "elements" && m === "POST") return fini(h.postElements(req, res, parts[2]));
    if (parts.length === 5 && parts[3] === "elements" && m === "PUT") return fini(h.putElement(req, res, parts[2], parts[4]));
    if (parts.length === 5 && parts[3] === "elements" && m === "DELETE") return fini(h.deleteElement(req, res, parts[2], parts[4]));
  }
  if (parts[1] === "rappels") {
    if (parts.length === 3 && parts[2] === "analyser" && m === "POST") return fini(h.postAnalyserRappels(req, res));
    if (parts.length === 2 && m === "GET") return fini(h.getRappels(req, res));
    if (parts.length === 2 && m === "POST") return fini(h.postRappels(req, res));
    if (parts.length === 3 && m === "PUT") return fini(h.putRappel(req, res, parts[2]));
    if (parts.length === 3 && m === "DELETE") return fini(h.deleteRappel(req, res, parts[2]));
  }
  if (parts[1] === "taches" && parts[3] === "etat" && parts.length === 4 && m === "PUT") {
    return fini(h.putEtatTache(req, res, parts[2]));
  }
  if (parts[1] === "taches" && parts[3] === "etiquettes" && parts.length === 4 && m === "PUT") {
    return fini(h.putCategoriesTache(req, res, parts[2]));
  }
  if (parts[1] === "etiquettes") {
    if (parts.length === 2 && m === "GET") return fini(h.getEtiquettes(req, res));
    if (parts.length === 3 && m === "PUT") return fini(h.putEtiquette(req, res, parts[2]));
    if (parts.length === 3 && m === "DELETE") return fini(h.deleteEtiquette(req, res, parts[2]));
  }
  if (parts[1] === "dossiers") {
    if (parts.length === 2 && m === "GET") return fini(h.getDossiers(req, res));
    if (parts.length === 3 && m === "PUT") return fini(h.putDossier(req, res, parts[2]));
    if (parts.length === 3 && m === "DELETE") return fini(h.deleteDossier(req, res, parts[2]));
    if (parts.length === 4 && parts[3] === "notes" && m === "POST") return fini(h.postNotes(req, res, parts[2]));
    if (parts.length === 5 && parts[3] === "notes" && m === "DELETE") return fini(h.deleteNote(req, res, parts[2], parts[4]));
  }
  if (parts[1] === "rattachements" && parts.length === 3 && m === "PUT") return fini(h.putRattachement(req, res, parts[2]));
  if (parts[1] === "historique" && parts.length === 2 && m === "GET") return fini(h.getHistorique(req, res));
  if (parts[1] === "capture" && parts[2] === "analyser" && parts.length === 3 && m === "POST") return fini(h.postAnalyserCapture(req, res));
  if (parts[1] === "capture" && parts[2] === "extraire" && parts.length === 3 && m === "POST") return fini(h.postExtraireCapture(req, res));
  if (parts[1] === "motion" && parts.length === 3) {
    if (parts[2] === "apply" && m === "POST") return fini(h.applyMotion(req, res));
    if (parts[2] === "undo" && m === "POST") return fini(h.undoMotion(req, res));
    if (parts[2] === "ledger" && m === "GET") return fini(h.getLedger(req, res));
  }
  if (parts[1] === "reflection-suggest" && parts.length === 2) {
    if (m === "GET") return fini(h.getSuggestState(req, res));
    if (m === "POST") return fini(h.postSuggest(req, res));
  }
  if (parts[1] === "setup" && parts.length === 2) {
    if (m === "GET") return fini(h.getSetupState(req, res));
    if (m === "PUT") return fini(h.putSetupState(req, res));
  }
  if (parts[1] === "setup" && parts[2] === "analyse" && parts.length === 3 && m === "POST") {
    return fini(h.analyseOnboarding(req, res));
  }
  if (parts[1] === "setup" && parts[2] === "couverture" && parts.length === 4 && m === "DELETE") {
    return fini(h.viderCouvertureSection(req, res, parts[3]));
  }
  if (parts[1] === "google" && parts.length === 3) {
    // callback : c'est le navigateur qui revient de Google, en GET, sans session
    // d'app — l'authentification se fait par le `state` signé.
    if (parts[2] === "callback" && m === "GET") return fini(h.googleCallback(req, res));
    if (parts[2] === "status" && m === "GET") return fini(h.googleStatus(req, res));
    if (parts[2] === "auth" && m === "POST") return fini(h.googleAuth(req, res));
    if (parts[2] === "deconnexion" && m === "POST") return fini(h.googleDeconnexion(req, res));
    if (parts[2] === "apply" && m === "POST") return fini(h.applyAgenda(req, res));
    if (parts[2] === "undo" && m === "POST") return fini(h.undoAgenda(req, res));
    if (parts[2] === "test" && m === "POST") return fini(h.testerAgenda(req, res));
  }
  if (parts[1] === "import" && parts.length === 2 && m === "POST") return fini(h.importerConversations(req, res));
  // Mémoire de projets (lot B) : lecture seule des sessions Claude Code.
  if (parts[1] === "connaissances") {
    if (parts.length === 2 && m === "GET") return fini(hc.etat(req, res));
    if (parts[2] === "sources" && parts.length === 3 && m === "PUT") return fini(hc.reglerSources(req, res));
    if (parts[2] === "sources" && parts.length === 4 && m === "DELETE") return fini(hc.purger(req, res, parts[3]));
    if (parts[2] === "synchroniser" && parts.length === 3 && m === "POST") return fini(hc.synchroniser(req, res));
    if (parts[2] === "chercher" && parts.length === 3 && m === "GET") return fini(hc.chercher(req, res));
  }
  if (parts[1] === "capture" && parts.length === 2) {
    // POST : la seule route de l'app qui accepte AUSSI un jeton porteur (le
    // raccourci iPhone ne peut pas envoyer de cookie de session).
    if (m === "POST") return fini(h.capturer(req, res));
    if (m === "GET") return fini(h.listerCaptures(req, res));
  }
  if (parts[1] === "capture" && parts[2] === "jeton" && parts.length === 3) {
    if (m === "GET") return fini(h.etatJetonCapture(req, res));
    if (m === "POST") return fini(h.creerJetonCapture(req, res));
    if (m === "DELETE") return fini(h.supprimerJetonCapture(req, res));
  }
  if (parts[1] === "activite" && parts.length === 2 && m === "GET") return fini(h.getActivite(req, res));
  if (parts[1] === "activite" && parts[2] === "ping" && parts.length === 3 && m === "POST") {
    return fini(h.pingActivite(req, res));
  }
  if (parts[1] === "roadmap" && m === "GET") return fini(h.getRoadmap(req, res));
  if (parts[1] === "hash" && m === "POST") return fini(h.hashPassword(req, res));
  if (parts[1] === "health" && m === "GET") return fini(h.health(req, res));
  if (parts[1] === "export" && parts.length === 2 && m === "GET") return fini(h.exporter(req, res));
  if (parts[1] === "dictee" && parts[2] === "correction" && parts.length === 3 && m === "POST") {
    return fini(h.postCorrectionDictee(req, res));
  }
  if (parts[1] === "transcribe" && parts.length === 2) {
    if (m === "GET") return fini(h.transcribeProbe(req, res));
    if (m === "POST") return fini(h.transcribeAudio(req, res));
  }
  if (parts[1] === "jobs" && parts[2] === "reflection" && (m === "GET" || m === "POST")) {
    return fini(h.reflectionJob(req, res));
  }

  if (parts[1] === "conversations") {
    if (parts.length === 2) {
      if (m === "GET") return fini(h.listConversations(req, res));
      if (m === "POST") return fini(h.createConversation(req, res));
    }
    if (parts.length === 3) {
      if (m === "GET") return fini(h.getConversation(req, res, parts[2]));
      if (m === "PATCH") return fini(h.renameConversation(req, res, parts[2]));
      if (m === "DELETE") return fini(h.deleteConversation(req, res, parts[2]));
    }
    if (parts.length === 4 && parts[3] === "messages" && m === "POST") {
      return fini(h.postMessage(req, res, parts[2]));
    }
    if (parts.length === 5 && parts[3] === "autorisations" && m === "POST") {
      return fini(h.repondreAutorisation(req, res, parts[2], parts[4]));
    }
    if (parts.length === 6 && parts[3] === "propositions" && parts[5] === "refus" && m === "POST") {
      return fini(h.refuserProposition(req, res, parts[2], parts[4]));
    }
    if (parts.length === 6 && parts[3] === "propositions" && parts[5] === "ajuster" && m === "POST") {
      return fini(h.ajusterProposition(req, res, parts[2], parts[4]));
    }
    if (parts.length === 6 && parts[3] === "propositions" && parts[5] === "regle" && m === "POST") {
      return fini(h.validerRegleProposee(req, res, parts[2], parts[4]));
    }
    if (parts.length === 4 && parts[3] === "stop" && m === "POST") {
      return fini(h.stopConversation(req, res, parts[2]));
    }
    if (parts.length === 4 && parts[3] === "compacter" && m === "POST") {
      return fini(h.compacterConversation(req, res, parts[2]));
    }
  }

  return false;
}
