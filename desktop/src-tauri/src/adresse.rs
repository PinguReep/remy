//! L'adresse de la tour : saisie une fois, gardée sur ce PC, jamais dans le code
//! (dépôt public). Mêmes règles que l'iPhone (`ClientAPI.normaliserAdresse`) :
//! `https://` vers un hôte avec un point, `http://` seulement en local ; ni
//! chemin, ni requête, ni identifiants.
//!
//! Et le second verrou des commandes natives : la page qui appelle doit venir
//! exactement de cette adresse (ou des pages embarquées dans l'app).

use url::Url;

/// Rend l'adresse propre (`https://hote[:port]`, sans `/` final) ou `None`.
pub fn normaliser(texte: &str) -> Option<String> {
    let mut t = texte.trim().to_string();
    if t.is_empty() || t.contains("$(") || t.chars().any(char::is_whitespace) {
        return None;
    }
    if !t.contains("://") {
        t = format!("https://{t}");
    }
    while t.ends_with('/') {
        t.pop();
    }
    let url = Url::parse(&t).ok()?;
    let hote = url.host_str()?.to_string();
    if hote.is_empty() || !(hote.contains('.') || hote == "localhost") {
        return None;
    }
    // `Url` met « / » pour un chemin vide : seul celui-là est accepté.
    if url.path() != "/" && !url.path().is_empty() {
        return None;
    }
    if url.query().is_some() || url.fragment().is_some() {
        return None;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let local = hote == "localhost" || hote == "127.0.0.1";
    match url.scheme() {
        "https" => {}
        "http" if local => {}
        _ => return None,
    }
    // `Url` a déjà mis l'hôte en minuscules et retiré le port par défaut.
    Some(match url.port() {
        Some(port) => format!("{}://{}:{}", url.scheme(), hote, port),
        None => format!("{}://{}", url.scheme(), hote),
    })
}

/// La page `url` vient-elle exactement de la tour configurée (même schéma,
/// même hôte, même port) ? Une autre machine du tailnet, un autre port : non.
pub fn meme_origine(url: &Url, adresse: &str) -> bool {
    match Url::parse(adresse) {
        Ok(a) => {
            matches!(url.scheme(), "http" | "https")
                && url.origin().is_tuple()
                && url.origin() == a.origin()
        }
        Err(_) => false,
    }
}

/// Une page embarquée dans l'app (`tauri://localhost` ailleurs, et
/// `http(s)://tauri.localhost` sous Windows).
pub fn est_page_locale(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => url.host_str() == Some("tauri.localhost") && url.port().is_none(),
        _ => false,
    }
}

/// Un lien que l'on peut confier au navigateur par défaut : `http(s)` seulement,
/// sans identifiants, longueur bornée.
pub fn lien_externe(texte: &str) -> Option<Url> {
    if texte.len() > 2048 {
        return None;
    }
    let url = Url::parse(texte.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return None;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    Some(url)
}

/// Une vue du site (`aujourdhui`, `reglages/ordinateur`…) : de quoi construire
/// un `#/…`, rien d'autre.
pub fn vue_valide(vue: &str) -> bool {
    !vue.is_empty()
        && vue.len() <= 64
        && vue
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '/' || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn une_adresse_saisie_est_normalisee() {
        assert_eq!(
            normaliser("ma-tour.mon-tailnet.ts.net:8444").as_deref(),
            Some("https://ma-tour.mon-tailnet.ts.net:8444")
        );
        assert_eq!(
            normaliser("  HTTPS://Ma-Tour.Mon-Tailnet.ts.net:8444/  ").as_deref(),
            Some("https://ma-tour.mon-tailnet.ts.net:8444")
        );
        assert_eq!(normaliser("http://localhost:3000").as_deref(), Some("http://localhost:3000"));
        assert_eq!(normaliser("http://127.0.0.1:3010/").as_deref(), Some("http://127.0.0.1:3010"));
        assert_eq!(normaliser("https://remy.exemple.org:443").as_deref(), Some("https://remy.exemple.org"));
    }

    #[test]
    fn une_adresse_douteuse_est_refusee() {
        for (texte, pourquoi) in [
            ("", "vide"),
            ("$(REMY_ADRESSE_TOUR)", "réglage de compilation vide"),
            ("http://ma-tour.mon-tailnet.ts.net:8444", "jamais en clair hors du PC"),
            ("https://ma-tour.ts.net/api/health", "un hôte, pas une page"),
            ("https://ma-tour.ts.net/?x=1", "pas de requête"),
            ("https://ma-tour.ts.net/#/remy", "pas de fragment"),
            ("https://sam:secret@ma-tour.ts.net", "pas d'identifiants"),
            ("pas une adresse", "des espaces"),
            ("https://machine", "un hôte sans point"),
            ("ftp://ma-tour.ts.net", "autre schéma"),
            ("javascript:alert(1)", "autre schéma"),
            ("file:///C:/Windows", "fichier"),
        ] {
            assert_eq!(normaliser(texte), None, "{texte} : {pourquoi}");
        }
    }

    #[test]
    fn seule_l_origine_configuree_passe() {
        let tour = "https://ma-tour.mon-tailnet.ts.net:8444";
        let ok = |u: &str| meme_origine(&Url::parse(u).unwrap(), tour);
        assert!(ok("https://ma-tour.mon-tailnet.ts.net:8444/"));
        assert!(ok("https://ma-tour.mon-tailnet.ts.net:8444/?fenetre=noter#/aujourdhui"));
        assert!(!ok("https://ma-tour.mon-tailnet.ts.net/"), "autre port");
        assert!(!ok("https://ma-tour.mon-tailnet.ts.net:8445/"), "autre port");
        assert!(!ok("http://ma-tour.mon-tailnet.ts.net:8444/"), "en clair");
        assert!(!ok("https://autre-machine.mon-tailnet.ts.net:8444/"), "autre machine du tailnet");
        assert!(!ok("https://ma-tour.mon-tailnet.ts.net.exemple.org:8444/"), "suffixe piégé");
        assert!(!ok("tauri://localhost/demarrage.html"));
        assert!(!meme_origine(&Url::parse("https://ma-tour.ts.net/").unwrap(), "pas une url"));
    }

    #[test]
    fn les_pages_embarquees_sont_reconnues() {
        let local = |u: &str| est_page_locale(&Url::parse(u).unwrap());
        assert!(local("tauri://localhost/demarrage.html"));
        assert!(local("http://tauri.localhost/noter.html"));
        assert!(local("https://tauri.localhost/noter.html"));
        assert!(!local("http://tauri.localhost:8080/"), "un serveur local quelconque");
        assert!(!local("https://tauri.localhost.exemple.org/"));
        assert!(!local("http://localhost:3000/"));
        assert!(!local("https://ma-tour.ts.net/"));
    }

    #[test]
    fn seuls_les_liens_web_partent_au_navigateur() {
        assert!(lien_externe("https://exemple.org/page?x=1").is_some());
        assert!(lien_externe("http://exemple.org").is_some());
        assert!(lien_externe("file:///C:/Windows/System32/calc.exe").is_none());
        assert!(lien_externe("ms-settings:privacy").is_none());
        assert!(lien_externe("javascript:alert(1)").is_none());
        assert!(lien_externe("https://sam:mdp@exemple.org").is_none());
        assert!(lien_externe(&format!("https://exemple.org/{}", "a".repeat(3000))).is_none());
    }

    #[test]
    fn une_vue_n_est_qu_un_chemin_simple() {
        assert!(vue_valide("aujourdhui"));
        assert!(vue_valide("reglages/ordinateur"));
        assert!(vue_valide("remy/conv_12"));
        assert!(!vue_valide(""));
        assert!(!vue_valide("javascript:alert(1)"));
        assert!(!vue_valide("../../etc"));
        assert!(!vue_valide(&"a".repeat(65)));
    }

    /// Les motifs de `capabilities/distante.json` (règles d'accès de Tauri) :
    /// la tour du tailnet et le développement local, rien d'autre.
    #[test]
    fn les_regles_d_acces_distantes_sont_generiques_et_etroites() {
        use std::str::FromStr;
        use tauri::utils::acl::RemoteUrlPattern;
        let brut = include_str!("../capabilities/distante.json");
        let json: serde_json::Value = serde_json::from_str(brut).unwrap();
        let motifs: Vec<RemoteUrlPattern> = json["remote"]["urls"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| RemoteUrlPattern::from_str(m.as_str().unwrap()).unwrap())
            .collect();
        let passe = |u: &str| {
            let url = Url::parse(u).unwrap();
            motifs.iter().any(|m| m.test(&url))
        };
        assert!(passe("https://ma-tour.mon-tailnet.ts.net:8444/"));
        assert!(passe("https://ma-tour.mon-tailnet.ts.net:8444/?fenetre=noter"));
        assert!(passe("https://ma-tour.mon-tailnet.ts.net/"));
        assert!(passe("http://localhost:3010/"));
        assert!(passe("http://127.0.0.1:3010/"));
        assert!(!passe("http://ma-tour.mon-tailnet.ts.net:8444/"), "en clair");
        assert!(!passe("https://exemple.org/"));
        assert!(!passe("https://ts.net.exemple.org/"));
        assert!(!passe("https://ma-tour.ts.net.exemple.org:8444/"));
        assert!(!passe("http://localhost.exemple.org/"));
        // Aucune adresse propre à une tour dans les règles (dépôt public).
        assert!(!brut.contains("8444"));
        let permissions = json["permissions"].as_array().unwrap();
        for p in permissions {
            let p = p.as_str().unwrap();
            assert!(
                p.starts_with("allow-bureau-") || p == "core:event:allow-listen" || p == "core:event:allow-unlisten",
                "permission inattendue pour une page distante : {p}"
            );
        }
        assert_eq!(json["local"], serde_json::Value::Bool(false));
    }
}
