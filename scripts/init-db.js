require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
(async () => {
  try {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('Database tables and indexes created successfully.');
  } catch (err) {
    console.error('Database initialization failed:', err.message);
    process.exitCode = 1;
  } finally { await pool.end(); }
})();
