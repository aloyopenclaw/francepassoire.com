import { afterEach, describe, expect, it, vi } from 'vitest';
// Adapters CERT-FR/ANSSI (T16) — tests sur fixtures RSS enregistrées en live
// le 2026-08-20 (flux publics du CERT-FR, aucune donnée personnelle).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  certFrAlertesAdapter,
  certFrAvisAdapter,
} from '../../workers/ingest/adapters/cert-fr';

const fixturesDir = fileURLToPath(new URL('../fixtures/adapters/', import.meta.url));
const fixture = (name: string): string => readFileSync(`${fixturesDir}${name}`, 'utf8');

/** fetch mocké : sert un corps et un statut HTTP, à la manière du worker. */
const fetchServant =
  (body: string, status = 200): typeof fetch =>
  (async () => new Response(body, { status })) as unknown as typeof fetch;

/** RSS minimal construit à la main pour les cas ciblés (heuristique entité). */
function rssAvecTitres(titres: string[]): string {
  const items = titres
    .map(
      (t) =>
        `<item><title>${t}</title><link>https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-9999/</link>` +
        `<description>xl</description><guid isPermaLink="true">https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-9999/</guid>` +
        `<pubDate>Thu, 20 Aug 2026 00:00:00 +0000</pubDate></item>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>CERT-FR</title>${items}</channel></rss>`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cert-fr — flux réels enregistrés', () => {
  it('certFrAvisAdapter : 40 items extraits, tous contextes avec entité null', async () => {
    const xml = fixture('cert-fr-avis.xml');
    const candidats = await certFrAvisAdapter.fetchCandidates(fetchServant(xml));

    expect(certFrAvisAdapter.id).toBe('cert-fr-avis');
    expect(candidats).toHaveLength(40);
    for (const c of candidats) {
      expect(c.source).toBe('cert-fr');
      expect(c.source_url).toMatch(/^https:\/\/www\.cert\.ssi\.gouv\.fr\//);
      expect(c.entity_name).toBeNull(); // bulletins de vulnérabilités : pas d'organisation nommée
      const raw = JSON.parse(c.raw) as { titre: string; guid: string; pubDate: string };
      expect(raw.titre).toBeTruthy();
      expect(raw.guid).toBe(c.source_url);
      expect(raw.pubDate).toBeTruthy();
    }
  });

  it('certFrAlertesAdapter : 40 items, liens /alerte/CERTFR-*-ALE-* (feed singulier)', async () => {
    const xml = fixture('cert-fr-alertes.xml');
    const candidats = await certFrAlertesAdapter.fetchCandidates(fetchServant(xml));

    expect(certFrAlertesAdapter.id).toBe('cert-fr-alertes');
    expect(candidats).toHaveLength(40);
    expect(candidats.every((c) => /\/alerte\/CERTFR-\d{4}-ALE-\d+\/$/.test(c.source_url ?? ''))).toBe(
      true,
    );
  });

  it('les deux adapters exposent des ids distincts (états KV séparés)', () => {
    expect(typeof certFrAvisAdapter.fetchCandidates).toBe('function');
    expect(typeof certFrAlertesAdapter.fetchCandidates).toBe('function');
    expect(new Set([certFrAvisAdapter.id, certFrAlertesAdapter.id]).size).toBe(2);
  });
});

describe('cert-fr — dédup guid (pattern cnil, fix soak)', () => {
  it('chaque candidat porte un guid stable et distinct (jointure titre ⊕ lien)', async () => {
    const xml = fixture('cert-fr-avis.xml');
    const passe1 = await certFrAvisAdapter.fetchCandidates(fetchServant(xml));
    const passe2 = await certFrAvisAdapter.fetchCandidates(fetchServant(xml));

    expect(passe1).toHaveLength(40);
    expect(passe1.map((c) => c.guid)).toEqual(passe2.map((c) => c.guid)); // stable d'une passe à l'autre
    expect(new Set(passe1.map((c) => c.guid)).size).toBe(40); // pas de collision de jointure
  });

  it('guid connu filtré, guid inconnu émis — 40 items, un filtré → 39', async () => {
    const xml = fixture('cert-fr-avis.xml');
    const tous = await certFrAvisAdapter.fetchCandidates(fetchServant(xml));
    const cible = tous[0]?.guid as string; // 40 items vérifiés au test précédent
    expect(cible).toBeTruthy();

    const dedupliques = await certFrAvisAdapter.fetchCandidates(fetchServant(xml), new Set([cible]));

    // l'adapter re-parse le flux : 40 (et pas 39+réémission) prouverait un guid instable
    expect(dedupliques).toHaveLength(39);
    expect(dedupliques.map((c) => c.guid)).not.toContain(cible);
    expect(dedupliques.every((c) => c.guid !== undefined)).toBe(true);
  });
});

describe('cert-fr — heuristique entité conservatrice', () => {
  it('forme juridique française explicite → entité extraite ; sinon null', async () => {
    const xml = rssAvecTitres([
      'Incident affectant les solutions de la société ACME SAS (20 août 2026)',
      'Vulnérabilité dans OpenSSL (14 août 2026)',
      '[MàJ] Multiples vulnérabilités dans GitLab (12 janvier 2024)',
    ]);
    const candidats = await certFrAvisAdapter.fetchCandidates(fetchServant(xml));

    expect(candidats).toHaveLength(3);
    expect(candidats[0]?.entity_name).toBe('ACME SAS');
    expect(candidats[1]?.entity_name).toBeNull(); // nom de produit, pas une organisation
    expect(candidats[2]?.entity_name).toBeNull(); // « au moindre doute, null »
  });
});

describe('cert-fr — robustesse', () => {
  it('HTTP non-200 → [] avec avertissement, pas d’exception', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const candidats = await certFrAlertesAdapter.fetchCandidates(fetchServant('Service Unavailable', 503));

    expect(candidats).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('503'), expect.anything());
  });

  it('XML tronqué (item non fermé) → [] avec avertissement', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const xml =
      '<?xml version="1.0"?><rss version="2.0"><channel><title>CERT-FR</title>' +
      '<item><title>Sans fin de balise' /* </item> manquant */;

    const candidats = await certFrAvisAdapter.fetchCandidates(fetchServant(xml));

    expect(candidats).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('RSS valide mais vide (0 item) → [] silencieux, sans warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const xml = '<rss version="2.0"><channel><title>CERT-FR</title></channel></rss>';

    const candidats = await certFrAvisAdapter.fetchCandidates(fetchServant(xml));

    expect(candidats).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('corps non RSS du tout → [] avec avertissement', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const candidats = await certFrAlertesAdapter.fetchCandidates(
      fetchServant('<html><body>page d’erreur</body></html>'),
    );

    expect(candidats).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});
