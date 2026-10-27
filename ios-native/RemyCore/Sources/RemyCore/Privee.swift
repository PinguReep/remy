import Foundation

/// Une conversation privée (27/10, sur l'iPhone comme sur le site) : traitée
/// par le modèle local de la tour seulement. Ni Claude (même en secours), ni
/// la mémoire, ni la réflexion de la nuit. Pas de recherche web, sauf si Sam
/// l'a permise (recherche-privee-v1) : la question seule sort alors, passée
/// par la salle blanche et le filtre. Sans retour : la tour refuse de rendre
/// publique une conversation privée.
public enum ConversationPrivee {
    /// Ce que ça change, dit en clair (en-tête, écran vide, confirmation).
    /// `recherche` : la recherche dans les conversations privées s'applique
    /// (nil : inconnu, ou tour sans ce réglage — elle ne cherche pas).
    public static func ceQueCaChange(recherche: Bool?) -> String {
        let base = "Rien ne part chez Claude ni ailleurs : Rémy répond avec le modèle local de ta tour, n'en retient rien dans sa mémoire, et la réflexion de la nuit ne la lit pas."
        let web = recherche == true
            ? "Recherche web permise (Réglages) : seule la question sort, passée par la salle blanche et le filtre."
            : "Pas de recherche web (Réglages › Recherche dans les conversations privées pour la permettre)."
        return base + " " + web + " Modèle local éteint : Rémy ne peut pas y répondre."
    }

    /// Avant de rendre privée la conversation en cours : sans retour, dit
    /// avant de confirmer.
    public static func confirmation(recherche: Bool?) -> String {
        "C'est sans retour : elle restera privée. Pour repasser par Claude, il faudra ouvrir une nouvelle conversation. "
            + ceQueCaChange(recherche: recherche)
    }

    /// Le refus de la tour (400) : une conversation privée le reste.
    public static let sansRetour = "Une conversation privée le reste : ouvre-en une nouvelle pour passer par Claude."
}
