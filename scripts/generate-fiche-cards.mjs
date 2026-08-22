#!/usr/bin/env node
// FrancePassoire — cartes fiche 1080×1080 pour les réseaux sociaux (T51).
//
// Génère dist/fiche/<slug>/card.jpg pour CHAQUE fiche du catalogue : fond
// orange #FF6B1A, trame de trous encre (motif passoire du site), nom de
// l'entité en Bricolage Grotesque 800, volume en Spline Sans Mono, pastille
// de statut (verte « Confirmée » / passoire « Revendiquée »), wordmark
// FRANCEPASSOIRE en bas. Ces cartes servent d'og:image (fiche/[slug].astro)
// ET d'image de post Instagram (« JPEG is the only image format supported »,
// doc Content Publishing — d'où le JPEG obligatoire).
//
// Chaîne SANS nouvelle dépendance runtime : satori (SVG) → resvg (PNG) →
// sharp (JPEG). satori + @resvg/resvg-js sont les seuls devDeps ajoutés ;
// sharp arrive TRANSITIVEMENT par astro (dépendance directe d'astro 5 — si
// astro venait à le lâcher, ce script échouerait immédiatement et visiblement).
//
// Polices : TTF statiques OFL téléchargés une bonne fois dans scripts/assets/
// (licences et provenance : scripts/assets/README.md) — satori ne lit pas le
// woff2 auto-hébergé du site.
//
// Usage :
//   node scripts/generate-fiche-cards.mjs                # tout le catalogue
//   node scripts/generate-fiche-cards.mjs --only a,b     # rendu ciblé (test)
// Garde : > MAX_FICHES fiches → génération sautée (le catalogue dépasse les
// prévisions du design ? on repense avant d'engluer le build).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

const TAILLE = 1080;
const MAX_FICHES = 3000;
const CONCURRENCE = 8;
const QUALITE_JPEG = 85;

const ORANGE = '#FF6B1A';
const ENCRE = '#241405';
const CREME = '#FFF6EA';
const VERT = '#0E7A46';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(racine, 'scripts', 'assets');
const catalogueDir = join(racine, 'data', 'catalog');
const distDir = join(racine, 'dist');

const POLICES = [
  { fichier: 'bricolage-800.ttf', famille: 'Bricolage Grotesque', graisse: 800 },
  { fichier: 'bricolage-400.ttf', famille: 'Bricolage Grotesque', graisse: 400 },
  { fichier: 'spline-700.ttf', famille: 'Spline Sans Mono', graisse: 700 },
  { fichier: 'spline-400.ttf', famille: 'Spline Sans Mono', graisse: 400 },
].map((p) => ({
  name: p.famille,
  weight: p.graisse,
  style: 'normal',
  data: readFileSync(join(assetsDir, p.fichier)),
}));

const fichiersPolices = [
  'bricolage-800.ttf',
  'bricolage-400.ttf',
  'spline-700.ttf',
  'spline-400.ttf',
].map((f) => join(assetsDir, f));

const nombreFr = new Intl.NumberFormat('fr-FR');

const PHRASES_UNITE = {
  personnes: 'personnes concernées',
  comptes: 'comptes concernés',
  enregistrements: 'enregistrements concernés',
  lignes: 'lignes concernées',
};

// ---------------------------------------------------------------------------
// Trame de trous : motif passoire du site en pur positionnement absolu
// (satori ne répète pas les background-image radial-gradient).
// ---------------------------------------------------------------------------

function trameTrous() {
  const pas = 72;
  const diametre = 14;
  const trous = [];
  for (let y = pas / 2; y < TAILLE; y += pas) {
    for (let x = pas / 2; x < TAILLE; x += pas) {
      trous.push({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            position: 'absolute',
            left: `${String(x)}px`,
            top: `${String(y)}px`,
            width: `${String(diametre)}px`,
            height: `${String(diametre)}px`,
            borderRadius: '9999px',
            backgroundColor: ENCRE,
            opacity: '0.16',
          },
        },
      });
    }
  }
  return {
    type: 'div',
    props: { style: { display: 'flex', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }, children: trous },
  };
}

// ---------------------------------------------------------------------------
// Pastilles de statut — la signature visuelle du site : scellée verte pour
// Confirmée, passoire à trous crème pour Revendiquée.
// ---------------------------------------------------------------------------

function pastilleStatut(statut) {
  if (statut === 'confirmee') {
    return {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          backgroundColor: VERT,
          border: `4px solid ${ENCRE}`,
          borderRadius: '9999px',
          padding: '14px 34px',
        },
        children: [
          texte('CONFIRMÉE', { famille: 'Spline Sans Mono', graisse: 700, taille: 34, couleur: CREME, espacement: 2 }),
        ],
      },
    };
  }
  const trous = [0, 1, 2].map((i) => ({
    type: 'div',
    props: {
      style: {
        width: '12px',
        height: '12px',
        borderRadius: '9999px',
        backgroundColor: ENCRE,
        marginLeft: i === 0 ? '0px' : '8px',
      },
    },
  }));
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        alignItems: 'center',
        backgroundColor: CREME,
        border: `4px solid ${ENCRE}`,
        borderRadius: '9999px',
        padding: '14px 34px',
      },
      children: [
        ...trous,
        {
          type: 'div',
          props: { style: { display: 'flex', width: '16px' } },
        },
        texte('REVENDIQUÉE', { famille: 'Spline Sans Mono', graisse: 700, taille: 34, couleur: ENCRE, espacement: 2 }),
      ],
    },
  };
}

function texte(contenu, { famille, graisse, taille, couleur, espacement }) {
  return {
    type: 'div',
    props: {
      style: {
        fontFamily: famille,
        fontWeight: graisse,
        fontSize: `${String(taille)}px`,
        color: couleur,
        ...(espacement ? { letterSpacing: `${String(espacement)}px` } : {}),
        display: 'flex',
      },
      children: contenu,
    },
  };
}

// ---------------------------------------------------------------------------
// Carte complète.
// ---------------------------------------------------------------------------

function texteOuTronque(entite, max) {
  return entite.length > max ? `${entite.slice(0, max - 1)}…` : entite;
}

/** Taille display adaptée à la longueur du nom (211 caractères observés). */
function tailleEntite(longueur) {
  if (longueur <= 14) return 128;
  if (longueur <= 24) return 104;
  if (longueur <= 40) return 84;
  if (longueur <= 80) return 62;
  if (longueur <= 140) return 48;
  return 40;
}

function carteFiche(fiche) {
  const nom = texteOuTronque(fiche.entity, 170);
  const volume =
    fiche.volume.count > 0
      ? `${nombreFr.format(fiche.volume.count)} ${PHRASES_UNITE[fiche.volume.unit] ?? fiche.volume.unit}`
      : 'Volume non communiqué';

  return {
    type: 'div',
    props: {
      style: {
        width: `${String(TAILLE)}px`,
        height: `${String(TAILLE)}px`,
        backgroundColor: ORANGE,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px',
        fontFamily: 'Spline Sans Mono',
        color: ENCRE,
      },
      children: [
        trameTrous(),
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              flexGrow: 1,
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    fontFamily: 'Bricolage Grotesque',
                    fontWeight: 800,
                    fontSize: `${String(tailleEntite(fiche.entity.length))}px`,
                    lineHeight: 1.1,
                    color: ENCRE,
                    wordBreak: 'break-word',
                    maxWidth: '100%',
                  },
                  children: nom,
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    marginTop: '28px',
                    fontFamily: 'Spline Sans Mono',
                    fontWeight: 700,
                    fontSize: '40px',
                    color: CREME,
                  },
                  children: volume.toUpperCase(),
                },
              },
              { type: 'div', props: { style: { display: 'flex', height: '34px' } } },              pastilleStatut(fiche.statut),
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            },
            children: [
              texte('FRANCEPASSOIRE', { famille: 'Bricolage Grotesque', graisse: 800, taille: 44, couleur: ENCRE, espacement: 3 }),
              texte('francepassoire.com', { famille: 'Spline Sans Mono', graisse: 400, taille: 30, couleur: ENCRE }),
            ],
          },
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Rendu : satori → SVG, resvg → PNG (polices chargées pour les <text>),
// sharp → JPEG.
// ---------------------------------------------------------------------------

async function rendreCarte(fiche) {
  const svg = await satori(carteFiche(fiche), {
    width: TAILLE,
    height: TAILLE,
    fonts: POLICES,
  });
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: TAILLE },
    font: { loadSystemFonts: false, fontFiles: fichiersPolices },
  })
    .render()
    .asPng();
  return sharp(png).jpeg({ quality: QUALITE_JPEG, mozjpeg: true }).toBuffer();
}

// ---------------------------------------------------------------------------
// Point d'entrée.
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const iOnly = args.indexOf('--only');
const slugsCibles =
  iOnly !== -1 && args[iOnly + 1]
    ? new Set(args[iOnly + 1].split(',').map((s) => s.trim()).filter(Boolean))
    : null;

if (!existsSync(distDir)) {
  console.error('✗ generate-fiche-cards : dist/ introuvable — lance d’abord `npm run build`.');
  process.exit(1);
}

let fiches = readdirSync(catalogueDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(catalogueDir, f), 'utf8')));

if (slugsCibles) {
  fiches = fiches.filter((f) => slugsCibles.has(f.slug));
}

if (fiches.length > MAX_FICHES) {
  console.error(
    `✗ generate-fiche-cards : ${String(fiches.length)} fiches > garde ${String(MAX_FICHES)} — génération sautée (repenser le coût de build).`,
  );
  process.exit(0);
}

const debut = Date.now();
let faites = 0;
let curseur = 0;

async function ouvrier() {
  while (curseur < fiches.length) {
    const fiche = fiches[curseur];
    curseur += 1;
    const jpg = await rendreCarte(fiche);
    const dossier = join(distDir, 'fiche', fiche.slug);
    mkdirSync(dossier, { recursive: true });
    writeFileSync(join(dossier, 'card.jpg'), jpg);
    faites += 1;
    if (faites % 100 === 0) {
      console.log(`  … ${String(faites)}/${String(fiches.length)} cartes`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCE }, () => ouvrier()));

console.log(
  `✓ generate-fiche-cards : ${String(faites)} carte(s) JPEG ${String(TAILLE)}×${String(TAILLE)} dans dist/fiche/<slug>/card.jpg (${String(((Date.now() - debut) / 1000).toFixed(1))} s)`,
);
