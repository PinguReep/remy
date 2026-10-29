//! L'icône de Rémy dans la zone de notification (près de l'horloge).
//! Clic gauche : montrer / ranger la fenêtre. Clic droit : le menu.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::{commandes, fenetres, raccourci, Etat};

/// Les entrées dont le texte ou la coche suivent les réglages.
pub struct MenuZone {
    pub noter: MenuItem<Wry>,
    pub demarrage: CheckMenuItem<Wry>,
    pub adresse: MenuItem<Wry>,
}

fn texte_noter(libelle: &str) -> String {
    format!("Noter…  ({libelle})")
}

fn texte_adresse(etat: &Etat) -> String {
    if etat.adresse().is_some() {
        "Changer l'adresse de la tour…".into()
    } else {
        "Donner l'adresse de la tour…".into()
    }
}

pub fn creer(app: &AppHandle, etat: &Etat) -> tauri::Result<MenuZone> {
    let r = etat.reglages.lock().unwrap().clone();
    let ouvrir = MenuItem::with_id(app, "ouvrir", "Ouvrir Rémy", true, None::<&str>)?;
    let noter = MenuItem::with_id(app, "noter", texte_noter(&raccourci::libelle(&r.raccourci)), true, None::<&str>)?;
    let aujourdhui = MenuItem::with_id(app, "aujourdhui", "Aujourd'hui", true, None::<&str>)?;
    let reglages = MenuItem::with_id(app, "reglages", "Réglages de l'ordinateur", true, None::<&str>)?;
    let demarrage = CheckMenuItem::with_id(app, "demarrage", "Démarrer avec Windows", true, r.demarrage, None::<&str>)?;
    let adresse = MenuItem::with_id(app, "adresse", texte_adresse(etat), true, None::<&str>)?;
    let recharger = MenuItem::with_id(app, "recharger", "Recharger", true, None::<&str>)?;
    let quitter = MenuItem::with_id(app, "quitter", "Quitter Rémy", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &ouvrir,
            &noter,
            &aujourdhui,
            &reglages,
            &PredefinedMenuItem::separator(app)?,
            &demarrage,
            &adresse,
            &recharger,
            &PredefinedMenuItem::separator(app)?,
            &quitter,
        ],
    )?;

    let mut icone = TrayIconBuilder::with_id("remy")
        .tooltip("Rémy")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, evenement| sur_menu(app, evenement.id().as_ref()))
        .on_tray_icon_event(|icone, evenement| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = evenement
            {
                fenetres::basculer_principale(icone.app_handle());
            }
        });
    if let Some(image) = app.default_window_icon() {
        icone = icone.icon(image.clone());
    }
    icone.build(app)?;
    Ok(MenuZone { noter, demarrage, adresse })
}

fn sur_menu(app: &AppHandle, id: &str) {
    match id {
        "ouvrir" => fenetres::afficher_principale(app),
        "noter" => fenetres::basculer_noter(app),
        "aujourdhui" => fenetres::aller_vue(app, "aujourdhui"),
        "reglages" => fenetres::aller_vue(app, "reglages/ordinateur"),
        "demarrage" => {
            let etat = app.state::<Etat>();
            let voulu = !etat.reglages.lock().unwrap().demarrage;
            if let Err(e) = commandes::appliquer_reglages(app, &etat, None, Some(voulu), None) {
                let _ = commandes::notifier(app, "Démarrage avec Windows inchangé", &e, None);
            }
            // La coche suit l'état réel, même après un refus.
            actualiser(app, &etat);
        }
        "adresse" => fenetres::vers_demarrage(app, true),
        "recharger" => {
            if let Some(w) = app.get_webview_window(fenetres::PRINCIPALE) {
                let _ = w.reload();
            }
            fenetres::afficher_principale(app);
        }
        "quitter" => app.exit(0),
        _ => {}
    }
}

/// Remet le menu d'accord avec les réglages (raccourci, démarrage, adresse).
pub fn actualiser(app: &AppHandle, etat: &Etat) {
    let _ = app;
    let menu = etat.menu.lock().unwrap();
    let Some(m) = menu.as_ref() else { return };
    let r = etat.reglages.lock().unwrap().clone();
    let _ = m.noter.set_text(texte_noter(&raccourci::libelle(&r.raccourci)));
    let _ = m.demarrage.set_checked(r.demarrage);
    let _ = m.adresse.set_text(texte_adresse(etat));
}
