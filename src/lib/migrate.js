const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate() {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', '..', 'migrations', 'schema.sql'),
    'utf8'
  );
  await pool.query(sql);
  // eslint-disable-next-line no-console
  console.log('[migrate] Schema applied successfully.');
  await pool.end();
}

migrate().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
