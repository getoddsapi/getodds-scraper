// node --test: checks the client against a fake fetch (no network).
// LIVE=1 also runs the keyless endpoints against getoddsapi.com.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiError,
  americanToDecimal,
  decimalToAmerican,
  familyToMarket,
  fetchRows,
  flattenBoardRow,
  flattenPropRow,
  keylessPlan,
  normalizeInput,
} from '../src/client.js';

const res = (body, status = 200) => ({ ok: status < 400, status, headers: new Map(), json: async () => body });
const fake = (handler) => {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, opts });
    return handler(url, calls.length - 1);
  };
  f.calls = calls;
  return f;
};
const collect = async (gen) => {
  const out = [];
  for await (const r of gen) out.push(r);
  return out;
};

const propRow = {
  id: 'p1',
  player: 'Jayson Tatum',
  team: 'BOS',
  stat: 'points',
  stat_label: 'Points',
  starts_at: '2026-11-17T00:30:00.000Z',
  event: 'BOS @ NYK',
  consensus_line: 27.5,
  quotes: {
    fanduel: { id: 'fd1', line: 27.5, over: -110, under: -115, priced: true, observed_at: '2026-11-16T04:00:00Z' },
    prizepicks: { id: 'pp1', line: 27, over: null, under: null, priced: false, observed_at: '2026-11-16T04:01:00Z' },
  },
};

test('odds conversions', () => {
  assert.equal(americanToDecimal(100), 2);
  assert.equal(americanToDecimal(-200), 1.5);
  assert.equal(americanToDecimal(null), null);
  assert.equal(decimalToAmerican(2.5), 150);
  assert.equal(decimalToAmerican(1.5), -200);
});

test('normalizeInput defaults and validation', () => {
  const i = normalizeInput({});
  assert.equal(i.marketType, 'player-props');
  assert.equal(i.sport, 'nba');
  assert.deepEqual(i.books, []);
  assert.equal(i.maxItems, 1000);
  assert.deepEqual(normalizeInput({ books: 'FanDuel, novig' }).books, ['fanduel', 'novig']);
  assert.equal(normalizeInput({ gameMarket: 'all' }).gameMarket, '');
  assert.throws(() => normalizeInput({ sport: 'cricket' }), /Unknown sport/);
});

test('flattenPropRow: one row per book and side, pick-em rows unpriced', () => {
  const rows = flattenPropRow(propRow, 'nba');
  assert.equal(rows.length, 3);
  const over = rows.find((r) => r.book === 'fanduel' && r.side === 'over');
  assert.equal(over.price_american, -110);
  assert.equal(over.price_decimal, 1.9091);
  assert.equal(over.line, 27.5);
  assert.equal(over.player, 'Jayson Tatum');
  assert.equal(over.market, 'points');
  assert.equal(over.captured_at, '2026-11-16T04:00:00Z');
  const pp = rows.find((r) => r.book === 'prizepicks');
  assert.equal(pp.side, null);
  assert.equal(pp.price_american, null);
  assert.equal(pp.pickem, true);
  assert.equal(flattenPropRow(propRow, 'nba', ['prizepicks']).length, 1);
});

test('flattenBoardRow reads <book>_line columns', () => {
  const rows = flattenBoardRow({
    sport: 'nba', player: 'A', team: 'MIN', stat: 'assists', starts_at: 'x', event: 'e', updated_at: 't',
    fanduel_line: 3.5, fanduel_over: -102, fanduel_under: -130, draftkings_line: null, underdog_line: 3.5,
  });
  assert.deepEqual(rows.map((r) => `${r.book}:${r.side}`), ['fanduel:over', 'fanduel:under', 'underdog:null']);
});

test('familyToMarket', () => {
  assert.equal(familyToMarket('moneyline'), 'moneyline');
  assert.equal(familyToMarket('', 'Run Line'), 'spread');
  assert.equal(familyToMarket('totals'), 'total');
});

test('keylessPlan', () => {
  assert.equal(keylessPlan(normalizeInput({})), 'board');
  assert.equal(keylessPlan(normalizeInput({ marketType: 'game-lines' })), 'sandbox');
  assert.equal(keylessPlan(normalizeInput({ marketType: 'game-lines', books: ['pinnacle'] })), null);
  assert.equal(keylessPlan(normalizeInput({ marketType: 'game-lines', sport: 'mlb' })), null);
});

test('keyed props follow offsets and send the bearer key', async () => {
  const f = fake((url, i) =>
    res(i === 0
      ? { data: [propRow], pagination: { has_more: true, next_offset: 200 } }
      : { data: [propRow], pagination: { has_more: false, next_offset: null } }),
  );
  const rows = await collect(fetchRows(normalizeInput({ books: ['fanduel'], player: 'tatum' }), { apiKey: 'k', fetchImpl: f }));
  assert.equal(rows.length, 4);
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0].url, /\/api\/v1\/props\?sport=nba&books=fanduel&player=tatum&limit=200&offset=0/);
  assert.match(f.calls[1].url, /offset=200/);
  assert.equal(f.calls[0].opts.headers.Authorization, 'Bearer k');
});

test('keyless props read the public board and never send a key', async () => {
  const f = fake(() => res({ boards: [{ rows: [{ sport: 'nba', player: 'A', stat: 'points', fanduel_line: 20.5, fanduel_over: 100, fanduel_under: -120 }] }] }));
  const rows = await collect(fetchRows(normalizeInput({}), { apiKey: '', fetchImpl: f }));
  assert.equal(rows.length, 2);
  assert.match(f.calls[0].url, /\/player-props-today\/data\/nba\.json$/);
  assert.equal(f.calls[0].opts.headers.Authorization, undefined);
});

test('keyless game lines read the sandbox and filter by market', async () => {
  const f = fake(() => res({ data: [
    { event_id: 'e1', sport: 'NBA', home: 'H', away: 'A', starts_at: 's', market: 'moneyline', period: 'game', side: 'home', line: null, american: -142, decimal: 1.704225, observed_at: 'o' },
    { event_id: 'e1', sport: 'NBA', home: 'H', away: 'A', starts_at: 's', market: 'spread', period: 'game', side: 'home', line: -3.5, american: -110, decimal: 1.909, observed_at: 'o' },
  ] }));
  const rows = await collect(fetchRows(normalizeInput({ marketType: 'game-lines', gameMarket: 'moneyline' }), { apiKey: '', fetchImpl: f }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].book, 'draftkings');
  assert.equal(rows[0].team, 'H');
  assert.equal(rows[0].event, 'A @ H');
  assert.equal(rows[0].price_decimal, 1.7042);
  assert.match(f.calls[0].url, /sandbox\/odds\?sport=nba/);
});

test('keyed game lines: every book, 403 on one book is skipped', async () => {
  const f = fake((url) => {
    if (url.includes('/api/v1/odds')) return res({ data: [{ id: 'd1', event_id: 'e', sport: 'NBA', home: 'H', away: 'A', market: 'total', side: 'over', line: 220.5, american: -110, decimal: 1.909, observed_at: 'o' }], pagination: { has_more: false } });
    if (url.includes('/api/v1/sportsbook/markets')) return res({ error: { code: 'SOURCE_NOT_GRANTED', message: 'no fanduel scope' } }, 403);
    if (url.includes('/api/v1/pinnacle/markets')) return res({ data: [{ id: 'm1', league: 'NBA', matchup_id: '9', home: 'H', away: 'A', market: 'spread', period: 0, outcomes: [{ side: 'home', line: -3.5, price_american: -105, price_decimal: 1.952 }, { side: 'away', line: 3.5, price_american: -105, price_decimal: 1.952 }], observed_at: 'o' }], pagination: { has_more: false } });
    if (url.includes('/api/v1/novig/markets')) return res({ data: [
      { id: 'n1', event: { id: 'ev', name: 'A @ H', home: 'H', away: 'A', starts_at: 's' }, market: 'moneyline', is_main: true, outcomes: [{ id: 'o1', side: 'home', price_american: -120, price_decimal: 1.833, fair: 0.53, fair_american: -113 }], observed_at: 'o' },
      { id: 'n2', event: {}, market: 'player_prop', outcomes: [{ id: 'o2', side: 'over' }] },
    ], pagination: { has_more: false } });
    throw new Error(`unexpected ${url}`);
  });
  const logs = [];
  const rows = await collect(fetchRows(normalizeInput({ marketType: 'game-lines' }), { apiKey: 'k', fetchImpl: f, log: (m) => logs.push(m) }));
  assert.deepEqual(rows.map((r) => r.book), ['draftkings', 'pinnacle', 'pinnacle', 'novig']);
  assert.equal(rows[3].fair_probability, 0.53);
  assert.equal(rows[1].team, 'H');
  assert.ok(logs.some((l) => /Skipping fanduel/.test(l)));
});

test('401 surfaces as ApiError', async () => {
  const f = fake(() => res({ error: { code: 'INVALID_API_KEY', message: 'A valid bearer API key is required.' } }, 401));
  await assert.rejects(collect(fetchRows(normalizeInput({}), { apiKey: 'bad', fetchImpl: f })), (e) => e instanceof ApiError && e.status === 401);
});

test('live: keyless sandbox and public board', { skip: !process.env.LIVE }, async () => {
  const lines = await collect(fetchRows(normalizeInput({ marketType: 'game-lines', sport: 'nba' }), { apiKey: '' }));
  assert.ok(lines.length > 0, 'sandbox returned rows');
  for (const r of lines) {
    assert.equal(r.book, 'draftkings');
    assert.ok(r.price_american !== null && r.captured_at);
  }
  const props = await collect(fetchRows(normalizeInput({ sport: 'nba' }), { apiKey: '' }));
  assert.ok(props.length > 0, 'board returned rows');
  assert.ok(props.every((r) => r.player && r.market && r.line !== null));
});
