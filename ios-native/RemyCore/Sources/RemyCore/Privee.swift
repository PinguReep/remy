import Foundation

/// La recherche web dans les conversations privées, telle que la tour
/// l'applique (recherche-privee-v1) : de quoi dire en clair ce qui sort, et
/// ne renvoyer à Réglages que si l'interrupteur y est actionnable.
public enum EtatRecherchePrivee: Equatable, Sendable {
    /// Pas encore lu sur la tour.
    case inconnu
    /// Tour sans ce réglage : une conversation privée n'y cherche jamais.
    case sansReglage
    /// Permise par Sam : la recherche passe par la salle blanche et le filtre.
    case permise
    /// Coupée (par défaut) : l'interrupteur de Réglages la permettrait.
    case coupee
    /// La recherche web elle-même est coupée (Réglages ou tour) : rien ne sort,
    /// quoi que dise l'interrupteur privé.
    case webCoupee
    /// Verrouillée sur la tour (REMY_RECHERCHE_PRIVEE=off, salle blanche
    /// coupée, pas de recherche locale) : l'interrupteur est grisé.
    case verrouillee

    public static func de(_ r: Reglages) -> EtatRecherchePrivee {
        if r.verrouRecherchePrivee != nil { return .verrouillee }
        if r.rechercheWeb != true || r.rechercheWebCoupeeParLaTour == true { return .webCoupee }
        return r.recherchePrivee == true ? .permise : .coupee
    }
}

/// Une conversation privée (27/10, sur l'iPhone comme sur le site) : traitée
/// par le modèle local de la tour seulement. Ni Claude (même en secours), ni
/// la mémoire, ni la réflexion de la nuit. Pas de recherche web, sauf si Sam
/// l'a permise (recherche-privee-v1) : des questions générales sortent alors
/// vers le moteur, écrites par Rémy puis par la salle blanche, filtrées ; les
/// pages sont lues depuis la tour (lib/salle-blanche.js). Sans retour : la
/// tour refuse de rendre publique une conversation privée.
public enum ConversationPrivee {
    /// Ce qui sort quand la recherche est permise : une seule phrase, reprise
    /// par la conversation, Réglages et les Nouveautés.
    public static let ceQuiSort = "partent vers le moteur de recherche des questions générales, écrites par Rémy puis par la salle blanche (une recherche qui ne sait rien de toi) ; les pages trouvées sont lues depuis ta tour, et le filtre bloque noms, numéros et mots de cette conversation."

    /// Le modèle local éteint : une condition, pas un état.
    public static let sansModeleLocal = "Si le modèle local est éteint, Rémy ne répond pas : rien ne bascule vers Claude."

    /// Ce que ça change, dit en clair (écran vide, feuille, confirmation).
    public static func ceQueCaChange(_ etat: EtatRecherchePrivee) -> String {
        let local = "Rémy répond avec le modèle local de ta tour, n'en retient rien dans sa mémoire, et la réflexion de la nuit ne la lit pas."
        let web: String
        switch etat {
        case .permise: web = "Recherche web permise (Réglages) : " + ceQuiSort
        case .coupee: web = "Pas de recherche web (Réglages › Recherche dans les conversations privées pour la permettre)."
        case .webCoupee: web = "Pas de recherche web : elle est coupée (Réglages › Recherche web)."
        case .verrouillee: web = "Pas de recherche web : ta tour ne la permet pas dans une conversation privée."
        case .sansReglage: web = "Pas de recherche web dans une conversation privée."
        case .inconnu: web = "Pas de recherche web, sauf si tu l'as permise dans Réglages."
        }
        return sousTitre(etat) + " : " + local + " " + web + " " + sansModeleLocal
    }

    /// La promesse en quelques mots : « ni ailleurs » seulement quand rien
    /// d'autre ne peut sortir (recherche coupée, ou tour qui ne cherche pas).
    public static func sousTitre(_ etat: EtatRecherchePrivee) -> String {
        switch etat {
        case .permise, .inconnu: return "Rien ne part chez Claude"
        case .coupee, .webCoupee, .verrouillee, .sansReglage: return "Rien ne part chez Claude ni ailleurs"
        }
    }

    /// Avant de rendre privée la conversation en cours : sans retour, dit
    /// avant de confirmer.
    public static func confirmation(_ etat: EtatRecherchePrivee) -> String {
        "C'est sans retour : elle restera privée. Pour repasser par Claude, il faudra ouvrir une nouvelle conversation. "
            + ceQueCaChange(etat)
    }

    /// « Noter une idée » depuis une conversation privée : rien n'entre dans
    /// la mémoire.
    public static let pasDeMemoire = "Conversation privée : rien n'entre dans la mémoire. Ouvre une conversation ordinaire pour noter une idée."
}
