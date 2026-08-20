# Règles de prose des fiches

> **Statut : DRAFT — verrouillage à la signature du propriétaire.**
> Document produit par la tâche 21 (gate de style, Wave 3). Les règles
> ci-dessous deviennent normatives uniquement après la signature du
> propriétaire sur les préversions `apercu/ton-a/*` et `apercu/ton-b/*`.
> Elles complètent `docs/fiche-contract.md` §3 (lignes directrices
> rédactionnelles), qui reste la référence tant que ce document n'est pas
> verrouillé.

## 1. Périmètre

Ces règles gouvernent la prose rédigée à la main dans et autour d'une fiche :

| Champ | Nature | Couvert ici |
| --- | --- | --- |
| `description` | résumé de la fiche | §3, §4, §5 |
| `timeline[].event` | événements datés | §3, §4 |
| `volume.label` | contexte du chiffre | §3, §6 |
| info-bulles des chips de données | micro-copie risque | §7 |
| libellés de statut et phrases d'explication | micro-copie honnêteté | §5 |

Les titres de sources (`sources[].label`) reprennent les titres originaux :
ils ne sont pas réécrits.

## 2. Principes non négociables (reprise de fiche-contract §3)

1. **Neutralité factuelle** : chaque affirmation est attribuée à qui la
   dit ; on distingue systématiquement revendication, intrusion reconnue et
   exfiltration confirmée.
2. **Zéro invention** : tout fait renvoie à une URL de `sources[]` ; ce qui
   n'est pas sourcé n'est pas écrit.
3. **Aucune donnée volée consultée, hébergée ou reproduite.**
4. **Français exclusif**, chiffres et dates aux normes françaises
   (6,8 millions ; 70 000 ; 20 août 2026).

## 3. Bornes de longueur

| Élément | Borne dure | Cible |
| --- | --- | --- |
| `description` | ≤ 120 mots | 80–110 mots |
| Phrase de `description` | ≤ 25 mots | 12–18 mots |
| `timeline[].event` | ≤ 40 mots | 15–30 mots |
| Info-bulle de chip | ≤ 20 mots | 12–18 mots |
| Phrase d'orientation (ton B) | 1 phrase, ≤ 20 mots | — |

Une description sous 80 mots est acceptable si tous les faits sourcés y
figurent ; on ne remplit jamais avec des adjectifs.

## 4. Temps verbaux

- **Passé composé** pour les événements datés : « a détecté », « a
  revendiqué », « a notifié ».
- **Présent** pour l'état courant et ce qui reste inconnu : « les volumes
  ne sont pas confirmés », « l'exfiltration n'est pas confirmée ».
- **Futur interdit** : aucun « devrait », « va confirmer », « suivra » — la
  fiche ne promet rien.
- **Conditionnel** uniquement pour rapporter une incertitude émise par une
  source (« n'aurait accédé qu'à un serveur de test »), jamais pour
   spéculer nous-mêmes.

## 5. Neutralité accusatoire — motifs autorisés / interdits

**Règle maîtresse : une revendication n'est pas un fait.** Le verbe porte
l'attribution :

| Pour dire… | Motif autorisé | Motif interdit |
| --- | --- | --- |
| Un acteur allègue | « X revendique le piratage… », « selon la revendication relayée par FrenchBreaches » | « X a piraté », « X a volé » |
| L'entité admet partiellement | « Alaxione reconnaît une intrusion », « dément le vol de données réelles » | « Alaxione avoue », « ment » |
| L'exfiltration est inconnue | « ne pas pouvoir confirmer une exfiltration », « exfiltration non confirmée » | « les données ont fuité » |
| La fuite est établie | « fuite confirmée par [source officielle] » (statut `confirmee`) | tout ce qui précède |

Distinctions à ne jamais fusionner : **intrusion** (accès au système) ≠
**exfiltration** (copie de données) ≠ **confirmation** (source officielle).

Vocabulaire interdit en prose : « pillage », « carnage », « drame »,
« massif », « monstrueux », « hallucinant », « scandale », empilements
d'adjectifs, points d'exclamation. Le style du site est vif ; la prose des
fiches reste sobre.

## 6. Attribution des sources

- **Chaque chiffre porte sa source** : « 6,8 millions de personnes selon
  lui », « périmètre notifié par l'IRD ».
- Une revendication s'attribute via son **relais** : « selon la
  revendication relayée par FrenchBreaches » — jamais « selon un forum »,
  jamais de lien direct vers un forum criminel (cf. fiche-contract §1).
- Un fait issu d'une source officielle s'attribute à l'institution :
  « dans sa notification du 17 août, l'IRD précise… ».
- Pas de « selon nos informations » : FrancePassoire n'a pas de sources
  propres, uniquement les sources citées.

## 7. Micro-copie des info-bulles (chips de données)

Format : **le risque concret pour la personne**, pas une définition.

- Commencer par le contenu quand il est connu (« Email, téléphone,
  adresse : … »), sinon par la donnée elle-même.
- Verbes au potentiel, jamais à la menace : « peut être utilisé pour »,
  « à surveiller », « à changer immédiatement » — jamais « vous serez
  piraté ».
- ≤ 20 mots, une seule idée par bulle, aucun point d'exclamation.
- Ce qui est exposé concrètement (mots de passe, biométrie) peut porter un
  impératif (« à changer immédiatement, partout où vous les réutilisez »).

## 8. Les deux tons proposés — table de décision

| Critère | Ton A — « Factuel sec » | Ton B — « Pédagogique citoyen » |
| --- | --- | --- |
| Structure | Chronologie d'abord, phrases déclaratives courtes | 1 phrase d'explication → faits → 1 phrase d'orientation |
| Lecture | Presse, vérification rapide, profil déjà alerté | Grand public, première visite, anxiété à apaiser |
| Adjectifs | Quasi aucun | Le strict nécessaire (« intimes », « crédible ») |
| Orientation | Aucune (renvoi visuel aux 3 gestes) | 1 phrase : « Si vous aviez un compte, changez… » |
| Risque | Sécheresse ; le lecteur inquiet ne sait pas quoi faire | Une phrase de plus ; à surveiller pour ne pas glisser vers l'alarme |
| Direction éditoriale | Style dépêche | Style service public |

**Mix possible** (si le propriétaire le demande) : corps de description en
ton A + phrase d'orientation finale en ton B, ou ton par statut (A pour
`revendiquee`, B pour `confirmee`).

## 9. Calibration — préversions de la gate (branche `fiche/anchors-preview`)

| Fiche | Ton A | Ton B |
| --- | --- | --- |
| Alaxione | `/apercu/ton-a/alaxione-20260820/` | `/apercu/ton-b/alaxione-20260820/` |
| IRD | `/apercu/ton-a/ird-20260817/` | `/apercu/ton-b/ird-20260817/` |

Chaque préversion rend la fiche complète (mêmes données, même gabarit) ;
seule la description change. La fiche de référence (champ `description`
du JSON) reste sur `/fiche/<slug>/`.

**Après signature** : fusion du ton retenu dans le champ `description` des
JSON d'ancrage, suppression de `src/lib/prose-tones.ts` et des routes
`apercu/`, passage de ce document en « VERROUILLÉ » — puis cette gate lie
éditorialement fiche-contract §3.
