const pool = require('../config/db');

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function reserveBook(userId, bookId) {
  return inTransaction(async (client) => {
    const bookResult = await client.query('SELECT id, title, is_active FROM books WHERE id = $1 FOR UPDATE', [bookId]);
    if (!bookResult.rowCount || !bookResult.rows[0].is_active) throw new Error('Book not found or not available for reservation.');
    const duplicate = await client.query(
      `SELECT id FROM reservations WHERE user_id = $1 AND book_id = $2 AND status IN ('waiting','ready')`,
      [userId, bookId]
    );
    if (duplicate.rowCount) throw new Error('You already have an active reservation for this book.');

    const loanCount = await client.query("SELECT COUNT(*)::int AS count FROM loans WHERE user_id = $1 AND status = 'borrowed'", [userId]);
    if (loanCount.rows[0].count >= Number(process.env.MAX_ACTIVE_LOANS || 5)) throw new Error('You have reached the maximum number of active loans. Return a book before collecting another.');

    const copy = await client.query(
      `SELECT id FROM book_copies WHERE book_id = $1 AND status = 'available' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [bookId]
    );
    if (copy.rowCount) {
      const inserted = await client.query(
        `INSERT INTO reservations (user_id, book_id, copy_id, status, ready_at, expires_at)
         VALUES ($1, $2, $3, 'ready', NOW(), NOW() + ($4 * INTERVAL '1 hour')) RETURNING *`,
        [userId, bookId, copy.rows[0].id, Number(process.env.RESERVATION_HOLD_HOURS || 48)]
      );
      await client.query("UPDATE book_copies SET status = 'reserved' WHERE id = $1", [copy.rows[0].id]);
      return { ...inserted.rows[0], message: 'Reservation confirmed. Please collect it before the hold expires.' };
    }
    const inserted = await client.query(
      `INSERT INTO reservations (user_id, book_id, status) VALUES ($1, $2, 'waiting') RETURNING *`, [userId, bookId]
    );
    return { ...inserted.rows[0], message: 'No copy is currently available. You have been added to the waiting list.' };
  });
}

async function cancelReservation(userId, reservationId, isStaff = false) {
  return inTransaction(async (client) => {
    const query = `SELECT * FROM reservations WHERE id = $1 ${isStaff ? '' : 'AND user_id = $2'} FOR UPDATE`;
    const params = isStaff ? [reservationId] : [reservationId, userId];
    const result = await client.query(query, params);
    if (!result.rowCount) throw new Error('Reservation not found.');
    const reservation = result.rows[0];
    if (!['waiting', 'ready'].includes(reservation.status)) throw new Error('Only waiting or ready reservations can be cancelled.');
    await client.query("UPDATE reservations SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1", [reservationId]);
    if (reservation.copy_id) {
      await client.query("UPDATE book_copies SET status = 'available' WHERE id = $1 AND status = 'reserved'", [reservation.copy_id]);
      await promoteWaitingReservation(client, reservation.book_id, reservation.copy_id);
    }
    return { ...reservation, status: 'cancelled' };
  });
}

async function promoteWaitingReservation(client, bookId, copyId) {
  const waiting = await client.query(
    `SELECT id FROM reservations WHERE book_id = $1 AND status = 'waiting' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`, [bookId]
  );
  if (!waiting.rowCount) return;
  const reservationId = waiting.rows[0].id;
  await client.query(
    `UPDATE reservations SET copy_id = $1, status = 'ready', ready_at = NOW(), expires_at = NOW() + ($2 * INTERVAL '1 hour') WHERE id = $3`,
    [copyId, Number(process.env.RESERVATION_HOLD_HOURS || 48), reservationId]
  );
  await client.query("UPDATE book_copies SET status = 'reserved' WHERE id = $1", [copyId]);
}

async function collectReservation(reservationId, staffId) {
  const result = await inTransaction(async (client) => {
    const found = await client.query('SELECT * FROM reservations WHERE id = $1 FOR UPDATE', [reservationId]);
    if (!found.rowCount) throw new Error('Reservation not found.');
    const reservation = found.rows[0];
    if (reservation.status !== 'ready' || !reservation.copy_id) throw new Error('This reservation is not ready for collection.');
    if (reservation.expires_at && new Date(reservation.expires_at) < new Date()) {
      await client.query("UPDATE reservations SET status = 'expired' WHERE id = $1", [reservationId]);
      await client.query("UPDATE book_copies SET status = 'available' WHERE id = $1 AND status = 'reserved'", [reservation.copy_id]);
      await promoteWaitingReservation(client, reservation.book_id, reservation.copy_id);
      return { expired: true };
    }
    const count = await client.query("SELECT COUNT(*)::int AS count FROM loans WHERE user_id = $1 AND status = 'borrowed'", [reservation.user_id]);
    if (count.rows[0].count >= Number(process.env.MAX_ACTIVE_LOANS || 5)) throw new Error('This user has reached the maximum number of active loans.');
    const loanDays = Number(process.env.LOAN_DAYS || 14);
    const loan = await client.query(
      `INSERT INTO loans (user_id, book_id, copy_id, issued_by, issued_at, due_at, status)
       VALUES ($1, $2, $3, $4, NOW(), NOW() + ($5 * INTERVAL '1 day'), 'borrowed') RETURNING *`,
      [reservation.user_id, reservation.book_id, reservation.copy_id, staffId, loanDays]
    );
    await client.query("UPDATE reservations SET status = 'fulfilled', collected_at = NOW() WHERE id = $1", [reservationId]);
    await client.query("UPDATE book_copies SET status = 'issued' WHERE id = $1", [reservation.copy_id]);
    return loan.rows[0];
  });
  if (result && result.expired) throw new Error('The reservation hold has expired. The copy was released and the next waiting reservation was processed.');
  return result;
}

async function returnLoan(loanId, staffId) {
  return inTransaction(async (client) => {
    const result = await client.query("SELECT * FROM loans WHERE id = $1 AND status = 'borrowed' FOR UPDATE", [loanId]);
    if (!result.rowCount) throw new Error('Active loan not found or it has already been returned.');
    const loan = result.rows[0];
    await client.query("UPDATE loans SET status = 'returned', returned_at = NOW(), returned_to = $2 WHERE id = $1", [loanId, staffId]);
    await client.query("UPDATE book_copies SET status = 'available' WHERE id = $1", [loan.copy_id]);
    await promoteWaitingReservation(client, loan.book_id, loan.copy_id);
    return { ...loan, status: 'returned' };
  });
}

module.exports = { inTransaction, reserveBook, cancelReservation, collectReservation, returnLoan };
