
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const BOOKS_FILE = path.join(__dirname, '../data/books.json');
const COPIES_PER_BOOK = 2;
const BATCH_SIZE = 25;

async function processBatch(books, startIndex) {
  const client = await pool.connect();

  let imported = 0;
  let skipped = 0;
  let copiesCreated = 0;

  try {
    await client.query('BEGIN');

    for (let i = 0; i < books.length; i++) {
      const book = books[i];

      const {
        title,
        author,
        publisher = null,
        publication_year = null,
        description = null,
        isbn = null,
        category,
        shelf_location = null
      } = book;

      if (!title || !author || !category) {
        throw new Error(
          `Book ${startIndex + i + 1} is missing required information.`
        );
      }

      const year = publication_year == null || publication_year === ''
        ? null
        : Number(publication_year);

      if (year !== null &&
          (!Number.isInteger(year) || year < 1000 || year > 2200)) {
        throw new Error(`Invalid publication year: ${title}`);
      }

      const categoryResult = await client.query(
        `INSERT INTO categories (name)
         VALUES ($1)
         ON CONFLICT (name) DO UPDATE
         SET name = EXCLUDED.name
         RETURNING id`,
        [category]
      );

      const categoryId = categoryResult.rows[0].id;

      const existing = await client.query(
        `SELECT id FROM books
         WHERE LOWER(TRIM(title)) = LOWER(TRIM($1))
         AND LOWER(TRIM(author)) = LOWER(TRIM($2))
         LIMIT 1`,
        [title, author]
      );

      let bookId;

      if (existing.rowCount > 0) {
        bookId = existing.rows[0].id;
        skipped++;
      } else {
        const result = await client.query(
          `INSERT INTO books
           (isbn, title, author, publisher, publication_year,
            description, category_id, shelf_location)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            isbn || null,
            title,
            author,
            publisher,
            year,
            description,
            categoryId,
            shelf_location
          ]
        );

        bookId = result.rows[0].id;
        imported++;
      }

      for (let copy = 1; copy <= COPIES_PER_BOOK; copy++) {
        const barcode =
          `LIB-BOOK-${bookId}-${String(copy).padStart(2, '0')}`;

        const result = await client.query(
          `INSERT INTO book_copies (book_id, barcode, status)
           VALUES ($1, $2, 'available')
           ON CONFLICT (barcode) DO NOTHING`,
          [bookId, barcode]
        );

        copiesCreated += result.rowCount;
      }
    }

    await client.query('COMMIT');

    return { imported, skipped, copiesCreated };

  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback failed:', rollbackError.message);
    }

    throw error;

  } finally {
    client.release();
  }
}

async function importBooks() {
  if (!fs.existsSync(BOOKS_FILE)) {
    throw new Error('data/books.json was not found.');
  }

  const books = JSON.parse(fs.readFileSync(BOOKS_FILE, 'utf8'));

  if (!Array.isArray(books) || books.length === 0) {
    throw new Error('The books file is empty or invalid.');
  }

  let totalImported = 0;
  let totalSkipped = 0;
  let totalCopiesCreated = 0;

  try {
    console.log('Database:', process.env.DB_NAME);
    console.log('Books to process:', books.length);
    console.log('Batch size:', BATCH_SIZE);

    for (let start = 0; start < books.length; start += BATCH_SIZE) {
      const batch = books.slice(start, start + BATCH_SIZE);

      const result = await processBatch(batch, start);

      totalImported += result.imported;
      totalSkipped += result.skipped;
      totalCopiesCreated += result.copiesCreated;

      console.log(
        `Processed ${Math.min(start + batch.length, books.length)}/${books.length}`
      );
    }

    const totals = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM books) AS total_books,
        (SELECT COUNT(*) FROM book_copies) AS total_copies
    `);

    console.log('\n========== IMPORT COMPLETED ==========');
    console.log('New books imported:', totalImported);
    console.log('Existing books skipped:', totalSkipped);
    console.log('New copies created:', totalCopiesCreated);
    console.log('Total books:', totals.rows[0].total_books);
    console.log('Total copies:', totals.rows[0].total_copies);

  } finally {
    await pool.end();
  }
}

importBooks().catch(error => {
  console.error('\nIMPORT FAILED:', error.stack || error);
  process.exitCode = 1;
});
