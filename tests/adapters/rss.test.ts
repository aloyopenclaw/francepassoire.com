import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// T15 — adapter RSS médias (workers/ingest/adapters/rss.ts).
// Fixtures : captures réelles rognées à ≤30 items (voir fixtures/adapters/README-rss.md).
import { makeRssAdapter, rssAdapters, rssFeedConfigs, type FeedConfig } from '../../workers/ingest/adapters/rss';
import type { Candidate } from '../../workers/ingest/src/adapter';

const fixturesDir = fileURLToPath(new URL('../fixtures/adapters/', import.meta.url));
const loadFixture = (name: string): string => readFileSync(`${fixturesDir}${name}`, 'utf-8');

/** fetch injecté qui sert un corps/ statut fixes quelle que soit l'URL. */
const fetchServing = (body: string, status = 200): typeof fetch =>
  (async () => new Response(body, { status, headers: { 'content-type': 'application/xml' } })) as typeof fetch;

/** fetch injecté qui route par URL (pour le test d'isolation multi-sources). */
const fetchRouting =
  (routes: Record<string, string>): typeof fetch =>
  (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = routes[url] ?? '<rss>unknown</rss>';
    return new Response(body, { status: 200 });
  }) as typeof fetch;

const feed = (over: Partial<FeedConfig> = {}): FeedConfig => ({
  id: 'rss:test',
  name: 'Test',
  url: 'https://example.fr/feed',
  ...over,
});

const findCandidate = (candidates: Candidate[], fragment: string): Candidate | undefined =>
  candidates.find((c) => JSON.parse(c.raw).title.includes(fragment));

describe('T15 · adapter RSS — échantillons réels porteurs de mots-clés', () => {
  it('01net : candidat SFR avec source_url exact (fuite + données + pirate)', async () => {
    const adapter = makeRssAdapter(feed({ id: 'rss:01net', name: '01net', url: 'https://www.01net.com/feed/' }));
    const candidates = await adapter.fetchCandidates(fetchServing(loadFixture('rss-01net.xml')));

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const sfr = findCandidate(candidates, 'SFR confirme une fuite');
    expect(sfr).toBeDefined();
    expect(sfr?.source).toBe('rss');
    expect(sfr?.source_url).toBe(
      'https://www.01net.com/actualites/sfr-confirme-une-fuite-de-donnees-21-millions-de-lignes-revendiquees-par-le-pirate-des-impots.html',
    );
    // Entité : « SFR » est un acronyme isolé (run < 2 mots) → null, le synthétiseur T18 tranche.
    expect(sfr?.entity_name).toBeNull();
    const raw = JSON.parse(sfr?.raw ?? '{}');
    expect(raw).toMatchObject({
      guid: 'https://www.01net.com/?p=1365066',
      feed: 'rss:01net',
      title: expect.stringContaining('SFR confirme une fuite'),
    });
    expect(raw.pubDate).toBeTruthy();
  });

  it('JDN : entité « Sébastien Lecornu » extraite d’un titre vérifié à l’œil', async () => {
    const adapter = makeRssAdapter(feed({ id: 'rss:jdn', name: 'JDN', url: 'https://www.journaldunet.com/rss/' }));
    const candidates = await adapter.fetchCandidates(fetchServing(loadFixture('rss-jdn.xml')));

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    // Titre réel : « Sébastien Lecornu préside lundi une cellule interministérielle de crise
    // après le piratage de données fiscales et personnelles de 678 000 personnes ».
    const lecornu = findCandidate(candidates, 'Sébastien Lecornu préside');
    expect(lecornu).toBeDefined();
    expect(lecornu?.entity_name).toBe('Sébastien Lecornu'); // run TitleCase ≥ 2 mots, vérifié à l’œil
    expect(lecornu?.source_url).toBe(
      'https://www.journaldunet.com/business/action-publique/1553749-sebastien-lecornu-preside-lundi-une-cellule-interministerielle-de-crise-apres-le-piratage-de-donnees-fiscales-et-personnelles-de-678-000-personnes/',
    );
  });

  it('Zataz : 6 candidats sur la capture réelle ; entité nulle sur les titres courts', async () => {
    const adapter = makeRssAdapter(feed({ id: 'rss:zataz', name: 'Zataz', url: 'https://www.zataz.com/feed/' }));
    const candidates = await adapter.fetchCandidates(fetchServing(loadFixture('rss-zataz.xml')));

    // Fixture figée : items 1,2,3,5,7,8 portent un mot-clé ; « Club One Casino » (item 0) n'en porte pas.
    expect(candidates).toHaveLength(6);
    const stripe = findCandidate(candidates, 'Stripe visé par une fuite');
    expect(stripe?.source_url).toBe('https://www.zataz.com/stripe-vise-par-une-fuite-revendiquee-de-662-bases-de-donnees/');
    expect(stripe?.entity_name).toBeNull(); // « Stripe » seul = run d’1 mot
    expect(JSON.parse(stripe?.raw ?? '{}').guid).toBe('https://www.zataz.com/?p=47421');
    expect(findCandidate(candidates, 'Club One Casino')).toBeUndefined(); // pas de mot-clé → pas candidat
  });

  it('ZDNet : échantillon breach (articles réels) → 1 candidat DGFiP, le titre sans mot-clé reste dehors', async () => {
    const adapter = makeRssAdapter(feed({ id: 'rss:zdnet-fr', name: 'ZDNet FR', url: 'https://www.zdnet.fr/feed' }));
    const candidates = await adapter.fetchCandidates(fetchServing(loadFixture('rss-zdnet-fr-breach.xml')));

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.source_url).toBe(
      'https://www.zdnet.fr/actualites/fuite-a-la-dgfip-apres-les-excuses-du-ministre-lurgence-de-revoir-liam-face-aux-cyberattaques-en-serie-500205.htm',
    );
    expect(candidates[0]?.entity_name).toBeNull();
  });

  it('LeMagIT : 4 candidats sur la capture réelle (guid = lien, l’item n’a pas de guid natif)', async () => {
    const adapter = makeRssAdapter(feed({ id: 'rss:lemagit', name: 'LeMagIT', url: 'https://www.lemagit.fr/rss/ContentSyndication.xml' }));
    const candidates = await adapter.fetchCandidates(fetchServing(loadFixture('rss-lemagit.xml')));

    // Fixture figée : items Cyberhebdo, Vols de données, Cyberattaques (brève)
    // et Cyberattaques & vols portent un mot-clé ; les titres quotés « … » du
    // bruit (Phantom Compute, crise existentielle) n’en portent pas → dehors.
    expect(candidates).toHaveLength(4);
    // Titre réel en espaces insécables (typo française TechTarget) — le raw
    // garde les octets d’origine, le fragment porte donc les mêmes \u00a0.
    const cyberhebdo = findCandidate(candidates, 'Cyberhebdo du 21\u00a0août 2026');
    expect(cyberhebdo?.source_url).toBe(
      'https://www.lemagit.fr/actualites/366649425/Cyberhebdo-do-21-aout-2026-considerable-fuite-de-donnees-en-Lettonie',
    );
    // Le flux TechTarget n’expose pas de <guid> : repli sur le lien de l’item.
    expect(cyberhebdo?.guid).toBe(cyberhebdo?.source_url);
    expect(JSON.parse(cyberhebdo?.raw ?? '{}')).toMatchObject({
      feed: 'rss:lemagit',
      pubDate: 'Fri, 21 Aug 2026 06:54:00 GMT',
    });
    // Casse phrase : « Lettonie » seul = run d’1 mot → null, le synthétiseur tranche.
    expect(cyberhebdo?.entity_name).toBeNull();
    expect(findCandidate(candidates, 'Phantom Compute')).toBeUndefined();
  });

  it('Clubic : 2 candidats sur l’échantillon composé (titres CDATA), les bons plans restent dehors', async () => {
    const adapter = makeRssAdapter(feed({ id: 'rss:clubic', name: 'Clubic', url: 'https://www.clubic.com/feed/rss' }));
    const candidates = await adapter.fetchCandidates(fetchServing(loadFixture('rss-clubic.xml')));

    // 8 items de bruit réels (bons plans, titres CDATA sans mot-clé) + 2
    // articles réels de la rubrique cybersécurité (voir README fixtures).
    expect(candidates).toHaveLength(2);
    const almerys = findCandidate(candidates, 'Cyberattaque chez Almerys');
    expect(almerys?.source_url).toBe(
      'https://www.clubic.com/actualite-613981-cyberattaque-chez-almerys-les-adherents-d-alan-touches-par-une-fuite-de-donnees-sensibles.html',
    );
    // Convention Clubic vérifiée sur la capture : le guid EST l’URL de l’article.
    expect(almerys?.guid).toBe(almerys?.source_url);
    expect(almerys?.entity_name).toBeNull();
    expect(findCandidate(candidates, 'CyberGhost VPN')).toBeUndefined();
  });
});

describe('T15 · adapter RSS — bruit et pannes', () => {
  it('échantillon réel ZDNet sans mot-clé : 0 candidats', async () => {
    const adapter = makeRssAdapter(feed({ id: 'rss:zdnet-fr', name: 'ZDNet FR', url: 'https://www.zdnet.fr/feed' }));
    const candidates = await adapter.fetchCandidates(fetchServing(loadFixture('rss-zdnet-fr.xml')));
    expect(candidates).toEqual([]);
  });

  it('XML malformé → [] sans lever, la source suivante continue de produire', async () => {
    const broken = makeRssAdapter(feed({ id: 'rss:broken', name: 'Broken', url: 'https://broken.example/feed' }));
    const zataz = makeRssAdapter(feed({ id: 'rss:zataz', name: 'Zataz', url: 'https://www.zataz.com/feed/' }));
    const fetchFn = fetchRouting({
      'https://broken.example/feed': loadFixture('rss-malformed.xml'),
      'https://www.zataz.com/feed/': loadFixture('rss-zataz.xml'),
    });

    await expect(broken.fetchCandidates(fetchFn)).resolves.toEqual([]);
    const candidates = await zataz.fetchCandidates(fetchFn);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
  });

  it('HTTP 500 → [] sans lever', async () => {
    const adapter = makeRssAdapter(feed());
    await expect(adapter.fetchCandidates(fetchServing('server error', 500))).resolves.toEqual([]);
  });
});

describe('T15 · adapter RSS — déduplication par guid', () => {
  it('un guid présent dans knownGuids est filtré, les autres items passent', async () => {
    const adapter = makeRssAdapter(feed({ id: 'rss:zataz', name: 'Zataz', url: 'https://www.zataz.com/feed/' }));
    const xml = loadFixture('rss-zataz.xml');

    const fresh = await adapter.fetchCandidates(fetchServing(xml));
    const alreadySeen = new Set(['https://www.zataz.com/?p=47421']); // guid de « Stripe visé par une fuite… »
    const deduped = await adapter.fetchCandidates(fetchServing(xml), alreadySeen);

    expect(fresh).toHaveLength(6);
    expect(deduped).toHaveLength(5);
    expect(findCandidate(deduped, 'Stripe visé par une fuite')).toBeUndefined();
    expect(findCandidate(deduped, 'Fuite Stripe')).toBeDefined();
  });

  it('chaque candidat porte le guid natif de l’item (candidate.guid = raw.guid)', async () => {
    const adapter = makeRssAdapter(feed({ id: 'rss:zataz', name: 'Zataz', url: 'https://www.zataz.com/feed/' }));
    const candidates = await adapter.fetchCandidates(fetchServing(loadFixture('rss-zataz.xml')));

    expect(candidates).toHaveLength(6);
    for (const c of candidates) {
      // le runner (guid_set KV) dédup sur candidate.guid : il doit refléter le guid item
      expect(c.guid).toBe(JSON.parse(c.raw ?? '{}').guid);
      expect(c.guid).toBeTruthy();
    }
  });
});

describe('T15 · adapter RSS — heuristiques (docs RSS inline)', () => {
  const runInline = async (title: string): Promise<Candidate[]> => {
    const url = 'https://example.fr/article-x';
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><item><title>${title}</title><link>${url}</link><guid>guid-${title.length}</guid><pubDate>Thu, 20 Aug 2026 10:00:00 +0200</pubDate></item></channel></rss>`;
    const adapter = makeRssAdapter(feed());
    return adapter.fetchCandidates(fetchServing(xml));
  };

  it('guillemets « … » : entité quotée en capitale', async () => {
    const candidates = await runInline('Cyberattaque : le groupe « Orange Conseils » touché');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.entity_name).toBe('Orange Conseils');
  });

  it('tolérance aux accents : « Piraté » et « Cyberdéfense » passent la normalisation', async () => {
    const candidates = await runInline('Piraté chez Orange Cyberdéfense : des données extraites');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.entity_name).toBe('Orange Cyberdéfense');
  });

  it('un mot-clé n’est jamais une entité : « Fuite Stripe : … » reste entity_name null', async () => {
    const candidates = await runInline('Fuite Stripe : au moins 200 Français concernés');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.entity_name).toBeNull();
  });
});

describe('T15 · adapter RSS — configuration exportée', () => {
  it('rssAdapters expose les 9 flux worker (FrenchBreaches et gnews moissonnés côté VPS, Hackmanac retiré)', () => {
    expect(rssAdapters).toHaveLength(9);
    expect(rssAdapters.map((a) => a.id)).toEqual([
      'rss:01net',
      'rss:zdnet-fr',
      'rss:jdn',
      'rss:zataz',
      'rss:fuitesinfos',
      'rss:undernews',
      'rss:dsb',
      'rss:lemagit',
      'rss:clubic',
    ]);
    expect(rssFeedConfigs.map((f) => f.url)).toEqual([
      'https://www.01net.com/feed/', // redirige depuis https://www.01net.com/feed
      'https://www.zdnet.fr/feed', // redirige depuis https://www.zdnet.fr/feed/
      'https://www.journaldunet.com/rss/', // l’URL thématique du plan renvoie 404 (voir README fixtures)
      'https://www.zataz.com/feed/',
      'https://fuitesinfos.fr/feed.xml', // ajout 23/08 : sources spécialisées (leads publics)
      'https://www.undernews.fr/feed',
      'https://www.datasecuritybreach.fr/feed/',
      'https://www.lemagit.fr/rss/ContentSyndication.xml', // ajout 23/08 T54d : seul flux TechTarget exposé
      'https://www.clubic.com/feed/rss', // ajout 23/08 T54d : /rss/news.rss redirige ici (unique flux)
    ]);
  });
});

// Régression 23/08 : FrenchBreaches (titres = noms d'entités nus) doit
// passer SANS le filtre par mots-clés — le bug rejetait 100 % de ses items.
describe('makeRssAdapter — sansFiltreKeywords (régression FrenchBreaches)', () => {
  const fb = makeRssAdapter({ id: 'rss:frenchbreaches', name: 'FrenchBreaches', url: 'https://frenchbreaches.com/feed.xml', sansFiltreKeywords: true });
  const xml = `<?xml version="1.0"?><rss><channel><title>x</title>${'<item><title>Declic Services</title><link>https://frenchbreaches.com/alertes/declic</link><guid>fb-1</guid><pubDate>Sun, 23 Aug 2026 01:31:00 +0200</pubDate></item>'}</channel></rss>`;
  const fetchFn = (async () => new Response(xml, { status: 200 })) as typeof fetch;

  it('FrenchBreaches : item sans mot-clé EST retenu', async () => {
    const candidats = await fb.fetchCandidates(fetchFn, new Set());
    expect(candidats).toHaveLength(1);
    expect(candidats[0]?.entity_name).toBe('Declic Services');
  });

  it('flux standard : le même titre SANS le drapeau est filtré', async () => {
    const standard = makeRssAdapter({ id: 'rss:test', name: 'Test', url: 'https://example.com/feed' });
    const candidats = await standard.fetchCandidates(fetchFn, new Set());
    expect(candidats).toHaveLength(0);
  });
});
