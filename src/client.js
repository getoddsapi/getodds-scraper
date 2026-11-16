// Thin client: calls the documented GetOdds API and yields one flat row per line.
// No scraping of any sportsbook site; all data comes from getoddsapi.com.
import config from './config.js';

export class ApiError extends Error {
  constructor(status, code, message, url) {
    super(`${status}${code ? ` ${code}` : ''}: ${message}`);
    this.status = status;
    this.code = code;
    this.url = url;
  }
}

export function americanToDecimal(a) {
  if (a === null || a === undefined || Number.isNaN(Number(a))) return null;
  const n = Number(a);
  if (n === 0) return null;
  return round(n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n), 4);
}

export function decimalToAmerican(d) {
  if (d === null || d === undefined || !(Number(d) > 1)) return null;
  const n = Number(d);
  return Math.round(n >= 2 ? (n - 1) * 100 : -100 / (n - 1));
}

function round(n, p) {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}

export function normalizeInput(raw = {}) {
  const input = { ...raw };
  input.marketType = input.marketType === 'game-lines' ? 'game-lines' : 'player-props';
  input.sport = String(input.sport || 'nba').toLowerCase();
  if (!config.sports.includes(input.sport)) {
    throw new Error(`Unknown sport "${input.sport}". Options: ${config.sports.join(', ')}`);
  }
  input.books = (Array.isArray(input.books) ? input.books : String(input.books || '').split(','))
    .map((b) => String(b).trim().toLowerCase())
    .filter(Boolean);
  input.gameMarket = config.gameMarkets.includes(input.gameMarket) ? input.gameMarket : '';
  input.maxItems = Math.max(1, Number(input.maxItems) || 1000);
  return input;
}

export async function getJson(url, { apiKey, fetchImpl = fetch, log = () => {} } = {}) {
  const headers = { Accept: 'application/json', 'User-Agent': `apify-actor/${config.name}` };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, { headers });
    if (res.status === 429 && attempt < 3) {
      const wait = Math.min(Number(res.headers?.get?.('retry-after')) || 2 ** (attempt + 1), 60);
      log(`Rate limited, waiting ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const e = body?.error ?? {};
      throw new ApiError(res.status, e.code ?? '', e.user_message ?? e.message ?? `HTTP ${res.status}`, url);
    }
    return body;
  }
}

function qs(params) {
  const q = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]),
  );
  return q.size ? `?${q}` : '';
}

const row = (r) => ({
  book: r.book,
  sport: r.sport ?? null,
  market_type: r.market_type,
  market: r.market ?? null,
  period: r.period ?? null,
  event: r.event ?? null,
  event_id: r.event_id ?? null,
  home: r.home ?? null,
  away: r.away ?? null,
  starts_at: r.starts_at ?? null,
  player: r.player ?? null,
  team: r.team ?? null,
  side: r.side ?? null,
  line: r.line ?? null,
  price_american: r.price_american ?? null,
  price_decimal: r.price_decimal ?? (r.price_american != null ? americanToDecimal(r.price_american) : null),
  captured_at: r.captured_at ?? null,
  source_id: r.source_id ?? null,
  ...(r.extra ?? {}),
});

// ---------- player props ----------

// One /api/v1/props row carries every book's quote. Split it into one row per book and side.
export function flattenPropRow(p, sport, books = []) {
  const out = [];
  for (const [book, q] of Object.entries(p.quotes ?? {})) {
    if (books.length && !books.includes(book)) continue;
    const base = {
      book,
      sport,
      market_type: 'player_prop',
      market: p.stat,
      event: q.event ?? p.event ?? null,
      starts_at: p.starts_at,
      player: p.player,
      team: p.team,
      line: q.line,
      captured_at: q.observed_at ?? null,
      source_id: q.id ?? null,
      extra: { stat_label: p.stat_label ?? null, consensus_line: p.consensus_line ?? null, pickem: !q.priced },
    };
    if (q.priced === false || (q.over == null && q.under == null)) {
      out.push(row({ ...base, side: null, price_american: null }));
      continue;
    }
    if (q.over != null) out.push(row({ ...base, side: 'over', price_american: q.over }));
    if (q.under != null) out.push(row({ ...base, side: 'under', price_american: q.under }));
  }
  return out;
}

// The keyless public board has one row per player and stat with <book>_line / _over / _under columns.
export function flattenBoardRow(p, books = []) {
  const out = [];
  for (const book of config.propBooks) {
    if (books.length && !books.includes(book)) continue;
    const line = p[`${book}_line`];
    if (line === null || line === undefined) continue;
    const base = {
      book,
      sport: p.sport,
      market_type: 'player_prop',
      market: p.stat,
      event: p.event ?? null,
      starts_at: p.starts_at,
      player: p.player,
      team: p.team,
      line,
      captured_at: p.updated_at ?? null,
      extra: { stat_label: p.stat_label ?? null, consensus_line: p.sportsbook_median_line ?? null, pickem: config.pickemBooks.includes(book) },
    };
    const over = p[`${book}_over`];
    const under = p[`${book}_under`];
    if (over == null && under == null) {
      out.push(row({ ...base, side: null, price_american: null }));
      continue;
    }
    if (over != null) out.push(row({ ...base, side: 'over', price_american: over }));
    if (under != null) out.push(row({ ...base, side: 'under', price_american: under }));
  }
  return out;
}

async function* propsKeyed(input, ctx) {
  const params = { sport: input.sport, books: input.books.join(','), player: input.player, stat: input.stat, limit: 200, offset: 0 };
  for (let page = 0; page < 50; page++) {
    const body = await getJson(`${config.base}/api/v1/props${qs(params)}`, ctx);
    for (const p of body?.data ?? []) yield* flattenPropRow(p, input.sport, input.books);
    const pg = body?.pagination ?? {};
    if (!pg.has_more || pg.next_offset == null) return;
    params.offset = pg.next_offset;
  }
}

async function* propsKeyless(input, ctx) {
  const body = await getJson(`${config.base}/player-props-today/data/${input.sport}.json`, { ...ctx, apiKey: '' });
  for (const board of body?.boards ?? []) {
    for (const p of board.rows ?? []) {
      if (input.player && !String(p.player).toLowerCase().includes(String(input.player).toLowerCase())) continue;
      if (input.stat && p.stat !== input.stat) continue;
      yield* flattenBoardRow(p, input.books);
    }
  }
}

// ---------- game lines ----------

export function dkRow(r, book = 'draftkings') {
  return row({
    book,
    sport: String(r.sport ?? '').toLowerCase() || null,
    market_type: 'game_line',
    market: r.market,
    period: r.period,
    event: r.away && r.home ? `${r.away} @ ${r.home}` : null,
    event_id: r.event_id,
    home: r.home,
    away: r.away,
    starts_at: r.starts_at,
    team: r.side === 'home' ? r.home : r.side === 'away' ? r.away : null,
    side: r.side,
    line: r.line,
    price_american: r.american,
    price_decimal: r.decimal != null ? round(r.decimal, 4) : null,
    captured_at: r.observed_at,
    source_id: r.id ?? null,
    extra: r.stale !== undefined ? { stale: r.stale } : undefined,
  });
}

export function marketOutcomeRows(m, book, sport) {
  const ev = m.event && typeof m.event === 'object' ? m.event : {};
  const home = m.home ?? ev.home ?? null;
  const away = m.away ?? ev.away ?? null;
  return (m.outcomes ?? []).map((o) =>
    row({
      book,
      sport,
      market_type: m.market === 'player_prop' ? 'player_prop' : 'game_line',
      market: m.market === 'player_prop' ? (m.stat ?? m.native_market_type) : m.market,
      period: m.period ?? null,
      event: ev.name ?? (away && home ? `${away} @ ${home}` : null),
      event_id: ev.id ?? m.matchup_id ?? m.game_matchup_id ?? null,
      home,
      away,
      starts_at: m.starts_at ?? ev.starts_at ?? null,
      player: m.player ?? null,
      team: o.side === 'home' ? home : o.side === 'away' ? away : null,
      side: o.side ?? o.name ?? null,
      line: o.line ?? m.line ?? null,
      price_american: o.price_american ?? null,
      price_decimal: o.price_decimal != null ? round(o.price_decimal, 4) : null,
      captured_at: m.observed_at ?? null,
      source_id: o.id ?? m.id ?? null,
      extra: book === 'novig' ? { fair_probability: o.fair ?? null, fair_american: o.fair_american ?? null, is_main: m.is_main ?? null } : { is_alternate: m.is_alternate ?? null },
    }),
  );
}

export function familyToMarket(family = '', name = '') {
  const s = `${family} ${name}`.toLowerCase();
  if (/money ?line|moneyline|match.?result|to win|winner/.test(s)) return 'moneyline';
  if (/spread|handicap|run line|puck line/.test(s)) return 'spread';
  if (/total|over.?under/.test(s)) return 'total';
  return family || null;
}

export function fanduelRows(m, sport) {
  const [away, home] = String(m.event_name ?? '').split(/\s+@\s+|\s+v\s+/);
  const market = familyToMarket(m.family, m.name);
  return (m.selections ?? [])
    .filter((s) => s.status !== 'suspended')
    .map((s) =>
      row({
        book: 'fanduel',
        sport,
        market_type: 'game_line',
        market,
        period: m.period ?? null,
        event: m.event_name ?? null,
        event_id: m.event_id ?? null,
        home: home ?? null,
        away: away ?? null,
        starts_at: m.starts_at ?? null,
        team: s.team ?? null,
        side: s.side ?? s.name ?? null,
        line: s.line ?? m.line ?? null,
        price_american: s.american ?? null,
        price_decimal: s.decimal != null ? round(s.decimal, 4) : null,
        captured_at: m.observed_at ?? null,
        source_id: s.id ?? null,
        extra: { native_market: m.name ?? null },
      }),
    );
}

async function* offsetPages(path, params, ctx, pick) {
  const p = { ...params, offset: 0 };
  for (let page = 0; page < 50; page++) {
    const body = await getJson(`${config.base}${path}${qs(p)}`, ctx);
    for (const r of body?.data ?? []) yield* pick(r);
    const pg = body?.pagination ?? {};
    if (!pg.has_more || pg.next_offset == null) return;
    p.offset = pg.next_offset;
  }
}

const lineReaders = {
  draftkings: (input, ctx) =>
    offsetPages('/api/v1/odds', { sport: input.sport.toUpperCase(), market: input.gameMarket, fresh_only: 'true', limit: 200 }, ctx, (r) => [dkRow(r)]),
  pinnacle: (input, ctx) =>
    offsetPages('/api/v1/pinnacle/markets', { league: input.sport.toUpperCase(), market: input.gameMarket, limit: 200 }, ctx, (m) =>
      marketOutcomeRows(m, 'pinnacle', input.sport),
    ),
  novig: (input, ctx) =>
    offsetPages('/api/v1/novig/markets', { league: input.sport.toUpperCase(), market: input.gameMarket, limit: 200 }, ctx, (m) =>
      m.market === 'player_prop' ? [] : marketOutcomeRows(m, 'novig', input.sport),
    ),
  fanduel: async function* (input, ctx) {
    const p = { league: input.sport.toUpperCase(), status: 'open', limit: 100 };
    for (let page = 0; page < 50; page++) {
      const body = await getJson(`${config.base}/api/v1/sportsbook/markets${qs(p)}`, ctx);
      for (const m of body?.data ?? []) {
        if (m.is_future || m.player || m.in_play) continue;
        for (const r of fanduelRows(m, input.sport)) if (!input.gameMarket || r.market === input.gameMarket) yield r;
      }
      const pg = body?.pagination ?? {};
      if (!pg.has_more || !pg.next_after) return;
      p.after = pg.next_after;
    }
  },
};

async function* linesKeyed(input, ctx) {
  const wanted = input.books.length ? input.books : Object.keys(lineReaders);
  for (const book of wanted) {
    if (!lineReaders[book]) {
      ctx.log(`Skipping ${book}: game lines are read from ${Object.keys(lineReaders).join(', ')}.`);
      continue;
    }
    if (!config.lineBooks[book].includes(input.sport)) {
      ctx.log(`Skipping ${book}: no ${input.sport.toUpperCase()} game lines there.`);
      continue;
    }
    try {
      yield* lineReaders[book](input, ctx);
    } catch (e) {
      // A key without this book's source grant answers 403; keep the other books.
      if (e instanceof ApiError && (e.status === 403 || e.status === 422)) {
        ctx.log(`Skipping ${book}: ${e.message}`);
        continue;
      }
      throw e;
    }
  }
}

async function* linesKeyless(input, ctx) {
  const sandboxSport = config.sandboxSports[input.sport];
  const body = await getJson(`${config.base}/api/v1/sandbox/odds${qs({ sport: sandboxSport })}`, { ...ctx, apiKey: '' });
  for (const r of body?.data ?? []) {
    if (sandboxSport === 'soccer' && String(r.sport).toLowerCase() !== input.sport) continue;
    if (input.gameMarket && r.market !== input.gameMarket) continue;
    yield dkRow(r);
  }
}

// What a keyless run can read, or null when it needs a key.
export function keylessPlan(input) {
  if (input.marketType === 'player-props') return config.boardSports.includes(input.sport) ? 'board' : null;
  if (!config.sandboxSports[input.sport]) return null;
  if (input.books.length && !input.books.includes('draftkings')) return null;
  return 'sandbox';
}

export async function* fetchRows(input, { apiKey, fetchImpl = fetch, log = () => {} } = {}) {
  const ctx = { apiKey, fetchImpl, log };
  if (input.marketType === 'player-props') {
    if (apiKey) yield* propsKeyed(input, ctx);
    else yield* propsKeyless(input, ctx);
    return;
  }
  if (apiKey) yield* linesKeyed(input, ctx);
  else yield* linesKeyless(input, ctx);
}
