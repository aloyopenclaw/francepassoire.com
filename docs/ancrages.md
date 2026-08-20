# Ancrages Nostr du registre d'intégrité

Le registre d'intégrité FrancePassoire (`registre.jsonl`, chaîne d'empreintes
SHA-256 — spécification canonique dans `src/lib/registry.ts`) est ancré
publiquement sur le réseau Nostr : chaque fiche publiée reçoit une note
`ANCRAGE <slug> <empreinte>` signée, plus une note d'ancre de tête. Toute
retouche ultérieure du registre casse la chaîne et rend les ancrages Nostr
caducs — la preuve d'antériorité est publique, le dépôt reste privé.

> **STATUT : genèse pas encore exécutée — déclenchée par l'orchestrateur à la
> fusion de la première tranche** (décision épinglée n° 6 : genèse
> immédiatement avant le premier merge de fiche). Le tableau ci-dessous est
> vide jusqu'à l'exécution du runbook.

## Clé d'ancrage (quarantaine)

| Élément | Valeur |
|---|---|
| npub public (identité d'ancrage) | `npub1c4s8aye7ye8vmwa39zllytlj8rqcz4gqwtp30vw0vlk9ksj3u5uqqyjymd` |
| Secret | `~/.config/francepassoire/nostr.key` — hex, chmod 600, **jamais commité, jamais affiché** |
| Backup | À la charge du propriétaire (coffre-fort + support physique) — voir `docs/social-setup.md` § 5 |
| Worker social (tâches 38/40) | `wrangler secret put NOSTR_NSEC` (nsec dérivé du hex lors du backup) |

Génération idempotente (réutilise une clé existante) :

```bash
node scripts/verify-anchors.mjs --gen
```

## Relais épinglés

Jamais un seul relais (règle du plan, tâche 27) :

- `wss://relay.damus.io`
- `wss://nos.lol`
- `wss://relay.primal.net`

## Ancrages publiés

Tableau rempli automatiquement par `scripts/publish-anchors.mjs` au moment de
la genèse, puis à chaque fusion via le hook CI. La ligne `tête` ancre
l'empreinte de tête courante du registre.

| ancrage | empreinte | id d'événement Nostr |
|---|---|---|
| alaxione-20260820 | 1e5d01da7eae276b4bf9b079e7d6d0889c380f9a07622293616ccda3740d98bc | f05ffec4526ab886ea0887c0181729eea52dc1a357e38b487885ba564fb7347c |
| ants-20260415 | 67b203154cafec94f2d88b7d51037ac18046ef0806fd864d977baa86edfeb793 | 3badf095b2fc656fc4969ca79e1fee3e09c1f9eb09d469d73a4dfa55b55e142e |
| bloctel-20260812 | 9dfc00d3834d89eeed93662815b2f82373045673e40e8cca125fa377d1970b88 | b8dc462481d736e259f2500b2917a369ac6fe2efb0370643beccf080509fac16 |
| centre-hospitalier-perpignan-20260720 | ae68bb66cc772f63bcd7cd6313560bb95484275fd58d6f4ab7587203822072fc | c113bdaf3528401441782210e38779b194ffd38185e5c24e7a8c23fd2637d007 |
| croq-vacances-20260715 | 8d74172d9c46b1d0a26391c68869e0132c072cc9397349644e76cbca5d395daa | 3a0b331555cd26b39c76c2e1ed668e73fe5936035ebb68ed5b5baba2f1c264b6 |
| dgfip-20260812 | 8409dee640bba9aa0e6f497925e6d57df96e26036f19678b049ce56dc48a2d1a | 6c7807788e5d3ba98be187d810fe84c0a4089eec300d8ac48c79f7ac27e7fb3c |
| education-nationale-20260731 | f76ecef9fadf95bc756f300179c6c1f5c32ade863112760ce58db0ecefb81560 | b2d3babb5b10bc1a5a1707f9b411378b338f57df32127e694627367ee1ca1df1 |
| intermarche-drive-20260803 | 9be247f3298a3668a17398c3232b80de110a558bf4ef9fa7e884bffbf7097a38 | 3e0246b97c76a92635aa9d7dc77def73fe2f32b6099a4d09b0d839d936aba2b3 |
| ird-20260817 | 23ad5b3f541f1774e12ca91803626efbd195f619221e0fac13a90efd0f511d1e | 5068673d759dc90a5ca707fa546164f400044ae1fcb3d9d48623c689b02c7001 |
| police-nationale-20260415 | 9b3430747af3db5a938604170505b679bc01cb6f7754dc8619baa2cc21ce432c | 5ce677d2daf9f3f9e8c56831714024463ea7fd48209936a0ab4836c9c981c864 |
| sante-publique-france-20260811 | cd0e86844ac3188240cd929642ba248e312a967048ecadddf399742321e21499 | 7c39c227f4b9612c232e3a03762bb4c49a0ac3ffe303b9bf1ed78fdc5c333227 |
| sfr-20260717 | 590e4a5f3f30a5f07ffa564a522c33c3c128fcd8918b62bf0d35a6d774d260b8 | 3b5c7b6b10437a73a613533fdd590b5b3d6b4e329d22791e0f326a2abe375f4c |
| stade-francois-20260805 | 108e0708d593e56111b3424308b2037e22908288c157be28109fc44a894856f7 | 36ca709aa23a3f991ab0fbc6f240badc51195de2b449af284ab8d9fd0c32d2be |
| tête | 108e0708d593e56111b3424308b2037e22908288c157be28109fc44a894856f7 | 40de0757df7a0212a10544022c64a84cfa2d3ae0f9da1d0437b0bea67b381ca0 |
| air-france-klm-20250806 | 9070c6248afcc300ef1da8274192cce2b813c284198952af8d5b8aa12114a431 | f041ebe6c9c8bb887991e08c8eb151bdae71e43a04d147a9ba039fdf094f6d73 |
| auchan-20250821 | aa1ab1bc6d43950535118593977ffe23687810660cea15cf4fc211a1a3c323e8 | 1481fb60dd83286e88e202c9e2e5c32d594bde9a4677b20033ee1ef586e8fe06 |
| bouygues-telecom-20250806 | 9b93179d759968874642f7825a6a0fcf064395b89a5631a6efeee5f36028aa93 | fc5efcc622b482f339f89a55a13a038668dcb83bf4986ce5130fc7cf4bc81d0c |
| caisse-des-depots-20250212 | bef16432d0c56943926bb6eff0749e1d391047023df508ff34ff40791e7641ad | 618edb3e74803a519788e988d72112b604f83d34c687fde1aa03a65ded359102 |
| intersport-20250319 | 57976571a84bef099ad0d43e9122904e578e84d78d2839e08c94d6dbe32b37fb | b2080a59ea386c95324cda0a0fbf86772eb105e193cdc236d79ad7893d6e71cd |
| kiabi-20250114 | a79f044fcd44735a124c2265e3830cba23c38ce055770c00c131acb3de765619 | 3f9a6dd2c322f17d400ce6c9612bf329ee5de35a1c27d30b180222668e1121f6 |
| ministere-de-l-interieur-20251212 | 14fe0025f8585caf8a307579d57ca96861451409d5575f3badf02378ec4db3b3 | b202e1ec268a6602da0938e91bc76b5655394258124d181fc76f118b54b4f11d |
| nexpublica-france-20251222 | 149e0a6723f4f645eb11eab812549ddb789891892443b3e07d9f73fad50d3738 | 8049944261b467d3cce39a6cc9e8c3487e000f5119d5bcdb29ea0888e671c47a |
| orange-20250728 | 94706c8b4bb2249c667d2477f6fddab4990ce1173dfd8e7c57b114c475fdc5b4 | 8e9288ed9bc542af8911de62c96fef9909884e834f72979a1b4d2bbb97ee717d |
| sorbonne-universite-20250606 | d296fb7cd7c4015ee89347f964d504f0ad6ab2996717ee9732bd13c54e397587 | 06cefb303bfa10a4c7a6dcf8ab89930d7fb6a70b68f47757be823cad5bad0a8d |

## RUNBOOK — exécution de la genèse (orchestrateur uniquement)

Préconditions : tâche 10 faite (module de chaîne), tâche 21 verrouillée
(prose), fiches d'ancrage (branche `fiche/anchors-preview`) et première
tranche de backfill stagées sur branches.

1. **(a) Fusion des fiches d'ancrage** : merger `fiche/anchors-preview` dans
   la branche de genèse (jamais directement dans main avant la genèse).
2. **(b) Staging de la première tranche** : placer les fiches de la première
   tranche de backfill aux côtés des fiches d'ancrage.
3. **(c) Genèse** (hors-ligne, déterministe, refuse d'écraser un registre
   existant — aucun chaînage rétroactif, jamais) :

   ```bash
   node scripts/genesis.mjs --fiches-dir data/catalog \
     [--anchors-dir <répertoire des fiches d'ancrage si distinct>] \
     --out registre.jsonl
   node scripts/verify-registry.mjs registre.jsonl   # doit sortir 0
   ```

4. **(d) Publication des ancrages Nostr** (clé en quarantaine, best-effort
   sur les 3 relais, ids consignés dans le tableau ci-dessus) :

   ```bash
   node scripts/publish-anchors.mjs --registre registre.jsonl
   ```

5. **(e) Artefact public** : copier `registre.jsonl` vers le chemin de sortie
   du build selon la tâche 35 (étape de copie `public/registre.jsonl` →
   `dist/`). **Note de coordination : l'endpoint `/registre.jsonl` appartient
   à la branche de la tâche 35** (merge-hold jusqu'à la première fusion
   post-genèse) — coordonner le moment exact de la copie avec cette branche,
   ne pas dupliquer l'endpoint ici.
6. **(f) Contrôle final** — doit sortir 0 (tous les ancrages retrouvés sur
   ≥2 relais, registre recalculé identique) :

   ```bash
   node scripts/verify-anchors.mjs
   ```

7. **(g) Signal** : prévenir la tâche 22 (premier merge) que la genèse est
   faite — le premier merge de tranche peut alors avoir lieu ; l'ordre
   genèse → premier merge est prouvé par l'historique git.

À partir de là, chaque fusion de PR ajoute ses événements **en bout de
chaîne** via le hook CI et republie l'ancre de tête.

## Outils

| Script | Rôle |
|---|---|
| `scripts/genesis.mjs` | Genèse hors-ligne : fiches → chaîne `ajout` triée par slug (refuse tout registre existant) |
| `scripts/publish-anchors.mjs` | Signe et publie les notes `ANCRAGE` sur les relais épinglés, consigne les ids ici (`--dry-run` pour répétition sans effet) |
| `scripts/verify-anchors.mjs` | Relit ce tableau + le registre publié + ≥2 relais ; exit 0 seulement si tout concorde |
| `scripts/verify-registry.mjs` | Vérification hors-ligne de la chaîne (zéro dépendance) |
