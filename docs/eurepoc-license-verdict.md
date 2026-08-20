# Verdict de licence — EuRepoC « Global Dataset of Cyber Incidents » (Zenodo)

**Date du verdict : 20 août 2026** · Tâche 24 (plan francepassoire-launch, backfill
historique tranche 1) — gate de licence avant tout usage, sur le modèle de la
tâche 17.

## Verdict

**NON PERMISSIF pour nos usages.** La version courante du jeu de données
EuRepoC (v1.3, couvrant intégralement 2000–2024, soit précisément notre fenêtre
de backfill) est publiée sous licence **CC-BY-NC 4.0** : usage non commercial
uniquement. La barre de la gate exige une licence permissive **CC-BY ou CC0** ;
la clause NC ne la satisfient pas.

## URLs consultées (transcription dans `.omo/evidence/francepassoire-launch/task-24-francepassoire-launch.log`)

| Ordre | URL | Résultat |
|---|---|---|
| 1 | `https://zenodo.org/api/records/14965395` | 200 — métadonnées de l'enregistrement v1.3 (publié 2025-03-04, « covers the years 2000 – 2024 entirely ») : `"license": {"id": "cc-by-nc-4.0"}` |
| 2 | `https://zenodo.org/api/records/11108195` | 200 — enregistrement v1.2 (publié 2024-05-03) : `"license": {"id": "cc-by-4.0"}` — ancienne version, périmètre arrêté au 02.05.2024 |
| 3 | `https://zenodo.org/api/records/7848941` | 200 — enregistrement v1.1 (publié 2023-04-20) : `"license": null` |
| 4 | `https://eurepoc.eu/database/` | 200 — encart « Notice: License changed » (citation ci-dessous) |
| 5 | `https://zenodo.org/records/14965395` (page HTML) | 403 pour un client HTTP automatisé (défi JavaScript) ; les métadonnées du même enregistrement ont été obtenues via l'API officielle ci-dessus, que la page de défi désigne elle-même aux agents |

## Citation textuelle

Encart de la page officielle [eurepoc.eu/database](https://eurepoc.eu/database/)
(extrait, verbatim) :

> « Notice: License changed — Thanks for your interest in our project! Please
> note that we changed our copyright license to CC-BY-NC 4.0, i.e. the database
> may only be used non-commercial purposes as of 2nd April 2025. »

Métadonnées de licence de l'enregistrement Zenodo courant (API, verbatim) :

```json
"license": {"id": "cc-by-nc-4.0"}
```

## Décision

**EuRepoC N'EST PAS utilisé pour la tranche 1 du backfill historique** — ni
comme source de faits, ni comme base de leads. Conformément à la consigne de la
gate (« si non permissif → leads issus des rétrospectives presse à la place »),
les 8 incidents sélectionnés proviennent des rétrospectives et communiqués
publics français : CNIL, cybermalveillance.gouv.fr, communiqués d'entités
(Ledger, France Travail, FFF), presse nationale et spécialisée (Libération, Le
Figaro, Le Parisien, ZDNet.fr, RTL, franceinfo, next.ink, Zataz). Aucune fiche
de cette tranche ne cite EuRepoC, n'importe une ligne du jeu de données ni
n'en dérive un chiffre.

Si une tâche future souhaite l'usage maximal que la licence tolérerait
(**leads-only** : consultation pour identifier des incidents, chaque fait étant
ensuite sourcé hors jeu de données), elle devra d'abord documenter la
conformité NC (usage strictement non commercial, aucune réutilisation de
contenu) dans une mise à jour du présent document.

## Ce que ce verdict N'AFFECTE PAS

- **Tâche 24 (cette tranche)** : aucun impact — aucun usage d'EuRepoC n'était
  nécessaire, les sources ouvertes suffisant.
- **La v1.2 historique** (enregistrement 11108195, licence CC-BY 4.0) reste
  consultable ; mention informative uniquement, sans usage de notre part :
  son périmètre est figé au 2 mai 2024 et le projet EuRepoC considère la
  licence du projet comme CC-BY-NC depuis le 2 avril 2025.

## Révision éventuelle

Si EuRepoC publie une version sous CC-BY/CC0, ou accorde une autorisation
écrite adaptée à un observatoire citoyen, ce document doit être mis à jour
(nouvelle citation + URL) avant tout usage du jeu de données.
