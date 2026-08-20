# Verdict de licence — registre fuitesinfos (`fuitesinfos-transparence`)

**Date du verdict : 20 août 2026** · Décision épinglée n° 9 (plan francepassoire-launch, tâche 17).

## Verdict

**NON PERMISSIF.** Le dépôt `CedHaurus/fuitesinfos-transparence` ne porte **aucune
licence**. Sans licence explicite, le droit d'auteur s'applique par défaut (tous
droits réservés) : l'ingestion automatisée et la republication de
`registre.jsonl` dans notre pipeline ne sont pas autorisées.

## URLs consultées (transcription dans `.omo/evidence/francepassoire-launch/task-17-francepassoire-launch.log`)

| Ordre | URL | Résultat |
|---|---|---|
| 1 | `https://raw.githubusercontent.com/CedHaurus/fuitesinfos-transparence/main/LICENSE` | **404 Not Found** |
| 2 | `https://raw.githubusercontent.com/CedHaurus/fuitesinfos-transparence/master/LICENSE` | **404 Not Found** |
| 3 | `https://api.github.com/repos/CedHaurus/fuitesinfos-transparence/contents/` | 200 — liste racine : `.github/`, `.gitignore`, `ANCRAGES.md`, `EMPREINTE.txt`, `README.md`, `REGISTRE.md`, `registre.jsonl`, `verifier.py` — **aucun fichier LICENSE** |
| 4 | `https://api.github.com/repos/CedHaurus/fuitesinfos-transparence` | 200 — champ licence de GitHub : `"license": null` |
| 5 | `https://raw.githubusercontent.com/CedHaurus/fuitesinfos-transparence/main/README.md` | 200 — lu intégralement : **aucune mention de licence, de réutilisation ou de déclaration de droits ouverts** (CC-BY, MIT, Apache, domaine public…) |

## Citation textuelle

Il n'existe pas de ligne de licence à citer dans le dépôt. La preuve la plus
directe est le champ licence de l'API GitHub pour ce dépôt :

```json
"license": null
```

Et l'absence totale de fichier ou de section de licence dans le listing racine
et le README (recherches case-insensitive : `licen`, `réutilisa`, `CC-BY`,
`MIT`, `Apache`, `domaine public` — aucune correspondance).

Le README décrit au contraire un catalogue « tenu à la main, entrée par
entrée », sans aucune déclaration accordant des droits de réutilisation :

> « Le catalogue est tenu à la main, entrée par entrée. Il n'y a ni collecte
> automatique, ni republication en masse : chaque fiche est établie
> individuellement, et c'est pourquoi elle peut être corrigée individuellement. »

## Décision

**L'adapter `registre.jsonl` N'EST PAS construit** — voir
[`docs/license-exclusion.md`](./license-exclusion.md) pour le détail de
l'exclusion et ses conséquences opérationnelles.

## Ce que ce verdict N'AFFECTE PAS

- **Tâche 10 (wave 1)** : la vérification cryptographique de la chaîne
  d'empreintes du registre (263 événements, `exit 0`, empreinte de tête
  `6508eaa8…d79a`) reste valable telle quelle — elle a porté sur une fixture
  téléchargée une fois à des fins de test d'intégrité, sans pipeline
  d'ingestion ni republication. Cross-référence :
  `.omo/evidence/francepassoire-launch/task-10-francepassoire-launch.log`.
- **Usage éditorial manuel** : citer fuitesinfos.fr comme source (lien,
  attribution) dans une fiche rédigée par un humain reste du citation
  légitime — l'exclusion ne porte que sur l'ingestion automatisée.

## Révision éventuelle

Si l'auteur du dépôt ajoute une licence permissive (MIT, CC-BY, Apache…) ou
nous accorde une autorisation écrite, ce document doit être mis à jour avec la
nouvelle citation et URL, et l'adapter pourra être construit selon le cahier
des charges déjà prévu (poll du raw URL, diff `lastSeq` → candidats
`fuitesinfos-registre`, priorité basse).
