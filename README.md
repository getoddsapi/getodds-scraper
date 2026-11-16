# GetOdds Sports Odds & Player Props API

An Apify actor that saves sports odds and player props to an Apify dataset (JSON, CSV, Excel) on a schedule or on demand: one row per line, with the book, player or team, market, line, price and the time it was captured.

Books: FanDuel, DraftKings, BetRivers, Pinnacle and Novig (two-sided prices) plus PrizePicks, Underdog and DK Pick6 (pick'em lines). Sports: NBA, NFL, NHL, college football and college basketball for player props; those plus MLB, Premier League and MLS for game lines.

It does not scrape sportsbook pages. It reads the documented [GetOdds API](https://getoddsapi.com/?utm_source=apify&utm_medium=actor&utm_campaign=getodds-scraper) with your own key, so runs are fast, rows have a stable schema and nothing breaks when a sportsbook site changes. Without a key it reads the keyless sample: DraftKings game lines from the GetOdds sandbox (cached up to 5 minutes, at most 50 rows) or the free public player props board (a capped sample). Add a free key for every line at every book.

GetOdds (getoddsapi.com) is an independent data service operated by Stunning Couches LLC. It is not affiliated with or endorsed by FanDuel, DraftKings, BetRivers, Pinnacle, Novig, PrizePicks, Underdog or any sportsbook. The data is prices, not betting advice.

## Quick start

1. Get a free key (1,000 requests a day, no card): https://getoddsapi.com/sign-up?utm_source=apify&utm_medium=actor&utm_campaign=getodds-scraper
2. Run the actor with `apiKey` set, pick `marketType` and `sport`, and optionally narrow `books`.
3. Download the dataset or connect it to Sheets, Zapier, Make or a webhook.

## What it can read

| `marketType` | Rows | Without a key |
| --- | --- | --- |
| `player-props` | Every book's line and over/under price per player and stat, for games in the next 48 hours | The free public board (capped sample) |
| `game-lines` | Moneyline, spread and total per game, from DraftKings, FanDuel, Pinnacle and Novig | DraftKings only, from the sandbox (at most 50 rows) |

## Input

| Field | Default | Notes |
| --- | --- | --- |
| `apiKey` | empty | Stored as a secret. Empty means the keyless sample. You can also set `GETODDS_API_KEY` in the actor environment. |
| `marketType` | `player-props` | `player-props` or `game-lines`. |
| `sport` | `nba` | `nba`, `nfl`, `nhl`, `ncaaf`, `ncaab`, `mlb`, `epl`, `mls`. Player props cover the first five. |
| `books` | all | Any of `fanduel`, `draftkings`, `betrivers`, `pinnacle`, `novig`, `prizepicks`, `underdog`, `pick6`. Books your key has no grant for are skipped with a log line. |
| `gameMarket` | `all` | Game lines only: `moneyline`, `spread` or `total`. |
| `player` | empty | Player props only. Name or part of it. |
| `stat` | empty | Player props only, for example `points`, `rebounds`, `threes`, `pra`, `passing_yards`, `receptions`, `shots_on_goal`. |
| `maxItems` | 1000 | Stop after this many rows. |

## Output

One row per line and side:

```json
{
  "book": "fanduel",
  "sport": "nba",
  "market_type": "player_prop",
  "market": "points",
  "period": null,
  "event": "Portland Trail Blazers @ Minnesota Timberwolves",
  "starts_at": "2026-11-17T01:00:00.000Z",
  "player": "Ayo Dosunmu",
  "team": "MIN",
  "side": "over",
  "line": 17.5,
  "price_american": 102,
  "price_decimal": 2.02,
  "captured_at": "2026-11-16T04:22:38.656Z",
  "stat_label": "Points",
  "consensus_line": 17.5,
  "pickem": false,
  "keyless": false,
  "attribution": "Data: getoddsapi.com"
}
```

Pick'em books (PrizePicks, Underdog, Pick6) post a line, not a price, so their rows have `side` and `price_american` set to null and `pickem` true. Game line rows carry `event_id`, `home`, `away`, `team` (the side's team on moneyline and spread) and, for Novig, the no-vig `fair_probability`. Check `captured_at` before using a price.

## Costs

Apify compute for a run is a few seconds. API usage is billed by GetOdds on your own plan: one request per page of up to 200 props or markets. The free tier (1,000 requests a day) covers scheduled runs, and [paid plans](https://getoddsapi.com/pricing?utm_source=apify&utm_medium=actor&utm_campaign=getodds-scraper) start at $5 a month.

## Prefer code?

The same data is in the official packages: [Python](https://github.com/getoddsapi/getodds-python), [JavaScript](https://github.com/getoddsapi/getodds-js), [R](https://github.com/getoddsapi/getodds-r) and an [MCP server](https://github.com/getoddsapi/getodds-mcp) for AI agents. Full reference: https://getoddsapi.com/docs?utm_source=apify&utm_medium=actor&utm_campaign=getodds-scraper

## Develop

```bash
npm install
npm test                      # no network
npm run test:live             # also hits the keyless endpoints
APIFY_LOCAL_STORAGE_DIR=./storage GETODDS_API_KEY=... npm start
```

MIT License.
