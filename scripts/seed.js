
require('dotenv').config();

const bcrypt = require('bcryptjs');
const pool = require('../config/db');

(async () => {
  try {
    const email = process.env.SEED_ADMIN_EMAIL;
    const password = process.env.SEED_ADMIN_PASSWORD;

    if (!email || !password) {
      throw new Error(
        'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be configured.'
      );
    }

    if (password.length < 12) {
      throw new Error(
        'Administrator password must be at least 12 characters.'
      );
    }

    const hash = await bcrypt.hash(password, 12);

    await pool.query(
      `INSERT INTO users
       (full_name, email, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email) DO NOTHING`,
      ['Library Administrator', email.toLowerCase(), hash]
    );

    const categories = [
      'Computer Science',
      'Mathematics',
      'Economics',
      'Literature',
      'History'
    ];

    for (const name of categories) {
      await pool.query(
        `INSERT INTO categories (name)
         VALUES ($1)
         ON CONFLICT (name) DO NOTHING`,
        [name]
      );
    }

    console.log('Database seeding completed successfully.');

  } catch (err) {
    console.error('Seeding failed:', err.message);
    process.exitCode = 1;

  } finally {
    await pool.end();
  }
})();
