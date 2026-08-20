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
| alaxione-20260820 | 1e5d01da7eae276b4bf9b079e7d6d0889c380f9a07622293616ccda3740d98bc | 17fec8b7958f3019b6b423cecd1398469be75002dad0212c30e5fdc062ef3c2b |
| ants-20260415 | 67b203154cafec94f2d88b7d51037ac18046ef0806fd864d977baa86edfeb793 | 4990442eac0a7f1d694e5022d8523c58566681e7f545e14026a2092e9276328f |
| bloctel-20260812 | 9dfc00d3834d89eeed93662815b2f82373045673e40e8cca125fa377d1970b88 | 237b097dc75b77e949e54a5ef6572e7e5cfea5a77b986d6631f5112d7bf4698c |
| centre-hospitalier-perpignan-20260720 | ae68bb66cc772f63bcd7cd6313560bb95484275fd58d6f4ab7587203822072fc | ff98de35a9a2ceecbb45b85f24266cfe6a18182df17bc21481524ac7964d11da |
| croq-vacances-20260715 | 8d74172d9c46b1d0a26391c68869e0132c072cc9397349644e76cbca5d395daa | fd87cbfb4434a007dabf4c8a6101519ae79959503af9f83ea2d620936e369e8b |
| dgfip-20260812 | 8409dee640bba9aa0e6f497925e6d57df96e26036f19678b049ce56dc48a2d1a | 6594f26b8f28737841fadfc6814fb8a35825d1d3283a20971df3c6e427dc38c2 |
| education-nationale-20260731 | f76ecef9fadf95bc756f300179c6c1f5c32ade863112760ce58db0ecefb81560 | 0e6d12b0e6212a7edc69b2d4128c83be2f479ae862fd667225e98518dd642389 |
| intermarche-drive-20260803 | 9be247f3298a3668a17398c3232b80de110a558bf4ef9fa7e884bffbf7097a38 | 9b36465737835d7d6dc3049a5451d9a842d7edd31d3b95faed5403ca2746a63c |
| ird-20260817 | 23ad5b3f541f1774e12ca91803626efbd195f619221e0fac13a90efd0f511d1e | a97a60c329c28dd83d87389c35c314f8a1eb99c8843e15cc847cdd18a45d6215 |
| police-nationale-20260415 | 9b3430747af3db5a938604170505b679bc01cb6f7754dc8619baa2cc21ce432c | 2e631759604c1c8484e49e9a0a674cdb139a2b5497bfc7ef52e6cb9e189f9275 |
| sante-publique-france-20260811 | cd0e86844ac3188240cd929642ba248e312a967048ecadddf399742321e21499 | 3a074b763e0447530cc3de727e6a40c14b3be778ac1564c3b2e63fb935e7d419 |
| sfr-20260717 | 590e4a5f3f30a5f07ffa564a522c33c3c128fcd8918b62bf0d35a6d774d260b8 | 38f4362c8c7a86306768795668519668ccb671bc8d61fae4d65acecf335b8d60 |
| stade-francois-20260805 | 108e0708d593e56111b3424308b2037e22908288c157be28109fc44a894856f7 | be1ad93bbfb1d971ae87b10adb969f933c1272e28ed3545656ff5dde4b6c3d30 |
| tête | 068c13054c40e5d84db5e8551ba3fce5c3c1dd49be9069bb9d3e4afcc9676bb6 | 7728d504644c6300ce2622b1e06ceb68c883141ccc98768b20497161411e7bdf |
| air-france-klm-20250806 | 9070c6248afcc300ef1da8274192cce2b813c284198952af8d5b8aa12114a431 | 1a1099c61b7c43c15d7d21c24bd7b9c9a30e4fa457deb59fcaddfeb38af7e375 |
| auchan-20250821 | aa1ab1bc6d43950535118593977ffe23687810660cea15cf4fc211a1a3c323e8 | 261c9103e177576eabee8f532dc75625caf52c10d83b565a8aab7d3afd29c470 |
| bouygues-telecom-20250806 | 9b93179d759968874642f7825a6a0fcf064395b89a5631a6efeee5f36028aa93 | a4700222a790b6077ff14888960a760eaac6d2d701d1cc2cd35a7e6bb2c6d0ca |
| caisse-des-depots-20250212 | bef16432d0c56943926bb6eff0749e1d391047023df508ff34ff40791e7641ad | 26bae1456ab8f4e940d1efd6273e58990ec55e05cf16101c03f3a37483e8c77b |
| intersport-20250319 | 57976571a84bef099ad0d43e9122904e578e84d78d2839e08c94d6dbe32b37fb | 4a5e5cf97b2826f4af5e26af8a2652bce1c01ae5e8efa839a561d31665015afc |
| kiabi-20250114 | a79f044fcd44735a124c2265e3830cba23c38ce055770c00c131acb3de765619 | 95edf38ecce211a0e9c0075b02c4491f4d95bbbe6dbae254d960bed60dbc91da |
| ministere-de-l-interieur-20251212 | 14fe0025f8585caf8a307579d57ca96861451409d5575f3badf02378ec4db3b3 | d1c8461b41a60e7afb261f4349b40c093b7e408ec6a344b99cf657a2d6256c81 |
| nexpublica-france-20251222 | 149e0a6723f4f645eb11eab812549ddb789891892443b3e07d9f73fad50d3738 | 09c55df258d042e7a3c67b333c06e70e15798a53d4594e05ccafe62b3bc512d9 |
| orange-20250728 | 94706c8b4bb2249c667d2477f6fddab4990ce1173dfd8e7c57b114c475fdc5b4 | a7800b564255b67665995dafaa65704c2581e64f850a32f8ee83108ffd0cb664 |
| sorbonne-universite-20250606 | d296fb7cd7c4015ee89347f964d504f0ad6ab2996717ee9732bd13c54e397587 | 574045aeaf858bfedb2953ec09cac1b5a1d8f15038b2bd815fc2c4b1c01f2c91 |
| assurance-retraite-20240909 | 2d6eb84b013e171c4a6d7b563bc9cf550471bcdfb0921c11a8148c3ac30d3e31 | eec150921c43a6b121c47429c6dfb18009b939fa695302c665952694b693058e |
| boulanger-20240909 | 849f3163dedf7123809a256eebde3d30c20c2a6ab7cfc1faa8b4a0d58189b428 | 940bfdd5800267fcf109e11f7dcbc8fcbad6a576703d5da3b9f58a6da270d84a |
| cultura-20240910 | 92faebfb1dfc4b325d77507db53fe1e654fe54098cdcb50003ab5576cc3df448 | c4aabf47bc3d6630eae311a88e8a94934a2fa2a0821e09172358aae5bda5b6f9 |
| dedalus-20210214 | 2acf2c7b57175ba867e1fd7e3cfc4b833630966692645b690e4ae14775286bad | 4f9ffce089fa81376c87bc9358824fcb1c0e092936cc92da64c04853dc483930 |
| fff-20240326 | ef63d74cea33a5723837d0f16397ff91e9ffcc7d8bcdbe948d6c77ed6effa809 | 72f01e4cc3198be69e68ae3745023b935a635698170a5244e8c171f1b288e6f8 |
| france-travail-20240313 | b45d049737fbd9134857cc8b6c4b8ca6c6f3601073b4518c9ecf77e84fcd2d71 | 84457424f729ba3897b2afd04b3500e67d1120b69e1ce9b3428bceec686b8104 |
| ledger-20200729 | dace7dfbb1de2a8d3cc6d2cd8fe717267532c75b1d06c377ddb770afbec1284a | ec8719a33edce7ec0725a58887f9d9f2e2f5f321e525e0730c5fd14dd79b9354 |
| viamedis-20240205 | 048e645103c167533c36fea893940aa81518886ae682a5ffe359d0dfefc59b9a | 4b4626a9548072e8620af0b1de733a78da5a78f940ae5c46f565c3b80ecf6e4a |
| accor-20260715 | 3ee34148408767b32deb04b948fcc4f9e6806cf189425aa56df94040d9a35210 | 9318c1179ea12183c27af0031f98de7dfa3329d955e750bb8c52517bd61bf5ef |
| aefe-20260811 | a7c61f856d8b75baf5996bc82078fe80dd6ca7ae6ad106ce1f0297b732d73bff | 0f6f8272f8a0d768d37b768ed0d1a08b7512eefa5b15654d1fa50b0ec2f7bc33 |
| bureau-vallee-20260809 | 33b9f21b27741acd4a767600172591e23db2726158a97098e74db3ab1c666158 | 707adee2430fdf4ab78d1fdbb375a9416c737d7a32059e935e3ec9c31f78b335 |
| capgemini-engineering-20260820 | 23981cd3a9bea01f6942ee567cdbe3b2d1d18bfebdcb4a20d68fa3c474357edf | 95c19442a6317571aaa14ab124a4490c0b770dc61db6dbb6db6ac2b96b1fa7bf |
| eva-gg-20260716 | af24a4e6fc2afee3ea6719dfd40e106a88923fc74034061aa713fc8d3812ff91 | 6438b950bf4c6bf2feaeda2ea2c0b6a2fb21331c3ffb828b7d7d2a93b38b5be1 |
| experts-entreprendre-20260820 | ee4f4ef9b11739f287be051cd5ba5f01d53bd3f7ed0b741133236cbb419d5fd9 | 479c894977875e39d4c3b07666d927729af73e4c3fd09e415b27c75065493bb9 |
| ffe-20260708 | 01ca041d837ef641661c7c752e2a40ddf0bc31493d7c454d1d50349384202e3c | ba0c956cef3d620267281ddd11665f6aa92b8f1f968142139d979b2b45d3f6e3 |
| ffgym-20260226 | 35d3edb134966458d359db1e367b0487badd79b9ad47b90b4acd17215520c2b6 | 611adbe9e692ef42f273666a0d8c013f259cb6b784a56ae8e842ff74472a281f |
| ffhandball-20260810 | a823277a1c164c63e1c18099364073f45afec070740ba11a310788de38d6b58d | 7999282b6d6506f176c60defcea9d434457b72599778fd3c017731f4eb38acbb |
| ficoba-20260128 | 58268956c43959520948b06ac5e362b44ae4fc701e865a15e31a8e709056c8a8 | c3956e98f7ed5b1473ae56b6b212cb7eafe35b57d84b9fe821869103d8755c93 |
| hubee-20260109 | c811d74fda2afac65fa2e080ab5497f8519028fd31f5c1449df86c7db2870db9 | ab380a9271c0ac3aa6322de2826e37a5f09fa795cf67a6d3e87a9a3b4d7d02ee |
| insee-20260625 | a9f5976ec35316d7ee54ffb0c027bd3aaec9bffc53b5cfc79f6fcaa79efd3d70 | 8cf8da128a3f2447e0f1a09bf40f7c03b64dc7553daa2704c08b6e8be044079a |
| ofii-20260101 | 487facc40aef231400c64b70ef74ac054119d2972befda28ea2345e9db33f06d | 99a294bb3c0b29f963f082ae9c16a3ba44307b41bcca100c196def66821f0ecc |
| sport-2000-20260819 | ec8b22438e7989707861764f5dcd7cc4f2c217823ee9b10ce3a55b8011106596 | 13970fb128d3c47c25816e89d0e484f70bbaf1236b84d9725017c8a7f8f9a77d |
| tchap-20260607 | e5b2d03ac667a26db5f60cd507b15824a53c6c81789f1b8e91af58645837f86a | fcbb09a1f3e03f90a6b76121848fdc24c426a4abb70191cf9c3ef302acd0685e |
| alain-afflelou-20250415 | 2b70e03061b62907409eb2f4195e2f442fd7acff1d37044ddb4e163e51c27bd1 | 40529a91382e465dc81c0223da5bc072650460312ec79ca2406f7fc74e1fd70f |
| autosur-20250316 | d58b114ebba20f19d50a61c44c21a20a8f4779ee3c09f92104d58398ecd305bc | ceee114d57a22b0920eb602493251d2ea0d0eabc790d1dd8476b8dcfd38463fd |
| chronopost-20250212 | 2decc2852e3211427d360b371ab012ac607add082204f7b75352a7db7b709c89 | 9d20fc75f36affab23a4c5074ed909b6f37f3e720894ba29886f0104ef8e33f4 |
| chronopost-20251219 | 7193f083b740f271ef9f6f855ba413b696eb9dd6aa60c495339948595e86d115 | 0b2d6b1e47168da44d4005b7a74b93ce07b80185ebff1441592f1e7ec4bc495e |
| colis-prive-20251124 | 06eca597191d74ebb647b39d65369a33ca7fa6d9347b2daf7ba8cf5c63a7814c | cbcc145b2e6f6a98867fb3b5491e34fe2ca8c8ee043a7a5f6e40aeffbc8e0704 |
| coriolis-telecom-20250711 | b0dc7caffeae4e09c7dbfdba56d12ab8255334da962f5f4e92841ff73e7e930f | 9e21127d3ecba7a6ddbb1dc3f7d49dfd6a2479dd32a05de4981d72eb3b9d19ec |
| fftir-20251020 | f2449cd77f6c0b95e0ec434fd0804955efabc4ce1d77de143c84e69fe165803f | 0eed4bc4590c4daee43239f724932ab6d240c8cc2bdb83fe549b803688457cc3 |
| france-travail-20250722 | 58e568758a9892e5bb41235d4477028b001afff6c4981632f9558ba9cb18e468 | 52cc62a4e72e28f73226e87a0debb2830c345285e1151aea21ae67a9472ebfe1 |
| france-travail-20251201 | 645adfaea8d219eb9cc54f4065213597542840e1a0cd0de59ae39a503245bc31 | a2b7a7ab3124cb55722a66f12a0cacfceef43eb36c91e1191840fc47c7439dcd |
| harvest-20250228 | eda5c1c8b8b67244db015fe2576835570cae7374dc1e15d57dc8f9608dabc065 | ce14a4fc6f69abfc081f6cf35be47eb53207ff63f5722f0f484244d8e106e84e |
| leroy-merlin-20251203 | b1680b53910670b538a506826446d149e7c3f648620d6b7d9af88e993c90415a | f9d5c88850ee4a64154721c0826782532d86cc046070f6c0a682740b972fe75a |
| ministere-des-sports-20251217 | b51d05c0e2e87e0f68e57decd5e291b3cafcf7c6b68faf37f1a52d5ec61eca9f | c0827d07e6086bc1e2f992939c85f7ab78d724dbebe6efdb765cb529d01a2635 |
| mondial-relay-20251227 | 55d8c9e89b93e45d8c578558beddf38b1aa28853451dadc0b6c1c13d5f8d66df | 7f5bf621fe30b21852eaf422eba9b18afc60a58e939a64795b4e099db3a0362e |
| urssaf-pajemploi-20251117 | 41353b8a19cbf85cff5438d0ec961ad416070ece61d9a7920fd7cefdfc13edf2 | 9f552c91fb6470b07c8f9e8d2e8797adfe0e8f90550fb6cd58aef1d64362caf2 |
| weda-20251110 | 222aa5c7bd16254f30d5c0ebea4afdd40566f29cc81aa823f621a1ea82d82666 | e2bbae73b7b2c6ca6b72cead2cdd3446fcafd518d21961300ce6d35ca08bca10 |
| almerys-20240205 | 5e340e022cc0b4c2b00c7e883f042c9b01eaee09219ad4fe4d8045b12a6cc35e | d78a5787ff3ac77b8364f45467b2dcb383d4fe67e5c2ddbd09a782471d8dfc1e |
| ap-hp-20210912 | 357c1ec16c17a185fbec0ad149d0afce868b3bf19979ebe892b7241aa99ff830 | 85225e23648873462e46796c2ac5f200f40632794bd952020bb0ca3fc7a46f48 |
| caf-20240212 | e3fa72554738e388ef5efed8f0e747794ef0d61994ed1c0dde0f858df2b80db3 | 9c76d0b464611ed02fba8fa1d0e253f8d02fb4369e14f3925c7697b2f96e9d75 |
| centre-hospitalier-arles-20210818 | 0c97a2b52909d42cc7f2a56a1f9c64e1944ec663267e5913517460b1752a37e9 | 4dc5e240beb179c8886e84ac594e5c70432e99c5c8b8245c30effb9dd6f81162 |
| centre-hospitalier-sud-francilien-20220822 | 3f99fa56f1558b808e972057542ea900310d908c04a06285c15ad6fd555a4971 | 6b0c0c5f87fd6b88e15c0f5a6d206350c50f263bfc8d4a2ef3fdbea477c1a3b9 |
| ght-coeur-grand-est-20220419 | 873335e91bcdc7cd3473ffb4a1921104a10d7471ae67e059f0ba6e55f90eb5fb | e20370fe6db8d691fa80a3d558007cc2a822cbde3433e3eaef03b234d89b82d2 |
| la-poste-mobile-20220708 | d9fa96d3bbf110b76b479bb2179e4605ebbeeec2d5818b85a4f71c25b0c932ac | f4be9cd274622af11f2adb9e8aac88bf63af1fc953283e1c988d3856b5e6a931 |
| ldlc-20240228 | f354698b736a7aa40757762a484afa67407ad3f77604a5e0579d800add721939 | d49c3db690061bf0214812445a25710682a50aaf8f1ad727fd586fc9c6510975 |
| allopneus-20260323 | 925dea44de139b4b6c462c13d76648a97c7abba33d863aaec15ce08f0651f837 | 8042ec5b4e71cede79eb7859d95e81e9b0f9b662111d5c73eab0b80c3092aa41 |
| alumnforce-20260406 | 7bcf7eb9200bbe4633068556dba93f5270ca5a8d7795638860ab33e3a61d3cc5 | 2091dd17d8b60020b60deadbcce17380b4a2de1b85b3d4c3ec90e8181f4ea544 |
| banques-alimentaires-20260304 | 4070f5eaa14a9f6a8cab4972b29fcdcf1934fd58c4609fd419e6b50acbec1217 | c9ef33328c0cc15b9e811433d23d10c07515d4c085496bfbeecfde98039b9de4 |
| basic-fit-20260413 | 5ad0658412907537a97657618294e7e6e406cfe3b5948ca1a1c8f57238e700b6 | 8ea5b1f51b904837c2c5a1eb367ce51f30ebcf421a2ba2fde7a5f856399da4c3 |
| brit-hotel-20260414 | 2f434ab34f241fbd7e4d716ae6c125f61c0e26579e59161df0281234b37080c3 | b124bfa24abd2f39a081e7000013b82ace37c917653c73f4f193b3f89118c4cc |
| cegedim-sante-20260226 | 3cc09a77e4492f32a183f7fb532d89ff5a4ec3934eb1d3fef063a7fbb5805496 | a3e698462ebc970654f0d49e900e6e71750386c9a53075d8a4535e92167afe39 |
| cfdt-20260218 | 6b92605d49fc26ef62e9845c911650c7cd7b65fbbf52a76fc1708bebbc749c7a | 1ff2eeb830aab7893992cfe8395bef1f8b4a32629c15fe2784636d64ba558074 |
| cnous-20260323 | c02b9455d92054d8b2f300ea50298aeab47e085e41b8a9a49ac07489d9f2bed6 | 2d6c96c47736ddd884311314902904830fd777215e4593181107179a617aef16 |
| education-nationale-20260323 | c7600d08845987991923b30af521615316931a1bf583388b0cbf1e6c7dffe8ad | 276acbe1cf7be211186687a3e86560f4caeaa8e2b2af5861b697d586b284e9dd |
| educonnect-20260411 | 89058f96e66ee98e582ec386644624c00b850acf2bc3b394247d364961f13113 | aa8b219da83f63bc80e96e4aca42cc7a0fc18b2844a141f9364eba0418c6766e |
| enseignement-catholique-20260321 | c5c5c9c80f7da016147a4d156ed227f686597f55f4d0830f75640a6df1fd368b | 9d9a923907a03fc9238b095f6c8b32de314eaaa2921d0a9f6c06f87f4ca88aca |
| ff-savate-20260330 | 88ecd4cd40ab49f69581b93cb26435683657bf2bd669cfe8257163229b686da2 | f8b043505a26064d5a009b28ea592e248bb9f667b24676bc073a574e2c3a85ec |
| ffa-20260221 | acf17aa47138d7e1b9140d6216184567eb18485d093cd8094d230271a4ce5157 | 797911399189456163dbd50a83a9df921b296bf0b33c5f142c638dcd4a4718f0 |
| ffr-20260317 | b04075ecbc695111555018a4fef07fcb50331e31681834493b748ef4afa5f5c1 | 1c5f739d1a05fc40a396f6093aebe8c58af2aa2430ccfcbd9f2fbfd934beacdc |
| fnc-20260123 | 33ce9c27708afebd32af18c50bb63de4d0411b8e963ea8959aeeb87827f749a5 | 0fdbef0a82c50b67936f270da988d0fbc7ffd49cc02cb1b082712b130d5ccf92 |
| force-ouvriere-20260401 | 5c4135a946954f257576e995a75b90170ff6340c9baf0ee0be322f33f955e697 | 3c32b1f9cbf570ed61c66250451e4dbf94fb05ebdee82f15e34e0f89adb4b4be |
| kfc-france-20260407 | 01a13d0ae8b2d6ee01267a245eca50f2c07fe1c052fea2fd5ce1af9bdd2f9af7 | 1996e6f647fbfff3a6ba1863a81b36c9204d5ca952897bb5b43461ba7806686d |
| lidl-20260712 | 85207b29a5f1bd25ce9ec923e52343948b3e24a866cdbc9259407ab2b4b78eb2 | 2b7b83a23698e5ed5df0f59237ac8786b0120fe4a553cbba5d0752d625224bcc |
| logis-hotels-20260414 | b1ed248cb694f1e059f047c5fc7a1b6aed486d43b214f8cda02a6c9420900b89 | a6e274ac46676de04cefe509bba8c2981d24bfbed9ae69a10384a612bfc41227 |
| pierre-vacances-20260515 | b2f695e30f158d64e3957dab75d63cc6d5e80e1265cc9a490858c35c8e79f3e9 | 87515fc35a17a2bd22ce23eec7e43f13cce89a5034b75292974b7d8bd798fc80 |
| reglo-mobile-20260218 | 5353b3d8ae94f58f525a6684b362898ed799051bb2e9551da73c18290a443a4e | 9991e7f5ef30383d6e1e101f8641dc4c2891e1a0eb2c72b513bd8eff71257a56 |
| sia-20260324 | aeba723cfca61da87145ff9956c5c2c7c4732d83d897f74d3db794900e0ba578 | 5783560b8dcc9fcf30464cd49a2255b3fa0dfe43a0b555e6c04efa2b562e2058 |
| unss-20260228 | 54d702de8e580a541a683d0ef82f81da8260286ecc18c09798ee243faf234267 | 538d88ecffcc1b634a08a11a6163e8f288e02a98322dfbccce621ac320c0d9fa |
| xplor-resamania-20260801 | 372b5cc0b7df74703ca9567a5e38a06831e579ba00b81e0c7dfe5669cd72d87c | 06dfda4cba89782174aac48a93119cfb8f2a34f0ddf47dda96371766030dc794 |
| ymed-20260406 | 068c13054c40e5d84db5e8551ba3fce5c3c1dd49be9069bb9d3e4afcc9676bb6 | a0264d036b5a76c9cb0f5c7126023438c23bb3bcbfbd67a082998b874534424b |

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
