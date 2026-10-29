//! Les deux fenêtres : la principale (le site de la tour, ou la page de
//! démarrage embarquée) et « Noter » (petite, sans bordure, au-dessus de tout,
//! hors barre des tâches).
//!
//! Navigation : seules les pages embarquées et l'origine exacte de la tour
//! s'ouvrent dans l'app. Un lien `http(s)` ailleurs part dans le navigateur
//! par défaut ; tout le reste est ignoré.

use std::sync::atomic::Ordering;
use std::sync::{Arc, RwLock};

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
    WebviewWindowBuilder::new(app, PRINCIPALE, WebviewUrl::App("demarrage.html".into()))
        .title("Rémy")
        .inner_size(1280.0, 800.0)
        .min_inner_size(420.0, 560.0)
        .center()
        .visible(!cachee)
        .focused(!cachee)
        .zoom_hotkeys_enabled(true)
        .on_navigation(politique_navigation(app.clone(), etat.adresse_partagee.clone()))
        .on_new_window(nouvelle_fenetre_refusee(app.clone()))
        .build()
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
pub fn basculer_principale(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(PRINCIPALE) {
        let devant = w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) && w.is_focused().unwrap_or(false);
        if devant {
            let _ = w.hide();
        } else {
            afficher_principale(app);
        }
    }
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
    w.navigate(url).map_err(|e| format!("Navigation impossible : {e}"))
}

/// La fenêtre principale revient sur la page de démarrage (pour changer
/// l'adresse, ou réessayer).
pub fn vers_demarrage(app: &AppHandle, changer: bool) {
    let page = if changer { "demarrage.html?changer=1" } else { "demarrage.html" };
    if let Some(w) = app.get_webview_window(PRINCIPALE) {
        let _ = w.navigate(url_locale(page));
    }
    afficher_principale(app);
    // La Noter de la tour d'avant n'a plus lieu d'être : retour à la page de secours.
    if let Some(n) = app.get_webview_window(NOTER) {
        let _ = n.navigate(url_locale("noter.html"));
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

/// Le site a-t-il déjà répondu dans la fenêtre principale ?
pub fn site_charge(app: &AppHandle) -> bool {
    app.state::<Etat>().site_charge.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn les_pages_embarquees_sont_bien_locales() {
        assert!(adresse::est_page_locale(&url_locale("demarrage.html")));
        assert!(adresse::est_page_locale(&url_locale("demarrage.html?changer=1")));
        assert!(adresse::est_page_locale(&url_locale("noter.html")));
    }
}
