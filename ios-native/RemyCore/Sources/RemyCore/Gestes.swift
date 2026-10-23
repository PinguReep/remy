import Foundation

// Gestes de l'accueil au-delà de Motion (retours TestFlight 13) : commencer
// une tâche plus tôt, et gérer une activité de l'agenda comme une tâche.
//
// L'API Motion ne sait ni avancer ni verrouiller une tâche : « commencée »
// vit dans Remy (taches-etat-v2), Motion est prévenu à la fin (Terminer).
// Le seul vrai cadenas est un événement de l'agenda : une activité à soi
// (« Aspirateur ») se décale, se prolonge, se marque faite ; un rendez-vous
// avec d'autres personnes ne se modifie jamais d'un geste (agenda-gestes-v1).

extension TableauModel {
    /// « Commencer maintenant » : la tâche devient l'élément en cours tout de
    /// suite (sans attendre la tour), pour sa durée Motion.
    @discardableResult
    public func commencer(id: String, titre: String, duree: Int?) async -> Bool {
        let fin = Mesures.partagees.chrono("app.geste")
        let maintenant = Date().millis
        let defaire = deplacerEnCours(id: id, titre: titre, duree: duree ?? 30, depuis: maintenant)
        do {
            try await api.etatTache(id, ["commencee": maintenant])
            fin()
            app?.dire("« \(titre) » commencée. Motion sera prévenu quand tu la termines.", annuler: { [weak self] in
                Task { await self?.arreter(id: id, titre: titre) }
            })
            if let e = donnees?.journee?.items?.first(where: { $0.type == "tache" && $0.id == id }) {
                await surCommencee?(e)
            }
            return true
        } catch {
            defaire()
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return false }
            app?.dire("« \(titre) » n'a pas pu être commencée : \((error as? LocalizedError)?.errorDescription ?? "erreur").")
            return false
        }
    }

    /// Annule « commencer » : la tâche retrouve sa place dans Motion.
    public func arreter(id: String, titre: String) async {
        do {
            try await api.etatTache(id, ["commencee": false])
            app?.dire("« \(titre) » : remise à sa place.")
            await charger()
        } catch {
            app?.signaler(error)
        }
    }

    /// Une activité de l'agenda faite (ou pas) : gardé dans Remy, l'agenda ne change pas.
    public func marquerFaite(_ e: ElementJour, fait: Bool) async {
        let defaire = modifierLocal(e.id, type: "rdv") { $0.fait = fait }
        do {
            try await api.etatTache("rdv:" + e.id, ["fait": fait])
        } catch {
            defaire?()
            if let er = error as? ErreurAPI, er == .nonConnecte { app?.signaler(er); return }
            app?.dire("« \(e.titre) » n'a pas pu être marquée : \((error as? LocalizedError)?.errorDescription ?? "erreur").")
        }
    }

    /// Décaler une activité de l'agenda (sa durée reste). Jamais un rendez-vous avec d'autres.
    @discardableResult
    public func decaler(_ e: ElementJour, a debut: Date) async -> Bool {
        guard e.estActivite else {
            app?.dire("« \(e.titre) » a d'autres participants : déplace-le dans ton agenda ou demande à Rémy.")
            return false
        }
        let duree = e.finEffective - e.debut
        let defaire = modifierLocal(e.id, type: "rdv") {
            $0.debut = debut.millis
            $0.fin = debut.millis + duree
        }
        return await agenda(e, resume: "Décalée depuis l'app", action: ActionProposee(type: "modifier", titre: e.titre, debut: Format.isoAvecFuseau(debut), id: e.id),
                            succes: "« \(e.titre) » : à \(Format.heure(debut)).", defaire: defaire)
    }

    /// Prolonger une activité de l'agenda (la fin seule bouge).
    @discardableResult
    public func prolongerActivite(_ e: ElementJour, de minutes: Int) async -> Bool {
        guard e.estActivite else { return false }
        let nouvelle = Int(((e.finEffective - e.debut) / 60_000).rounded()) + minutes
        let defaire = modifierLocal(e.id, type: "rdv") { $0.fin = $0.debut + Double(nouvelle) * 60_000 }
        return await agenda(e, resume: "Prolongée depuis l'app", action: ActionProposee(type: "modifier", titre: e.titre, duree: .nombre(Double(nouvelle)), id: e.id),
                            succes: "« \(e.titre) » : +\(minutes) min, jusqu'à \(Format.heure(e.finEffective + Double(minutes) * 60_000)).", defaire: defaire)
    }

    private func agenda(_ e: ElementJour, resume: String, action: ActionProposee, succes: String, defaire: (() -> Void)?) async -> Bool {
        let fin = Mesures.partagees.chrono("app.geste")
        let p = Proposition(source: "agenda", resume: resume, actions: [action])
        do {
            let r = try await api.appliquer(p, convId: nil, index: nil, idCommande: UUID().uuidString)
            let res = r.results?.first
            if (r.echecs ?? 0) > 0 || res?.ok == false {
                defaire?()
                app?.dire("Ton agenda n'a pas accepté : \(res?.erreur ?? "raison inconnue").")
                return false
            }
            fin()
            var annuler: (@MainActor () -> Void)? = nil
            if let ledger = r.ledgerId {
                annuler = { [weak self] in
                    Task {
                        guard let self else { return }
                        do {
                            let a = try await self.api.annuler(Proposition(source: "agenda", resume: nil, actions: [], ledgerId: ledger))
                            self.app?.dire(a.ok == false ? "Impossible de remettre « \(e.titre) » comme avant." : "« \(e.titre) » : remis comme avant.")
                            await self.apresGeste()
                        } catch {
                            self.app?.signaler(error)
                        }
                    }
                }
            }
            app?.dire(succes, annuler: annuler)
            await apresGeste()
            return true
        } catch {
            defaire?()
            if let er = error as? ErreurAPI, er == .nonConnecte { app?.signaler(er); return false }
            app?.dire("Ton agenda n'a pas pu être modifié : \((error as? LocalizedError)?.errorDescription ?? "erreur").")
            return false
        }
    }

    /// La tâche passe en cours tout de suite ; rend de quoi revenir en arrière.
    func deplacerEnCours(id: String, titre: String, duree: Int, depuis: Millis) -> () -> Void {
        guard var j = donnees?.journee else { return {} }
        let avant = j
        var items = j.items ?? []
        let fin = depuis + Double(duree) * 60_000
        if let i = items.firstIndex(where: { $0.type == "tache" && $0.id == id }) {
            items[i].debut = depuis
            items[i].fin = fin
            items[i].duree = duree
            items[i].commencee = true
        } else {
            let t = j.aFaire?.first { $0.id == id } ?? j.retard?.items.first { $0.id == id }
            var e = ElementJour(type: "tache", id: id, titre: t?.titre ?? titre, projet: t?.projet, priorite: t?.priorite,
                                debut: depuis, fin: fin, duree: duree, echeance: t?.echeance)
            e.commencee = true
            items.append(e)
            j.aFaire?.removeAll { $0.id == id }
            if var r = j.retard, r.items.contains(where: { $0.id == id }) {
                r.items.removeAll { $0.id == id }
                r.total = max(0, r.total - 1)
                j.retard = r
            }
        }
        items.sort { $0.debut < $1.debut }
        j.items = items
        donnees?.journee = j
        return { [weak self] in self?.donnees?.journee = avant }
    }
}
