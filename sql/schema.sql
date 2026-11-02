CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (role IN ('admin','librarian','student')),
  student_id VARCHAR(40) UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS books (
  id BIGSERIAL PRIMARY KEY,
  isbn VARCHAR(20) UNIQUE,
  title VARCHAR(250) NOT NULL,
  author VARCHAR(180) NOT NULL,
  publisher VARCHAR(180),
  publication_year INTEGER CHECK (publication_year IS NULL OR publication_year BETWEEN 1000 AND 2200),
  description TEXT,
  category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
  shelf_location VARCHAR(80),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS book_copies (
  id BIGSERIAL PRIMARY KEY,
  book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  barcode VARCHAR(80) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available','reserved','issued','maintenance','lost')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reservations (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  copy_id BIGINT REFERENCES book_copies(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL CHECK (status IN ('waiting','ready','fulfilled','cancelled','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS loans (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  copy_id BIGINT NOT NULL REFERENCES book_copies(id) ON DELETE RESTRICT,
  issued_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ NOT NULL,
  returned_at TIMESTAMPTZ,
  returned_to BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'borrowed' CHECK (status IN ('borrowed','returned'))
);

CREATE INDEX IF NOT EXISTS idx_books_title_author ON books (title, author);
CREATE INDEX IF NOT EXISTS idx_copies_book_status ON book_copies (book_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_user_status ON reservations (user_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_queue ON reservations (book_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_loans_user_status ON loans (user_id, status);
CREATE INDEX IF NOT EXISTS idx_loans_due_at ON loans (due_at) WHERE status = 'borrowed';

-- Only one active reservation per user per title; history remains in the table.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_reservation_per_user_book
ON reservations (user_id, book_id) WHERE status IN ('waiting','ready');
