// Anti-SSRF du navigateur (Lot 0, J0.8b) : une page lue par Rémy ne doit
// jamais lui faire appeler la tour, les Sparks, le tailnet ou une adresse
// réservée — ni directement, ni par une redirection, ni par une ressource,
// ni par un nom public qui pointe vers le réseau de Sam.
//
// 127.0.0.1 joue « Internet » (BROWSE_TEST_PUBLIQUES, actif sous REMY_ENV=test
// seulement) ; 127.0.0.2 joue le réseau privé de Sam.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";

delete process.env.BROWSE_ALLOW_LOCAL;
process.env.BROWSE_TEST_PUBLIQUES = "127.0.0.1";
const { adresseInterdite, verifierCible, telechargerSur, browsePage } = await import("../lib/browse.js");

test("adresses interdites : privé, Tailscale, lien local, réservé — en IPv4 comme en IPv6", () => {
  const interdites = [
    "10.0.0.1", "100.100.1.1", "127.0.0.2", "169.254.169.254", "172.20.0.1", "192.168.1.50", "0.0.0.0", "224.0.0.1", "198.18.0.1",
    "::1", "::", "::ffff:7f00:2", "::ffff:10.0.0.1", "fd7a:115c:a1e0::1", "fe80::1", "64:ff9b::a00:1", "2002:a00:1::", "ff02::1",
  ];
  for (const ip of interdites) assert.equal(adresseInterdite(ip), true, ip);
  for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(adresseInterdite(ip), false, ip);
  assert.equal(adresseInterdite("pas-une-ip"), true);
});

test("la cible est jugée sur son adresse RÉSOLUE, pas sur son nom", async () => {
  const vers = (ip) => async () => [{ address: ip, family: ip.includes(":") ? 6 : 4 }];
  await assert.rejects(verifierCible("http://167772165/"), /privée/); // 10.0.0.5 écrit en décimal
  await assert.rejects(verifierCible("http://localhost:3010/api/health"), /privée/);
  await assert.rejects(verifierCible("https://ma-tour.exemple.ts.net:8444/"), /privée/);
  await assert.rejects(verifierCible("http://[::ffff:127.0.0.2]/"), /privée/);
  await assert.rejects(verifierCible("https://piege.example/", { resoudre: vers("192.168.1.50") }), /réseau de Sam/);
  await assert.rejects(verifierCible("https://piege.example/", { resoudre: async () => [{ address: "93.184.216.34" }, { address: "10.0.0.5" }] }), /privée/);
  await assert.rejects(verifierCible("file:///etc/passwd"), /http/);
  assert.ok(await verifierCible("https://exemple.fr/", { resoudre: vers("93.184.216.34") }));
});

// Un « Internet » (127.0.0.1) qui redirige vers le « réseau privé » (127.0.0.2).
async function decor() {
  let secretVu = 0;
  const prive = http.createServer((q, r) => {
    secretVu++;
    r.end("SECRET");
  });
  await new Promise((ok) => prive.listen(0, "127.0.0.2", ok));
  const cible = `http://127.0.0.2:${prive.address().port}/secret`;
  const internet = http.createServer((q, r) => {
    if (q.url === "/vers-prive") return r.writeHead(302, { Location: cible }).end();
    if (q.url === "/vers-public") return r.writeHead(301, { Location: "/arrivee" }).end();
    if (q.url === "/arrivee") return r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<html><head><title>Arrivée</title></head><body>ARRIVÉ <a href='suite'>suite</a></body></html>");
    if (q.url === "/ressources") {
      return r.writeHead(200, { "Content-Type": "text/html" }).end(
        `<html><body>PAGE<script src="${cible}"></script><script>fetch("${cible}").catch(()=>{});</script><iframe src="${cible}"></iframe></body></html>`,
      );
    }
    r.writeHead(404).end();
  });
  await new Promise((ok) => internet.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${internet.address().port}`;
  return { base, vus: () => secretVu, fermer: () => (prive.close(), internet.close()) };
}

test("redirection vers le réseau privé : refusée AVANT toute connexion ; vers le public : suivie", async () => {
  const d = await decor();
  try {
    await assert.rejects(telechargerSur(`${d.base}/vers-prive`), /privée/);
    assert.equal(d.vus(), 0, "le serveur privé n'a reçu aucune requête");
    const r = await telechargerSur(`${d.base}/vers-public`);
    assert.equal(r.status, 200);
    assert.equal(r.urlFinale, `${d.base}/arrivee`);
    assert.match(r.corps.toString(), /ARRIVÉ/);
  } finally {
    d.fermer();
  }
});

const chrome = [
  process.env.BROWSE_EXECUTABLE,
  "/opt/pw-browsers/chromium",
  "/usr/bin/google-chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find((p) => p && fs.existsSync(p));

test("le vrai navigateur : ni redirection, ni script, ni fetch, ni iframe vers le réseau privé", { skip: !chrome && "aucun Chromium sur cette machine" }, async () => {
  process.env.BROWSE_EXECUTABLE = chrome;
  const d = await decor();
  try {
    await assert.rejects(browsePage({ url: `${d.base}/vers-prive` }), /privée/);
    const p = await browsePage({ url: `${d.base}/ressources` });
    assert.match(p.texte, /PAGE/);
    assert.equal(d.vus(), 0, "aucune requête n'a atteint le réseau privé");
    // Une redirection permise : la page arrive, avec sa vraie adresse.
    const ok = await browsePage({ url: `${d.base}/vers-public` });
    assert.match(ok.texte, /ARRIVÉ/);
    assert.equal(ok.url_finale, `${d.base}/arrivee`);
    assert.equal(ok.titre, "Arrivée");
  } finally {
    d.fermer();
  }
});

test("le vrai navigateur ne sort pas par la bande : préchargement, SharedWorker, iframe, WebRTC", { skip: !chrome && "aucun Chromium sur cette machine" }, async () => {
  process.env.BROWSE_EXECUTABLE = chrome;
  const net = await import("node:net");
  const dgram = await import("node:dgram");
  const vus = [];
  const tcp = net.createServer((s) => (vus.push("tcp"), s.destroy()));
  await new Promise((ok) => tcp.listen(0, "127.0.0.2", ok));
  const port = tcp.address().port;
  const udp = dgram.createSocket("udp4");
  udp.on("message", () => vus.push("udp"));
  await new Promise((ok) => udp.bind(port, "127.0.0.2", ok));
  const P = `127.0.0.2:${port}`;
  const page = `<html><head>
    <script type="speculationrules">{"prefetch":[{"source":"list","urls":["http://${P}/spec"]}]}</script>
    <link rel=prerender href="http://${P}/pr"><link rel=preconnect href="http://${P}">
  </head><body>BANDE<iframe src="http://${P}/if"></iframe>
    <script>new SharedWorker("/sw.js");
    try { const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:${P}" }] }); pc.createDataChannel("x"); pc.createOffer().then((o) => pc.setLocalDescription(o)); } catch (e) {}</script>
  </body></html>`;
  const internet = http.createServer((q, r) => {
    if (q.url === "/sw.js") return r.writeHead(200, { "Content-Type": "text/javascript" }).end(`fetch("http://${P}/sw").catch(()=>{})`);
    r.writeHead(200, { "Content-Type": "text/html" }).end(page);
  });
  await new Promise((ok) => internet.listen(0, "127.0.0.1", ok));
  try {
    const p = await browsePage({ url: `http://127.0.0.1:${internet.address().port}/` });
    assert.match(p.texte, /BANDE/);
    await new Promise((r) => setTimeout(r, 1500));
    assert.deepEqual(vus, [], "rien n'a atteint le réseau privé");
  } finally {
    internet.close();
    tcp.close();
    udp.close();
  }
});

test("une bombe de décompression ne gèle pas la tour", async () => {
  const zlib = await import("node:zlib");
  const bombe = zlib.brotliCompressSync(Buffer.alloc(64 * 1024 * 1024)); // quelques Ko → 64 Mo
  const srv = http.createServer((q, r) => r.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "br" }).end(bombe));
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  try {
    await assert.rejects(telechargerSur(`http://127.0.0.1:${srv.address().port}/`), /trop lourde/);
  } finally {
    srv.close();
  }
});
