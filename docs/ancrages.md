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
| alaxione-20260820 | 1e5d01da7eae276b4bf9b079e7d6d0889c380f9a07622293616ccda3740d98bc | fc8da9d7f2a05941ecf855501a104f59354c63393399a534f9b80d2a7ef85068 |
| ants-20260415 | 67b203154cafec94f2d88b7d51037ac18046ef0806fd864d977baa86edfeb793 | 19fb13ebd348586bb4aa18589e07c6be87e884cae4890e63759c93d63101a40b |
| bloctel-20260812 | 9dfc00d3834d89eeed93662815b2f82373045673e40e8cca125fa377d1970b88 | aeac729feb63600239bd30d9572e039c942a9eae2a217ff42cf659e86dc0a14e |
| centre-hospitalier-perpignan-20260720 | ae68bb66cc772f63bcd7cd6313560bb95484275fd58d6f4ab7587203822072fc | b8a600b1a9c3dee8e59ea9747a5dc176d07da1c428cdaf081ff780dba43e06ba |
| croq-vacances-20260715 | 8d74172d9c46b1d0a26391c68869e0132c072cc9397349644e76cbca5d395daa | 62605337715dc31ff5bf492ffae959a57fe8caa9b9e486520504eb22da8e8ab7 |
| dgfip-20260812 | 8409dee640bba9aa0e6f497925e6d57df96e26036f19678b049ce56dc48a2d1a | 10d0158489a1547574f3a2b52d357b062a80e5580f68ff1e8445fae3bb481b05 |
| education-nationale-20260731 | f76ecef9fadf95bc756f300179c6c1f5c32ade863112760ce58db0ecefb81560 | 48d68c26ac6f9c6350234b9d3594849896dd21c47d4577c3fb8f788b4b8c5c5d |
| intermarche-drive-20260803 | 9be247f3298a3668a17398c3232b80de110a558bf4ef9fa7e884bffbf7097a38 | 3ab5e340b3a080c95af6b6753f0031fd98cc26ccc925a400b73bb0a8856a8802 |
| ird-20260817 | 23ad5b3f541f1774e12ca91803626efbd195f619221e0fac13a90efd0f511d1e | 5161e716f8e063ca189aa5d5bebd32e8a57e53b253aec4bdeb544e8918060f7e |
| police-nationale-20260415 | 9b3430747af3db5a938604170505b679bc01cb6f7754dc8619baa2cc21ce432c | 2a2e912705f9958f8ae9a00e6ab34df3bb830c4e17e1fcdc78f2fa288970432e |
| sante-publique-france-20260811 | cd0e86844ac3188240cd929642ba248e312a967048ecadddf399742321e21499 | 3f61d613dec466b26d8783c05f6ba3bdcdbe041e8ad63e0d669a643489af3aaa |
| sfr-20260717 | 590e4a5f3f30a5f07ffa564a522c33c3c128fcd8918b62bf0d35a6d774d260b8 | d56ee28944efc5da3b859b4ceacf3808fbfba848a6c2101ffb1c99d577154c39 |
| stade-francois-20260805 | 108e0708d593e56111b3424308b2037e22908288c157be28109fc44a894856f7 | e1fc5096b337d0c8627e7e44a9b6aaf5931859b27da2d0609376800c7d6eaf17 |
| tête | 048e645103c167533c36fea893940aa81518886ae682a5ffe359d0dfefc59b9a | 25cedeae172e243fe5c73a2d083ec67f2ca89df867a0a5e9d4c10187ffd5b81c |
| air-france-klm-20250806 | 9070c6248afcc300ef1da8274192cce2b813c284198952af8d5b8aa12114a431 | 89b9022d658718c05fcc03bc7b3c4bc6223908176a8cbba5bee1d4dc369d4af4 |
| auchan-20250821 | aa1ab1bc6d43950535118593977ffe23687810660cea15cf4fc211a1a3c323e8 | 850b95d9de68da9d4e6b10910969a8b0a996302673cd70a46aac796bdc9bd2ce |
| bouygues-telecom-20250806 | 9b93179d759968874642f7825a6a0fcf064395b89a5631a6efeee5f36028aa93 | 80ddbfaa39b44fafd98e7316caacbc275c8e669107f18f3f6be7197367bd26e8 |
| caisse-des-depots-20250212 | bef16432d0c56943926bb6eff0749e1d391047023df508ff34ff40791e7641ad | e74f45fb93293a467152307ceb98cd8133efe03e1ed0cec739efe2542a0fc91d |
| intersport-20250319 | 57976571a84bef099ad0d43e9122904e578e84d78d2839e08c94d6dbe32b37fb | 852f3d1273b91e7ddf42a21bd6595598edcf43128f8617b68952926e55b3eba9 |
| kiabi-20250114 | a79f044fcd44735a124c2265e3830cba23c38ce055770c00c131acb3de765619 | 83b3fea4a1634b9b0488c37682a6e4bd2617aeb1bbeead24348f1640f9b71950 |
| ministere-de-l-interieur-20251212 | 14fe0025f8585caf8a307579d57ca96861451409d5575f3badf02378ec4db3b3 | 536b711445e21b12194c4d2a19330eadcfa85d306ac47e472e10b1950e14117b |
| nexpublica-france-20251222 | 149e0a6723f4f645eb11eab812549ddb789891892443b3e07d9f73fad50d3738 | 5d4cbc10779856c676777cf6492e6a8d201b5b29ebd08ce6d087f6ec823fd7de |
| orange-20250728 | 94706c8b4bb2249c667d2477f6fddab4990ce1173dfd8e7c57b114c475fdc5b4 | 482af7b331834ea23bbcb900c8dae7b1427d41c08e3ce227db80ad26d0138dc1 |
| sorbonne-universite-20250606 | d296fb7cd7c4015ee89347f964d504f0ad6ab2996717ee9732bd13c54e397587 | 52f1ddba656ca33c9c370990b5124dd9dce07a8b1bb0cb3a95c35f8b9e4c0b01 |
| assurance-retraite-20240909 | 2d6eb84b013e171c4a6d7b563bc9cf550471bcdfb0921c11a8148c3ac30d3e31 | 1a7846d491b46a22ff455d5bb173a3fc406fbf190765f67e4ed462c115fb999c |
| boulanger-20240909 | 849f3163dedf7123809a256eebde3d30c20c2a6ab7cfc1faa8b4a0d58189b428 | cc5ff32ce034a79c6198413d06d5a105c23d5ab2e4758bc73092f8022bd0d8bd |
| cultura-20240910 | 92faebfb1dfc4b325d77507db53fe1e654fe54098cdcb50003ab5576cc3df448 | 8d82bd941c7d3ae8acb93603d426aed1fd0a34bcce5239f45d5003c36dbc1e24 |
| dedalus-20210214 | 2acf2c7b57175ba867e1fd7e3cfc4b833630966692645b690e4ae14775286bad | 5f44f5ea5d9f556dc3a9c459f5c07dbc55d591b2770df366ec6c50191cf464f9 |
| fff-20240326 | ef63d74cea33a5723837d0f16397ff91e9ffcc7d8bcdbe948d6c77ed6effa809 | ed0af2533e2a6df52e8587525e99031281bec68be20635c1465e580c2b9b8f65 |
| france-travail-20240313 | b45d049737fbd9134857cc8b6c4b8ca6c6f3601073b4518c9ecf77e84fcd2d71 | d81be0913e924a10e66e937107ff2c00238713290a4aa5dfdd993d6a01a23bf6 |
| ledger-20200729 | dace7dfbb1de2a8d3cc6d2cd8fe717267532c75b1d06c377ddb770afbec1284a | 811cdfe854ce4cf32f235ebab4611532268b9c715d78d98a9af04d4aee95323d |
| viamedis-20240205 | 048e645103c167533c36fea893940aa81518886ae682a5ffe359d0dfefc59b9a | 3529ab512d6217210c42c2d1c524acb6d9a453b5f48fd5c926726beac0ac3a29 |

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
