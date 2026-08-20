import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMPREINTE_GENESIS,
  append,
  calculerEmpreinte,
  genesis,
  parseJsonl,
  verifierChaine,
  type EvenementRegistre,
  type LigneRegistre,
} from '../src/lib/registry';

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));
const scriptVerif = fileURLToPath(
  new URL('../scripts/verify-registry.mjs', import.meta.url),
);

function evenement(i: number): EvenementRegistre {
  return {
    date: '2026-08-01',
    type: 'ajout',
    entite: `Entité témoin ${i}`,
    fiche_du: '2026-07-15',
  };
}

async function construireChaine(n: number): Promise<LigneRegistre[]> {
  const lignes = [await genesis(evenement(0))];
  for (let i = 1; i < n; i++) {
    lignes.push(await append(evenement(i), lignes[i - 1]));
  }
  return lignes;
}

function copie(lignes: LigneRegistre[]): LigneRegistre[] {
  return lignes.map((l) => ({ ...l }));
}

describe('registre chaîné — construction', () => {
  it('construit et vérifie une chaîne de 50 événements', async () => {
    const lignes = await construireChaine(50);
    expect(lignes).toHaveLength(50);
    expect(lignes[0].seq).toBe(1);
    expect(lignes[49].seq).toBe(50);
    for (let i = 1; i < 50; i++) {
      expect(lignes[i].empreinte_precedente).toBe(lignes[i - 1].empreinte);
    }
    const resultat = await verifierChaine(lignes);
    expect(resultat.valide).toBe(true);
    expect(resultat.nbEvenements).toBe(50);
    expect(resultat.empreinteTete).toBe(lignes[49].empreinte);
  });

  it('genèse : seq 1 et empreinte_precedente = 64 zéros (règle fuitesinfos)', async () => {
    const gen = await genesis(evenement(0));
    expect(gen.seq).toBe(1);
    expect(gen.empreinte_precedente).toBe(EMPREINTE_GENESIS);
    expect(EMPREINTE_GENESIS).toBe('0'.repeat(64));
    expect(gen.empreinte).toMatch(/^[0-9a-f]{64}$/);
  });

  it("append sans ligne précédente lève (pas d'ajout orphelin)", async () => {
    await expect(append(evenement(1), null as never)).rejects.toThrow(
      /précédente/,
    );
    await expect(append(evenement(1), undefined as never)).rejects.toThrow(
      /précédente/,
    );
    // Une « précédente » sans empreinte est un orphelin déguisé.
    await expect(
      append(evenement(1), { seq: 1 } as never),
    ).rejects.toThrow(/précédente/);
  });
});

describe('registre chaîné — détection de retouche', () => {
  it('octet modifié dans entite de la ligne 20 → brisée dès la ligne 20', async () => {
    const lignes = copie(await construireChaine(50));
    lignes[19].entite = lignes[19].entite.slice(0, -1) + 'X';
    const resultat = await verifierChaine(lignes);
    expect(resultat.valide).toBe(false);
    expect(resultat.premiereLigneCassee).toBe(20);
    expect(resultat.erreur).toContain('modifié');
  });

  it('octet modifié dans empreinte de la ligne 20 → brisée dès la ligne 20', async () => {
    const lignes = copie(await construireChaine(50));
    const e = lignes[19].empreinte;
    lignes[19].empreinte = (e[0] === '0' ? '1' : '0') + e.slice(1);
    const resultat = await verifierChaine(lignes);
    expect(resultat.valide).toBe(false);
    expect(resultat.premiereLigneCassee).toBe(20);
  });

  it('retouche cohérente de la ligne 20 (empreinte recalculée) → rupture au chaînon suivant, ligne 21', async () => {
    // L'attaquant réécrit entite ET recalcule l'empreinte de la ligne 20 :
    // la ligne 20 reste autonome, mais la ligne 21 pointe encore l'ancienne
    // empreinte — la rupture de chaîne apparaît ligne 21.
    const lignes = copie(await construireChaine(50));
    lignes[19].entite = 'Entité réécrite';
    lignes[19].empreinte = await calculerEmpreinte(lignes[19]);
    const resultat = await verifierChaine(lignes);
    expect(resultat.valide).toBe(false);
    expect(resultat.premiereLigneCassee).toBe(21);
    expect(resultat.erreur).toContain('rompue');
  });

  it('ligne supprimée → numéro de séquence en défaut dès la ligne 10', async () => {
    const lignes = copie(await construireChaine(50));
    lignes.splice(9, 1);
    const resultat = await verifierChaine(lignes);
    expect(resultat.valide).toBe(false);
    expect(resultat.premiereLigneCassee).toBe(10);
    expect(resultat.erreur).toContain('insérée ou supprimée');
  });

  it('registre vide refusé', async () => {
    const resultat = await verifierChaine([]);
    expect(resultat.valide).toBe(false);
    expect(resultat.erreur).toContain('vide');
  });

  it('parseJsonl signale la ligne JSON invalide', () => {
    expect(() =>
      parseJsonl('{"seq": 1}\npas du json\n'),
    ).toThrow(/ligne 2/);
  });
});

describe('compatibilité fuitesinfos (fixture réelle)', () => {
  it('le registre réel de CedHaurus/fuitesinfos-transparence vérifie (empreintes recalculées à l\'identique)', async () => {
    const brut = readFileSync(
      join(fixturesDir, 'fuitesinfos-registre.jsonl'),
      'utf8',
    );
    const lignes = parseJsonl(brut) as LigneRegistre[];
    expect(lignes).toHaveLength(263);
    const resultat = await verifierChaine(lignes);
    expect(resultat.valide).toBe(true);
    expect(resultat.empreinteTete).toBe(
      '6508eaa82d0218cbf4769c5a73db1d89c5bb4836f4b837ae2018c01c7083d79a',
    );
  });

  it('la chaîne générée versionnée (registre-genere-50.jsonl) vérifie via la bibliothèque', async () => {
    const brut = readFileSync(
      join(fixturesDir, 'registre-genere-50.jsonl'),
      'utf8',
    );
    const lignes = parseJsonl(brut) as LigneRegistre[];
    expect(lignes).toHaveLength(50);
    const resultat = await verifierChaine(lignes);
    expect(resultat.valide).toBe(true);
  });
});

describe('CLI scripts/verify-registry.mjs (zéro dépendance)', () => {
  function verifier(chemin: string) {
    return spawnSync(process.execPath, [scriptVerif, chemin], {
      encoding: 'utf8',
    });
  }

  it('exit 0 sur le registre fuitesinfos réel', () => {
    const r = verifier(join(fixturesDir, 'fuitesinfos-registre.jsonl'));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('263 événements vérifiés');
  });

  it('exit 0 sur la chaîne générée, exit 1 sur la copie retouchée (ligne 20 nommée)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-registre-'));
    try {
      const lignes = await construireChaine(50);
      const saine = join(dir, 'registre-50.jsonl');
      writeFileSync(saine, lignes.map((l) => JSON.stringify(l)).join('\n') + '\n');

      const ok = verifier(saine);
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain('50 événements vérifiés');

      lignes[19].entite = lignes[19].entite.slice(0, -1) + 'X';
      const retouchee = join(dir, 'registre-50-retouche.jsonl');
      writeFileSync(
        retouchee,
        lignes.map((l) => JSON.stringify(l)).join('\n') + '\n',
      );

      const ko = verifier(retouchee);
      expect(ko.status).toBe(1);
      expect(ko.stderr).toContain('ligne 20');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fichier introuvable ou argument absent → exit 2', () => {
    expect(verifier(join(fixturesDir, 'inexistant.jsonl')).status).toBe(2);
    const sansArg = spawnSync(process.execPath, [scriptVerif], {
      encoding: 'utf8',
    });
    expect(sansArg.status).toBe(2);
  });
});
