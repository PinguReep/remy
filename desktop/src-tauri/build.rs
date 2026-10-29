// Les commandes de l'app reçoivent chacune une permission `allow-<commande>` :
// une page n'appelle que ce que ses règles d'accès (`capabilities/`) listent.
const COMMANDES: &[&str] = &[
    "bureau_etat",
    "bureau_regler",
    "bureau_notifier",
    "bureau_noter_fermer",
    "bureau_ouvrir",
    "bureau_ouvrir_lien",
    "bureau_changer_adresse",
    "bureau_notes_attente",
    "bureau_notes_acquitter",
    "bureau_page_chargee",
    "bureau_adresse_lire",
    "bureau_adresse_normaliser",
    "bureau_adresse_enregistrer",
    "bureau_aller_tour",
    "bureau_note_locale",
    "bureau_notes_locales_compte",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDES)),
    )
    .expect("échec de la préparation de la compilation Tauri");
}
