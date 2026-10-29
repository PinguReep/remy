// Les éléments d'un grand tableau JSON, un par un, sans charger le fichier
// entier (29/10) : le conversations.json d'un export ChatGPT peut peser des
// centaines de Mo. On suit les guillemets et les crochets octet par octet
// (les caractères de structure sont ASCII, un caractère accentué ne peut pas
// les imiter en UTF-8), et chaque élément est analysé à part.
//
// Un objet au lieu d'un tableau : `{ "conversations": [...] }` rend ses
// éléments, un objet seul est rendu tel quel.

const OBJET_SEUL_MAX = 256 * 1024 * 1024;

export class JsonInvalide extends Error {
  constructor(raison) {
    super(`Fichier JSON illisible : ${raison}`);
    this.code = "JSON_INVALIDE";
  }
}

const blanc = (c) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0xef || c === 0xbb || c === 0xbf;

export async function* elementsJson(flux, { elementMax = 128 * 1024 * 1024 } = {}) {
  let commence = false;
  let objetSeul = null; // morceaux d'un fichier qui n'est pas un tableau
  let tailleObjet = 0;
  let profondeur = 0;
  let dansChaine = false;
  let echappe = false;
  let morceaux = [];
  let enElement = false;
  let tailleElement = 0;
  for await (const brut of flux) {
    const bloc = Buffer.isBuffer(brut) ? brut : Buffer.from(brut);
    if (objetSeul) {
      objetSeul.push(bloc);
      tailleObjet += bloc.length;
      if (tailleObjet > OBJET_SEUL_MAX) throw new JsonInvalide("objet trop gros");
      continue;
    }
    let depart = enElement ? 0 : -1;
    for (let i = 0; i < bloc.length; i++) {
      const c = bloc[i];
      if (dansChaine) {
        if (echappe) echappe = false;
        else if (c === 0x5c) echappe = true;
        else if (c === 0x22) dansChaine = false;
        continue;
      }
      if (!commence) {
        if (blanc(c)) continue;
        if (c === 0x5b) {
          commence = true;
          profondeur = 1;
          continue;
        }
        if (c === 0x7b) {
          objetSeul = [bloc.subarray(i)];
          tailleObjet = bloc.length - i;
          break;
        }
        throw new JsonInvalide("ni tableau ni objet");
      }
      if (c === 0x22) {
        dansChaine = true;
        continue;
      }
      if (c === 0x7b || c === 0x5b) {
        if (profondeur === 1 && !enElement) {
          enElement = true;
          depart = i;
          tailleElement = 0;
        }
        profondeur++;
        continue;
      }
      if (c === 0x7d || c === 0x5d) {
        profondeur--;
        if (profondeur === 1 && enElement) {
          morceaux.push(bloc.subarray(depart, i + 1));
          const texte = Buffer.concat(morceaux).toString("utf8");
          morceaux = [];
          enElement = false;
          depart = -1;
          let valeur;
          try {
            valeur = JSON.parse(texte);
          } catch (err) {
            throw new JsonInvalide(err.message);
          }
          yield valeur;
        } else if (profondeur === 0) {
          return;
        }
      }
    }
    if (enElement && depart >= 0) {
      const reste = bloc.subarray(depart);
      morceaux.push(reste);
      tailleElement += reste.length;
      if (tailleElement > elementMax) throw new JsonInvalide("un élément dépasse la taille permise");
    }
  }
  if (objetSeul) {
    let v;
    try {
      v = JSON.parse(Buffer.concat(objetSeul).toString("utf8"));
    } catch (err) {
      throw new JsonInvalide(err.message);
    }
    if (Array.isArray(v?.conversations)) {
      for (const x of v.conversations) yield x;
    } else {
      yield v;
    }
    return;
  }
  if (!commence) throw new JsonInvalide("fichier vide");
  if (profondeur !== 0) throw new JsonInvalide("fichier incomplet");
}
