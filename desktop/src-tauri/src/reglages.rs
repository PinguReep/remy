//! Ce que l'app garde sur ce PC, dans `%APPDATA%\com.pingureep.remy.bureau\` :
//! `bureau.json` (adresse de la tour et réglages de la coquille) et
//! `notes-en-attente.json` (notes tapées dans « Noter » quand le site n'a pas pu
//! se charger, effacées dès qu'il les a envoyées).
//!
//! Écriture atomique (fichier temporaire puis renommage) : une coupure de
//! courant ne laisse jamais un fichier à moitié écrit.

use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::raccourci;

pub const FICHIER_REGLAGES: &str = "bureau.json";
pub const FICHIER_NOTES: &str = "notes-en-attente.json";
pub const NOTES_MAX: usize = 200;
pub const NOTE_LONGUEUR_MAX: usize = 4000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Reglages {
    /// `https://hote[:port]`, propre (voir `adresse::normaliser`).
    pub adresse: Option<String>,
    /// Forme rangée (`Ctrl+Alt+Space`).
    pub raccourci: String,
    /// Démarrer avec Windows (fenêtre cachée, icône seule).
    pub demarrage: bool,
    /// Fermer la fenêtre la range près de l'horloge au lieu de quitter.
    pub fermer_dans_zone: bool,
    /// Le premier lancement a eu lieu (démarrage avec Windows posé une fois).
    pub premier_lancement_fait: bool,
    /// La notification « Rémy reste près de l'horloge » a été montrée.
    pub fermeture_expliquee: bool,
}

impl Default for Reglages {
    fn default() -> Self {
        Self {
            adresse: None,
            raccourci: raccourci::PAR_DEFAUT.into(),
            demarrage: true,
            fermer_dans_zone: true,
            premier_lancement_fait: false,
            fermeture_expliquee: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NoteLocale {
    pub id: String,
    pub texte: String,
    /// Moment de la saisie, ISO 8601 UTC.
    pub a: String,
}

pub fn ecrire_atomique(chemin: &Path, contenu: &[u8]) -> std::io::Result<()> {
    if let Some(dossier) = chemin.parent() {
        fs::create_dir_all(dossier)?;
    }
    let provisoire = chemin.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&provisoire)?;
        f.write_all(contenu)?;
        f.sync_all()?;
    }
    fs::rename(&provisoire, chemin)
}

/// Lit les réglages ; un fichier absent ou abîmé rend les valeurs par défaut
/// (l'app redemande alors l'adresse plutôt que de ne pas démarrer).
pub fn lire(dossier: &Path) -> Reglages {
    let chemin = dossier.join(FICHIER_REGLAGES);
    let mut r: Reglages = fs::read(&chemin)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    // Une valeur trafiquée à la main ne doit pas passer pour propre.
    r.adresse = r.adresse.as_deref().and_then(crate::adresse::normaliser);
    if raccourci::lire(&r.raccourci).is_err() {
        r.raccourci = raccourci::PAR_DEFAUT.into();
    }
    r
}

pub fn enregistrer(dossier: &Path, r: &Reglages) -> std::io::Result<()> {
    let json = serde_json::to_vec_pretty(r).map_err(std::io::Error::other)?;
    ecrire_atomique(&dossier.join(FICHIER_REGLAGES), &json)
}

pub fn lire_notes(dossier: &Path) -> Vec<NoteLocale> {
    fs::read(dossier.join(FICHIER_NOTES))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn enregistrer_notes(dossier: &Path, notes: &[NoteLocale]) -> std::io::Result<()> {
    let chemin = dossier.join(FICHIER_NOTES);
    if notes.is_empty() {
        return match fs::remove_file(&chemin) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        };
    }
    let json = serde_json::to_vec_pretty(notes).map_err(std::io::Error::other)?;
    ecrire_atomique(&chemin, &json)
}

/// Garde une note tapée hors ligne. Rend la note et le nombre en attente.
pub fn ajouter_note(dossier: &Path, texte: &str) -> Result<(NoteLocale, usize), String> {
    let texte = texte.trim();
    if texte.is_empty() {
        return Err("La note est vide.".into());
    }
    if texte.chars().count() > NOTE_LONGUEUR_MAX {
        return Err(format!("La note est trop longue (plus de {NOTE_LONGUEUR_MAX} caractères)."));
    }
    let mut notes = lire_notes(dossier);
    if notes.len() >= NOTES_MAX {
        return Err(format!(
            "Déjà {NOTES_MAX} notes en attente sur ce PC : ouvre Rémy quand la tour répond pour les envoyer."
        ));
    }
    let maintenant = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let mut id = format!("bureau-{}", maintenant.as_millis());
    let mut n = 1;
    while notes.iter().any(|x| x.id == id) {
        n += 1;
        id = format!("bureau-{}-{n}", maintenant.as_millis());
    }
    let note = NoteLocale {
        id,
        texte: texte.to_string(),
        a: iso8601(maintenant.as_secs()),
    };
    notes.push(note.clone());
    enregistrer_notes(dossier, &notes).map_err(|e| format!("Impossible de garder la note sur ce PC : {e}"))?;
    Ok((note, notes.len()))
}

/// Efface les notes que le site a bien envoyées.
pub fn acquitter_notes(dossier: &Path, ids: &[String]) -> Result<usize, String> {
    let mut notes = lire_notes(dossier);
    notes.retain(|n| !ids.contains(&n.id));
    enregistrer_notes(dossier, &notes).map_err(|e| format!("Impossible d'effacer les notes envoyées : {e}"))?;
    Ok(notes.len())
}

/// `secondes` depuis 1970 → `AAAA-MM-JJTHH:MM:SSZ` (algorithme des jours civils).
pub fn iso8601(secondes: u64) -> String {
    let jours = (secondes / 86_400) as i64;
    let reste = secondes % 86_400;
    let z = jours + 719_468;
    let ere = z.div_euclid(146_097);
    let jde = z.rem_euclid(146_097);
    let ade = (jde - jde / 1460 + jde / 36_524 - jde / 146_096) / 365;
    let a = ade + ere * 400;
    let jda = jde - (365 * ade + ade / 4 - ade / 100);
    let mp = (5 * jda + 2) / 153;
    let j = jda - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let a = if m <= 2 { a + 1 } else { a };
    format!(
        "{a:04}-{m:02}-{j:02}T{:02}:{:02}:{:02}Z",
        reste / 3600,
        (reste % 3600) / 60,
        reste % 60
    )
}

/// Le dossier des données de test : un dossier neuf, jamais le vrai profil.
#[cfg(test)]
pub fn dossier_de_test(nom: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("remy-bureau-test-{nom}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    d
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn premier_lancement_valeurs_par_defaut() {
        let d = dossier_de_test("defaut");
        let r = lire(&d);
        assert_eq!(r.adresse, None);
        assert_eq!(r.raccourci, "Ctrl+Alt+Space");
        assert!(r.demarrage, "démarrage avec Windows allumé par défaut");
        assert!(r.fermer_dans_zone);
        assert!(!r.premier_lancement_fait);
    }

    #[test]
    fn les_reglages_survivent_a_un_redemarrage() {
        let d = dossier_de_test("aller-retour");
        let r = Reglages {
            adresse: Some("https://ma-tour.mon-tailnet.ts.net:8444".into()),
            raccourci: "Ctrl+Shift+N".into(),
            demarrage: false,
            fermer_dans_zone: false,
            premier_lancement_fait: true,
            fermeture_expliquee: true,
        };
        enregistrer(&d, &r).unwrap();
        assert_eq!(lire(&d), r);
        let brut = fs::read_to_string(d.join(FICHIER_REGLAGES)).unwrap();
        assert!(brut.contains("\"fermerDansZone\""), "clés en camelCase : {brut}");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn un_fichier_abime_ou_trafique_ne_bloque_pas() {
        let d = dossier_de_test("abime");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join(FICHIER_REGLAGES), b"{ pas du json").unwrap();
        assert_eq!(lire(&d), Reglages::default());
        fs::write(
            d.join(FICHIER_REGLAGES),
            br#"{"adresse":"http://ma-tour.ts.net:8444","raccourci":"N","demarrage":false}"#,
        )
        .unwrap();
        let r = lire(&d);
        assert_eq!(r.adresse, None, "adresse en clair refusée même écrite à la main");
        assert_eq!(r.raccourci, "Ctrl+Alt+Space");
        assert!(!r.demarrage, "les autres valeurs sont gardées");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn les_notes_de_secours_sont_gardees_puis_effacees() {
        let d = dossier_de_test("notes");
        assert!(lire_notes(&d).is_empty());
        let (n1, total) = ajouter_note(&d, "  Rappeler Léa pour le devis  ").unwrap();
        assert_eq!(total, 1);
        assert_eq!(n1.texte, "Rappeler Léa pour le devis");
        assert!(n1.id.starts_with("bureau-"));
        assert!(n1.a.ends_with('Z') && n1.a.len() == 20, "{}", n1.a);
        let (n2, total) = ajouter_note(&d, "Commander des mèches pour les bougies").unwrap();
        assert_eq!(total, 2);
        assert_ne!(n1.id, n2.id);
        assert!(ajouter_note(&d, "   ").is_err());
        assert!(ajouter_note(&d, &"a".repeat(NOTE_LONGUEUR_MAX + 1)).is_err());
        assert_eq!(acquitter_notes(&d, &[n1.id.clone()]).unwrap(), 1);
        assert_eq!(lire_notes(&d), vec![n2.clone()]);
        assert_eq!(acquitter_notes(&d, &[n2.id]).unwrap(), 0);
        assert!(!d.join(FICHIER_NOTES).exists(), "plus rien en attente : plus de fichier");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn la_file_de_secours_est_bornee() {
        let d = dossier_de_test("borne");
        let notes: Vec<NoteLocale> = (0..NOTES_MAX)
            .map(|i| NoteLocale { id: format!("n{i}"), texte: "x".into(), a: iso8601(0) })
            .collect();
        enregistrer_notes(&d, &notes).unwrap();
        assert!(ajouter_note(&d, "une de trop").unwrap_err().contains("en attente"));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn dates_iso() {
        assert_eq!(iso8601(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(iso8601(1_793_260_800), "2026-10-29T08:00:00Z");
        assert_eq!(iso8601(4_107_542_399), "2100-02-28T23:59:59Z");
    }
}
