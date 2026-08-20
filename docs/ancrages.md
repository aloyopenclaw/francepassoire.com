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
| alaxione-20260820 | 1e5d01da7eae276b4bf9b079e7d6d0889c380f9a07622293616ccda3740d98bc | 781e94cabeeaa7e5c7128bacbcdf9e957a8579f01792683d60ae77e33fb23cf5 |
| ants-20260415 | 67b203154cafec94f2d88b7d51037ac18046ef0806fd864d977baa86edfeb793 | 853fef10bb418d6e800d6507b52ee494c403d713570eff34f584b906e433a15c |
| bloctel-20260812 | 9dfc00d3834d89eeed93662815b2f82373045673e40e8cca125fa377d1970b88 | 47453fff8907a847647c6af8650abe6fc0586c8886577d98d571e3284cce2637 |
| centre-hospitalier-perpignan-20260720 | ae68bb66cc772f63bcd7cd6313560bb95484275fd58d6f4ab7587203822072fc | c59b431300152c5d813bc6fc843d7667547dc08aac63143fe91aac12bd020894 |
| croq-vacances-20260715 | 8d74172d9c46b1d0a26391c68869e0132c072cc9397349644e76cbca5d395daa | 5c25a5542a403a45286dbc7d6e91ae6ee6d261fdb4cd4f1cdf576f2c4aa8c708 |
| dgfip-20260812 | 8409dee640bba9aa0e6f497925e6d57df96e26036f19678b049ce56dc48a2d1a | 6d1ab0ee706df8fdf81a729ebf98d2e515a6f7696facfc36ffbc9e79c02027f6 |
| education-nationale-20260731 | f76ecef9fadf95bc756f300179c6c1f5c32ade863112760ce58db0ecefb81560 | a0cb195f0d710a7cea9dd380ab0663dd64fb4b7c92150725a668d5b4466d4b66 |
| intermarche-drive-20260803 | 9be247f3298a3668a17398c3232b80de110a558bf4ef9fa7e884bffbf7097a38 | bea9ef3c115b4434c5c89395aca0b1f921472de7ddef6ebcebb98a81ed8ef725 |
| ird-20260817 | 23ad5b3f541f1774e12ca91803626efbd195f619221e0fac13a90efd0f511d1e | cfd6ffeb739a752ccc16bd589888fc00140ad581ba61942a10b6b768532e268c |
| police-nationale-20260415 | 9b3430747af3db5a938604170505b679bc01cb6f7754dc8619baa2cc21ce432c | ac0f09e8e94714763340a939b1f65fe75dc9d920fe96d679ec4bf1cffb6354a8 |
| sante-publique-france-20260811 | cd0e86844ac3188240cd929642ba248e312a967048ecadddf399742321e21499 | 57ac5f981cc343e6a87e8e7e6b30e12951e9b82201f4c94baf40368f876f9aeb |
| sfr-20260717 | 590e4a5f3f30a5f07ffa564a522c33c3c128fcd8918b62bf0d35a6d774d260b8 | ed6ac266af006466200a1f770017e954aa4509f369e3ea21b270851d39ad31ba |
| stade-francois-20260805 | 108e0708d593e56111b3424308b2037e22908288c157be28109fc44a894856f7 | ffc3dde2a8473d63549f89184fde3763ddb054df4ac8dfb652fc50d9193d5114 |
| tête | 222aa5c7bd16254f30d5c0ebea4afdd40566f29cc81aa823f621a1ea82d82666 | 78a9ce2ed85434fb8f64bf1c4b9cd4bf026172d764775a6b2cf4ba40be67e1fe |
| air-france-klm-20250806 | 9070c6248afcc300ef1da8274192cce2b813c284198952af8d5b8aa12114a431 | 0d11214b8ec7a2c5400fc91eee2ad82168588a9daad1664eccef13598c0d357a |
| auchan-20250821 | aa1ab1bc6d43950535118593977ffe23687810660cea15cf4fc211a1a3c323e8 | accd4b53f908523eca4a1fd4726f37442ca636943fea602863a4e078612a3bcd |
| bouygues-telecom-20250806 | 9b93179d759968874642f7825a6a0fcf064395b89a5631a6efeee5f36028aa93 | 17048c705af2fa1553a7b6476fc7c7daf302a598e149238b9e345d2b777cd476 |
| caisse-des-depots-20250212 | bef16432d0c56943926bb6eff0749e1d391047023df508ff34ff40791e7641ad | 6eada93feb77fee5d4b7fc3382df5d943fd8d37a6263bef63bacd56545df5ffd |
| intersport-20250319 | 57976571a84bef099ad0d43e9122904e578e84d78d2839e08c94d6dbe32b37fb | ade2f1ffcc2eb1d9186bb7a014e16ac618adf43bc4b8f6384fafc88b7d260267 |
| kiabi-20250114 | a79f044fcd44735a124c2265e3830cba23c38ce055770c00c131acb3de765619 | 2e0d3de167f850b402c3d5273b81053a21dc5963ec8b9c13993ceb9312040fc7 |
| ministere-de-l-interieur-20251212 | 14fe0025f8585caf8a307579d57ca96861451409d5575f3badf02378ec4db3b3 | f0ed52b7b677d9e128db03128ceb5459b58c937cb2af5ee5a9d5375c4504d0d8 |
| nexpublica-france-20251222 | 149e0a6723f4f645eb11eab812549ddb789891892443b3e07d9f73fad50d3738 | 3c62d5ff58d385cbafc117ee455cf18764dcb5b8edd3a30a80b37460ed002937 |
| orange-20250728 | 94706c8b4bb2249c667d2477f6fddab4990ce1173dfd8e7c57b114c475fdc5b4 | 8e56fff70367aad631cf3ae16034f43d771fa3b42af59e4b7a951d7db69f6618 |
| sorbonne-universite-20250606 | d296fb7cd7c4015ee89347f964d504f0ad6ab2996717ee9732bd13c54e397587 | 8775c5cce7d20994a82e2100aaccbccdc52e06933d8ee7ba56f289079d3aa96d |
| assurance-retraite-20240909 | 2d6eb84b013e171c4a6d7b563bc9cf550471bcdfb0921c11a8148c3ac30d3e31 | e4de846ce157fcecc08412ed5c61ecaa1f12dd4dccd8b3db8cd7ba8d07331891 |
| boulanger-20240909 | 849f3163dedf7123809a256eebde3d30c20c2a6ab7cfc1faa8b4a0d58189b428 | abbc8680649a87633f0bd5ee78612ad6de0e858019d2764c81e6d2a4ab7b2017 |
| cultura-20240910 | 92faebfb1dfc4b325d77507db53fe1e654fe54098cdcb50003ab5576cc3df448 | 56f88ff5cddcb5d5298d30b6e33a7c37522d8660f1231873835d1b176de40669 |
| dedalus-20210214 | 2acf2c7b57175ba867e1fd7e3cfc4b833630966692645b690e4ae14775286bad | 9a0dce925ce492a8d6fbd3bb575615dfb275582ea30f72bb5de94f9febeec972 |
| fff-20240326 | ef63d74cea33a5723837d0f16397ff91e9ffcc7d8bcdbe948d6c77ed6effa809 | cd80d6918e35437b99a1e25549c9c49fe4454ea65f065585d3ab3e96d61b48c1 |
| france-travail-20240313 | b45d049737fbd9134857cc8b6c4b8ca6c6f3601073b4518c9ecf77e84fcd2d71 | 00e0b134dec8e43e35e2d0abf6f28670aef428ad4e10b35a84b3ad201741c86d |
| ledger-20200729 | dace7dfbb1de2a8d3cc6d2cd8fe717267532c75b1d06c377ddb770afbec1284a | 045ea6f542de06fa455cddf76942d741080dc86285614a4dadd6f16bf41c216f |
| viamedis-20240205 | 048e645103c167533c36fea893940aa81518886ae682a5ffe359d0dfefc59b9a | 30c575d918471e0b580fed54a4e26e17ddcf4ab8c68e693407e842e84974a7e0 |
| accor-20260715 | 3ee34148408767b32deb04b948fcc4f9e6806cf189425aa56df94040d9a35210 | e8f16fd8179fcc4ebceb8914de2ca528f938752fdcb907d164517031a5f768aa |
| aefe-20260811 | a7c61f856d8b75baf5996bc82078fe80dd6ca7ae6ad106ce1f0297b732d73bff | a0c92e7d0abe5c2818138c4faeb6a4b195c06f169d5e2c286541d80453e71b37 |
| bureau-vallee-20260809 | 33b9f21b27741acd4a767600172591e23db2726158a97098e74db3ab1c666158 | 46e9180aecd41b3460a5cd8db31e3fa721c505beb6f1415627cfb41d7fe1572b |
| capgemini-engineering-20260820 | 23981cd3a9bea01f6942ee567cdbe3b2d1d18bfebdcb4a20d68fa3c474357edf | 0808cb4902f1f27d4717cf62269d965ff81b49284cf325509033a87312d60983 |
| eva-gg-20260716 | af24a4e6fc2afee3ea6719dfd40e106a88923fc74034061aa713fc8d3812ff91 | a0724fe06722a111830066264be118a1fae740e536a841f563632caacc6edfda |
| experts-entreprendre-20260820 | ee4f4ef9b11739f287be051cd5ba5f01d53bd3f7ed0b741133236cbb419d5fd9 | d50c4b84f937755d910427796710165e60c5d9eff263b0fa0012d6889bf833f1 |
| ffe-20260708 | 01ca041d837ef641661c7c752e2a40ddf0bc31493d7c454d1d50349384202e3c | 14b78b3f0a815816b3f7522f2a2bbbb515e46e32be0d82222ae92c532fba7ab9 |
| ffgym-20260226 | 35d3edb134966458d359db1e367b0487badd79b9ad47b90b4acd17215520c2b6 | d3779f10cb980459898b94fbf75605bc6335be5fa56618189ef448484673de2d |
| ffhandball-20260810 | a823277a1c164c63e1c18099364073f45afec070740ba11a310788de38d6b58d | 1fac1693585ae17d955a3fcb742bebd462bd0322abbfd8b8532f82175fe7d523 |
| ficoba-20260128 | 58268956c43959520948b06ac5e362b44ae4fc701e865a15e31a8e709056c8a8 | 3beb8a0a430d34a9b1d6e6a7f024ad1130153c0a732ecbe26f7f7d7a00db3614 |
| hubee-20260109 | c811d74fda2afac65fa2e080ab5497f8519028fd31f5c1449df86c7db2870db9 | b78b1fafd6650dbd28d59cf6b52cdcbf2fd5236223a863c9987d94969123eac9 |
| insee-20260625 | a9f5976ec35316d7ee54ffb0c027bd3aaec9bffc53b5cfc79f6fcaa79efd3d70 | 3d0732ec6d53f1a6fb03ba8aa7b26c94e6db103038448b4fbbbe3507d86a2800 |
| ofii-20260101 | 487facc40aef231400c64b70ef74ac054119d2972befda28ea2345e9db33f06d | 22ecb393a4ebd19e1bc1a5b9a457d0a3b3639e21fb106bcb15b15a9a16f34e43 |
| sport-2000-20260819 | ec8b22438e7989707861764f5dcd7cc4f2c217823ee9b10ce3a55b8011106596 | 8243288dce492c48236f062c50ac751040c83f61808107629299d0a51761a380 |
| tchap-20260607 | e5b2d03ac667a26db5f60cd507b15824a53c6c81789f1b8e91af58645837f86a | cb8661cd378362a086b2f3feb1761ff6a089ef111b8cc4664f4b23ea9e1eda65 |
| alain-afflelou-20250415 | 2b70e03061b62907409eb2f4195e2f442fd7acff1d37044ddb4e163e51c27bd1 | 9f59cfbd302f3d5dcc2772423b9b2c9f9e4ca92a870aae62ae76d3dd0a00298e |
| autosur-20250316 | d58b114ebba20f19d50a61c44c21a20a8f4779ee3c09f92104d58398ecd305bc | e2c753a9d69a73d8debc046fe09ad6fc5910ca55c691eec2cb09fa3c8844c11e |
| chronopost-20250212 | 2decc2852e3211427d360b371ab012ac607add082204f7b75352a7db7b709c89 | 6eade4b1193f7aa64dfcb9e6485ac374ed2efd3c54e5380ae9c1e8c13374edcc |
| chronopost-20251219 | 7193f083b740f271ef9f6f855ba413b696eb9dd6aa60c495339948595e86d115 | 76e0cb50f262fa997a85cac68f7812dab4f5513379f008d4973a57014f8e2f0d |
| colis-prive-20251124 | 06eca597191d74ebb647b39d65369a33ca7fa6d9347b2daf7ba8cf5c63a7814c | 08298ea12d084c0d475a483aacf8160c3ee57ab9a85d2040d0d3841161549c83 |
| coriolis-telecom-20250711 | b0dc7caffeae4e09c7dbfdba56d12ab8255334da962f5f4e92841ff73e7e930f | b836dafb8072cba1922f8063c1d7615f374778062f2fe35af71be11fc9c5c4fc |
| fftir-20251020 | f2449cd77f6c0b95e0ec434fd0804955efabc4ce1d77de143c84e69fe165803f | 59bba6015264914384a8bc8abe08d9947bc39987b6543f6efda1ad745e941a67 |
| france-travail-20250722 | 58e568758a9892e5bb41235d4477028b001afff6c4981632f9558ba9cb18e468 | f42b6421a4659dac37875d2ad4366af01f94cedb87de7e96094aedfde4d9478a |
| france-travail-20251201 | 645adfaea8d219eb9cc54f4065213597542840e1a0cd0de59ae39a503245bc31 | c952b11af15dca59ca93f7f0f51f497a2fd920f4f952edf0daa50715c69386af |
| harvest-20250228 | eda5c1c8b8b67244db015fe2576835570cae7374dc1e15d57dc8f9608dabc065 | 51b440b5ead73abe32a4766aa599b84526d3a96fe2afcac3342631e59266beb3 |
| leroy-merlin-20251203 | b1680b53910670b538a506826446d149e7c3f648620d6b7d9af88e993c90415a | eacf6a83476cb0061e858837d9e3e65f06da0b2cacd6e84dfa9cda4fdb297d0e |
| ministere-des-sports-20251217 | b51d05c0e2e87e0f68e57decd5e291b3cafcf7c6b68faf37f1a52d5ec61eca9f | ce29190f53e9afaf89eca8d6cc84c775b38b62d32781c49a507f04af7fe2a7bd |
| mondial-relay-20251227 | 55d8c9e89b93e45d8c578558beddf38b1aa28853451dadc0b6c1c13d5f8d66df | 0497c1643ce7a9dd212ec1a2078f30e152cf9c200cb7cf6ee2fc413616d8c404 |
| urssaf-pajemploi-20251117 | 41353b8a19cbf85cff5438d0ec961ad416070ece61d9a7920fd7cefdfc13edf2 | e3f14de059f86a43c8ec47ae013cd5ae714a69557b778f3ec118f7c0dec9095a |
| weda-20251110 | 222aa5c7bd16254f30d5c0ebea4afdd40566f29cc81aa823f621a1ea82d82666 | 22f4ffb641f75c25ea4cba581ad31485f571b2f326892dbec5421062d61ead24 |

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
