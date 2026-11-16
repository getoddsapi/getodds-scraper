import { Actor, log } from 'apify';
import { ApiError, fetchRows, keylessPlan, normalizeInput } from './client.js';
import config from './config.js';

await Actor.init();

let input;
try {
  input = normalizeInput((await Actor.getInput()) ?? {});
} catch (e) {
  await Actor.fail(e.message);
}
const apiKey = String(input.apiKey || process.env[config.env] || '').trim();

if (input.marketType === 'player-props' && !config.propSports.includes(input.sport)) {
  await Actor.fail(`Player props cover ${config.propSports.join(', ')}. For ${input.sport.toUpperCase()} pick "Game lines".`);
}

if (!apiKey) {
  const plan = keylessPlan(input);
  if (!plan) {
    await Actor.fail(
      `This input needs a GetOdds API key (${input.marketType}, ${input.sport.toUpperCase()}${input.books.length ? `, books ${input.books.join(',')}` : ''}). ` +
        `Get a free key (${config.free}) at ${config.signupUrl} and paste it into the apiKey field.`,
    );
  }
  log.warning(
    plan === 'board'
      ? 'No API key: reading the free public player props board (a capped sample, refreshed every 5 minutes).'
      : 'No API key: reading the keyless sandbox (DraftKings game lines, cached up to 5 minutes, at most 50 rows).',
  );
  log.warning(`Every line at every book, with pagination: free key (${config.free}) at ${config.signupUrl}`);
}

log.info(`Reading ${input.marketType} for ${input.sport.toUpperCase()} from ${config.base}${input.books.length ? ` (books: ${input.books.join(', ')})` : ''}`);
let count = 0;
const batch = [];
try {
  for await (const row of fetchRows(input, { apiKey, log: log.info.bind(log) })) {
    batch.push({ ...row, keyless: !apiKey, attribution: config.attribution });
    count++;
    if (batch.length >= 500) await Actor.pushData(batch.splice(0));
    if (count >= input.maxItems) break;
  }
} catch (e) {
  if (batch.length) await Actor.pushData(batch);
  if (e instanceof ApiError && e.status === 401) {
    await Actor.fail(`GetOdds rejected the API key. Check it, or create a free key (${config.free}) at ${config.signupUrl}`);
  }
  if (e instanceof ApiError && e.status === 429) {
    await Actor.fail(`GetOdds rate limit or quota reached: ${e.message}. Plans: ${config.pricingUrl}`);
  }
  await Actor.fail(`GetOdds request failed: ${e.message}`);
}
if (batch.length) await Actor.pushData(batch);
log.info(`Saved ${count} rows to the dataset.`);
if (!count) log.warning('No lines matched. An empty board is a real answer (for example, no games in the next 48 hours); try another sport or remove filters.');
await Actor.exit(`Saved ${count} ${input.marketType} rows for ${input.sport.toUpperCase()}.`);
