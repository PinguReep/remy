// Requêtes de l'app iPhone : le « ? » encodé dans le chemin par les anciens builds.
import test from "node:test";
import assert from "node:assert/strict";
import { reparerRequete } from "../lib/http.js";

const url = (u) => reparerRequete({ url: u }).url;

test("RÉGRESSION : « %3F » dans le chemin redevient une requête", () => {
  assert.equal(url("/api/dashboard%3Ffrais=1"), "/api/dashboard?frais=1");
  assert.equal(url("/api/dashboard%3ffrais=1&x=2"), "/api/dashboard?frais=1&x=2");
  assert.equal(url("/api/dashboard%3Ffrais=1?y=3"), "/api/dashboard?frais=1&y=3");
});

test("une URL normale ne bouge pas", () => {
  assert.equal(url("/api/dashboard?frais=1"), "/api/dashboard?frais=1");
  assert.equal(url("/api/conversations/abc/messages"), "/api/conversations/abc/messages");
});
