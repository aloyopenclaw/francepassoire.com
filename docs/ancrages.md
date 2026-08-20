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
| alaxione-20260820 | 1e5d01da7eae276b4bf9b079e7d6d0889c380f9a07622293616ccda3740d98bc | 6ec3f5e59b6693396602299ea00242746869e3ff31e65356ccf5b2c382858a29 |
| ants-20260415 | 67b203154cafec94f2d88b7d51037ac18046ef0806fd864d977baa86edfeb793 | cc6c594ed7142dec8d16641c2c5c0c66919ff69eff69b6d1c4d282bd6e290c31 |
| bloctel-20260812 | 9dfc00d3834d89eeed93662815b2f82373045673e40e8cca125fa377d1970b88 | a69e3a4128b1a9e04367d833b7bfe9137e10501bc349bcfc1a0787e07c64c3db |
| centre-hospitalier-perpignan-20260720 | ae68bb66cc772f63bcd7cd6313560bb95484275fd58d6f4ab7587203822072fc | cd5d954046ddd8546831cee8d650819b34ad998d0a4514b24a79d6c578216d3a |
| croq-vacances-20260715 | 8d74172d9c46b1d0a26391c68869e0132c072cc9397349644e76cbca5d395daa | c251ef3e608dfb0a425a4147076b55d6d668509da553b4524c8513311039c385 |
| dgfip-20260812 | 8409dee640bba9aa0e6f497925e6d57df96e26036f19678b049ce56dc48a2d1a | f560a5ee66db955b36e3877020d0e98ff0067d53b56134e6cce4267d5d2bb60e |
| education-nationale-20260731 | f76ecef9fadf95bc756f300179c6c1f5c32ade863112760ce58db0ecefb81560 | 15f327b94f95cafb560133c33480f2ac1833b438efbd285891c8b34f26d34dae |
| intermarche-drive-20260803 | 9be247f3298a3668a17398c3232b80de110a558bf4ef9fa7e884bffbf7097a38 | 0eb308f7b4e9fdc751261dde8349ee3f3d69b85e0d961f2706af6ebdbd26207e |
| ird-20260817 | 23ad5b3f541f1774e12ca91803626efbd195f619221e0fac13a90efd0f511d1e | ea12729b4bafb9f8d31eaa1dacfc492c15c76010f9bc588b512cfa4335f276e1 |
| police-nationale-20260415 | 9b3430747af3db5a938604170505b679bc01cb6f7754dc8619baa2cc21ce432c | ba6e073a071072f0ef6698f613f60810e31bc2964c29398107276ff7b08dc51a |
| sante-publique-france-20260811 | cd0e86844ac3188240cd929642ba248e312a967048ecadddf399742321e21499 | afa31cf7c28195a9dcf2f022d96b450ee6b7f2318485597101b27671eb62c792 |
| sfr-20260717 | 590e4a5f3f30a5f07ffa564a522c33c3c128fcd8918b62bf0d35a6d774d260b8 | c8f434dfa1891460842efaeeccec56690da6d732b1161a9c055f7a607e398511 |
| stade-francois-20260805 | 108e0708d593e56111b3424308b2037e22908288c157be28109fc44a894856f7 | e2f87f0948511b46c034f661e9fda943f8f538fae964afed4a856787f6d4b18b |
| tête | f354698b736a7aa40757762a484afa67407ad3f77604a5e0579d800add721939 | b28af98b35b277cd21108bf24f68b2719155247bfa1028b94e41a6b5bbf31716 |
| air-france-klm-20250806 | 9070c6248afcc300ef1da8274192cce2b813c284198952af8d5b8aa12114a431 | d2ddc3dfce18673bfc6f87a650a95025731ca91fb3ea999804ed01a33effc972 |
| auchan-20250821 | aa1ab1bc6d43950535118593977ffe23687810660cea15cf4fc211a1a3c323e8 | 5a39270e3b1c8ba24d0762ad5baa7c431deecc28ea9997cfebf611687338520d |
| bouygues-telecom-20250806 | 9b93179d759968874642f7825a6a0fcf064395b89a5631a6efeee5f36028aa93 | f2906b6f8bb06aed685c2df2e34f61849d1f7a78b308fee6b2217b2bdbd48078 |
| caisse-des-depots-20250212 | bef16432d0c56943926bb6eff0749e1d391047023df508ff34ff40791e7641ad | b6a955c6b7347a2eca8926ddf7b142c08aecf5ac8227ef7eb1bd7b102077dc32 |
| intersport-20250319 | 57976571a84bef099ad0d43e9122904e578e84d78d2839e08c94d6dbe32b37fb | 1463f0106db81beed8018631ccf71a29554a5ee97a404ec5ddde37dc977dcc43 |
| kiabi-20250114 | a79f044fcd44735a124c2265e3830cba23c38ce055770c00c131acb3de765619 | 8cd594ca2306d4e53e49596469ef5b08a6a7801f133981cea2e387262430eec5 |
| ministere-de-l-interieur-20251212 | 14fe0025f8585caf8a307579d57ca96861451409d5575f3badf02378ec4db3b3 | d727e185339054c451739892b30253947857a17f2a18dac0b723e7ead2470c83 |
| nexpublica-france-20251222 | 149e0a6723f4f645eb11eab812549ddb789891892443b3e07d9f73fad50d3738 | e6bc280af4c4086071cfe131d477f436f63c91474b8c8454fb1884b8056dc1f3 |
| orange-20250728 | 94706c8b4bb2249c667d2477f6fddab4990ce1173dfd8e7c57b114c475fdc5b4 | 74640042ca6970fdb655287e2fa9fc29cb5f956fa6fcf4fd1ad9d11297aad440 |
| sorbonne-universite-20250606 | d296fb7cd7c4015ee89347f964d504f0ad6ab2996717ee9732bd13c54e397587 | fec23b20686c07ec2515007129609aa7085cb6a43563bf96e57d958c782012ee |
| assurance-retraite-20240909 | 2d6eb84b013e171c4a6d7b563bc9cf550471bcdfb0921c11a8148c3ac30d3e31 | a9868b31a96ccbae7dd777ccc1112104bb8cee5810a783633f2a767b0dfdaacd |
| boulanger-20240909 | 849f3163dedf7123809a256eebde3d30c20c2a6ab7cfc1faa8b4a0d58189b428 | 503bd14e72211cf689d6ce6c1f94b8376a6a67f9377c7ce843802425f773b6a4 |
| cultura-20240910 | 92faebfb1dfc4b325d77507db53fe1e654fe54098cdcb50003ab5576cc3df448 | c42ff0bd60b7cae5d9ddedb4cce02f2940edf6e24996a067f17b56c151de6222 |
| dedalus-20210214 | 2acf2c7b57175ba867e1fd7e3cfc4b833630966692645b690e4ae14775286bad | d6010e9d2bad9bec468000927fd6bdc2235fb8f6482a4f65b1cfa1634f47f111 |
| fff-20240326 | ef63d74cea33a5723837d0f16397ff91e9ffcc7d8bcdbe948d6c77ed6effa809 | 2d28167528e24cd472d0bc12999b058d10fa3749aeb1654cae40e8dd067d7aaf |
| france-travail-20240313 | b45d049737fbd9134857cc8b6c4b8ca6c6f3601073b4518c9ecf77e84fcd2d71 | 62039916acd4235bcab9388d806058fb187b9ab4ba62b0ceaa15663527c5347d |
| ledger-20200729 | dace7dfbb1de2a8d3cc6d2cd8fe717267532c75b1d06c377ddb770afbec1284a | 6b9ec3fad97aaa4dc631590f18e043d719ca6754ed30379e03360de1f487809f |
| viamedis-20240205 | 048e645103c167533c36fea893940aa81518886ae682a5ffe359d0dfefc59b9a | 0819c98e7e25c8e7221fdebfa9f72f216a04cde0398bbd32e00536d7426597bb |
| accor-20260715 | 3ee34148408767b32deb04b948fcc4f9e6806cf189425aa56df94040d9a35210 | 652afe6b849af71f36df9de752d90eb06b6e0f3249fa4608189f3383dcc44e21 |
| aefe-20260811 | a7c61f856d8b75baf5996bc82078fe80dd6ca7ae6ad106ce1f0297b732d73bff | 2b9d5d7c341f99a047245f822fc33640df437561ffefb24df17407a52943a85b |
| bureau-vallee-20260809 | 33b9f21b27741acd4a767600172591e23db2726158a97098e74db3ab1c666158 | e5da02a2b0df14ca5c38a47a20fd975dbe1407fa88a8f95559c4767be5d607e8 |
| capgemini-engineering-20260820 | 23981cd3a9bea01f6942ee567cdbe3b2d1d18bfebdcb4a20d68fa3c474357edf | 1ac0ca6768bd545fb4e099fba5c6cc970703cd80a36eee9810870b316de6085e |
| eva-gg-20260716 | af24a4e6fc2afee3ea6719dfd40e106a88923fc74034061aa713fc8d3812ff91 | b6eeb20285d2819431c0dc01782530cc672d945ebb5ae8b94ee857a64f86d58d |
| experts-entreprendre-20260820 | ee4f4ef9b11739f287be051cd5ba5f01d53bd3f7ed0b741133236cbb419d5fd9 | e23a1cc9cc6efd16943721cf8a1a784049d9c91af9dea8c99863711e3b9078ab |
| ffe-20260708 | 01ca041d837ef641661c7c752e2a40ddf0bc31493d7c454d1d50349384202e3c | 0ad8be6882c9c7e1328b1449c47905a566bbcd8dcb085d988712c1fa3cbe3ebf |
| ffgym-20260226 | 35d3edb134966458d359db1e367b0487badd79b9ad47b90b4acd17215520c2b6 | 2b8b3a6964baa25b74a5abf5d9781a30d6e043c624fb9cf0c77c898e582750de |
| ffhandball-20260810 | a823277a1c164c63e1c18099364073f45afec070740ba11a310788de38d6b58d | f63813386abb705e42ba3ed0faada401108a05a7bb0ef9be94fe170b42dd2487 |
| ficoba-20260128 | 58268956c43959520948b06ac5e362b44ae4fc701e865a15e31a8e709056c8a8 | 196907371404f4546cbd0ab074ba153ecc7c205d9028f6c77adc89b1decc10b9 |
| hubee-20260109 | c811d74fda2afac65fa2e080ab5497f8519028fd31f5c1449df86c7db2870db9 | 906223cbe13281831cf99a8c0225c109321ac9ddc2ba2f24549c7d22415b0725 |
| insee-20260625 | a9f5976ec35316d7ee54ffb0c027bd3aaec9bffc53b5cfc79f6fcaa79efd3d70 | 446a2aad4641ac5125508ec3d27d742624ff592e3287160018b4a78affa8223f |
| ofii-20260101 | 487facc40aef231400c64b70ef74ac054119d2972befda28ea2345e9db33f06d | 40440da87dd77e30885085c7f030168b2c04c981a23993985d5dba60171c2e95 |
| sport-2000-20260819 | ec8b22438e7989707861764f5dcd7cc4f2c217823ee9b10ce3a55b8011106596 | d730084bc6d2a0727d3b668f125981bf4b54e64d877595852616ce904e5eb8a7 |
| tchap-20260607 | e5b2d03ac667a26db5f60cd507b15824a53c6c81789f1b8e91af58645837f86a | 5a8269409dfa41237b66230d5de54f1b80916c67e607d6141d8c32bfa6ecd169 |
| alain-afflelou-20250415 | 2b70e03061b62907409eb2f4195e2f442fd7acff1d37044ddb4e163e51c27bd1 | 0e991642ae862f74a717cda101da4f5fd445d54759914c6a592b786a2d342aa0 |
| autosur-20250316 | d58b114ebba20f19d50a61c44c21a20a8f4779ee3c09f92104d58398ecd305bc | 5e1cccf034a09566b4c14ee18dbc6663bacd5f1ff0bfb28c592f2fae0952c8e0 |
| chronopost-20250212 | 2decc2852e3211427d360b371ab012ac607add082204f7b75352a7db7b709c89 | 9216a5613730e81d3ebdf2bdfc1c092c779881f3b906f28f63a8d8923b9491a5 |
| chronopost-20251219 | 7193f083b740f271ef9f6f855ba413b696eb9dd6aa60c495339948595e86d115 | d6d99b884befa78a1a6dbe2e91fbf95d2911b81657a1d833e5e8d44361b76f35 |
| colis-prive-20251124 | 06eca597191d74ebb647b39d65369a33ca7fa6d9347b2daf7ba8cf5c63a7814c | 07ad0b995777ab5830ee16d117f942b28100e5450268569fa9e9b52e141e1414 |
| coriolis-telecom-20250711 | b0dc7caffeae4e09c7dbfdba56d12ab8255334da962f5f4e92841ff73e7e930f | 4e6122378b937d6cd4beabb02f06de6d4dd0c83602662e85fd464559e0663f61 |
| fftir-20251020 | f2449cd77f6c0b95e0ec434fd0804955efabc4ce1d77de143c84e69fe165803f | 742974338bbc1248a0db49c772b5f7f763e067c007322b148d988d938ae5fd81 |
| france-travail-20250722 | 58e568758a9892e5bb41235d4477028b001afff6c4981632f9558ba9cb18e468 | 3c64649798109b4cbcafaaa8e9cb50c60a52d6212a8241a15823288a265f22a1 |
| france-travail-20251201 | 645adfaea8d219eb9cc54f4065213597542840e1a0cd0de59ae39a503245bc31 | 5cb89ae554e7dc60cff99e13da6a01be5f846baf2b22f8bb51da311540fbb986 |
| harvest-20250228 | eda5c1c8b8b67244db015fe2576835570cae7374dc1e15d57dc8f9608dabc065 | ad477be55a78b43e44a43980a47fc0a9c097b76e0fd6a5d04f729b748c7a01ef |
| leroy-merlin-20251203 | b1680b53910670b538a506826446d149e7c3f648620d6b7d9af88e993c90415a | 1027c488608d406448262cbcddd764fd923b843b8649c77f594a7e454d47aef3 |
| ministere-des-sports-20251217 | b51d05c0e2e87e0f68e57decd5e291b3cafcf7c6b68faf37f1a52d5ec61eca9f | e099544b8d7c9232a53f87a4d40087a5c9b1fe40be08aa9d9765e5dc118b6cd3 |
| mondial-relay-20251227 | 55d8c9e89b93e45d8c578558beddf38b1aa28853451dadc0b6c1c13d5f8d66df | 8e94e7c85568a0bdf594528383ffe9845e519fe00393f3fff797c6cf0f997e08 |
| urssaf-pajemploi-20251117 | 41353b8a19cbf85cff5438d0ec961ad416070ece61d9a7920fd7cefdfc13edf2 | 2c9830f8618b81e7537595777cd037a21017d22c96041f8257318736c2f0fb52 |
| weda-20251110 | 222aa5c7bd16254f30d5c0ebea4afdd40566f29cc81aa823f621a1ea82d82666 | 6be3bcde5ca6f962c94007f2210b9b34459e86c2980aaa30ad1e29f18bfa8351 |
| almerys-20240205 | 5e340e022cc0b4c2b00c7e883f042c9b01eaee09219ad4fe4d8045b12a6cc35e | b5f9fca7deb6e8598526f3fd0d5631ddb5a2ff84ab7386f44b35ab0ffa113b19 |
| ap-hp-20210912 | 357c1ec16c17a185fbec0ad149d0afce868b3bf19979ebe892b7241aa99ff830 | e69b965d50ea6c76f63e2b34e430ace219fca90f43f570a94db233fa3308b099 |
| caf-20240212 | e3fa72554738e388ef5efed8f0e747794ef0d61994ed1c0dde0f858df2b80db3 | 96d34a91c85bf8c4f1ae7ad174e22dfe31405c1faed8a400bd85679979120316 |
| centre-hospitalier-arles-20210818 | 0c97a2b52909d42cc7f2a56a1f9c64e1944ec663267e5913517460b1752a37e9 | a8c3455ffe8bc773ac6c4f52d94cf8ab65e6c7e1d49ff3f841d0314a51d35783 |
| centre-hospitalier-sud-francilien-20220822 | 3f99fa56f1558b808e972057542ea900310d908c04a06285c15ad6fd555a4971 | 1ed1ef6ae7dafd30382583355c4d89e07ac50583651e0e6a66fa7c712c96235c |
| ght-coeur-grand-est-20220419 | 873335e91bcdc7cd3473ffb4a1921104a10d7471ae67e059f0ba6e55f90eb5fb | 900c4df9f1b044624cf61bf781881f970d854a4e39691770e46471ab66791550 |
| la-poste-mobile-20220708 | d9fa96d3bbf110b76b479bb2179e4605ebbeeec2d5818b85a4f71c25b0c932ac | 52542ce3c905d5434700bfe82f8b8c8d7abbb6c1808640d56654af0945ec1fbe |
| ldlc-20240228 | f354698b736a7aa40757762a484afa67407ad3f77604a5e0579d800add721939 | 76fa075afffb8f3d5c42f2944370fb5b7a03a3f8b510cac4da273630abbb8a60 |

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
