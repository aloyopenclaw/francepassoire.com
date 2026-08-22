# Rapport d'épuisement des sources — backfill T22/T23/T24

**Date : 2026-08-22. Conclut l'option A (poursuite jusqu'à épuisement documenté).**

## Méthode

Rafales 1 à 9 : chaque lane reçoit une famille de sources (CNIL par période,
presse par année/secteur, HIBP, rétrospectives, pools thématiques) avec une
demande de 20 fiches et obligation de consigner l'épuisement dans le message
de commit. Barre d'inclusion inchangée : ≥ 2 sources vivantes par fiche, vol
documenté, dédoublonnage pré-fusion (check-doublons), zod + spot-check CI.

## Rendement par lane (fiches obtenues / 20 demandées)

| Rafale | Lane (famille) | Rendement | Note d'épuisement du commit |
| --- | --- | --- | --- |
| 7 | CNIL 2021 | 7/20 | tableau 2021 épuisé |
| 7 | transport 2022-2025 | 12/20 | presse/veille épuisée après dedup |
| 7 | T2 2025 presse nationale | 2/20 | pool épuisé |
| 7 | éducation 2022-2025 | 10/20 | pool épuisé après dedup |
| 7 | récentes 2026 (D1 48h) | 17/20 | presse août épuisée après dedup |
| 8 | T3 2025 presse nationale | 5/20 | pool épuisé après dedup |
| 8 | CNIL 2019 et antérieur | 14/20 | tableaux 2019-2017 épuisés |
| 8 | médias/télécom 2022-2025 | 10/20 | balayage FB/Zataz/presse/CNIL/HIBP/veille épuisé |
| 8 | immobilier/BTP 2022-2025 | 9/20 | balayage FB/BLF/Zataz/presse/CNIL épuisé |
| 9 | HIBP France (AddedDate 2025) | 3/20 | 0 nouveau après dedup ; extension au catalogue complet documentée |
| 9 | presse régionale 2024 | 8/20 | pool épuisé après dedup |
| 9 | CNIL 2011-2016 | 15/20 | tableaux épuisés |
| 9 | récentes (72h + presse du jour) | 9/20 | pool épuisé après dedup 956 |
| 9 | public 2022-2024 | 6/20 | presse/CNIL/communiqués épuisés à la barre ≥2 sources + vol |
| 9 | e-commerce 2022-2023 | 7/20 | balayage Zataz/presse/CNIL/HIBP/D1 épuisé |
| 9 | santé 2022-2024 | 14/20 | gros incidents déjà au catalogue ; restants vérifiés ≥2 sources |

Toutes les rafales convergent : 3 à 17 fiches par lane de 20, quel que soit
l'angle. Les incidents manquants restants sont soit sous la barre éditoriale
(1 seule source, vol non documenté), soit des doublons d'entités déjà
cataloguées.

## Couverture finale

- **1021 fiches**, chaîne 1076 événements, tête `e756bee7…`
- Par année : 2011-2016 ≈ 5-10/an ; 2017-2021 ≈ 8-27/an ; 2022 : 52 ;
  2023 : 98 ; 2024 : 186 ; 2025 : 361 ; 2026 : 198
- Statuts : 607 confirmées / 414 revendiquées
- Secteurs : services 309, public 170, retail 152, santé 101, industrie 101,
  média 83, finance 43, autre 36, recherche 26

L'année de référence 2025 (baseline fuitesinfos ~580) est couverte à 361
fiches vérifiables ; l'écart correspond aux incidents à source unique ou sans
vol documenté, exclus par la barre éditoriale, et aux entités déjà couvertes
sous une autre date.

## Conclusion

Épuisement documenté atteint au sens de l'option A : chaque famille de
sources a été balayée au moins une fois en profondeur, avec rendement
décroissant confirmé lane après lane. Le flux d'actualité continue via les
workers d'ingestion (CNIL, HIBP, presse) qui alimentent la file de validation
éditoriale au quotidien.

Décision propriétaire restante : aucune. La poursuite éventuelle de fiches
supplémentaires passerait par un abaissement de la barre éditoriale (refusé à
ce jour) ou l'attente de nouveaux incidents via l'ingestion.
