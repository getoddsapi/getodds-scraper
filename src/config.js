// What this actor can read from the GetOdds API (https://getoddsapi.com/openapi.json).
const utm = 'utm_source=apify&utm_medium=actor&utm_campaign=getodds-scraper';

export default {
  name: 'getodds-scraper',
  base: 'https://getoddsapi.com',
  env: 'GETODDS_API_KEY',
  utm,
  signupUrl: `https://getoddsapi.com/sign-up?${utm}`,
  docsUrl: `https://getoddsapi.com/docs?${utm}`,
  pricingUrl: `https://getoddsapi.com/pricing?${utm}`,
  free: '1,000 requests a day, no card',
  attribution: 'Data: getoddsapi.com',

  sports: ['nba', 'nfl', 'nhl', 'ncaaf', 'ncaab', 'mlb', 'epl', 'mls'],
  // Sports each source covers. Keyed calls only go to books that carry the sport.
  propSports: ['nba', 'nfl', 'nhl', 'ncaaf', 'ncaab'],
  propBooks: ['fanduel', 'draftkings', 'betrivers', 'pinnacle', 'novig', 'prizepicks', 'underdog', 'pick6'],
  pickemBooks: ['prizepicks', 'underdog', 'pick6'],
  lineBooks: {
    draftkings: ['nba', 'nfl', 'nhl', 'ncaaf', 'ncaab', 'mlb', 'epl', 'mls'],
    fanduel: ['nba', 'nfl', 'nhl', 'ncaaf', 'ncaab', 'mlb', 'epl', 'mls'],
    pinnacle: ['nba', 'nfl', 'nhl', 'ncaaf', 'ncaab', 'epl', 'mls'],
    novig: ['nba', 'nfl', 'nhl', 'ncaaf', 'ncaab', 'mlb', 'epl', 'mls'],
  },
  gameMarkets: ['moneyline', 'spread', 'total'],

  // Keyless sources: the sandbox (DraftKings game lines, cached up to 5 minutes, max 50 rows)
  // and the free public player props board (capped sample, refreshed every 5 minutes).
  sandboxSports: { nba: 'nba', nfl: 'nfl', nhl: 'nhl', ncaaf: 'ncaaf', epl: 'soccer', mls: 'soccer' },
  boardSports: ['nba', 'nfl', 'nhl', 'ncaaf', 'ncaab'],
};
