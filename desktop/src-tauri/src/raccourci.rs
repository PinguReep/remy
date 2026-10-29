//! Le raccourci global « Noter » (Ctrl+Alt+Espace par défaut, réglable).
//!
//! On accepte l'écriture anglaise de Tauri (« Ctrl+Alt+Space ») comme la
//! française (« Ctrl+Alt+Espace », « Maj », « Win »), on la range sous une forme
//! unique, et on refuse un raccourci sans vrai modificateur : une lettre seule
//! (ou Maj+lettre) volerait la frappe dans toutes les applications. Sous
//! Windows, AltGr vaut Ctrl+Alt : Ctrl+Alt+0 volerait « @ » sur un clavier
//! français (Ctrl+Alt+E « € », Ctrl+Alt+3 « # »…), d'où le refus de Ctrl+Alt
//! + une touche qui écrit, sans Maj ni Win en plus.

use std::str::FromStr;

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState};

pub const PAR_DEFAUT: &str = "Ctrl+Alt+Space";

/// Un raccourci lu : la forme rangée (re-lisible) et l'objet du greffon.
#[derive(Debug, Clone, PartialEq)]
pub struct Raccourci {
    pub texte: String,
    pub touche: Shortcut,
}

fn jeton_anglais(jeton: &str) -> String {
    match jeton.trim().to_lowercase().as_str() {
        "maj" | "majuscule" => "Shift".into(),
        "win" | "windows" | "meta" => "Super".into(),
        "espace" => "Space".into(),
        "entrée" | "entree" | "retour" => "Enter".into(),
        "échap" | "echap" | "esc" => "Escape".into(),
        "tab" | "tabulation" => "Tab".into(),
        "suppr" => "Delete".into(),
        "ctl" | "contrôle" | "controle" => "Ctrl".into(),
        _ => jeton.trim().to_string(),
    }
}

/// Une touche qui écrit un caractère (lettres, chiffres, ponctuation) : avec
/// AltGr, elle en écrit souvent un autre (@ # € { [ | …).
fn touche_ecrit(code: Code) -> bool {
    let nom = code.to_string();
    nom.starts_with("Key")
        || nom.starts_with("Digit")
        || matches!(
            code,
            Code::Backquote
                | Code::Minus
                | Code::Equal
                | Code::BracketLeft
                | Code::BracketRight
                | Code::Backslash
                | Code::Semicolon
                | Code::Quote
                | Code::Comma
                | Code::Period
                | Code::Slash
                | Code::IntlBackslash
                | Code::IntlRo
                | Code::IntlYen
        )
}

fn nom_touche(code: Code) -> String {
    let brut = code.to_string();
    if let Some(lettre) = brut.strip_prefix("Key") {
        return lettre.to_string();
    }
    if let Some(chiffre) = brut.strip_prefix("Digit") {
        return chiffre.to_string();
    }
    brut
}

/// Lit un raccourci saisi. `Err` dit quoi faire, en français.
pub fn lire(texte: &str) -> Result<Raccourci, String> {
    let texte = texte.trim();
    if texte.is_empty() || texte.len() > 64 {
        return Err("Raccourci invalide : donne une combinaison comme Ctrl+Alt+Espace.".into());
    }
    let anglais = texte.split('+').map(jeton_anglais).collect::<Vec<_>>().join("+");
    let touche = Shortcut::from_str(&anglais)
        .map_err(|_| format!("Raccourci invalide : « {texte} » n'est pas une combinaison connue (exemple : Ctrl+Alt+Espace)."))?;
    let vrais = Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER;
    if !touche.mods.intersects(vrais) {
        return Err("Raccourci invalide : il faut au moins Ctrl, Alt ou Win, sinon il volerait la frappe partout.".into());
    }
    if matches!(
        touche.key,
        Code::ControlLeft
            | Code::ControlRight
            | Code::AltLeft
            | Code::AltRight
            | Code::ShiftLeft
            | Code::ShiftRight
            | Code::MetaLeft
            | Code::MetaRight
    ) {
        return Err("Raccourci invalide : il faut une touche en plus des modificateurs.".into());
    }
    if touche.mods.contains(Modifiers::CONTROL | Modifiers::ALT)
        && !touche.mods.intersects(Modifiers::SHIFT | Modifiers::SUPER)
        && touche_ecrit(touche.key)
    {
        return Err(format!(
            "Raccourci refusé : Ctrl+Alt+{} vaut AltGr+{} sous Windows, qui écrit un caractère sur un clavier français (@, #, €, {{…). Ajoute Maj ou Win, ou prends Espace, Entrée ou une touche F1 à F12.",
            nom_touche(touche.key),
            nom_touche(touche.key)
        ));
    }
    let mut morceaux: Vec<&str> = Vec::new();
    if touche.mods.contains(Modifiers::CONTROL) {
        morceaux.push("Ctrl");
    }
    if touche.mods.contains(Modifiers::ALT) {
        morceaux.push("Alt");
    }
    if touche.mods.contains(Modifiers::SHIFT) {
        morceaux.push("Shift");
    }
    if touche.mods.contains(Modifiers::SUPER) {
        morceaux.push("Super");
    }
    let nom = nom_touche(touche.key);
    morceaux.push(&nom);
    let rangee = morceaux.join("+");
    // La forme rangée doit se relire à l'identique (sinon on la refuserait au
    // prochain démarrage).
    match Shortcut::from_str(&rangee) {
        Ok(relu) if relu == touche => Ok(Raccourci { texte: rangee, touche }),
        _ => Err(format!("Raccourci invalide : « {texte} » n'est pas pris en charge.")),
    }
}

/// Pour les menus et les messages : « Ctrl+Alt+Espace ».
pub fn libelle(texte: &str) -> String {
    texte
        .split('+')
        .map(|j| match j {
            "Space" => "Espace",
            "Shift" => "Maj",
            "Super" => "Win",
            "Enter" => "Entrée",
            "Escape" => "Échap",
            "Delete" => "Suppr",
            autre => autre,
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// Pose `nouveau` à la place d'`ancien`. Si Windows le refuse (déjà pris par
/// une autre application), l'ancien reste actif et l'erreur le dit.
pub fn remplacer(app: &AppHandle, ancien: Option<&Raccourci>, nouveau: &Raccourci) -> Result<(), String> {
    let gs = app.global_shortcut();
    if let Some(a) = ancien {
        if a.touche == nouveau.touche && gs.is_registered(a.touche) {
            return Ok(());
        }
        let _ = gs.unregister(a.touche);
    }
    match gs.register(nouveau.touche) {
        Ok(()) => Ok(()),
        Err(e) => {
            if let Some(a) = ancien {
                let _ = gs.register(a.touche);
            }
            Err(format!(
                "Déjà pris par une autre application : {} est refusé par Windows ({e}). L'ancien raccourci reste actif.",
                libelle(&nouveau.texte)
            ))
        }
    }
}

/// Le greffon appelle ceci pour chaque raccourci : on n'en a qu'un, Noter.
pub fn sur_raccourci(app: &AppHandle, _touche: &Shortcut, evenement: ShortcutEvent) {
    if evenement.state() == ShortcutState::Pressed {
        crate::fenetres::basculer_noter(app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_raccourci_par_defaut_se_lit() {
        let r = lire(PAR_DEFAUT).unwrap();
        assert_eq!(r.texte, "Ctrl+Alt+Space");
        assert_eq!(libelle(&r.texte), "Ctrl+Alt+Espace");
    }

    #[test]
    fn l_ecriture_francaise_est_comprise() {
        assert_eq!(lire("Ctrl+Alt+Espace").unwrap().texte, "Ctrl+Alt+Space");
        assert_eq!(lire("ctrl + maj + n").unwrap().texte, "Ctrl+Shift+N");
        assert_eq!(lire("Win+Alt+R").unwrap().texte, "Alt+Super+R");
        assert_eq!(lire("Alt+Ctrl+Maj+1").unwrap().texte, "Ctrl+Alt+Shift+1");
        assert_eq!(lire("Ctrl+Alt+F9").unwrap().texte, "Ctrl+Alt+F9");
        assert_eq!(libelle("Ctrl+Shift+Space"), "Ctrl+Maj+Espace");
    }

    #[test]
    fn la_forme_rangee_se_relit_a_l_identique() {
        for t in ["Ctrl+Alt+Space", "Ctrl+Shift+N", "Alt+Super+R", "Ctrl+Alt+Shift+1", "Ctrl+Alt+F12", "Ctrl+Alt+Enter"] {
            let r = lire(t).unwrap();
            assert_eq!(lire(&r.texte).unwrap(), r, "{t}");
        }
    }

    #[test]
    fn un_raccourci_qui_volerait_la_frappe_est_refuse() {
        for t in ["N", "Shift+N", "Maj+Espace", "", "Ctrl+Alt", "Ctrl+", "Ctrl+Alt+Truc", "Ctrl+N+M"] {
            assert!(lire(t).is_err(), "{t} devrait être refusé");
        }
        assert!(lire("N").unwrap_err().starts_with("Raccourci invalide"));
    }

    #[test]
    fn ctrl_alt_plus_une_touche_qui_ecrit_est_refuse_altgr() {
        // AltGr = Ctrl+Alt sous Windows : AltGr+0 « @ », AltGr+E « € »,
        // AltGr+3 « # », AltGr+) « ] » sur un clavier français.
        for t in ["Ctrl+Alt+0", "Alt+Ctrl+1", "Ctrl+Alt+E", "Ctrl+Alt+3", "Ctrl+Alt+Minus", "Ctrl+Alt+BracketRight", "Ctrl+Alt+Equal"] {
            let e = lire(t).expect_err(t);
            assert!(e.contains("AltGr") && e.contains("Maj ou Win"), "{t} : {e}");
        }
        // Avec Maj ou Win en plus, ou une touche qui n'écrit pas : permis.
        for t in ["Ctrl+Alt+Maj+E", "Ctrl+Alt+Win+0", "Ctrl+Alt+Espace", "Ctrl+Alt+Entrée", "Ctrl+Alt+F1", "Ctrl+Alt+F12", "Ctrl+Maj+N", "Alt+Win+R", "Ctrl+E"] {
            assert!(lire(t).is_ok(), "{t} devrait être permis : {:?}", lire(t));
        }
        assert_eq!(lire(PAR_DEFAUT).unwrap().texte, "Ctrl+Alt+Space", "le défaut n'est pas touché");
    }
}
