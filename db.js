const { Pool } = require('pg');
const config = require('../config');

if (!config.databaseUrl) {
  // eslint-disable-next-line no-console
  console.warn(
    '[db] DATABASE_URL is not set. Set it to your Render Postgres connection string in .env'
  );
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseUrl && config.databaseUrl.includes('render.com')
    ? { rejectUnauthorized: false }
    : undefined,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
