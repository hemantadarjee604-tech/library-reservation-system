
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

async function checkBooks() {
  try {
    const books = await pool.query(`
      SELECT id, title, author
      FROM public.books
      ORDER BY id
    `);

    const copies = await pool.query(`
      SELECT COUNT(*) AS total_copies
      FROM public.book_copies
    `);

    console.log('\n========== BOOK RECORDS ==========');
    console.table(books.rows);
    console.log('Total books:', books.rowCount);
    console.log('Total copies:', copies.rows[0].total_copies);
    console.log('==================================');

  } catch (error) {
    console.error('Database query failed:', error.message);
  } finally {
    await pool.end();
  }
}

checkBooks();
