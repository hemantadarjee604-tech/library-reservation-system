const { Pool } = require('pg');
require('dotenv').config();

const hasUrl = Boolean(process.env.DATABASE_URL);
const poolConfig = hasUrl
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || 'library_reservation_db',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool({ ...poolConfig, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
pool.on('error', (err) => console.error('Unexpected PostgreSQL pool error:', err.message));
module.exports = pool;
