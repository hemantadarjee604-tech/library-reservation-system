const express = require('express');
const pool = require('../config/db');
const auth = require('../controllers/authController');
const { requireAuth, requireRole } = require('../middleware/auth');
const service = require('../services/libraryService');
const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const books = await pool.query(`SELECT b.id,b.title,b.author,b.isbn,c.name AS category,
      COUNT(cp.id) FILTER (WHERE cp.status='available')::int AS available_copies
      FROM books b LEFT JOIN categories c ON c.id=b.category_id LEFT JOIN book_copies cp ON cp.book_id=b.id
      WHERE b.is_active=true GROUP BY b.id,c.name ORDER BY b.title LIMIT 12`);
    res.render('home', { title: 'Library Catalogue', books: books.rows });
  } catch (e) { next(e); }
});
router.get('/login', auth.showLogin);
router.post('/login', auth.login);
router.get('/register', auth.showRegister);
router.post('/register', auth.register);
router.post('/logout', auth.logout);

router.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    const isStaff = ['admin','librarian'].includes(req.session.user.role);
    const [books, reservations, loans, overdue] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM books WHERE is_active=true'),
      pool.query("SELECT COUNT(*)::int AS count FROM reservations WHERE status IN ('waiting','ready')"),
      pool.query("SELECT COUNT(*)::int AS count FROM loans WHERE status='borrowed'"),
      pool.query("SELECT COUNT(*)::int AS count FROM loans WHERE status='borrowed' AND due_at<NOW()")
    ]);
    const mine = await pool.query(`SELECT r.id,r.status,r.created_at,b.title,b.author,r.expires_at FROM reservations r JOIN books b ON b.id=r.book_id WHERE r.user_id=$1 AND r.status IN ('waiting','ready') ORDER BY r.created_at DESC LIMIT 8`, [req.session.user.id]);
    res.render('dashboard', { title: 'Dashboard', stats: { books: books.rows[0].count, reservations: reservations.rows[0].count, loans: loans.rows[0].count, overdue: overdue.rows[0].count }, mine: mine.rows, isStaff });
  } catch (e) { next(e); }
});

router.get('/books', async (req, res, next) => {
  try {
    const search = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();
    const params = [];
    let where = 'WHERE b.is_active=true';
    if (search) { params.push(`%${search}%`); where += ` AND (b.title ILIKE $${params.length} OR b.author ILIKE $${params.length} OR COALESCE(b.isbn,'') ILIKE $${params.length})`; }
    if (category && /^\d+$/.test(category)) { params.push(Number(category)); where += ` AND b.category_id=$${params.length}`; }
    const [books, categories] = await Promise.all([
      pool.query(`SELECT b.*,c.name AS category,COUNT(cp.id) FILTER (WHERE cp.status='available')::int AS available_copies,
        COUNT(cp.id)::int AS total_copies FROM books b LEFT JOIN categories c ON c.id=b.category_id LEFT JOIN book_copies cp ON cp.book_id=b.id ${where} GROUP BY b.id,c.name ORDER BY b.title`, params),
      pool.query('SELECT id,name FROM categories ORDER BY name')
    ]);
    res.render('books', { title: 'Books', books: books.rows, categories: categories.rows, q: search, selectedCategory: category });
  } catch (e) { next(e); }
});
router.get('/books/new', requireRole('admin','librarian'), async (req,res,next) => {
  try { const cats=await pool.query('SELECT id,name FROM categories ORDER BY name'); res.render('book-form',{title:'Add book',book:null,categories:cats.rows}); } catch(e){next(e);}
});
router.post('/books', requireRole('admin','librarian'), async (req,res,next) => {
  const client = await pool.connect();
  try {
    const { isbn,title,author,publisher,publication_year,description,category_id,shelf_location,copy_count } = req.body;
    if (!String(title||'').trim() || !String(author||'').trim()) throw new Error('Book title and author are required.');
    const count = Number(copy_count || 1);
    if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error('Copy count must be between 1 and 500.');
    await client.query('BEGIN');
    const result = await client.query(`INSERT INTO books(isbn,title,author,publisher,publication_year,description,category_id,shelf_location)
      VALUES(NULLIF($1,''),$2,$3,NULLIF($4,''),NULLIF($5,'')::int,NULLIF($6,''),NULLIF($7,'')::bigint,NULLIF($8,'')) RETURNING id`,
      [isbn||'',String(title).trim(),String(author).trim(),publisher||'',publication_year||'',description||'',category_id||'',shelf_location||'']);
    for (let i=1;i<=count;i++) await client.query('INSERT INTO book_copies(book_id,barcode) VALUES($1,$2)',[result.rows[0].id,`BK-${result.rows[0].id}-${String(i).padStart(4,'0')}`]);
    await client.query('COMMIT');
    req.session.flash={type:'success',message:`Book added with ${count} physical copy/copies.`}; res.redirect('/books');
  } catch(e) { await client.query('ROLLBACK').catch(()=>{}); if(e.code==='23505') {req.session.flash={type:'error',message:'That ISBN or barcode already exists.'}; return res.redirect('/books/new');} req.session.flash={type:'error',message:e.message};res.redirect('/books/new'); }
  finally {client.release();}
});
router.get('/books/:id/edit', requireRole('admin','librarian'), async (req,res,next) => {
  try {
    const [book,cats]=await Promise.all([
      pool.query('SELECT * FROM books WHERE id=$1 AND is_active=true',[req.params.id]),
      pool.query('SELECT id,name FROM categories ORDER BY name')
    ]);
    if(!book.rowCount) return res.status(404).render('error',{title:'Not found',message:'Book not found.'});
    res.render('book-edit',{title:'Edit book',book:book.rows[0],categories:cats.rows});
  } catch(e){next(e);}
});
router.post('/books/:id/edit', requireRole('admin','librarian'), async (req,res,next) => {
  try {
    const {isbn,title,author,publisher,publication_year,description,category_id,shelf_location}=req.body;
    if(!String(title||'').trim()||!String(author||'').trim()) throw new Error('Book title and author are required.');
    await pool.query(`UPDATE books SET isbn=NULLIF($1,''),title=$2,author=$3,publisher=NULLIF($4,''),publication_year=NULLIF($5,'')::int,description=NULLIF($6,''),category_id=NULLIF($7,'')::bigint,shelf_location=NULLIF($8,''),updated_at=NOW() WHERE id=$9 AND is_active=true`,[isbn||'',String(title).trim(),String(author).trim(),publisher||'',publication_year||'',description||'',category_id||'',shelf_location||'',req.params.id]);
    req.session.flash={type:'success',message:'Book details updated.'};res.redirect('/books/'+req.params.id);
  } catch(e){req.session.flash={type:'error',message:e.code==='23505'?'That ISBN is already used by another book.':e.message};res.redirect('/books/'+req.params.id+'/edit');}
});
router.post('/books/:id/archive', requireRole('admin'), async(req,res,next)=>{
  try{const active=await pool.query("SELECT COUNT(*)::int AS count FROM book_copies WHERE book_id=$1 AND status IN ('issued','reserved')",[req.params.id]);if(active.rows[0].count)throw new Error('Cannot archive this title while copies are issued or reserved.');await pool.query('UPDATE books SET is_active=false,updated_at=NOW() WHERE id=$1',[req.params.id]);req.session.flash={type:'success',message:'Book removed from the public catalogue.'};}
  catch(e){req.session.flash={type:'error',message:e.message};}res.redirect('/books');
});

router.get('/books/:id', async (req,res,next) => {
  try {
    const [book,copies]=await Promise.all([
      pool.query(`SELECT b.*,c.name AS category FROM books b LEFT JOIN categories c ON c.id=b.category_id WHERE b.id=$1 AND b.is_active=true`,[req.params.id]),
      pool.query('SELECT status,COUNT(*)::int AS count FROM book_copies WHERE book_id=$1 GROUP BY status',[req.params.id])
    ]);
    if(!book.rowCount) return res.status(404).render('error',{title:'Not found',message:'Book not found.'});
    res.render('book-detail',{title:book.rows[0].title,book:book.rows[0],copies:copies.rows});
  } catch(e){next(e);}
});
router.post('/books/:id/reserve', requireAuth, async (req,res,next) => {
  try { const result=await service.reserveBook(req.session.user.id,req.params.id); req.session.flash={type:'success',message:result.message};res.redirect('/reservations'); }
  catch(e){req.session.flash={type:'error',message:e.message};res.redirect('/books/'+req.params.id);}
});
router.get('/reservations', requireAuth, async (req,res,next) => {
  try {
    const isStaff=['admin','librarian'].includes(req.session.user.role);
    const sql=`SELECT r.*,b.title,b.author,u.full_name,u.email,cp.barcode FROM reservations r JOIN books b ON b.id=r.book_id JOIN users u ON u.id=r.user_id LEFT JOIN book_copies cp ON cp.id=r.copy_id ${isStaff?'':'WHERE r.user_id=$1'} ORDER BY CASE r.status WHEN 'ready' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END,r.created_at DESC LIMIT 300`;
    const result=await pool.query(sql,isStaff?[]:[req.session.user.id]);
    res.render('reservations',{title:'Reservations',reservations:result.rows,isStaff});
  } catch(e){next(e);}
});
router.post('/reservations/:id/cancel', requireAuth, async (req,res,next) => {
  try { await service.cancelReservation(req.session.user.id,req.params.id,['admin','librarian'].includes(req.session.user.role));req.session.flash={type:'success',message:'Reservation cancelled.'}; }
  catch(e){req.session.flash={type:'error',message:e.message};} res.redirect('/reservations');
});
router.post('/reservations/:id/collect', requireRole('admin','librarian'), async (req,res,next) => {
  try {await service.collectReservation(req.params.id,req.session.user.id);req.session.flash={type:'success',message:'Book collection recorded and loan created.'};}
  catch(e){req.session.flash={type:'error',message:e.message};} res.redirect('/reservations');
});
router.get('/loans', requireAuth, async (req,res,next) => {
  try {
    const isStaff=['admin','librarian'].includes(req.session.user.role);
    const result=await pool.query(`SELECT l.*,b.title,b.author,cp.barcode,u.full_name,u.email,CASE WHEN l.status='borrowed' AND l.due_at<NOW() THEN true ELSE false END AS is_overdue FROM loans l JOIN books b ON b.id=l.book_id JOIN book_copies cp ON cp.id=l.copy_id JOIN users u ON u.id=l.user_id ${isStaff?'':'WHERE l.user_id=$1'} ORDER BY CASE WHEN l.status='borrowed' THEN 0 ELSE 1 END,l.due_at`,isStaff?[]:[req.session.user.id]);
    res.render('loans',{title:'Loans and Returns',loans:result.rows,isStaff});
  } catch(e){next(e);}
});
router.post('/loans/:id/return', requireRole('admin','librarian'), async (req,res,next) => {
  try {await service.returnLoan(req.params.id,req.session.user.id);req.session.flash={type:'success',message:'Book returned successfully.'};}
  catch(e){req.session.flash={type:'error',message:e.message};} res.redirect('/loans');
});
router.get('/categories', requireRole('admin','librarian'), async(req,res,next)=>{
  try{const result=await pool.query('SELECT c.*,COUNT(b.id)::int AS book_count FROM categories c LEFT JOIN books b ON b.category_id=c.id GROUP BY c.id ORDER BY c.name');res.render('categories',{title:'Categories',categories:result.rows});}catch(e){next(e);}
});
router.post('/categories', requireRole('admin','librarian'), async(req,res,next)=>{
  try{const name=String(req.body.name||'').trim();if(name.length<2)throw new Error('Category name must have at least 2 characters.');await pool.query('INSERT INTO categories(name,description) VALUES($1,NULLIF($2,\'\'))',[name,req.body.description||'']);req.session.flash={type:'success',message:'Category created.'};}
  catch(e){req.session.flash={type:'error',message:e.code==='23505'?'That category already exists.':e.message};}res.redirect('/categories');
});
router.get('/users', requireRole('admin'), async(req,res,next)=>{
  try{const result=await pool.query('SELECT id,full_name,email,role,student_id,is_active,created_at FROM users ORDER BY created_at DESC');res.render('users',{title:'Users',users:result.rows});}catch(e){next(e);}
});
router.post('/users/:id/role', requireRole('admin'), async(req,res,next)=>{
  try{const role=req.body.role;if(!['admin','librarian','student'].includes(role))throw new Error('Invalid role.');if(String(req.params.id)===String(req.session.user.id)&&role!=='admin')throw new Error('You cannot remove your own admin role.');await pool.query('UPDATE users SET role=$1 WHERE id=$2',[role,req.params.id]);req.session.flash={type:'success',message:'User role updated.'};}
  catch(e){req.session.flash={type:'error',message:e.message};}res.redirect('/users');
});
router.get('/reports', requireRole('admin','librarian'), async(req,res,next)=>{
  try{
    const [inventory,lowStock,overdue,issued,queue]=await Promise.all([
      pool.query(`SELECT b.id,b.title,b.author,COUNT(cp.id)::int AS total_copies,COUNT(cp.id) FILTER(WHERE cp.status='available')::int AS available,COUNT(cp.id) FILTER(WHERE cp.status='issued')::int AS issued FROM books b LEFT JOIN book_copies cp ON cp.book_id=b.id WHERE b.is_active=true GROUP BY b.id ORDER BY b.title`),
      pool.query(`SELECT b.title,b.author,COUNT(cp.id)::int AS available FROM books b LEFT JOIN book_copies cp ON cp.book_id=b.id AND cp.status='available' WHERE b.is_active=true GROUP BY b.id HAVING COUNT(cp.id) FILTER(WHERE cp.status='available')<=1 ORDER BY available,b.title`),
      pool.query(`SELECT l.id,l.due_at,b.title,u.full_name,u.email,cp.barcode FROM loans l JOIN books b ON b.id=l.book_id JOIN users u ON u.id=l.user_id JOIN book_copies cp ON cp.id=l.copy_id WHERE l.status='borrowed' AND l.due_at<NOW() ORDER BY l.due_at`),
      pool.query(`SELECT l.id,l.issued_at,l.due_at,b.title,u.full_name,cp.barcode FROM loans l JOIN books b ON b.id=l.book_id JOIN users u ON u.id=l.user_id JOIN book_copies cp ON cp.id=l.copy_id WHERE l.status='borrowed' ORDER BY l.due_at`),
      pool.query(`SELECT r.id,r.created_at,b.title,u.full_name FROM reservations r JOIN books b ON b.id=r.book_id JOIN users u ON u.id=r.user_id WHERE r.status='waiting' ORDER BY r.created_at`)
    ]);
    res.render('reports',{title:'Reports',inventory:inventory.rows,lowStock:lowStock.rows,overdue:overdue.rows,issued:issued.rows,queue:queue.rows});
  }catch(e){next(e);}
});
module.exports=router;
