// Google Calendar — les RENDEZ-VOUS, que Motion ne sait pas gérer (son API
// publique n'expose que des tâches : /events et /calendar-events répondent 404).
//
// Accès direct à l'agenda de Sam, sans intermédiaire ni SDK : OAuth 2.0 et
// appels REST. Aucun tiers de plus dans la boucle — c'est son compte Google,
// son calendrier, son serveur.
//
// Même contrat de sécurité que Motion : le modèle PROPOSE, il n'écrit jamais.
// L'écriture vit ici, déclenchée par un appel authentifié et de même origine
// que déclenche un tap de Sam. Tout est annulable.

import { getGoogleToken, putGoogleToken, deleteGoogleToken } from "./store.js";
import { exigerBacASable } from "./bac-a-sable.js";
import { encadrer, ligneTierce } from "./encadrement.js";

const AUTH = process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const API = process.env.GOOGLE_API_URL || "https://www.googleapis.com/calendar/v3";

const REVOKE = process.env.GOOGLE_REVOKE_URL || "https://oauth2.googleapis.com/revoke";

// Le strict nécessaire : lire et écrire des ÉVÉNEMENTS. Pas la gestion des
// calendriers, pas les contacts, pas Gmail.
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

const AGENDA = process.env.GOOGLE_CALENDAR_ID || "primary";
const CACHE_MS = 5 * 60 * 1000;
let cache = { at: 0, text: "" };

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export async function googleConnecte() {
  if (!googleConfigured()) return false;
  return Boolean((await getGoogleToken())?.refresh_token);
}

// L'URL de retour doit correspondre EXACTEMENT à celle déclarée dans la console
// Google, sinon l'échange du code est refusé.
export function redirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const host = req?.headers?.host || "localhost:3456";
  const proto = /^localhost|^127\./.test(host) ? "http" : "https";
  return `${proto}://${host}/api/google/callback`;
}

// `state` : jeton anti-CSRF. Sans lui, un tiers pourrait faire connecter le
// compte Google de quelqu'un d'autre à l'app de Sam.
export function urlConnexion(req, state) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline", // indispensable pour obtenir un refresh_token
    prompt: "consent", // sinon Google ne redonne pas le refresh_token
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH}?${p}`;
}

async function postToken(params) {
  exigerBacASable(TOKEN, "Google");
  let r;
  try {
    r = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      // Sans délai, un jeton qui cale bloquait toute la file d'écriture agenda.
      signal: AbortSignal.timeout(Number(process.env.GOOGLE_DELAI_MS) || 15_000),
    });
  } catch (err) {
    const delai = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new Error(delai ? "Google n'a pas répondu à temps (connexion à l'agenda) : réessaie dans un instant" : "Google injoignable pour le moment : réessaie dans un instant");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Google OAuth (${r.status}) : ${data.error_description || data.error || "échec"}`);
  }
  return data;
}

export async function echangerCode(req, code) {
  const data = await postToken({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri(req),
    grant_type: "authorization_code",
  });
  if (!data.refresh_token) {
    throw new Error("Google n'a pas rendu de jeton de rafraîchissement — révoque l'accès et reconnecte-toi.");
  }
  return putGoogleToken({
    refresh_token: data.refresh_token,
    access_token: data.access_token,
    expire_a: Date.now() + (data.expires_in || 3600) * 1000,
  });
}

export async function deconnecter() {
  const t = await getGoogleToken();
  // On révoque côté Google aussi : supprimer notre copie ne suffirait pas à
  // couper l'accès.
  if (t?.refresh_token) {
    exigerBacASable(REVOKE, "Google");
    await fetch(`${REVOKE}?token=${encodeURIComponent(t.refresh_token)}`, {
      method: "POST",
    }).catch((err) => console.warn("Révocation Google échouée :", err.message));
  }
  return deleteGoogleToken();
}

// Jeton d'accès valide, rafraîchi si besoin (ils durent une heure).
async function accessToken() {
  const t = await getGoogleToken();
  if (!t?.refresh_token) throw new Error("Google Calendar n'est pas connecté");
  if (t.access_token && t.expire_a > Date.now() + 60_000) return t.access_token;
  const data = await postToken({
    refresh_token: t.refresh_token,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  const frais = await putGoogleToken({
    ...t,
    access_token: data.access_token,
    expire_a: Date.now() + (data.expires_in || 3600) * 1000,
  });
  return frais.access_token;
}

async function api(method, path, body) {
  const jeton = await accessToken();
  exigerBacASable(API, "Google");
  let r;
  try {
    r = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jeton}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Une requête bloquée ne doit pas bloquer l'écriture suivante (Lot 0).
      signal: AbortSignal.timeout(Number(process.env.GOOGLE_DELAI_MS) || 15_000),
    });
  } catch (err) {
    const delai = err?.name === "TimeoutError" || err?.name === "AbortError";
    console.warn(`Google ${method} ${path} : ${delai ? "délai dépassé" : err?.message}`);
    throw new Error(
      method === "GET"
        ? "Google Agenda injoignable pour le moment : réessaie dans un instant"
        : "Google Agenda n'a pas répondu : la modification a peut-être été faite — vérifie ton agenda avant de réessayer",
    );
  }
  if (!r.ok) {
    // Ce que Sam lit : la cause et quoi faire (le code reste entre
    // parenthèses, il sert aussi à reconnaître un 404). Le détail : au journal.
    const detail = await r.text().catch(() => "");
    console.warn(`Google ${method} ${path} (${r.status}) : ${detail.slice(0, 300)}`);
    const quoi =
      r.status === 404 || r.status === 410
        ? "Ce rendez-vous n'existe plus dans ton agenda"
        : r.status === 401 || r.status === 403
          ? "Google refuse l'accès à ton agenda : reconnecte-le depuis l'onglet Onboarding"
          : r.status === 429
            ? "Google limite les requêtes : réessaie dans une minute"
            : r.status >= 500
              ? "Google Agenda est en panne : réessaie plus tard"
              : "Google a refusé la modification";
    throw new Error(`${quoi} (${r.status})`);
  }
  if (r.status === 204) return {};
  try {
    return await r.json();
  } catch {
    throw new Error("Google Agenda a répondu de façon incomplète : vérifie ton agenda avant de réessayer");
  }
}

// --- Lecture : ce que Rémy voit avant de répondre --------------------------------

function fmtQuand(ev) {
  const debut = ev.start?.dateTime || ev.start?.date;
  const fin = ev.end?.dateTime || ev.end?.date;
  if (!debut) return "sans date";
  if (ev.start?.date) {
    return new Date(debut).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) + " (journée)";
  }
  const d = new Date(debut);
  const f = fin ? new Date(fin) : null;
  const jour = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  const h = (x) => x.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${jour} ${h(d)}${f ? `-${h(f)}` : ""}`;
}

// Les rendez-vous des 7 prochains jours, injectés dans le contexte de Rémy : sans
// ça, il proposerait des créneaux déjà pris.
// L'agenda a-t-il pu être lu au dernier essai ? Un jeton révoqué rendait
// l'agenda VIDE en silence, et l'outil d'écriture restait proposé : Rémy
// pouvait proposer un créneau déjà pris (audit du 13/10). Sans lecture, pas
// d'écriture proposée.
let lisible = true;
export const agendaLisible = () => lisible;

export async function agendaSnapshot() {
  if (!(await googleConnecte())) return "";
  if (Date.now() - cache.at < CACHE_MS) return cache.text;
  try {
    const maintenant = new Date();
    const dans7j = new Date(maintenant.getTime() + 7 * 24 * 3600 * 1000);
    const p = new URLSearchParams({
      timeMin: maintenant.toISOString(),
      timeMax: dans7j.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "40",
    });
    const data = await api("GET", `/calendars/${encodeURIComponent(AGENDA)}/events?${p}`);
    const events = (data.items || []).filter((e) => e.status !== "cancelled");
    // Un titre d'invitation est écrit par l'expéditeur, pas par Sam : sur
    // une ligne, borné, et le bloc entier est encadré comme matière externe.
    const ligne = (e) => {
      const invite = e.organizer && !e.organizer.self ? ` (invitation de ${ligneTierce(e.organizer.displayName || e.organizer.email, 60)})` : "";
      return `- [${e.id}] « ${ligneTierce(e.summary) || "(sans titre)"} »${invite} — ${fmtQuand(e)}${e.location ? ` · ${ligneTierce(e.location, 80)}` : ""}`;
    };
    const texte = events.length
      ? `### Rendez-vous des 7 prochains jours (Google Calendar)\n` +
        encadrer(events.map(ligne).join("\n"), { source: "agenda Google (titres écrits par Sam ou par qui l'invite)" })
      : "### Google Calendar : aucun rendez-vous dans les 7 prochains jours.";
    cache = { at: Date.now(), text: texte };
    lisible = true;
    return texte;
  } catch (err) {
    console.warn("Agenda Google indisponible :", err.message);
    lisible = false;
    return "";
  }
}

// Les rendez-vous d'une journée, bruts, pour la frise du tableau de bord.
// null = agenda non connecté (ce n'est pas une erreur : l'écran le dit).
// Cache court et par journée : l'écran se rouvre souvent, l'agenda change peu.
let jourCache = { cle: "", at: 0, items: null };
export async function agendaJournee(debut, fin) {
  if (!(await googleConnecte())) return null;
  const cle = `${debut}-${fin}`;
  if (jourCache.cle === cle && Date.now() - jourCache.at < 2 * 60 * 1000) return jourCache.items;
  const p = new URLSearchParams({
    timeMin: new Date(debut).toISOString(),
    timeMax: new Date(fin).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });
  const data = await api("GET", `/calendars/${encodeURIComponent(AGENDA)}/events?${p}`);
  const items = (data.items || []).filter((e) => e.status !== "cancelled");
  jourCache = { cle, at: Date.now(), items };
  return items;
}

// --- Écriture : Rémy propose, Sam valide --------------------------------------

// `dureeParDefautMin` : pour un DÉPLACEMENT, la durée actuelle du rendez-vous
// (sans elle, déplacer un RDV de 30 min le rallongeait à 1 h — audit du 13/10).
function normDebutFin(a, dureeParDefautMin = 60) {
  if (!a.debut) throw new Error("Date de début manquante");
  const debut = new Date(a.debut);
  if (isNaN(debut)) throw new Error(`Date de début illisible : ${a.debut}`);
  let fin = a.fin ? new Date(a.fin) : null;
  if (fin && isNaN(fin)) fin = null;
  if (!fin) {
    const minutes = Number.parseInt(a.duree, 10);
    fin = new Date(debut.getTime() + (Number.isFinite(minutes) ? Math.max(5, minutes) : dureeParDefautMin) * 60_000);
  }
  if (fin <= debut) throw new Error("La fin doit être après le début");
  return { debut, fin };
}

// Deux rendez-vous identiques au même moment = un doublon, pas une intention.
// Même garde-fou que côté Motion : Sam paie chaque appel, et revalide parfois
// par réflexe quand une réponse traîne.
function cleTitre(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function memeEvenement(titre, debutISO, ev) {
  const cle = cleTitre;
  const a = cle(titre);
  const b = cle(ev.summary);
  if (!a || !b || a !== b) return false;
  const d1 = Date.parse(debutISO);
  const d2 = Date.parse(ev.start?.dateTime || ev.start?.date || "");
  return Number.isFinite(d1) && Number.isFinite(d2) && Math.abs(d1 - d2) < 60_000;
}

async function evenementsProches(debutISO) {
  const centre = Date.parse(debutISO);
  if (!Number.isFinite(centre)) return [];
  const p = new URLSearchParams({
    timeMin: new Date(centre - 12 * 3600 * 1000).toISOString(),
    timeMax: new Date(centre + 12 * 3600 * 1000).toISOString(),
    singleEvents: "true",
    maxResults: "50",
  });
  const data = await api("GET", `/calendars/${encodeURIComponent(AGENDA)}/events?${p}`);
  return (data.items || []).filter((e) => e.status !== "cancelled");
}

// Vocabulaire fermé, comme Motion : creer | modifier | supprimer.
export async function appliquerAgenda(actions) {
  if (!(await googleConnecte())) throw new Error("Google Calendar n'est pas connecté");
  const results = [];
  for (const a of (actions || []).slice(0, 12)) {
    try {
      if (a.type === "creer") {
        if (!a.titre) throw new Error("Titre manquant");
        const { debut, fin } = normDebutFin(a);
        const jumeau = (await evenementsProches(debut.toISOString())).find((e) =>
          memeEvenement(a.titre, debut.toISOString(), e),
        );
        if (jumeau) {
          results.push({
            ok: false,
            type: "creer",
            titre: String(a.titre),
            erreur: `« ${jumeau.summary} » est déjà dans ton agenda à cette heure-là — rien n'a été créé`,
            doublon: true,
          });
          continue;
        }
        const body = {
          summary: String(a.titre).slice(0, 200),
          start: { dateTime: debut.toISOString() },
          end: { dateTime: fin.toISOString() },
        };
        if (a.lieu) body.location = String(a.lieu).slice(0, 300);
        if (a.description) body.description = String(a.description).slice(0, 2000);
        const ev = await api("POST", `/calendars/${encodeURIComponent(AGENDA)}/events`, body);
        results.push({
          ok: true,
          type: "creer",
          titre: body.summary,
          eventId: ev.id,
          quand: fmtQuand(ev),
          annulable: "supprimer",
          apres: etatEvenement(ev),
        });
      } else if (a.type === "modifier" || a.type === "supprimer") {
        if (!a.id) throw new Error("Identifiant d'événement manquant");
        const avant = await api("GET", `/calendars/${encodeURIComponent(AGENDA)}/events/${encodeURIComponent(a.id)}`);
        // Sam valide ce qu'il LIT : si l'identifiant désigne autre chose que
        // le titre affiché, on refuse. Même garde-fou que pour les tâches.
        const cle = cleTitre;
        if (a.titre && cle(a.titre) !== cle(avant.summary) && !cle(avant.summary).includes(cle(a.titre))) {
          throw new Error(`Le rendez-vous visé s'appelle « ${avant.summary} », pas « ${a.titre} » — action refusée par sécurité`);
        }
        const snapshot = {
          summary: avant.summary,
          start: avant.start,
          end: avant.end,
          location: avant.location,
          description: avant.description,
        };
        if (a.type === "supprimer") {
          await api("DELETE", `/calendars/${encodeURIComponent(AGENDA)}/events/${encodeURIComponent(a.id)}`);
          results.push({ ok: true, type: "supprimer", titre: avant.summary, eventId: a.id, annulable: "restaurer", avant: snapshot });
        } else {
          const body = {};
          if (a.nouveau_titre) body.summary = String(a.nouveau_titre).slice(0, 200);
          if (a.debut) {
            const dureeActuelle = (Date.parse(avant.end?.dateTime || "") - Date.parse(avant.start?.dateTime || "")) / 60_000;
            const { debut, fin } = normDebutFin(a, Number.isFinite(dureeActuelle) && dureeActuelle > 0 ? dureeActuelle : 60);
            body.start = { dateTime: debut.toISOString() };
            body.end = { dateTime: fin.toISOString() };
          }
          if (a.lieu) body.location = String(a.lieu).slice(0, 300);
          if (!Object.keys(body).length) throw new Error("Rien à modifier");
          const ev = await api("PATCH", `/calendars/${encodeURIComponent(AGENDA)}/events/${encodeURIComponent(a.id)}`, body);
          results.push({ ok: true, type: "modifier", titre: ev.summary, eventId: a.id, quand: fmtQuand(ev), annulable: "restaurer", avant: snapshot, apres: etatEvenement(ev) });
        }
      } else {
        throw new Error(`Action inconnue : ${a.type}`);
      }
    } catch (err) {
      console.warn("Action agenda échouée :", err.message);
      results.push({ ok: false, type: a.type, titre: a.titre || a.nouveau_titre || "?", erreur: err.message });
    }
  }
  cache = { at: 0, text: "" }; // le prochain instantané reflète les changements
  jourCache = { cle: "", at: 0, items: null };
  return results;
}

// Relire un événement précis. L'instantané ne couvre que 7 jours : pour vérifier
// qu'une écriture a bien atterri, il faut aller le chercher par son identifiant.
export async function lireEvenement(id) {
  return api("GET", `/calendars/${encodeURIComponent(AGENDA)}/events/${encodeURIComponent(id)}`);
}

// Défait UNE écriture d'agenda. Une suppression annulée recrée l'événement :
// son NOUVEL identifiant est rendu, pour que le journal suive.
// L'état d'un rendez-vous réduit à ce que Rémy écrit (et donc restaure).
function etatEvenement(ev) {
  const instant = (x) => x?.dateTime || x?.date || null;
  return {
    summary: ev?.summary ?? "",
    start: instant(ev?.start),
    end: instant(ev?.end),
    location: ev?.location ?? "",
    description: ev?.description ?? "",
  };
}

// Ce que Sam a changé dans son agenda depuis l'écriture de Rémy (vide = rien).
function deriveAgenda(actuel, apres) {
  if (!apres) return [];
  const pareil = (a, b) => (a && b && !isNaN(Date.parse(a)) && !isNaN(Date.parse(b)) && /\d{4}-\d{2}-\d{2}/.test(a) ? Date.parse(a) === Date.parse(b) : (a || "") === (b || ""));
  const noms = { summary: "titre", start: "début", end: "fin", location: "lieu", description: "description" };
  return Object.keys(noms).filter((k) => k in apres && !pareil(apres[k], actuel[k])).map((k) => noms[k]);
}

export async function annulerResultatAgenda(r) {
  if (!r?.ok) return { ok: true, titre: r?.titre, refait: "rien à défaire" };
  try {
    // Comme pour Motion : un rendez-vous retouché par Sam depuis n'est ni
    // supprimé ni écrasé (conflit dit). Seulement pour les écritures qui ont
    // gardé leur état « après » (Lot 0).
    if (r.apres && r.eventId && r.type !== "supprimer") {
      let actuel = null;
      try {
        actuel = etatEvenement(await api("GET", `/calendars/${encodeURIComponent(AGENDA)}/events/${encodeURIComponent(r.eventId)}`));
      } catch (err) {
        if (!/\(4(04|10)\)/.test(err.message)) throw err;
        if (r.annulable === "supprimer") return { ok: true, titre: r.titre, refait: "déjà supprimé" };
        return { ok: false, titre: r.titre, erreur: "Le rendez-vous n'existe plus : rien à restaurer", type: "supprimee" };
      }
      const bouge = deriveAgenda(actuel, r.apres);
      if (bouge.length) {
        return { ok: false, conflit: true, titre: r.titre, erreur: `Modifié dans ton agenda depuis (${bouge.join(", ")}) : rien n'est écrasé, à toi de voir`, type: "conflit" };
      }
    }
    if (r.annulable === "supprimer" && r.eventId) {
      try {
        await api("DELETE", `/calendars/${encodeURIComponent(AGENDA)}/events/${encodeURIComponent(r.eventId)}`);
      } catch (err) {
        if (!/\(4(04|10)\)/.test(err.message)) throw err; // déjà supprimé : l'état voulu
      }
      return { ok: true, titre: r.titre, refait: "supprimé" };
    }
    if (r.annulable === "restaurer" && r.avant) {
      if (r.type === "supprimer") {
        const ev = await api("POST", `/calendars/${encodeURIComponent(AGENDA)}/events`, r.avant);
        return { ok: true, titre: r.titre, refait: "recréé", eventId: ev.id };
      }
      // On repose aussi le lieu et la description d'avant, même vides : un
      // lieu ajouté par Rémy ne doit pas rester.
      await api("PATCH", `/calendars/${encodeURIComponent(AGENDA)}/events/${encodeURIComponent(r.eventId)}`, {
        ...r.avant,
        location: r.avant.location ?? "",
        description: r.avant.description ?? "",
      });
      return { ok: true, titre: r.titre, refait: "restauré" };
    }
    return { ok: false, titre: r.titre, erreur: "Rien pour restaurer cette action" };
  } catch (err) {
    console.warn("Annulation agenda échouée :", err.message);
    return { ok: false, titre: r.titre, erreur: err.message };
  } finally {
    cache = { at: 0, text: "" };
    jourCache = { cle: "", at: 0, items: null };
  }
}

// Annulation : on défait dans l'ordre inverse, comme pour Motion.
export async function annulerAgenda(results) {
  const out = [];
  for (const r of [...(results || [])].reverse()) {
    if (!r.ok) continue;
    try {
      if (r.annulable === "supprimer" && r.eventId) {
        await api("DELETE", `/calendars/${encodeURIComponent(AGENDA)}/events/${encodeURIComponent(r.eventId)}`);
        out.push({ ok: true, titre: r.titre, refait: "supprimé" });
      } else if (r.annulable === "restaurer" && r.avant) {
        if (r.type === "supprimer") {
          const ev = await api("POST", `/calendars/${encodeURIComponent(AGENDA)}/events`, r.avant);
          out.push({ ok: true, titre: r.titre, refait: "recréé", eventId: ev.id });
        } else {
          await api("PATCH", `/calendars/${encodeURIComponent(AGENDA)}/events/${encodeURIComponent(r.eventId)}`, r.avant);
          out.push({ ok: true, titre: r.titre, refait: "restauré" });
        }
      }
    } catch (err) {
      console.warn("Annulation agenda échouée :", err.message);
      out.push({ ok: false, titre: r.titre, erreur: err.message });
    }
  }
  cache = { at: 0, text: "" };
  jourCache = { cle: "", at: 0, items: null };
  return out;
}
