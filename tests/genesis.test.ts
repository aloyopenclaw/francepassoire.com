import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Suite de la PREPARATION de la genèse (tâche 27) : scripts/genesis.mjs est
// éprouvé sur des fiches FICTIVES en répertoire temporaire — jamais sur les
// fiches d'ancrage réelles (la genèse réelle est déclenchée par
// l'orchestrateur au moment de la première fusion, runbook docs/ancrages.md).

const scriptGenesis = fileURLToPath(
  new URL('../scripts/genesis.mjs', import.meta.url),
);
const scriptVerif = fileURLToPath(
  new URL('../scripts/verify-registry.mjs', import.meta.url),
);

const EMPREINTE_GENESIS = '0'.repeat(64);

interface FicheTemoins {
  slug: string;
  entity: string;
}

function ecrireFiche(dir: string, nomFichier: string, fiche: FicheTemoins) {
  writeFileSync(
    join(dir, nomFichier),
    JSON.stringify(
      {
        slug: fiche.slug,
        entity: fiche.entity,
        secteur: 'services',
        statut: 'revendiquee',
        dates: { revendication: '2026-08-01' },
        volume: { count: 1, unit: 'personnes', label: '1 personne' },
        data_types: ['autre'],
        sources: [
          { label: 'Exemple', url: 'https://exemple.fr/x', kind: 'article' },
        ],
        description:
          'Fiche fictive de test de la genèse — description volontairement assez longue.',
        timeline: [{ date: '2026-08-01', event: 'Fiction.' }],
      },
      null,
      2,
    ),
  );
}

/** Arborescence témoin : fiches-dir (2 fiches, noms de fichiers inverses de
 *  l'ordre des slugs) + anchors-dir (1 fiche dont le slug s'intercale). */
function monterTemoins(racine: string) {
  const fichesDir = join(racine, 'fiches');
  const anchorsDir = join(racine, 'ancrages');
  mkdirSync(fichesDir, { recursive: true });
  mkdirSync(anchorsDir, { recursive: true });
  ecrireFiche(fichesDir, 'zeta.json', { slug: 'fuite-zeta', entity: 'Entité Zêta' });
  ecrireFiche(fichesDir, 'alpha.json', { slug: 'fuite-alpha', entity: 'Entité Alpha' });
  ecrireFiche(anchorsDir, 'miel.json', { slug: 'fuite-miel', entity: 'Entité Miel' });
  return { fichesDir, anchorsDir };
}

function lancerGenesis(args: string[]) {
  return spawnSync(process.execPath, [scriptGenesis, ...args], {
    encoding: 'utf8',
  });
}

function verifierRegistre(chemin: string) {
  return spawnSync(process.execPath, [scriptVerif, chemin], {
    encoding: 'utf8',
  });
}

function lireRegistre(chemin: string) {
  return readFileSync(chemin, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('scripts/genesis.mjs — genèse du registre (préparation, fixtures seulement)', () => {
  it('chaîne valide : tri par slug, chaînon fondateur, un ajout par fiche, vérifiable par verify-registry.mjs (miroir indépendant)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-genesis-'));
    try {
      const { fichesDir, anchorsDir } = monterTemoins(dir);
      const sortie = join(dir, 'registre.jsonl');
      const r = lancerGenesis([
        '--fiches-dir', fichesDir,
        '--anchors-dir', anchorsDir,
        '--out', sortie,
        '--date', '2026-08-20',
      ]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('3 événements');

      const lignes = lireRegistre(sortie);
      expect(lignes).toHaveLength(3);
      // Ordre imposé par le tri des slugs, PAS par les noms de fichiers ni
      // par les répertoires (l'ancrage s'intercale entre les deux fiches).
      expect(lignes.map((l) => l.fiche_du)).toEqual([
        'fuite-alpha',
        'fuite-miel',
        'fuite-zeta',
      ]);
      expect(lignes[0].seq).toBe(1);
      expect(lignes[0].empreinte_precedente).toBe(EMPREINTE_GENESIS);
      for (let i = 1; i < lignes.length; i++) {
        expect(lignes[i].seq).toBe(i + 1);
        expect(lignes[i].empreinte_precedente).toBe(lignes[i - 1].empreinte);
      }
      expect(lignes.every((l) => l.type === 'ajout')).toBe(true);
      expect(lignes.every((l) => l.date === '2026-08-20')).toBe(true);
      expect(lignes[0].entite).toBe('Entité Alpha');

      // L'empreinte de tête imprimée est celle de la dernière ligne, et la
      // sortie vérifie sous le miroir INDÉPENDANT (verify-registry.mjs,
      // distinct de scripts/registre-lib.mjs utilisé par genesis).
      const tete = String(lignes[2].empreinte);
      expect(r.stdout).toContain(`empreinte de tête : ${tete}`);
      const v = verifierRegistre(sortie);
      expect(v.status).toBe(0);
      expect(v.stdout).toContain('3 événements vérifiés');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('déterministe : deux exécutions à date fixée → octets identiques, même à répertoires permutés', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-genesis-det-'));
    try {
      const { fichesDir, anchorsDir } = monterTemoins(dir);
      const a = join(dir, 'a.jsonl');
      const b = join(dir, 'b.jsonl');
      const r1 = lancerGenesis(['--fiches-dir', fichesDir, '--anchors-dir', anchorsDir, '--out', a, '--date', '2026-08-20']);
      // Permutation : anchors-dir devient la source principale — la fusion
      // triée par slug doit produire exactement les mêmes octets.
      const r2 = lancerGenesis(['--fiches-dir', anchorsDir, '--anchors-dir', fichesDir, '--out', b, '--date', '2026-08-20']);
      expect(r1.status).toBe(0);
      expect(r2.status).toBe(0);
      expect(readFileSync(a, 'utf8')).toBe(readFileSync(b, 'utf8'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('REFUSE un registre existant non vide — aucun chaînage rétroactif, pas d\'option --force', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-genesis-refus-'));
    try {
      const { fichesDir } = monterTemoins(dir);
      const sortie = join(dir, 'registre.jsonl');
      expect(lancerGenesis(['--fiches-dir', fichesDir, '--out', sortie, '--date', '2026-08-20']).status).toBe(0);

      const refuse = lancerGenesis(['--fiches-dir', fichesDir, '--out', sortie, '--date', '2026-08-20']);
      expect(refuse.status).toBe(1);
      expect(refuse.stderr).toContain('refus');
      expect(refuse.stderr).toContain('rétroactif');
      // Le contenu d'origine est intact (2 fiches : fiches-dir seul ici).
      expect(lireRegistre(sortie)).toHaveLength(2);

      // Aucune porte de sortie : --force n'existe pas (option inconnue).
      const force = lancerGenesis(['--fiches-dir', fichesDir, '--out', sortie, '--force']);
      expect(force.status).toBe(2);
      expect(force.stderr).toContain('option inconnue');

      // Fichier VIDE (0 octet) : accepté — aucun contenu écrasé.
      const vide = join(dir, 'vide.jsonl');
      writeFileSync(vide, '');
      expect(
        lancerGenesis(['--fiches-dir', fichesDir, '--out', vide, '--date', '2026-08-20']).status,
      ).toBe(0);
      expect(lireRegistre(vide)).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuse un slug dupliqué entre les répertoires', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-genesis-dup-'));
    try {
      const { fichesDir, anchorsDir } = monterTemoins(dir);
      ecrireFiche(anchorsDir, 'doublon.json', { slug: 'fuite-alpha', entity: 'Doublon' });
      const r = lancerGenesis([
        '--fiches-dir', fichesDir,
        '--anchors-dir', anchorsDir,
        '--out', join(dir, 'registre.jsonl'),
        '--date', '2026-08-20',
      ]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('slug dupliqué');
      expect(r.stderr).toContain('fuite-alpha');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
