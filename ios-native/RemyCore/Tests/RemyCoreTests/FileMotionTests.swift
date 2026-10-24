import XCTest
@testable import RemyCore

/// La file du quota Motion (24/10) : ce que la carte dit pendant « Oui, fais-le ».
final class FileMotionTests: XCTestCase {
    func testLaPhraseDitLaFileEtLaPause() throws {
        XCTAssertNil(FileMotion(quota: 12, enAttente: 0, attenteMs: 0).phrase, "au repos : rien de plus que d'habitude")
        XCTAssertNil(FileMotion(quota: 12, enAttente: 1, attenteMs: 800).phrase, "moins de 2 s : pas la peine de l'écrire")
        XCTAssertEqual(FileMotion(quota: 12, enAttente: 3, attenteMs: 19_200).phrase, "En file : Motion limite à 12 requêtes/min, ~20 s")
        XCTAssertEqual(FileMotion(quota: 12, enAttente: 1, attenteMs: 15_000, pause429: 15_000).phrase,
                       "Motion demande une pause (trop de requêtes) : nouvel essai dans ~15 s")
    }

    func testLaReponseDeLaTourSeDecode() throws {
        let json = #"{"quota":12,"enAttente":2,"attenteMs":20517,"pause429":0}"#
        let f = try JSONDecoder().decode(FileMotion.self, from: Data(json.utf8))
        XCTAssertEqual(f, FileMotion(quota: 12, enAttente: 2, attenteMs: 20_517))
        XCTAssertEqual(f.phrase, "En file : Motion limite à 12 requêtes/min, ~21 s")
    }
}
