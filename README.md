# FRANCEPASSOIRE

> **« La France, passoire à données. On compte les trous. »**

Observatoire citoyen indépendant recensant les fuites de données personnelles
touchant la France — catalogue, revendications ransomware, statistiques,
guides d'autoprotection et alertes citoyennes.

**Statut : prototype v1.0 (design contract figé).** Ce dépôt contient la
référence visuelle et structurelle du site. Le build de production (SSG,
données réelles, pipeline d'ingestion) viendra s'y greffer.

---

## Lancer en local

```bash
cd francepassoire.com
python3 -m http.server 3000
# → http://localhost:3000
```

Le fichier `index.html` fonctionne aussi en ouverture directe (double-clic),
mais un serveur local est préférable pour le favicon et les chemins relatifs.

## Structure

```
francepassoire.com/
├── index.html          # Site complet — 8 vues, SPA par bascule de pages
├── assets/
│   └── favicon.svg     # Logo passoire (tuile crème)
└── README.md
```

### Pages (dans index.html)

| Vue | ID | Contenu |
|---|---|---|
| Les fuites | `page-home` | Hero passoire, ticker gouttes, stats, filtres, cartes |
| Fiche Alaxione | `page-fiche` | Chiffre clé, chips de données, historique, 3 gestes |
| Ransomware | `page-ransomware` | Tableau 7 jours, groupes actifs, posture éditoriale |
| Dossier Qilin | `page-qilin` | TTPs, timeline des victimes françaises |
| Les chiffres | `page-chiffres` | Compteur National, cartes sectorisées avec liens |
| Se protéger | `page-proteger` | Vérifier (k-anonymat réel) · Agir · Surveiller |
| La méthode | `page-methode` | Sources, pastilles, registre d'intégrité, FAQ |

## Système de design (tokens)

| Token | Valeur | Usage |
|---|---|---|
| `brand.orange` | `#FF6B1A` | Fond héro, boutons, accents |
| `brand.hover` | `#E85A0C` | États pressés/hover |
| `brand.ink` | `#241405` | Encre (jamais de noir pur), bordures, ombres |
| `brand.cream` | `#FFF6EA` | Cartes |
| `brand.paper` | `#FFF9F2` | Fond de page |
| `brand.green` | `#0E7A46` | Statut Confirmée (trou colmaté) |

Typographie : **Bricolage Grotesque** (display) · **Instrument Sans** (corps) ·
**Spline Sans Mono** (chiffres, dates, labels).

Signature : pastilles à trous (Revendiquée = passoire qui fuit, dégradé radial)
vs pastille scellée verte (Confirmée) · motif de trous emboutis en dégradés
CSS purs · ombres dures 5px sans flou · boutons à enfoncement.

## Provenance des sections (fusion de 3 itérations)

- **Base (≈90 %)** : `france_passoire_prototype.html` — structure, home, fiche,
  ransomware, méthode, ticker, boutons
- **Se protéger › Surveiller** : layout de `france_passoire_v2.html` — « Créer
  une alerte personnalisée » en pleine largeur, chips de secteurs cochables,
  bouton « Activer ma veille », générateur DPO discret en dessous
- **Les chiffres (cartes)** : layout de `index.html` — cartes individuelles
  cliquables, rétroliens « → voir les fiches sources » / « → comment se
  protéger » / « → le panorama ransomware »
- **Footer** : style crème de `index.html` (à la place du footer noir)
- **Logo passoire** : illustration SVG de `index.html`, déclinée en header,
  footer et favicon (remplace l'emoji panier)

## Contraintes permanentes

- Thème clair uniquement — pas de dark mode
- Aucune donnée volée consultée, hébergée ou reproduite (métadonnées publiques
  uniquement)
- WCAG AA : focus visibles 3px, contrastes, `prefers-reduced-motion` respecté
- Vérificateur de mot de passe : k-anonymité (SHA-1 local, 5 caractères
  envoyés à `api.pwnedpasswords.com`)

## Prochaines étapes (feuille de route)

1. Déploiement prototype sur Cloudflare Pages (préproduction)
2. Build production : SSG multi-pages (1 page par fiche), CSS compilé,
   suppression du CDN Tailwind
3. Pipeline d'ingestion : ransomware.live, RSS médias, CNIL, registre
   fuitesinfos → file de validation éditoriale
4. Backfill du catalogue (~700 fiches) puis génération des pages
5. Registre d'intégrité chaîné réel (hash chain + ancrages)
6. Flux RSS/Atom, dataset JSON CC-BY, API publique
7. Phase 2 : watchlists, alertes email, réseaux sociaux

---
© 2026 FrancePassoire — projet d'utilité publique citoyenne.
