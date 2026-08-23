// workers/ingest/adapters/rss.ts — adapter RSS médias paramétré (T15).
// 4 flux configurés : 01net, ZDnet FR, JDN, Zataz. Le câblage au registre
// `adapters` (src/adapter.ts) se fera en T19 — ce module n'exporte que
// `makeRssAdapter` + les instances `rssAdapters` (types importés uniquement).

// ── Limites de l'analyse (documentées, volontaires) ─────────────────────────
//  * Parseur minimaliste à base de regex : `<item>…</item>` (RSS 2.0) et
//    `<entry>…</entry>` (Atom). Pas de XMLReader : namespaces, CDATA imbriqués
//    exotiques et encodages non-UTF8 ne sont pas gérés. Un XML sans item/entry
//    complet ou sans balise fermante de document (</rss>/</feed>/</channel>)
//    est traité comme malformé → [] (isolation de la source, jamais d'exception).
//  * Headline + lien uniquement (titre, link, guid/id, pubDate/updated) —
//    aucun scraping du corps d'article.
//  * Filtre par mots-clés sur le titre uniquement (voir KEYWORD_RE).
//  * Heuristique d'entité sur le titre : guillemets « … » / "…" / “…” avec
//    initiale en capitale, ou run TitleCase ≥ 2 mots (acronymes 3-7 capitales
//    acceptés comme mots du run), dont au moins un hors stopwords, et aucun
//    mot du run n'étant lui-même un mot-clé. Limite assumée : les titres des
//    médias français sont en casse phrase, donc beaucoup de vraies entités
//    d'un seul mot (ex. « SFR », « Stripe ») sortent avec entity_name null —
//    le synthétiseur (T18) décide.
//  * Dédup guid : le guid natif de l'item est exposé sur le candidat
//    (candidate.guid) et `fetchCandidates(fetchFn, knownGuids?)` filtre les
//    items déjà connus. C'est le runner (T19) qui câble le guid_set persisté
//    en KV (ingest:state:<id>) — l'adapter ne touche ni D1 ni KV.

import type { Candidate, SourceAdapter } from '../src/adapter';

/** Configuration d'un flux RSS/Atom — paramétrage de makeRssAdapter. */
export interface FeedConfig {
  /** Identifiant du flux, ex. 'rss:01net' (repris comme id de l'adapter). */
  id: string;
  /** Nom lisible du média (ex. '01net') — journalisation uniquement. */
  name: string;
  /** URL du flux, vérifiée en direct (redirections suivies par le serveur d'origine). */
  url: string;
  /**
   * Flux déjà 100 % pertinents (ex. FrenchBreaches : chaque item EST une
   * fuite) — KEYWORD_RE ne s'applique pas : leurs titres sont des noms
   * d'entités nus, le filtre rejetait TOUT (bug 23/08 : 0 candidat FB).
   */
  sansFiltreKeywords?: boolean;
}

// ── Mots-clés (fuite de données / cyber) ────────────────────────────────────
// Liste EXACTE (formes duales après normalisation NFD sans accents, minuscules,
// frontières de mots \b) : fuite, fuites, piratage, piratages, pirate, pirates,
// piraté(e)(s) [→ pirate/piratee/piratees après normalisation], pirater,
// cyberattaque(s), cyber-attaque(s), cyber attaque(s), ransomware(s),
// rançongiciel(s) [→ rancongiciel(s)], donnée(s) [→ donnee(s)].
// NB : « pirate » normalisé matche aussi l'anglais "pirate" — assumé pour
// ces flux francophones.
const KEYWORD_RE =
  /\b(fuites?|piratages?|pirates?|piratees?|pirater|cyber[-\u00a0 ]?attaques?|ransomwares?|rancongiciels?|donnees?)\b/i;

// ── Stopwords français (formes capitalisées telles qu'elles apparaissent en tête) ──
const STOPWORDS = new Set(
  ('Le La Les Un Une Des Du De Au Aux Et Ou En Dans Sur Pour Par Avec Sans Sous Ce Cet Cette Ces ' +
    'Son Sa Ses Leur Leurs Notre Nos Votre Vos Mon Ma Mes Tout Toute Tous Toutes Est Sont Après ' +
    'Avant Entre Vers Depuis Chez Que Qui Quoi Ne Pas Non Plus Face Voici').split(' '),
);

/** Normalisation : NFD → suppression des diacritiques → minuscules, espaces
 *  insécables → espace. « Piraté » et « données » deviennent « pirate » / « donnees ». */
const normalize = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u00a0/g, ' ').toLowerCase();

// ── Entités : guillemets puis runs TitleCase ────────────────────────────────
// Mot d'un run : TitleCase (« Lecornu », « Jean-Noël ») ou acronyme tout en
// capitales de 3 à 7 lettres (« SFR », « ANSSI » — exclut IA, PC, TV).
const TITLECASE_RE = /^[A-ZÉÈÊËÀÂÄÎÏÔÖÛÜÇŒ][a-zàâäéèêëîïôöûüçœ'-]+$/;
const ACRONYM_RE = /^[A-ZÉÈÊËÀÂÄÎÏÔÖÛÜÇŒ]{3,7}$/;

/** Vrai si le contenu quoté peut servir d'entité : initiale en capitale,
 *  pas un mot-clé, pas uniquement des stopwords. */
const isValidQuotedEntity = (text: string): boolean => {
  const stripped = text.replace(/^[«"“'\s]+/, '');
  const firstAlpha = stripped[0];
  if (!firstAlpha || !/[A-ZÉÈÊËÀÂÄÎÏÔÖÛÜÇŒ]/.test(firstAlpha)) return false;
  if (KEYWORD_RE.test(normalize(text))) return false;
  return true;
};

/** Première entité du titre : guillemets valides, sinon premier run TitleCase
 *  ≥ 2 mots (≥ 1 hors stopwords, 0 mot-clé), sinon null. Jamais un mot-clé. */
export function extractEntity(title: string): string | null {
  for (const re of [/«\s*([^«»]{2,60}?)\s*»/g, /"([^"]{2,60}?)"/g, /“([^”]{2,60}?)”/g]) {
    for (const m of title.matchAll(re)) {
      if (isValidQuotedEntity(m[1] ?? '')) return (m[1] ?? '').trim();
    }
  }

  // Tokens : on sépare espaces et apostrophes (l', d', qu'), on dépouille la
  // ponctuation de tête/queue («, :, !, …) pour ne garder que des mots.
  const tokens = title
    .split(/[\s]+/)
    .flatMap((w) => w.split(/['’]/))
    .map((w) => w.replace(/^[^A-Za-zÀ-ÿŒœ]+|[^A-Za-zÀ-ÿŒœ]+$/g, ''))
    .filter(Boolean);

  let run: string[] = [];
  for (const token of tokens) {
    const isWord = TITLECASE_RE.test(token) || ACRONYM_RE.test(token);
    if (!isWord) {
      if (run.length >= 2 && runHasEntity(run)) return run.join(' ');
      run = [];
      continue;
    }
    run.push(token);
  }
  if (run.length >= 2 && runHasEntity(run)) return run.join(' ');
  return null;
}

/** Un run est une entité s'il contient ≥ 1 mot hors stopwords et 0 mot-clé. */
const runHasEntity = (run: string[]): boolean => {
  if (run.some((w) => KEYWORD_RE.test(normalize(w)) && TITLECASE_RE.test(w))) return false;
  return run.some((w) => !STOPWORDS.has(w));
};

// ── Parseur RSS/Atom minimal ────────────────────────────────────────────────
interface RawItem {
  title: string;
  link: string | null;
  guid: string;
  pubDate: string | null;
}

/** Décode les entités HTML numériques et usuelles (&#233; → é, &amp;, …). */
const decodeEntities = (s: string): string =>
  s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, e: string) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e] ?? m),
    );

const stripCdata = (s: string): string => s.replace(/<!\[CDATA\[|\]\]>/g, '');

/** Valeur textuelle d'une balise dans un bloc item/entry (CDATA + entités gérés). */
const tagValue = (block: string, tag: string): string | null => {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeEntities(stripCdata(m[1] ?? '')).trim() : null;
};

/** Atom : href du <link> d'une entry (rel="alternate" ou premier link). */
const atomLink = (entry: string): string | null => {
  const links = [...entry.matchAll(/<link\b([^>]*)\/?>(?:([\s\S]*?)<\/link>)?/gi)];
  const alternate = links.find((m) => /rel=["']alternate["']/i.test(m[1] ?? ''));
  const chosen = alternate ?? links[0];
  const href = chosen?.[1]?.match(/href=["']([^"']+)["']/i)?.[1];
  return href ?? null;
};

/** Extrait les items RSS <item> et Atom <entry>. [] si le document est
 *  malformé (aucun item complet ou pas de balise fermante de document). */
export function parseFeedItems(xml: string): RawItem[] {
  const wellFormed =
    (xml.includes('<item') || xml.includes('<entry')) &&
    (xml.includes('</rss>') || xml.includes('</feed>') || xml.includes('</channel>'));
  if (!wellFormed) return [];

  const blocks = [
    ...(xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/g) ?? []),
    ...(xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/g) ?? []),
  ];

  const items: RawItem[] = [];
  for (const block of blocks) {
    const isAtom = /^<entry/i.test(block);
    const title = tagValue(block, 'title');
    if (!title) continue;
    const link = isAtom ? atomLink(block) : tagValue(block, 'link');
    const guid = tagValue(block, 'guid') ?? tagValue(block, 'id') ?? link ?? title;
    const pubDate = tagValue(block, 'pubDate') ?? tagValue(block, 'updated') ?? tagValue(block, 'published');
    items.push({ title, link, guid, pubDate });
  }
  return items;
}

// ── Adapter ─────────────────────────────────────────────────────────────────
/** SourceAdapter + dédup guid optionnelle — reste assignable au contrat src/adapter.ts. */
export interface RssAdapter extends SourceAdapter {
  fetchCandidates(fetchFn: typeof fetch, knownGuids?: Set<string>): Promise<Candidate[]>;
}

/**
 * Fabrique un SourceAdapter pour un flux RSS/Atom. Isolement par flux :
 * non-200 → [] ; XML malformé → [] ; jamais d'exception pour le contenu.
 * (Une erreur réseau de fetchFn remonte au runner, qui gère retries/circuit
 * breaker — cf. workers/ingest/src/index.ts.)
 */
export function makeRssAdapter(feedCfg: FeedConfig): RssAdapter {
  return {
    id: feedCfg.id,
    /**
     * @param knownGuids Optionnel : guids déjà vus (KV guid_set câblé par le
     *        runner en T19) — les items correspondants sont filtrés ici.
     */
    async fetchCandidates(fetchFn: typeof fetch, knownGuids?: Set<string>): Promise<Candidate[]> {
      // UA navigateur obligatoire : plusieurs hébergeurs (Cloudflare "Just a
      // moment") renvoient 403 au fetch nu du runtime Workers — silencieux
      // sinon (res.ok false → return []) alors que curl local passe (bug FB).
      const res = await fetchFn(feedCfg.url, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; FrancePassoire-Ingest/1.0; +https://francepassoire.com)' },
      });
      if (!res.ok) return [];

      const items = parseFeedItems(await res.text());
      const candidates: Candidate[] = [];
      for (const item of items) {
        if (!feedCfg.sansFiltreKeywords && !KEYWORD_RE.test(normalize(item.title))) continue;
        if (knownGuids?.has(item.guid)) continue;
        candidates.push({
          source: 'rss',
          guid: item.guid,
          source_url: item.link,
          raw: JSON.stringify({
            title: item.title,
            guid: item.guid,
            pubDate: item.pubDate,
            feed: feedCfg.id,
          }),
          entity_name: extractEntity(item.title),
        });
      }
      return candidates;
    },
  };
}

/** Les 4 flux configurés — URLs réelles vérifiées en direct le 2026-08-20
 *  (écarts documentés dans tests/fixtures/adapters/README-rss.md :
 *  JDN thématique → 404, on prend le flux général ; 01net → /feed/ avec
 *  slash final ; ZDNet → /feed sans slash). */
export const rssFeedConfigs: FeedConfig[] = [
  { id: 'rss:01net', name: '01net', url: 'https://www.01net.com/feed/' },
  { id: 'rss:zdnet-fr', name: 'ZDNet FR', url: 'https://www.zdnet.fr/feed' },
  { id: 'rss:jdn', name: 'JDN', url: 'https://www.journaldunet.com/rss/' },
  { id: 'rss:zataz', name: 'Zataz', url: 'https://www.zataz.com/feed/' },
  // Sources spécialisées fuites FR (ajout 23/08 : les 4 incidents DINUM/
  // iMapper/Declic/Solimut nous avaient échappé par absence de ces flux).
  // Les TITRES+URLS publics sont des leads ; le catalogue fuitesinfos
  // reste license-gated (décision tâche 17) : jamais de copie de fiches.
  { id: 'rss:fuitesinfos', name: 'Fuites Infos', url: 'https://fuitesinfos.fr/feed.xml' },
  // FrenchBreaches retiré du worker : son bot-check Cloudflare rejette les IP
  // du runtime Workers (worker-sonde : 403) — moissonné par fb-vps.yml sur le
  // VPS (IP OVH : 200), même contrat d'insertion D1 (statut NEW, guid).
  // Google News (fuites FR) retiré du worker : 503 aux IP sortantes Workers
  // (audit docs/audit-ip-blocking.md §4.1) ; moissonné par gnews-vps.yml sur
  // le VPS (IP OVH : 200), même contrat d'insertion D1 (statut NEW, guid).
  // Blogs spécialisés (ajout 23/08, vague « 100x »).
  { id: 'rss:undernews', name: 'UnderNews', url: 'https://www.undernews.fr/feed' },
  { id: 'rss:dsb', name: 'DataSecurityBreach', url: 'https://www.datasecuritybreach.fr/feed/' },
  // Hackmanac retiré : source redondante avec Zataz/DSB/Undernews et 202
  // anti-bot depuis Workers (audit docs/audit-ip-blocking.md §4.2).
];

/** Instances prêtes à l'emploi — le runner T19 les enregistrera dans
 *  `adapters` (src/adapter.ts) ; ce module ne modifie pas le registre. */
export const rssAdapters: SourceAdapter[] = rssFeedConfigs.map(makeRssAdapter);
