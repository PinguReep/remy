// Nettoyage de la sortie de GLM — cas tirés de la réponse réelle du 09/10/2026.
import test from "node:test";
import assert from "node:assert/strict";
import { nettoyerSortie, appelsEcritsEnTexte } from "../lib/sortie.js";

test("RÉGRESSION : un appel d'outil écrit en texte disparaît de la réponse", () => {
  const brut =
    "OK pour en faire un projet ?</arg_value><arg_key>duration</arg_key><arg_value>2h</arg_value></tool_call>\n\nAh, j'ai mal forgé un appel.<tool_call>motion_prop器";
  const net = nettoyerSortie(brut);
  assert.ok(!/arg_|tool_call|器|duration|2h/.test(net), net);
  assert.match(net, /OK pour en faire un projet \?/);
  assert.match(net, /Ah, j'ai mal forgé un appel\./);
});

test("RÉGRESSION : une boucle de répétition est réduite à une occurrence", () => {
  const net = nettoyerSortie(
    "- **Paramétrer le studio** (2h!) — c'est le paramétrage du studio — c'est le paramétrage du studio — c'est le paramétrage du studio",
  );
  assert.equal((net.match(/c'est le paramétrage du studio/g) || []).length, 1);
});

test("un texte normal ne bouge pas", () => {
  const t = "Voilà ma lecture.\n\n| Domaine | Nom |\n|---|---|\n| Achats | 🛒 Achats & Suivis |";
  assert.equal(nettoyerSortie(t), t);
});

test("un appel complet écrit en texte est récupéré pour être proposé", () => {
  const appels = appelsEcritsEnTexte(
    'Je te propose ça.<tool_call>motion_proposer<arg_key>resume</arg_key><arg_value>Clore</arg_value><arg_key>actions</arg_key><arg_value>[{"type":"terminer","id":"tk_1"}]</arg_value></tool_call>',
  );
  assert.deepEqual(appels, [{ name: "motion_proposer", args: { resume: "Clore", actions: [{ type: "terminer", id: "tk_1" }] } }]);
});
