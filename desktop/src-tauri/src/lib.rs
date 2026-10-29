//! Rémy sur Windows : une coquille Tauri v2 autour du site servi par la tour.
//!
//! La fenêtre principale affiche l'interface de la tour (adresse demandée au
//! premier lancement, gardée sur ce PC) ; la coquille ajoute ce qu'un onglet
//! de navigateur ne sait pas faire : une icône près de l'horloge, un raccourci
//! global « Noter », le démarrage avec Windows, des notifications natives.
//! Conception et contrat avec le site : `docs/bureau.md`.

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, RwLock};

use tauri::{Manager, RunEvent};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_notification::NotificationExt as _;
use tauri_plugin_window_state::StateFlags;

pub mod adresse;
pub mod commandes;
pub mod fenetres;
pub mod raccourci;
pub mod reglages;
pub mod zone;

/// Argument posé par le démarrage avec Windows : fenêtre cachée, icône seule.
pub const ARG_DEMARRAGE: &str = "--demarrage";

pub struct Etat {
    pub dossier: PathBuf,
    pub reglages: Mutex<reglages::Reglages>,
    /// Copie de l'adresse lue par les gardes de navigation (hors verrou des réglages).
    pub adresse_partagee: Arc<RwLock<Option<String>>>,
    pub raccourci_actif: Mutex<Option<raccourci::Raccourci>>,
    pub raccourci_erreur: Mutex<Option<String>>,
    /// Le site a répondu au moins une fois dans la fenêtre principale.
    pub site_charge: AtomicBool,
    pub notifs: Mutex<commandes::Notifs>,
    pub menu: Mutex<Option<zone::MenuZone>>,
}

impl Etat {
    pub fn nouveau(dossier: PathBuf, r: reglages::Reglages) -> Self {
        Self {
            adresse_partagee: Arc::new(RwLock::new(r.adresse.clone())),
            dossier,
            reglages: Mutex::new(r),
            raccourci_actif: Mutex::new(None),
            raccourci_erreur: Mutex::new(None),
            site_charge: AtomicBool::new(false),
            notifs: Mutex::new(commandes::Notifs::default()),
            menu: Mutex::new(None),
        }
    }

    pub fn adresse(&self) -> Option<String> {
        self.adresse_partagee.read().unwrap().clone()
    }

    pub fn raccourci_libelle(&self) -> String {
        raccourci::libelle(&self.reglages.lock().unwrap().raccourci)
    }

    pub fn enregistrer(&self) -> Result<(), String> {
        let r = self.reglages.lock().unwrap().clone();
        reglages::enregistrer(&self.dossier, &r).map_err(|e| format!("Réglage non gardé sur ce PC : {e}"))
    }
}

/// Sous Windows, toutes les fenêtres de Rémy portent l'identifiant de l'app
/// (celui du raccourci du menu Démarrer) : l'épingle de la barre des tâches et
/// les notifications retrouvent la même app, qu'elle ait été lancée par le
/// menu, par l'épingle ou au démarrage de Windows.
#[cfg(windows)]
fn fixer_identifiant_windows(identifiant: &str) {
    use windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    let large: Vec<u16> = identifiant.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        SetCurrentProcessExplicitAppUserModelID(large.as_ptr());
    }
}

fn mise_en_place(app: &mut tauri::App, cachee: bool) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    #[cfg(windows)]
    fixer_identifiant_windows(&app.config().identifier);

    let dossier = app.path().app_config_dir()?;
    let mut r = reglages::lire(&dossier);

    // Démarrage avec Windows : posé une fois au premier lancement (sinon pas de
    // notifications), ensuite Windows fait foi (Gestionnaire des tâches compris).
    let al = app.autolaunch();
    if !r.premier_lancement_fait {
        if r.demarrage {
            if let Err(e) = al.enable() {
                eprintln!("démarrage avec Windows non posé : {e}");
                r.demarrage = false;
            }
        }
        r.premier_lancement_fait = true;
    } else if let Ok(actif) = al.is_enabled() {
        r.demarrage = actif;
    }

    let etat = Etat::nouveau(dossier, r);
    if let Err(e) = etat.enregistrer() {
        eprintln!("{e}");
    }
    app.manage(etat);
    let etat = app.state::<Etat>();

    fenetres::creer_principale(&handle, &etat, cachee)?;
    fenetres::creer_noter(&handle, &etat)?;

    match zone::creer(&handle, &etat) {
        Ok(menu) => *etat.menu.lock().unwrap() = Some(menu),
        Err(e) => eprintln!("icône de la zone de notification absente : {e}"),
    }

    // Le raccourci global. Déjà pris ? L'app démarre quand même, et le dit.
    let texte = etat.reglages.lock().unwrap().raccourci.clone();
    let lu = raccourci::lire(&texte).or_else(|_| raccourci::lire(raccourci::PAR_DEFAUT));
    if let Ok(lu) = lu {
        match raccourci::remplacer(&handle, None, &lu) {
            Ok(()) => *etat.raccourci_actif.lock().unwrap() = Some(lu),
            Err(_) => {
                let message = format!(
                    "{} est déjà pris par une autre application : choisis-en un autre dans Réglages › Ordinateur.",
                    raccourci::libelle(&lu.texte)
                );
                *etat.raccourci_erreur.lock().unwrap() = Some(message.clone());
                let _ = commandes::notifier(&handle, "Raccourci Noter indisponible", &message, None);
            }
        }
    }

    // Un clic sur une notification ramène la fenêtre (et la vue concernée).
    let h = handle.clone();
    let _ = app.notification().on_action(move |action| {
        if action.action_id() != "tap" {
            return;
        }
        let vue = action
            .notification()
            .and_then(|n| h.state::<Etat>().notifs.lock().unwrap().vue_de(n.id()));
        match vue {
            Some(v) => fenetres::aller_vue(&h, &v),
            None => fenetres::afficher_principale(&h),
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cachee = std::env::args().any(|a| a == ARG_DEMARRAGE);

    let app = tauri::Builder::default()
        // En premier : une seconde instance ne fait que ramener la première.
        .plugin(tauri_plugin_single_instance::init(|app, args, _dossier| {
            if !args.iter().any(|a| a == ARG_DEMARRAGE) {
                fenetres::afficher_principale(app);
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .with_denylist(&[fenetres::NOTER])
                .build(),
        )
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args([ARG_DEMARRAGE])
                .app_name("Rémy")
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(raccourci::sur_raccourci)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| mise_en_place(app, cachee))
        .on_window_event(fenetres::sur_evenement)
        .invoke_handler(tauri::generate_handler![
            commandes::bureau_etat,
            commandes::bureau_regler,
            commandes::bureau_notifier,
            commandes::bureau_noter_fermer,
            commandes::bureau_ouvrir,
            commandes::bureau_ouvrir_lien,
            commandes::bureau_changer_adresse,
            commandes::bureau_notes_attente,
            commandes::bureau_notes_acquitter,
            commandes::bureau_adresse_lire,
            commandes::bureau_adresse_enregistrer,
            commandes::bureau_aller_tour,
            commandes::bureau_note_locale,
            commandes::bureau_notes_locales_compte,
        ])
        .build(tauri::generate_context!())
        .expect("Rémy n'a pas pu démarrer");

    app.run(|_app, evenement| {
        // Fenêtres fermées ≠ quitter : seul « Quitter Rémy » (ou la fermeture
        // avec le réglage « fermer = quitter ») arrête l'app.
        if let RunEvent::ExitRequested { api, code: None, .. } = evenement {
            api.prevent_exit();
        }
    });
}
