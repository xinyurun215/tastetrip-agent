// Explicitly synthetic local fixtures. These are not recorded Qloo responses.
// No real credential, provider request or network fallback belongs in this file.
import { createHash } from 'node:crypto';

const TYPES = { movie: 'urn:entity:movie', music: 'urn:entity:artist', book: 'urn:entity:book' };
const POOL_IDS = 'ABCDEFGHI'.split('');
const ORDERS = [POOL_IDS, 'DEFGHIABC'.split(''), 'GHIABCDEF'.split('')];
const KNOWN = [
  ['movie', 'Dune', 'dune-1984', 0, 1984],
  ['movie', 'Dune', 'dune-2021', 0, 2021],
  ['movie', 'Inception', 'inception', 0, 2010],
  ['movie', 'Amelie', 'amelie', 1, 2001],
  ['movie', 'Interstellar', 'interstellar', 2, 2014],
  ['music', 'Miles Davis', 'miles-davis', 0],
  ['music', 'Radiohead', 'radiohead', 1],
  ['music', 'Nina Simone', 'nina-simone', 2],
  ['music', 'Beyonce', 'beyonce', 1],
  ['book', 'The Great Gatsby', 'the-great-gatsby', 0, 1925],
  ['book', 'Beloved', 'beloved', 1, 1987],
  ['book', 'Dune', 'dune-book', 2, 1965],
  ['book', 'The Little Prince', 'the-little-prince', 2, 1943],
];
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const csv = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

function culturalEntity(kind, name, slug, ordinal, year) {
  const entity = {
    entity_id: `synthetic:${kind}:${slug}`,
    name,
    types: [TYPES[kind]],
    properties: { description: `Synthetic fixture record for ${name}; metadata is illustrative.` },
  };
  if (year) entity.properties.release_year = year;
  if (kind === 'movie') entity.properties.external = { imdb: [{ id: `tt${String(ordinal + 100).padStart(7, '0')}` }] };
  if (kind === 'music') entity.properties.external = { spotify: [{ id: `synthetic-spotify-${slug}` }] };
  if (kind === 'book') {
    const isbn13 = `978000000${String(ordinal).padStart(4, '0')}`;
    entity.properties.isbn13 = isbn13;
    entity.properties.external = { isbn: [{ id: isbn13 }] };
  }
  return entity;
}

function place(id) {
  const letter = id[0];
  const index = POOL_IDS.indexOf(letter);
  const sameNameBranch = letter === 'G' || letter === 'H';
  return {
    entity_id: id,
    name: sameNameBranch ? 'Synthetic Twin Cafe' : `Synthetic ${letter} ${index % 3 === 0 ? 'Jazz Club' : 'Restaurant'}`,
    types: ['urn:entity:place'],
    location: { lat: 40.74 + index / 1000, lon: -73.99 + (index % 3) / 1000 },
    properties: {
      address: `${index + 1} Synthetic Street, New York`,
      geocode: { city: 'New York', country_code: 'US' },
      external: { google_places: [{ id: `synthetic-store-${letter.toLowerCase()}` }] },
    },
    tags: [{ name: index % 3 === 0 ? 'Jazz Club' : 'Restaurant' }],
    query: { affinity: .95 - index / 20 },
  };
}

// Parameter allowlist deliberately excludes headers, authorization and arbitrary body fields.
const SAFE_PARAMS = new Set(['query', 'types', 'take', 'entity_ids', 'filter.type', 'filter.query',
  'filter.location', 'filter.location.radius', 'filter.exclude.entities', 'filter.results.entities',
  'signal.interests.entities', 'feature.explainability', 'filter.tags', 'sort_by']);
function requestRecord(url) {
  return { path: url.pathname, params: Object.fromEntries([...url.searchParams]
    .filter(([key]) => SAFE_PARAMS.has(key))
    .map(([key, value]) => [key, value.replace(/[\u0000-\u001f]/g, '').slice(0, 4096)])) };
}

export function createCommonFixture() {
  const registry = new Map();
  const profiles = new Map();
  KNOWN.forEach(([kind, name, slug, profile, year], index) => {
    const entity = culturalEntity(kind, name, slug, index + 1, year);
    registry.set(entity.entity_id, entity);
    profiles.set(entity.entity_id, profile);
  });

  function search(query, requestedTypes) {
    const kind = Object.keys(TYPES).find(key => requestedTypes.includes(TYPES[key])) || 'movie';
    const matches = [...registry.values()].filter(entity => entity.types.includes(TYPES[kind]) && normalized(entity.name) === normalized(query));
    if (matches.length) return matches;
    const slug = createHash('sha256').update(`${kind}:${normalized(query)}`).digest('hex').slice(0, 12);
    const entity = culturalEntity(kind, String(query).trim(), slug, 90);
    registry.set(entity.entity_id, entity);
    profiles.set(entity.entity_id, parseInt(slug[0], 16) % ORDERS.length);
    return [entity];
  }

  function profileOf(signalIds) {
    // Each query has a stable profile, independent of request order and cache state.
    for (const kind of ['movie', 'music', 'book']) {
      const id = signalIds.find(value => value.startsWith(`synthetic:${kind}:`) && profiles.has(value));
      if (id) return profiles.get(id);
    }
    return 0;
  }

  function transport({ scenario = 'default', calls = [] } = {}) {
    return async rawUrl => {
      const url = new URL(rawUrl);
      calls.push(requestRecord(url));
      if (url.pathname === '/search' && url.searchParams.get('types') === 'urn:entity:locality') {
        return response({ results: [{ entity_id: 'synthetic-new-york', name: 'New York', types: ['urn:entity:locality'],
          location: { lat: 40.74, lon: -73.99 }, properties: { geocode: { city: 'New York', country_code: 'US' } },
          tags: [{ tag_id: 'urn:tag:genre:locality:city' }] }] });
      }
      if (url.pathname === '/search') {
        return response({ results: search(url.searchParams.get('query'), csv(url.searchParams.get('types'))) });
      }
      if (url.pathname === '/entities') {
        return response({ results: { entities: csv(url.searchParams.get('entity_ids')).map(id => registry.get(id)).filter(Boolean) } });
      }
      if (url.pathname === '/v2/tags') {
        const music = /music|jazz|night/i.test(url.searchParams.get('filter.query') || '');
        return response({ results: { tags: [{ id: `urn:tag:category:place:${music ? 'jazz_club' : 'restaurant'}`, name: music ? 'Jazz Club' : 'Restaurant' }] } });
      }
      if (url.pathname === '/v2/insights') {
        if (scenario === 'error') return response({ error: 'synthetic_service_failure' }, 503);
        const fixedPool = csv(url.searchParams.get('filter.results.entities'));
        const excluded = new Set(csv(url.searchParams.get('filter.exclude.entities')));
        if (!fixedPool.length) {
          // Stable A duplicates and A-alias share verifiable provider identity.
          // G and H only share their name and remain distinct branch candidates.
          const discoveredIds = scenario === 'recheck' && !excluded.size ? POOL_IDS.slice(0, 3) : [...POOL_IDS, 'A', 'A-alias'];
          const pool = scenario === 'empty' ? [] : discoveredIds.filter(id => !excluded.has(id) && !excluded.has(id[0])).map(place);
          return response({ results: { entities: pool } });
        }
        const signalIds = csv(url.searchParams.get('signal.interests.entities'));
        const profile = profileOf(signalIds);
        const order = ORDERS[profile];
        let ranked = fixedPool.filter(id => POOL_IDS.includes(id[0]) && !excluded.has(id))
          .sort((left, right) => order.indexOf(left[0]) - order.indexOf(right[0]));
        if (scenario === 'partial' && profile > 0) {
          const included = new Set(order.slice(0, 6));
          ranked = ranked.filter(id => included.has(id[0]));
        }
        return response({ results: { entities: ranked.map((id, index) => {
          const item = place(id);
          item.query = { affinity: .94 - index / 25 };
          if (id[0] !== 'F') {
            const contributionIds = id[0] === 'E' && signalIds.length > 1 ? signalIds.slice(0, -1) : signalIds;
            item.query.explainability = { 'signal.interests.entities': contributionIds.map((entity_id, signalIndex) => ({ entity_id, score: .42 - signalIndex / 20 })) };
          }
          return item;
        }) } });
      }
      throw new Error(`Unexpected synthetic transport path: ${url.pathname}`);
    };
  }

  return { transport };
}
