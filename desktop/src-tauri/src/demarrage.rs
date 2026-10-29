//! Démarrer avec Windows : une valeur « Rémy » dans la clé `Run` de
//! l'utilisateur (pas d'administrateur), avec `--demarrage` (fenêtre cachée,
//! icône seule). Le nom est celui que le désinstallateur efface (`productName`).
//!
//! On passe par `auto-launch` directement plutôt que par le greffon autostart :
//! le greffon écrit le chemin du programme SANS guillemets, ce qui casse (ou
//! rend ambigu) un profil Windows dont le nom contient une espace.

use auto_launch::{AutoLaunch, AutoLaunchBuilder};

use crate::ARG_DEMARRAGE;

pub const NOM: &str = "Rémy";

/// La commande inscrite dans `Run` : chemin entre guillemets, puis l'argument.
pub fn chemin_inscrit(exe: &str) -> String {
    if cfg!(windows) {
        format!("\"{exe}\"")
    } else {
        exe.to_string()
    }
}

pub fn gestionnaire() -> Result<AutoLaunch, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Programme introuvable : {e}"))?;
    let chemin = chemin_inscrit(&exe.display().to_string());
    let mut b = AutoLaunchBuilder::new();
    b.set_app_name(NOM).set_app_path(&chemin).set_args(&[ARG_DEMARRAGE]);
    #[cfg(windows)]
    b.set_windows_enable_mode(auto_launch::WindowsEnableMode::CurrentUser);
    b.build().map_err(|e| format!("Démarrage avec Windows indisponible : {e}"))
}

pub fn actif() -> Result<bool, String> {
    gestionnaire()?.is_enabled().map_err(|e| e.to_string())
}

pub fn regler(oui: bool) -> Result<(), String> {
    let g = gestionnaire()?;
    let r = if oui { g.enable() } else { g.disable() };
    r.map_err(|e| format!("Windows a refusé de changer le démarrage automatique : {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_chemin_est_entre_guillemets_sous_windows() {
        let c = chemin_inscrit(r"C:\Users\Sam Martin\AppData\Local\Rémy\Remy.exe");
        if cfg!(windows) {
            assert_eq!(c, r#""C:\Users\Sam Martin\AppData\Local\Rémy\Remy.exe""#);
        } else {
            assert_eq!(c, r"C:\Users\Sam Martin\AppData\Local\Rémy\Remy.exe");
        }
    }
}
