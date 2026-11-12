// Lire le texte d'une image sur la tour (12/11) : l'OCR intégré à Windows
// (Windows.Media.Ocr), appelé par PowerShell 5.1. Rien ne sort de la tour :
// l'image passe par l'entrée standard (aucun fichier temporaire), le texte
// revient en JSON sur la sortie.
//
//   lireImage(octets, type) → { texte, moteur } | null
//   lireImageDetail(octets, type) → { texte, moteur } | { raison }
//
// Sans OCR (Linux, langue de reconnaissance absente, image illisible), la
// raison est dite et l'envoi continue : l'image reste jointe.
// REMY_OCR=off le coupe. Pour les tests, reglerOcr(fn) remplace le moteur ;
// REMY_OCR=essai (seulement avec REMY_ENV=test : la tour de démo) rend un
// texte fictif fixe, pour voir l'interface sans Windows.

import { spawn } from "node:child_process";

export const OCR_DELAI_MS = 30_000;
const OUBLI_INDISPONIBLE_MS = 3_600_000;

let injecte = null;
let indisponible = null; // { raison, jusqua }

export function reglerOcr(fn) {
  injecte = typeof fn === "function" ? fn : null;
  indisponible = null;
}

export const TEXTE_ESSAI = "FACTURE N° 2026-114\nBougies parfumées × 3\nTotal TTC 42,00 €";

// Le piège du dépôt (CLAUDE.md) : PowerShell 5.1 + « 2>$null » en mode Stop
// s'arrête à la première ligne d'erreur. Ce script n'appelle aucune commande
// externe et n'utilise aucune redirection : chaque échec est attrapé et rendu
// en JSON (« indisponible », « illisible », « erreur »).
export const SCRIPT_OCR = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function Sortir($o) { [Console]::Out.Write((New-Object PSObject -Property $o | ConvertTo-Json -Compress)) }
try {
  $octets = [Convert]::FromBase64String(([Console]::In.ReadToEnd()).Trim())
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
} catch { Sortir @{ indisponible = 'OCR de Windows absent sur cette tour' }; exit 0 }
try {
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + "`" + String.raw`1' } | Select-Object -First 1
  function Attendre($op, [Type]$type) {
    $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    if (-not $t.Wait(20000)) { throw 'délai dépassé' }
    $t.Result
  }
  $moteur = $null
  $langue = $null
  foreach ($l in [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages) {
    if ($l.LanguageTag -like 'fr*') { $moteur = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($l); $langue = $l.LanguageTag; break }
  }
  if (-not $moteur) {
    $moteur = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($moteur) { $langue = $moteur.RecognizerLanguage.LanguageTag }
  }
  if (-not $moteur) { Sortir @{ indisponible = 'aucune langue de reconnaissance installée dans Windows' }; exit 0 }
} catch { Sortir @{ indisponible = 'OCR de Windows inutilisable sur cette tour' }; exit 0 }
try {
  $flux = New-Object System.IO.MemoryStream(,$octets)
  $acces = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($flux)
  $decodeur = Attendre ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($acces)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  if ($decodeur.PixelWidth -gt $max -or $decodeur.PixelHeight -gt $max) { Sortir @{ illisible = "image trop grande pour l'OCR de Windows ($max px au plus)"; langue = $langue }; exit 0 }
  $image = Attendre ($decodeur.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $resultat = Attendre ($moteur.RecognizeAsync($image)) ([Windows.Media.Ocr.OcrResult])
  $lignes = @($resultat.Lines | ForEach-Object { $_.Text })
  Sortir @{ texte = ($lignes -join "` + "`" + String.raw`n"); langue = $langue }
} catch { Sortir @{ illisible = "image illisible pour l'OCR de Windows"; langue = $langue } }
`;

const encoder = (script) => Buffer.from(script, "utf16le").toString("base64");

// Lance PowerShell et rend son JSON (ou une raison).
function windows(octets, delaiMs) {
  return new Promise((resolve) => {
    let sortie = "";
    let fini = false;
    const finir = (r) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      resolve(r);
    };
    let ps;
    try {
      ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoder(SCRIPT_OCR)], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      return finir({ indisponible: "PowerShell introuvable sur cette tour" });
    }
    const minuteur = setTimeout(() => {
      ps.kill();
      finir({ illisible: `lecture du texte trop longue (plus de ${Math.round(delaiMs / 1000)} s)` });
    }, delaiMs);
    ps.on("error", () => finir({ indisponible: "PowerShell introuvable sur cette tour" }));
    ps.stdout.on("data", (c) => (sortie += c.toString("utf8")));
    ps.on("close", () => {
      const json = sortie.trim().split("\n").pop();
      try {
        finir(JSON.parse(json));
      } catch {
        finir({ illisible: "réponse illisible de l'OCR de Windows" });
      }
    });
    ps.stdin.on("error", () => {});
    ps.stdin.end(Buffer.from(octets).toString("base64"));
  });
}

export async function lireImageDetail(octets, type, { delaiMs = OCR_DELAI_MS } = {}) {
  if (injecte) {
    try {
      const r = await injecte(octets, type);
      return r && typeof r.texte === "string" ? { texte: r.texte, moteur: r.moteur || "injecté" } : { raison: r?.raison || "lecture du texte indisponible" };
    } catch {
      return { raison: "la lecture du texte a échoué" };
    }
  }
  const reglage = String(process.env.REMY_OCR || "").toLowerCase();
  if (reglage === "off") return { raison: "lecture du texte des images coupée sur la tour" };
  if (reglage === "essai" && process.env.REMY_ENV === "test") return { texte: TEXTE_ESSAI, moteur: "essai" };
  if (process.platform !== "win32") return { raison: "pas de lecture du texte des images sur cette tour (OCR de Windows seulement)" };
  if (indisponible && Date.now() < indisponible.jusqua) return { raison: indisponible.raison };
  const r = await windows(octets, delaiMs);
  if (r?.indisponible) {
    indisponible = { raison: String(r.indisponible), jusqua: Date.now() + OUBLI_INDISPONIBLE_MS };
    return { raison: indisponible.raison };
  }
  if (typeof r?.texte === "string") return { texte: r.texte, moteur: `OCR de Windows${r.langue ? ` (${r.langue})` : ""}` };
  return { raison: String(r?.illisible || r?.erreur || "image illisible pour l'OCR de Windows") };
}

export async function lireImage(octets, type, options) {
  const r = await lireImageDetail(octets, type, options);
  return r.raison ? null : r;
}
