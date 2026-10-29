//! Rémy sur Windows : une coquille Tauri v2 autour du site servi par la tour.
//!
//! La fenêtre principale affiche l'interface de la tour (adresse demandée au
//! premier lancement, gardée sur ce PC) ; la coquille ajoute ce qu'un onglet
//! de navigateur ne sait pas faire : une icône près de l'horloge, un raccourci
//! global « Noter », le démarrage avec Windows, des notifications natives.
//! Conception et contrat avec le site : `docs/bureau.md`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, RwLock};

use tauri::{Manager, RunEvent};
use tauri_plugin_notification::NotificationExt as _;
use tauri_plugin_window_state::StateFlags;

pub mod adresse;
pub mod commandes;
pub mod demarrage;
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
    /// Par fenêtre : la dernière navigation vers la tour, et si sa page s'est
    /// signalée (voir `fenetres::vers_tour`, garde-fou de 20 s).
    pub navigations: Mutex<HashMap<String, fenetres::Navigation>>,
    pub notifs: Mutex<commandes::Notifs>,
    pub menu: Mutex<Option<zone::MenuZone>>,
    /// Quand la fenêtre principale a perdu le focus : un clic sur l'icône le
    /// lui prend juste avant d'arriver (voir `fenetres::basculer_principale`).
    pub principale_quittee_a: Mutex<Option<std::time::Instant>>,
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
            navigations: Mutex::new(HashMap::new()),
            notifs: Mutex::new(commandes::Notifs::default()),
            menu: Mutex::new(None),
            principale_quittee_a: Mutex::new(None),
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
    if !r.premier_lancement_fait {
        if r.demarrage {
            if let Err(e) = demarrage::regler(true) {
                eprintln!("{e}");
                r.demarrage = false;
            }
        }
        r.premier_lancement_fait = true;
    } else if let Ok(actif) = demarrage::actif() {
        r.demarrage = actif;
        // Réinscrit le chemin du programme (il a pu changer à la réinstallation).
        if actif {
            let _ = demarrage::regler(true);
        }
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
            commandes::bureau_page_chargee,
            commandes::bureau_adresse_lire,
            commandes::bureau_adresse_normaliser,
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

#[cfg(test)]
mod tests {
    /// Les commandes déclarées (build.rs), les règles d'accès et la liste
    /// branchée dans `run()` disent la même chose ; aucune commande des pages
    /// embarquées (adresse, notes de secours) n'est ouverte à une page distante.
    #[test]
    fn commandes_regles_et_branchement_concordent() {
        let build = include_str!("../build.rs");
        let lib = include_str!("lib.rs");
        let declarees: Vec<&str> = build
            .lines()
            .filter_map(|l| l.trim().strip_prefix('"').and_then(|l| l.strip_suffix("\",")))
            .collect();
        assert!(declarees.len() >= 10, "{declarees:?}");
        let lire = |brut: &str| -> Vec<String> {
            let json: serde_json::Value = serde_json::from_str(brut).unwrap();
            json["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|p| p.as_str())
                .filter_map(|p| p.strip_prefix("allow-"))
                .map(|p| p.replace('-', "_"))
                .collect()
        };
        let locales = lire(include_str!("../capabilities/locale.json"));
        let distantes = lire(include_str!("../capabilities/distante.json"));
        for c in &declarees {
            assert!(lib.contains(&format!("commandes::{c},")), "{c} n'est pas branchée dans run()");
            assert!(
                locales.contains(&c.to_string()) || distantes.contains(&c.to_string()),
                "{c} n'est permise nulle part"
            );
        }
        for c in locales.iter().chain(distantes.iter()) {
            assert!(declarees.contains(&c.as_str()), "{c} permise mais pas déclarée");
        }
        for reservee in ["bureau_adresse_lire", "bureau_adresse_normaliser", "bureau_adresse_enregistrer", "bureau_aller_tour", "bureau_note_locale", "bureau_notes_locales_compte"] {
            assert!(!distantes.contains(&reservee.to_string()), "{reservee} ouverte à une page distante");
        }
    }
}
