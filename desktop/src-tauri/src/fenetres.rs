//! Les deux fenêtres : la principale (le site de la tour, ou la page de
//! démarrage embarquée) et « Noter » (petite, sans bordure, au-dessus de tout,
//! hors barre des tâches).
//!
//! Navigation : seules les pages embarquées et l'origine exacte de la tour
//! s'ouvrent dans l'app. Un lien `http(s)` ailleurs part dans le navigateur
//! par défaut ; tout le reste est ignoré.

use std::sync::atomic::Ordering;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt as _;
use url::Url;

use crate::{adresse, commandes, Etat};

pub const PRINCIPALE: &str = "main";
pub const NOTER: &str = "noter";

pub const EVT_NOTER_OUVERT: &str = "bureau://noter-ouvert";
pub const EVT_ALLER: &str = "bureau://aller";

/// Injecté dans chaque page des deux fenêtres : une page de la tour dit comment
/// elle s'est chargée (`bureau_page_chargee`). Voir `controle.js`.
pub const SCRIPT_CONTROLE: &str = include_str!("controle.js");

/// Une page de la tour qui ne s'est pas signalée dans ce délai (chargement
/// bloqué, page d'erreur du navigateur) ramène la fenêtre sur sa page embarquée.
pub const GARDE_CHARGEMENT: Duration = Duration::from_secs(20);

/// La dernière navigation d'une fenêtre vers la tour.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Navigation {
    /// Augmente à chaque navigation (vers la tour ou vers une page embarquée) :
    /// un garde-fou en retard ne touche pas à une navigation plus récente.
    pub numero: u64,
    /// La page de la tour s'est signalée (script de contrôle ou `bureau_etat`).
    pub signalee: bool,
}

/// Pourquoi la page de la tour n'est pas utilisable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Panne {
    /// Réponse 5xx : la tour répond, Rémy non (Tailscale Serve : 502).
    Statut(u16),
    /// Page vide, statut inconnu (WebKit ne donne pas le statut).
    Vide,
    /// La page ne s'est pas signalée en 20 s.
    Muette,
}

impl Panne {
    /// Pour l'adresse de la page embarquée (`?injoignable=502`).
    pub fn code(&self) -> String {
        match self {
            Panne::Statut(s) => s.to_string(),
            Panne::Vide => "vide".into(),
            Panne::Muette => "muette".into(),
        }
    }
}

/// Ce que dit le script de contrôle → panne ou non. `statut` 0 : inconnu.
/// Une page vide avec un statut 2xx connu reste acceptée (le site décide).
pub fn panne_de_page(statut: u16, vide: bool) -> Option<Panne> {
    if statut >= 500 {
        Some(Panne::Statut(statut))
    } else if statut == 0 && vide {
        Some(Panne::Vide)
    } else {
        None
    }
}

/// Par fenêtre, sa dernière navigation (dans `Etat`). À part de `Etat` pour
/// les tests : construire `Etat` sous Windows tire le code des menus, qui
/// demande Common Controls v6 (absent du manifeste des exécutables de test).
pub type Navigations = std::sync::Mutex<std::collections::HashMap<String, Navigation>>;

/// Nouvelle navigation de la fenêtre `label` : rend son numéro.
pub fn nouvelle_navigation(navigations: &Navigations, label: &str) -> u64 {
    let mut n = navigations.lock().unwrap();
    let e = n.entry(label.to_string()).or_default();
    e.numero += 1;
    e.signalee = false;
    e.numero
}

/// La page de la tour de la fenêtre `label` s'est signalée.
pub fn page_signalee(navigations: &Navigations, label: &str) {
    navigations.lock().unwrap().entry(label.to_string()).or_default().signalee = true;
}

/// La navigation `numero` de `label` est-elle toujours la dernière, et muette ?
pub fn navigation_muette(navigations: &Navigations, label: &str, numero: u64) -> bool {
    navigations
        .lock()
        .unwrap()
        .get(label)
        .is_some_and(|e| e.numero == numero && !e.signalee)
}

/// L'adresse d'une page embarquée, telle que la WebView la voit.
pub fn url_locale(page: &str) -> Url {
    let base = if cfg!(any(windows, target_os = "android")) {
        "http://tauri.localhost/"
    } else {
        "tauri://localhost/"
    };
    Url::parse(base).and_then(|b| b.join(page)).expect("adresse locale valide")
}

fn politique_navigation(app: AppHandle, adresse_partagee: Arc<RwLock<Option<String>>>) -> impl Fn(&Url) -> bool + Send + 'static {
    move |url: &Url| {
        if adresse::est_page_locale(url) || url.as_str() == "about:blank" {
            return true;
        }
        if let Some(a) = adresse_partagee.read().unwrap().as_deref() {
            if adresse::meme_origine(url, a) {
                return true;
            }
        }
        if let Some(lien) = adresse::lien_externe(url.as_str()) {
            let _ = app.opener().open_url(lien.as_str(), None::<&str>);
        }
        false
    }
}

fn nouvelle_fenetre_refusee(app: AppHandle) -> impl Fn(Url, tauri::webview::NewWindowFeatures) -> tauri::webview::NewWindowResponse<tauri::Wry> + Send + 'static {
    move |url: Url, _| {
        if let Some(lien) = adresse::lien_externe(url.as_str()) {
            let _ = app.opener().open_url(lien.as_str(), None::<&str>);
        }
        tauri::webview::NewWindowResponse::Deny
    }
}

pub fn creer_principale(app: &AppHandle, etat: &Etat, cachee: bool) -> tauri::Result<WebviewWindow> {
    let w = WebviewWindowBuilder::new(app, PRINCIPALE, WebviewUrl::App("demarrage.html".into()))
        .title("Rémy")
        .inner_size(1280.0, 800.0)
        .min_inner_size(420.0, 560.0)
        .center()
        .visible(!cachee)
        .focused(!cachee)
        .zoom_hotkeys_enabled(true)
        .initialization_script(SCRIPT_CONTROLE)
        .on_navigation(politique_navigation(app.clone(), etat.adresse_partagee.clone()))
        .on_new_window(nouvelle_fenetre_refusee(app.clone()))
        .build()?;
    // Au démarrage de Windows, la fenêtre reste cachée même si la position
    // retrouvée était « agrandie » (agrandir montre la fenêtre).
    if cachee {
        let _ = w.hide();
    }
    Ok(w)
}

pub fn creer_noter(app: &AppHandle, etat: &Etat) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, NOTER, WebviewUrl::App("noter.html".into()))
        .title("Noter — Rémy")
        .inner_size(560.0, 300.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .zoom_hotkeys_enabled(false)
        .initialization_script(SCRIPT_CONTROLE)
        .on_navigation(politique_navigation(app.clone(), etat.adresse_partagee.clone()))
        .on_new_window(nouvelle_fenetre_refusee(app.clone()))
        .build()
}

pub fn afficher_principale(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(PRINCIPALE) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Clic sur l'icône : montre la fenêtre, ou la range si elle est déjà devant.
/// Le clic donne d'abord le focus à la barre des tâches : une fenêtre qui
/// vient de le perdre (moins d'une demi-seconde) était devant.
pub fn basculer_principale(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(PRINCIPALE) {
        let quittee = *app.state::<Etat>().principale_quittee_a.lock().unwrap();
        let devant = w.is_visible().unwrap_or(false)
            && !w.is_minimized().unwrap_or(false)
            && (w.is_focused().unwrap_or(false) || etait_devant(quittee, Instant::now()));
        if devant {
            let _ = w.hide();
        } else {
            afficher_principale(app);
        }
    }
}

/// La fenêtre a perdu le focus il y a moins d'une demi-seconde.
pub fn etait_devant(quittee: Option<Instant>, maintenant: Instant) -> bool {
    quittee.is_some_and(|q| maintenant.saturating_duration_since(q) < Duration::from_millis(500))
}

#[derive(Clone, Serialize)]
struct Aller {
    vue: String,
}

/// Montre la fenêtre principale et demande au site d'aller à une vue.
pub fn aller_vue(app: &AppHandle, vue: &str) {
    afficher_principale(app);
    let _ = app.emit_to(PRINCIPALE, EVT_ALLER, Aller { vue: vue.to_string() });
}

pub fn cacher_noter(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(NOTER) {
        let _ = w.hide();
    }
}

/// Le raccourci global : ouvre Noter au centre de l'écran où est la souris
/// (un peu au-dessus du milieu), ou la referme si elle est déjà ouverte.
pub fn basculer_noter(app: &AppHandle) {
    let Some(w) = app.get_webview_window(NOTER) else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    placer_sous_la_souris(app, &w);
    let _ = w.show();
    let _ = w.set_focus();
    let _ = app.emit_to(NOTER, EVT_NOTER_OUVERT, ());
}

fn placer_sous_la_souris(app: &AppHandle, w: &WebviewWindow) {
    let ecran = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let (Some(ecran), Ok(taille)) = (ecran, w.outer_size()) else { return };
    let (ex, ey) = (ecran.position().x, ecran.position().y);
    let (el, eh) = (ecran.size().width as i32, ecran.size().height as i32);
    let x = ex + (el - taille.width as i32) / 2;
    let y = ey + (eh - taille.height as i32) / 3;
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

/// La fenêtre `label` part sur le site de la tour.
pub fn vers_tour(app: &AppHandle, label: &str) -> Result<(), String> {
    let etat = app.state::<Etat>();
    let adresse = etat.adresse().ok_or("Aucune adresse de tour enregistrée.")?;
    let cible = if label == NOTER {
        format!("{adresse}/?fenetre=noter")
    } else {
        format!("{adresse}/")
    };
    let url = Url::parse(&cible).map_err(|_| "Adresse de tour illisible.".to_string())?;
    let w = app
        .get_webview_window(label)
        .ok_or("Fenêtre introuvable.".to_string())?;
    let numero = nouvelle_navigation(&etat.navigations, label);
    w.navigate(url).map_err(|e| format!("Navigation impossible : {e}"))?;
    // Garde-fou : une page qui ne s'est pas signalée en 20 s (chargement
    // bloqué, page d'erreur) ramène la fenêtre sur sa page embarquée, qui
    // réessaie seule. Un fil à part : les minuteries d'une fenêtre cachée sont
    // ralenties, pas celui-ci.
    let app = app.clone();
    let label = label.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(GARDE_CHARGEMENT);
        if navigation_muette(&app.state::<Etat>().navigations, &label, numero) {
            let a = app.clone();
            let _ = app.run_on_main_thread(move || {
                if navigation_muette(&a.state::<Etat>().navigations, &label, numero) {
                    vers_secours(&a, &label, Panne::Muette);
                }
            });
        }
    });
    Ok(())
}

/// La page de la tour est en panne (5xx, vide, muette) : la fenêtre revient
/// sur sa page embarquée, sans changer de visibilité (au démarrage de
/// Windows, elle reste cachée). La principale y montre « Rémy ne répond pas
/// encore » et réessaie seule toutes les 30 s ; Noter reprend sa page de
/// secours (la note reste possible, gardée sur ce PC).
pub fn vers_secours(app: &AppHandle, label: &str, panne: Panne) {
    let etat = app.state::<Etat>();
    nouvelle_navigation(&etat.navigations, label);
    let page = if label == NOTER {
        format!("noter.html?retour={}", panne.code())
    } else {
        etat.site_charge.store(false, Ordering::SeqCst);
        format!("demarrage.html?injoignable={}", panne.code())
    };
    eprintln!("page de la tour en panne ({label}) : {}", panne.code());
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.navigate(url_locale(&page));
    }
}

/// La fenêtre principale revient sur la page de démarrage (pour changer
/// l'adresse, ou réessayer).
pub fn vers_demarrage(app: &AppHandle, changer: bool) {
    let page = if changer { "demarrage.html?changer=1" } else { "demarrage.html" };
    let etat = app.state::<Etat>();
    etat.site_charge.store(false, Ordering::SeqCst);
    nouvelle_navigation(&etat.navigations, PRINCIPALE);
    if let Some(w) = app.get_webview_window(PRINCIPALE) {
        let _ = w.navigate(url_locale(page));
    }
    afficher_principale(app);
    // Changer de tour : la Noter de la tour d'avant n'a plus lieu d'être,
    // retour à la page de secours (elle repassera sur le site de la nouvelle).
    if changer {
        nouvelle_navigation(&etat.navigations, NOTER);
        if let Some(n) = app.get_webview_window(NOTER) {
            let _ = n.navigate(url_locale("noter.html"));
        }
    }
}

/// La tour vient de répondre dans la fenêtre principale : si Noter attendait
/// sur sa page de secours, elle passe sur le site.
pub fn noter_vers_tour_si_secours(app: &AppHandle) {
    let Some(n) = app.get_webview_window(NOTER) else { return };
    let sur_secours = n.url().map(|u| adresse::est_page_locale(&u)).unwrap_or(false);
    // Jamais pendant qu'on tape une note dans la fenêtre de secours.
    if sur_secours && !n.is_visible().unwrap_or(false) {
        let _ = vers_tour(app, NOTER);
    }
}

/// Fermer, perdre le focus : ce que fait chaque fenêtre.
pub fn sur_evenement(fenetre: &tauri::Window, evenement: &WindowEvent) {
    let app = fenetre.app_handle();
    match (fenetre.label(), evenement) {
        (NOTER, WindowEvent::CloseRequested { api, .. }) => {
            api.prevent_close();
            let _ = fenetre.hide();
        }
        (NOTER, WindowEvent::Focused(false)) => {
            let _ = fenetre.hide();
        }
        (PRINCIPALE, WindowEvent::Focused(focus)) => {
            *app.state::<Etat>().principale_quittee_a.lock().unwrap() = if *focus { None } else { Some(Instant::now()) };
        }
        (PRINCIPALE, WindowEvent::CloseRequested { api, .. }) => {
            let etat = app.state::<Etat>();
            let (dans_zone, deja_explique) = {
                let r = etat.reglages.lock().unwrap();
                (r.fermer_dans_zone, r.fermeture_expliquee)
            };
            if !dans_zone {
                app.exit(0);
                return;
            }
            api.prevent_close();
            let _ = fenetre.hide();
            if !deja_explique {
                etat.reglages.lock().unwrap().fermeture_expliquee = true;
                let _ = etat.enregistrer();
                let libelle = etat.raccourci_libelle();
                let _ = commandes::notifier(
                    app,
                    "Rémy reste près de l'horloge",
                    &format!(
                        "Les rappels continuent. {libelle} pour noter. Quitter : clic droit sur l'icône de Rémy."
                    ),
                    None,
                );
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_clic_sur_l_icone_juste_apres_la_perte_du_focus_range_la_fenetre() {
        let t = Instant::now();
        assert!(etait_devant(Some(t), t + Duration::from_millis(120)));
        assert!(!etait_devant(Some(t), t + Duration::from_millis(900)));
        assert!(!etait_devant(None, t));
    }

    #[test]
    fn une_page_5xx_ou_vide_est_en_panne() {
        assert_eq!(panne_de_page(502, false), Some(Panne::Statut(502)));
        assert_eq!(panne_de_page(503, true), Some(Panne::Statut(503)));
        assert_eq!(panne_de_page(0, true), Some(Panne::Vide), "WebKit : statut inconnu, page vide");
        assert_eq!(panne_de_page(0, false), None, "WebKit : statut inconnu, page pleine");
        assert_eq!(panne_de_page(200, true), None, "statut 2xx connu : le site décide");
        assert_eq!(panne_de_page(200, false), None);
        assert_eq!(panne_de_page(404, false), None);
        assert_eq!(Panne::Statut(502).code(), "502");
        assert_eq!(Panne::Muette.code(), "muette");
    }

    #[test]
    fn le_garde_fou_ne_touche_qu_a_la_derniere_navigation_muette() {
        let navigations = Navigations::default();
        assert!(!navigation_muette(&navigations, PRINCIPALE, 1), "aucune navigation encore");
        let n1 = nouvelle_navigation(&navigations, PRINCIPALE);
        assert!(navigation_muette(&navigations, PRINCIPALE, n1));
        page_signalee(&navigations, PRINCIPALE);
        assert!(!navigation_muette(&navigations, PRINCIPALE, n1), "la page s'est signalée");
        let n2 = nouvelle_navigation(&navigations, PRINCIPALE);
        assert!(!navigation_muette(&navigations, PRINCIPALE, n1), "une navigation plus récente existe");
        assert!(navigation_muette(&navigations, PRINCIPALE, n2));
        assert!(!navigation_muette(&navigations, NOTER, n2), "chaque fenêtre a ses navigations");
    }

    #[test]
    fn le_script_de_controle_ne_vise_que_les_pages_de_la_tour() {
        assert!(SCRIPT_CONTROLE.contains("bureau_page_chargee"));
        assert!(SCRIPT_CONTROLE.contains("tauri.localhost"), "pages embarquées ignorées");
        assert!(SCRIPT_CONTROLE.contains("window.top !== window"), "cadres ignorés");
    }

    #[test]
    fn les_pages_embarquees_sont_bien_locales() {
        assert!(adresse::est_page_locale(&url_locale("demarrage.html")));
        assert!(adresse::est_page_locale(&url_locale("demarrage.html?changer=1")));
        assert!(adresse::est_page_locale(&url_locale("noter.html")));
        assert!(adresse::est_page_locale(&url_locale("demarrage.html?injoignable=502")));
        assert!(adresse::est_page_locale(&url_locale("noter.html?retour=muette")));
    }
}
