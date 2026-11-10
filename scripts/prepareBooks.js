
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const CSV_FILE = path.join(__dirname, '../data/pg_catalog.csv');
const BOOKS_FILE = path.join(__dirname, '../data/books.json');

const TARGET_TOTAL = 1000;

const categoryRules = [
  { name: 'Computer Science', keywords: ['computer', 'programming', 'software', 'algorithm'] },
  { name: 'Mathematics', keywords: ['mathematics', 'algebra', 'geometry', 'arithmetic'] },
  { name: 'Science and Technology', keywords: ['science', 'physics', 'chemistry', 'biology', 'technology'] },
  { name: 'History', keywords: ['history', 'historical'] },
  { name: 'Biography and Autobiography', keywords: ['biography', 'autobiography', 'memoir'] },
  { name: 'Business and Economics', keywords: ['economics', 'business', 'commerce', 'finance'] },
  { name: 'Education', keywords: ['education', 'teaching', 'school'] },
  { name: 'Philosophy', keywords: ['philosophy', 'ethics', 'metaphysics'] },
  { name: 'Fiction', keywords: ['fiction', 'romance', 'adventure', 'mystery', 'novel'] },
  { name: 'Literature', keywords: ['literature', 'poetry', 'drama'] }
];

function normalize(value = '') {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function cleanAuthor(value = '') {
  // Keep the complete catalogue author field rather than inventing
  // or guessing individual author names.
  return value.trim();
}

function assignCategory(subjects = '') {
  const text = subjects.toLowerCase();

  for (const category of categoryRules) {
    if (category.keywords.some(keyword => text.includes(keyword))) {
      return category.name;
    }
  }

  return 'Literature';
}

function prepareBooks() {
  if (!fs.existsSync(CSV_FILE)) {
    throw new Error('data/pg_catalog.csv was not found.');
  }

  if (!fs.existsSync(BOOKS_FILE)) {
    throw new Error('data/books.json was not found.');
  }

  const csv = fs.readFileSync(CSV_FILE, 'utf8');

  const records = parse(csv, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true
  });

  const existingBooks = JSON.parse(
    fs.readFileSync(BOOKS_FILE, 'utf8')
  );

  const selected = [...existingBooks];

  const seen = new Set(
    existingBooks.map(book =>
      `${normalize(book.title)}|${normalize(book.author)}`
    )
  );

  for (const record of records) {
    if (selected.length >= TARGET_TOTAL) break;

    if (record.Language !== 'en') continue;
    if (record.Type !== 'Text') continue;

    const title = (record.Title || '').trim();
    const author = cleanAuthor(record.Authors || '');

    if (!title || !author) continue;

    const key = `${normalize(title)}|${normalize(author)}`;

    if (seen.has(key)) continue;

    seen.add(key);

    selected.push({
      title,
      author,
      publisher: null,
      publication_year: null,
      description: `English-language public-domain catalogue record from Project Gutenberg. Catalogue ID: ${record['Text#']}.`,
      isbn: null,
      category: assignCategory(record.Subjects || ''),
      shelf_location: null
    });
  }

  if (selected.length !== TARGET_TOTAL) {
    throw new Error(
      `Only ${selected.length} unique books were prepared. Expected ${TARGET_TOTAL}.`
    );
  }

  // Save the prepared catalogue.
  fs.writeFileSync(
    BOOKS_FILE,
    JSON.stringify(selected, null, 2),
    'utf8'
  );

  console.log('\n========== BOOK CATALOGUE PREPARED ==========');
  console.log('Total unique books:', selected.length);
  console.log('Existing books preserved:', existingBooks.length);
  console.log('New books added:', selected.length - existingBooks.length);
  console.log('Physical copies planned:', selected.length * 2);
  console.log('Output file: data/books.json');
  console.log('=============================================\n');
}

try {
  prepareBooks();
} catch (error) {
  console.error('Preparation failed:', error.message);
  process.exitCode = 1;
}
