require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
(async () => {
  try {
    const email = (process.env.SEED_ADMIN_EMAIL || 'admin@library.local').toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (full_name,email,password_hash,role) VALUES ($1,$2,$3,'admin')
       ON CONFLICT (email) DO NOTHING`, ['Library Administrator', email, hash]
    );
    const categories = ['Computer Science', 'Mathematics', 'Economics', 'Literature', 'History'];
    for (const name of categories) await pool.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
    console.log(`Seed complete. Admin email: ${email}`);
    console.log('Initial password is set by SEED_ADMIN_PASSWORD or defaults to ChangeMe123!. Change it immediately after first login.');
  } catch (err) {
    console.error('Seeding failed:', err.message); process.exitCode = 1;
  } finally { await pool.end(); }
})();
