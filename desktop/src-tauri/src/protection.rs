//! Les notes de secours sont des données personnelles : chiffrées au repos.
//!
//! Sous Windows, par DPAPI (`CryptProtectData`, portée de l'utilisateur) : seul
//! ce compte Windows, sur ce PC, peut les relire ; une copie du fichier, un
//! autre compte ou un disque lu ailleurs ne voient que du bruit. Pas de clé à
//! garder nous-mêmes. Hors Windows (tests, essai de fumée sous Linux), le
//! contenu reste en clair : rien n'y est installé pour de vrai.
//!
//! Format sous Windows : l'en-tête `ENTETE` puis le bloc DPAPI.

/// Marque un fichier chiffré par DPAPI.
pub const ENTETE: &[u8] = b"REMY-DPAPI-1\n";

/// Ce qu'on écrit sur le disque.
pub fn sceller(clair: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        let mut v = ENTETE.to_vec();
        v.extend(dpapi::proteger(clair)?);
        Ok(v)
    }
    #[cfg(not(windows))]
    {
        Ok(clair.to_vec())
    }
}

/// Ce qu'on relit. Un contenu sans en-tête est un fichier en clair (écrit hors
/// Windows, ou par la version 0.1.0) : relu tel quel, chiffré à la prochaine
/// écriture.
pub fn ouvrir(octets: &[u8]) -> Result<Vec<u8>, String> {
    match octets.strip_prefix(ENTETE) {
        #[cfg(windows)]
        Some(bloc) => dpapi::deproteger(bloc),
        #[cfg(not(windows))]
        Some(_) => Err("fichier chiffré par Windows : illisible ici".into()),
        None => Ok(octets.to_vec()),
    }
}

#[cfg(windows)]
mod dpapi {
    use std::ptr::{null, null_mut};

    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    /// Lie le chiffré à cette app (une autre app du même compte qui appelle
    /// DPAPI sans cette valeur ne le relit pas par mégarde).
    const ENTROPIE: &[u8] = b"com.pingureep.remy.bureau/notes-en-attente";

    fn bloc(octets: &[u8]) -> Result<CRYPT_INTEGER_BLOB, String> {
        let taille = u32::try_from(octets.len()).map_err(|_| "données trop grandes".to_string())?;
        Ok(CRYPT_INTEGER_BLOB { cbData: taille, pbData: octets.as_ptr() as *mut u8 })
    }

    /// Copie le résultat de DPAPI puis rend sa mémoire à Windows.
    unsafe fn prendre(sortie: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        if sortie.pbData.is_null() {
            return Vec::new();
        }
        let v = std::slice::from_raw_parts(sortie.pbData, sortie.cbData as usize).to_vec();
        LocalFree(sortie.pbData as *mut core::ffi::c_void);
        v
    }

    pub fn proteger(clair: &[u8]) -> Result<Vec<u8>, String> {
        let entree = bloc(clair)?;
        let entropie = bloc(ENTROPIE)?;
        let mut sortie = CRYPT_INTEGER_BLOB { cbData: 0, pbData: null_mut() };
        // SAFETY : tampons valides pendant l'appel ; `sortie` alloué par
        // Windows, libéré par `prendre`.
        let ok = unsafe {
            CryptProtectData(&entree, null(), &entropie, null(), null(), CRYPTPROTECT_UI_FORBIDDEN, &mut sortie)
        };
        if ok == 0 {
            return Err(format!("chiffrement Windows refusé ({})", std::io::Error::last_os_error()));
        }
        Ok(unsafe { prendre(sortie) })
    }

    pub fn deproteger(chiffre: &[u8]) -> Result<Vec<u8>, String> {
        let entree = bloc(chiffre)?;
        let entropie = bloc(ENTROPIE)?;
        let mut sortie = CRYPT_INTEGER_BLOB { cbData: 0, pbData: null_mut() };
        // SAFETY : comme `proteger`.
        let ok = unsafe {
            CryptUnprotectData(&entree, null_mut(), &entropie, null(), null(), CRYPTPROTECT_UI_FORBIDDEN, &mut sortie)
        };
        if ok == 0 {
            return Err(format!(
                "Windows n'a pas pu le déchiffrer (autre compte, autre PC, ou profil réinitialisé : {})",
                std::io::Error::last_os_error()
            ));
        }
        Ok(unsafe { prendre(sortie) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_contenu_scelle_se_rouvre() {
        let clair = "Rappeler Léa pour le devis".as_bytes();
        let scelle = sceller(clair).unwrap();
        assert_eq!(ouvrir(&scelle).unwrap(), clair);
        assert_eq!(ouvrir(clair).unwrap(), clair, "un ancien fichier en clair se relit");
    }

    #[cfg(windows)]
    #[test]
    fn sous_windows_le_disque_ne_voit_jamais_le_texte() {
        let clair = "Rappeler Léa pour le devis".as_bytes();
        let scelle = sceller(clair).unwrap();
        assert!(scelle.starts_with(ENTETE));
        assert!(!scelle.windows(clair.len()).any(|w| w == clair), "texte en clair dans le fichier");
        let mut abime = scelle.clone();
        let dernier = abime.len() - 1;
        abime[dernier] ^= 0xFF;
        assert!(ouvrir(&abime).is_err(), "un bloc abîmé est refusé");
    }

    #[cfg(not(windows))]
    #[test]
    fn hors_windows_un_fichier_chiffre_est_illisible() {
        let mut faux = ENTETE.to_vec();
        faux.extend_from_slice(b"\x01\x02\x03");
        assert!(ouvrir(&faux).is_err());
    }
}
