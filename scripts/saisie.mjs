// Saisie au clavier pour les scripts de la tour. `masque` : rien ne s'affiche
// (mots de passe, clés).

export function demander(question, { masque = false } = {}) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (masque) stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let saisi = "";
    const lire = (c) => {
      for (const ch of c) {
        if (ch === "\r" || ch === "\n") {
          if (masque) stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", lire);
          if (masque) process.stdout.write("\n");
          return resolve(saisi.trim());
        }
        if (ch === "\u0003") process.exit(130); // Ctrl+C
        if (ch === "\u007f" || ch === "\b") saisi = saisi.slice(0, -1);
        else saisi += ch;
      }
    };
    stdin.on("data", lire);
  });
}
