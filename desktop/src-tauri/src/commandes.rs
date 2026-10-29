//! Les commandes natives (contrat coquille ↔ site, `docs/bureau.md` 1.4).
//!
//! Deux verrous : les règles d'accès de Tauri (`capabilities/`) ne laissent
//! passer que des origines génériques ; puis CHAQUE commande vérifie ici que
//! la page appelante vient exactement de la tour configurée (commandes
//! distantes) ou des pages embarquées (commandes locales). Aucune commande ne
//! lance de programme, ne lit de fichier choisi par la page, ni ne fait de
//! requête réseau.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, State, Webview};
use tauri_plugin_notification::NotificationExt as _;
use tauri_plugin_opener::OpenerExt as _;

use crate::{adresse, fenetres, raccourci, reglages, zone, Etat};

pub const TITRE_MAX: usize = 80;
pub const CORPS_MAX: usize = 240;
pub const NOTIFS_PAR_MINUTE: usize = 10;
pub const DOUBLON_CLE: Duration = Duration::from_secs(10 * 60);

// ---------------------------------------------------------------- verrous

fn url_appelante(webview: &Webview) -> Result<url::Url, String> {
    webview.url().map_err(|_| "Origine inconnue : commande refusée.".to_string())
}

/// La page vient-elle exactement de la tour configurée ?
fn verifier_tour(webview: &Webview, etat: &Etat) -> Result<(), String> {
    let url = url_appelante(webview)?;
    let adresse = etat.adresse();
    match adresse.as_deref() {
        Some(a) if adresse::meme_origine(&url, a) => Ok(()),
        _ => Err("Origine refusée : seule la tour configurée peut utiliser l'app.".into()),
    }
}

/// La page est-elle une des pages embarquées dans l'app ?
fn verifier_locale(webview: &Webview) -> Result<(), String> {
    let url = url_appelante(webview)?;
    if adresse::est_page_locale(&url) {
        Ok(())
    } else {
        Err("Origine refusée : commande réservée aux pages de l'app.".into())
    }
}

fn verifier_tour_ou_locale(webview: &Webview, etat: &Etat) -> Result<(), String> {
    verifier_locale(webview).or_else(|_| verifier_tour(webview, etat))
}

// ---------------------------------------------------------------- état

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EtatBureau {
    pub version: String,
    pub adresse: Option<String>,
    /// Forme rangée, à renvoyer telle quelle (`Ctrl+Alt+Space`).
    pub raccourci: String,
    /// Pour l'affichage (`Ctrl+Alt+Espace`).
    pub raccourci_libelle: String,
    /// Le raccourci n'a pas pu être posé (déjà pris) : quoi faire.
    pub raccourci_erreur: Option<String>,
    pub demarrage: bool,
    pub fermer_dans_zone: bool,
    /// `main` ou `noter`.
    pub fenetre: String,
}

pub fn etat_bureau(app: &AppHandle, etat: &Etat, fenetre: &str) -> EtatBureau {
    let r = etat.reglages.lock().unwrap().clone();
    EtatBureau {
        version: app.package_info().version.to_string(),
        adresse: r.adresse.clone(),
        raccourci_libelle: raccourci::libelle(&r.raccourci),
        raccourci: r.raccourci,
        raccourci_erreur: etat.raccourci_erreur.lock().unwrap().clone(),
        demarrage: r.demarrage,
        fermer_dans_zone: r.fermer_dans_zone,
        fenetre: fenetre.to_string(),
    }
}

/// Le site sait qu'il est dans l'app. Appelé depuis la fenêtre principale, il
/// dit aussi « la tour répond » : la fenêtre Noter, si elle attendait sur sa
/// page de secours, passe alors sur le site.
#[tauri::command]
pub fn bureau_etat(app: AppHandle, webview: Webview, etat: State<'_, Etat>) -> Result<EtatBureau, String> {
    verifier_tour(&webview, &etat)?;
    let fenetre = webview.window().label().to_string();
    fenetres::page_signalee(&etat, &fenetre);
    if fenetre == fenetres::PRINCIPALE && !etat.site_charge.swap(true, Ordering::SeqCst) {
        fenetres::noter_vers_tour_si_secours(&app);
    }
    Ok(etat_bureau(&app, &etat, &fenetre))
}

/// Réglages › Ordinateur.
#[tauri::command]
pub fn bureau_regler(
    app: AppHandle,
    webview: Webview,
    etat: State<'_, Etat>,
    raccourci: Option<String>,
    demarrage: Option<bool>,
    fermer_dans_zone: Option<bool>,
) -> Result<EtatBureau, String> {
    verifier_tour(&webview, &etat)?;
    appliquer_reglages(&app, &etat, raccourci, demarrage, fermer_dans_zone)?;
    Ok(etat_bureau(&app, &etat, webview.window().label()))
}

pub fn appliquer_reglages(
    app: &AppHandle,
    etat: &Etat,
    raccourci_texte: Option<String>,
    demarrage: Option<bool>,
    fermer_dans_zone: Option<bool>,
) -> Result<(), String> {
    if let Some(texte) = raccourci_texte {
        let nouveau = raccourci::lire(&texte)?;
        let mut actif = etat.raccourci_actif.lock().unwrap();
        raccourci::remplacer(app, actif.as_ref(), &nouveau)?;
        *actif = Some(nouveau.clone());
        *etat.raccourci_erreur.lock().unwrap() = None;
        etat.reglages.lock().unwrap().raccourci = nouveau.texte;
    }
    if let Some(oui) = demarrage {
        crate::demarrage::regler(oui)?;
        etat.reglages.lock().unwrap().demarrage = oui;
    }
    if let Some(oui) = fermer_dans_zone {
        etat.reglages.lock().unwrap().fermer_dans_zone = oui;
    }
    etat.enregistrer()?;
    zone::actualiser(app, etat);
    Ok(())
}

// ---------------------------------------------------------------- notifications

/// Limites des notifications : 10 par minute au plus, et la même clé ne
/// repart pas avant 10 minutes. Une page qui s'emballe ne peut pas inonder
/// l'écran.
#[derive(Default)]
pub struct Notifs {
    envois: VecDeque<Instant>,
    cles: HashMap<String, Instant>,
    vues: HashMap<i32, String>,
    prochain_id: i32,
}

impl Notifs {
    pub fn autoriser(&mut self, cle: Option<&str>, maintenant: Instant) -> Result<(), String> {
        while let Some(&premier) = self.envois.front() {
            if maintenant.duration_since(premier) >= Duration::from_secs(60) {
                self.envois.pop_front();
            } else {
                break;
            }
        }
        self.cles.retain(|_, &mut quand| maintenant.duration_since(quand) < DOUBLON_CLE);
        if let Some(c) = cle {
            if self.cles.contains_key(c) {
                return Err("Déjà notifié il y a moins de 10 minutes.".into());
            }
        }
        if self.envois.len() >= NOTIFS_PAR_MINUTE {
            return Err("Trop de notifications d'un coup : réessaie dans une minute.".into());
        }
        self.envois.push_back(maintenant);
        if let Some(c) = cle {
            self.cles.insert(c.to_string(), maintenant);
        }
        Ok(())
    }

    /// Un numéro pour la notification, et la vue à ouvrir si on clique dessus.
    pub fn retenir_vue(&mut self, vue: Option<String>) -> i32 {
        self.prochain_id = self.prochain_id.wrapping_add(1).max(1);
        let id = self.prochain_id;
        if let Some(v) = vue {
            if self.vues.len() > 100 {
                self.vues.clear();
            }
            self.vues.insert(id, v);
        }
        id
    }

    pub fn vue_de(&self, id: i32) -> Option<String> {
        self.vues.get(&id).cloned()
    }
}

/// Texte d'une notification : sans caractères de contrôle, sans espaces en
/// trop, borné (avec « … » si coupé).
pub fn borner(texte: &str, max: usize) -> String {
    let propre: String = texte
        .chars()
        .map(|c| if c == '\n' || c == '\t' { ' ' } else { c })
        .filter(|c| !c.is_control())
        .collect();
    let propre = propre.split_whitespace().collect::<Vec<_>>().join(" ");
    if propre.chars().count() <= max {
        return propre;
    }
    let mut coupe: String = propre.chars().take(max.saturating_sub(1)).collect();
    coupe = coupe.trim_end().to_string();
    coupe.push('…');
    coupe
}

pub fn notifier(app: &AppHandle, titre: &str, corps: &str, id: Option<i32>) -> Result<(), String> {
    let mut b = app.notification().builder().title(titre).body(corps);
    if let Some(id) = id {
        b = b.id(id);
    }
    b.show().map_err(|e| format!("Windows n'a pas affiché la notification : {e}"))
}

#[tauri::command]
pub fn bureau_notifier(
    app: AppHandle,
    webview: Webview,
    etat: State<'_, Etat>,
    titre: String,
    corps: String,
    cle: Option<String>,
    vue: Option<String>,
) -> Result<(), String> {
    verifier_tour(&webview, &etat)?;
    let titre = borner(&titre, TITRE_MAX);
    let corps = borner(&corps, CORPS_MAX);
    if titre.is_empty() && corps.is_empty() {
        return Err("Notification vide.".into());
    }
    let cle = cle.map(|c| borner(&c, 200));
    let vue = vue.filter(|v| adresse::vue_valide(v));
    let id = {
        let mut n = etat.notifs.lock().unwrap();
        n.autoriser(cle.as_deref(), Instant::now())?;
        n.retenir_vue(vue)
    };
    let titre = if titre.is_empty() { "Rémy".to_string() } else { titre };
    notifier(&app, &titre, &corps, Some(id))
}

// ---------------------------------------------------------------- fenêtres

#[tauri::command]
pub fn bureau_noter_fermer(app: AppHandle, webview: Webview, etat: State<'_, Etat>) -> Result<(), String> {
    verifier_tour_ou_locale(&webview, &etat)?;
    fenetres::cacher_noter(&app);
    Ok(())
}

#[tauri::command]
pub fn bureau_ouvrir(app: AppHandle, webview: Webview, etat: State<'_, Etat>, vue: Option<String>) -> Result<(), String> {
    verifier_tour_ou_locale(&webview, &etat)?;
    if webview.window().label() == fenetres::NOTER {
        fenetres::cacher_noter(&app);
    }
    match vue {
        Some(v) if adresse::vue_valide(&v) => fenetres::aller_vue(&app, &v),
        Some(_) => return Err("Vue inconnue.".into()),
        None => fenetres::afficher_principale(&app),
    }
    Ok(())
}

#[tauri::command]
pub fn bureau_ouvrir_lien(app: AppHandle, webview: Webview, etat: State<'_, Etat>, url: String) -> Result<(), String> {
    verifier_tour(&webview, &etat)?;
    let lien = adresse::lien_externe(&url).ok_or("Lien refusé : seuls les liens web (http, https) s'ouvrent.")?;
    app.opener()
        .open_url(lien.as_str(), None::<&str>)
        .map_err(|e| format!("Le navigateur ne s'est pas ouvert : {e}"))
}

#[tauri::command]
pub fn bureau_changer_adresse(app: AppHandle, webview: Webview, etat: State<'_, Etat>) -> Result<(), String> {
    verifier_tour(&webview, &etat)?;
    fenetres::vers_demarrage(&app, true);
    Ok(())
}

/// Appelée par le script de contrôle que la coquille injecte (pas par le
/// site) : comment la page de la tour s'est chargée. Une réponse 5xx ou une
/// page vide ramène la fenêtre sur sa page embarquée.
#[tauri::command]
pub fn bureau_page_chargee(
    app: AppHandle,
    webview: Webview,
    etat: State<'_, Etat>,
    statut: Option<u16>,
    vide: Option<bool>,
) -> Result<(), String> {
    verifier_tour(&webview, &etat)?;
    let fenetre = webview.window().label().to_string();
    match fenetres::panne_de_page(statut.unwrap_or(0), vide.unwrap_or(false)) {
        Some(panne) => fenetres::vers_secours(&app, &fenetre, panne),
        None => fenetres::page_signalee(&etat, &fenetre),
    }
    Ok(())
}

// ---------------------------------------------------------------- notes de secours

#[tauri::command]
pub fn bureau_notes_attente(webview: Webview, etat: State<'_, Etat>) -> Result<Vec<reglages::NoteLocale>, String> {
    verifier_tour(&webview, &etat)?;
    Ok(reglages::lire_notes(&etat.dossier))
}

#[tauri::command]
pub fn bureau_notes_acquitter(webview: Webview, etat: State<'_, Etat>, ids: Vec<String>) -> Result<(), String> {
    verifier_tour(&webview, &etat)?;
    if ids.len() > reglages::NOTES_MAX {
        return Err("Trop d'identifiants.".into());
    }
    reglages::acquitter_notes(&etat.dossier, &ids).map(|_| ())
}

// ---------------------------------------------------------------- pages embarquées

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdresseLue {
    pub adresse: Option<String>,
    pub version: String,
    pub fenetre: String,
    pub raccourci_libelle: String,
}

#[tauri::command]
pub fn bureau_adresse_lire(app: AppHandle, webview: Webview, etat: State<'_, Etat>) -> Result<AdresseLue, String> {
    verifier_locale(&webview)?;
    let r = etat.reglages.lock().unwrap().clone();
    Ok(AdresseLue {
        adresse: r.adresse,
        version: app.package_info().version.to_string(),
        fenetre: webview.window().label().to_string(),
        raccourci_libelle: raccourci::libelle(&r.raccourci),
    })
}

const ADRESSE_INVALIDE: &str = "Adresse invalide : il faut l'adresse https de la tour, par exemple \
     ma-tour.mon-tailnet.ts.net:8444 (sans chemin après le port).";

/// Normalise sans garder : la page sonde d'abord cette adresse.
#[tauri::command]
pub fn bureau_adresse_normaliser(webview: Webview, adresse: String) -> Result<String, String> {
    verifier_locale(&webview)?;
    adresse::normaliser(&adresse).ok_or_else(|| ADRESSE_INVALIDE.to_string())
}

/// Normalise et garde l'adresse ; rend l'adresse propre, ou dit pourquoi non.
#[tauri::command]
pub fn bureau_adresse_enregistrer(
    app: AppHandle,
    webview: Webview,
    etat: State<'_, Etat>,
    adresse: String,
) -> Result<String, String> {
    verifier_locale(&webview)?;
    let propre = adresse::normaliser(&adresse).ok_or_else(|| ADRESSE_INVALIDE.to_string())?;
    etat.reglages.lock().unwrap().adresse = Some(propre.clone());
    *etat.adresse_partagee.write().unwrap() = Some(propre.clone());
    etat.site_charge.store(false, Ordering::SeqCst);
    etat.enregistrer()?;
    zone::actualiser(&app, &etat);
    Ok(propre)
}

/// La page de démarrage (ou la Noter de secours) a vu la tour répondre : la
/// fenêtre qui l'affiche part sur le site.
#[tauri::command]
pub fn bureau_aller_tour(app: AppHandle, webview: Webview, etat: State<'_, Etat>) -> Result<(), String> {
    verifier_locale(&webview)?;
    if etat.adresse().is_none() {
        return Err("Aucune adresse de tour enregistrée.".into());
    }
    fenetres::vers_tour(&app, webview.window().label())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteGardee {
    pub id: String,
    pub en_attente: usize,
    /// Les notes d'avant n'ont pas pu être relues (fichier mis de côté).
    pub avertissement: Option<String>,
}

#[tauri::command]
pub fn bureau_note_locale(webview: Webview, etat: State<'_, Etat>, texte: String) -> Result<NoteGardee, String> {
    verifier_locale(&webview)?;
    let a = reglages::ajouter_note(&etat.dossier, &texte)?;
    Ok(NoteGardee { id: a.note.id, en_attente: a.en_attente, avertissement: a.avertissement })
}

#[tauri::command]
pub fn bureau_notes_locales_compte(webview: Webview, etat: State<'_, Etat>) -> Result<usize, String> {
    verifier_locale(&webview)?;
    Ok(reglages::lire_notes(&etat.dossier).len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dix_notifications_par_minute_au_plus() {
        let mut n = Notifs::default();
        let t0 = Instant::now();
        for i in 0..NOTIFS_PAR_MINUTE {
            assert!(n.autoriser(None, t0 + Duration::from_secs(i as u64)).is_ok());
        }
        assert!(n.autoriser(None, t0 + Duration::from_secs(30)).is_err());
        assert!(n.autoriser(None, t0 + Duration::from_secs(61)).is_ok(), "la première est sortie de la fenêtre");
    }

    #[test]
    fn la_meme_cle_ne_repart_pas_avant_dix_minutes() {
        let mut n = Notifs::default();
        let t0 = Instant::now();
        let cle = Some("rappel:42@2026-10-29T08:00:00Z");
        assert!(n.autoriser(cle, t0).is_ok());
        assert!(n.autoriser(cle, t0 + Duration::from_secs(120)).is_err());
        assert!(n.autoriser(Some("rappel:43@2026-10-29T08:00:00Z"), t0 + Duration::from_secs(120)).is_ok());
        assert!(n.autoriser(cle, t0 + DOUBLON_CLE + Duration::from_secs(1)).is_ok());
    }

    #[test]
    fn une_notification_refusee_ne_compte_pas() {
        let mut n = Notifs::default();
        let t0 = Instant::now();
        assert!(n.autoriser(Some("a"), t0).is_ok());
        for _ in 0..20 {
            assert!(n.autoriser(Some("a"), t0).is_err());
        }
        assert!(n.autoriser(Some("b"), t0).is_ok());
    }

    #[test]
    fn le_clic_retrouve_sa_vue() {
        let mut n = Notifs::default();
        let a = n.retenir_vue(Some("aujourdhui".into()));
        let b = n.retenir_vue(None);
        assert_ne!(a, b);
        assert_eq!(n.vue_de(a).as_deref(), Some("aujourdhui"));
        assert_eq!(n.vue_de(b), None);
    }

    #[test]
    fn les_textes_sont_bornes_et_propres() {
        assert_eq!(borner("  Appeler\nLéa \u{7}  ", 80), "Appeler Léa");
        let long = "mot ".repeat(100);
        let b = borner(&long, CORPS_MAX);
        assert_eq!(b.chars().count(), CORPS_MAX);
        assert!(b.ends_with('…'));
        assert_eq!(borner("", 80), "");
        assert_eq!(borner(&"é".repeat(80), 80).chars().count(), 80, "compte en caractères, pas en octets");
    }
}
