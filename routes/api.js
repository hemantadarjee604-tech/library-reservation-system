const express = require('express');
const pool = require('../config/db');
const auth = require('../controllers/authController');
const { requireAuth, requireRole } = require('../middleware/auth');
const service = require('../services/libraryService');
const router = express.Router();

router.post('/auth/register', auth.register);
router.post('/auth/login', auth.login);
router.post('/auth/logout', requireAuth, auth.logout);
router.get('/auth/me', requireAuth, (req,res)=>res.json({user:req.session.user}));

router.get('/books', async(req,res,next)=>{
  try{
    const q=String(req.query.q||'').trim();
    const values=[];let where='WHERE b.is_active=true';
    if(q){values.push(`%${q}%`);where+=` AND (b.title ILIKE $1 OR b.author ILIKE $1 OR COALESCE(b.isbn,'') ILIKE $1)`;}
    const result=await pool.query(`SELECT b.id,b.isbn,b.title,b.author,b.publisher,b.publication_year,b.description,b.shelf_location,c.name AS category,COUNT(cp.id)::int AS total_copies,COUNT(cp.id) FILTER(WHERE cp.status='available')::int AS available_copies FROM books b LEFT JOIN categories c ON c.id=b.category_id LEFT JOIN book_copies cp ON cp.book_id=b.id ${where} GROUP BY b.id,c.name ORDER BY b.title`,values);
    res.json({count:result.rowCount,books:result.rows});
  }catch(e){next(e);}
});
router.get('/books/:id', async(req,res,next)=>{
  try{const result=await pool.query(`SELECT b.*,c.name AS category,COUNT(cp.id)::int AS total_copies,COUNT(cp.id) FILTER(WHERE cp.status='available')::int AS available_copies FROM books b LEFT JOIN categories c ON c.id=b.category_id LEFT JOIN book_copies cp ON cp.book_id=b.id WHERE b.id=$1 AND b.is_active=true GROUP BY b.id,c.name`,[req.params.id]);if(!result.rowCount)return res.status(404).json({error:'Book not found.'});res.json({book:result.rows[0]});}catch(e){next(e);}
});
router.post('/books', requireRole('admin','librarian'), async(req,res,next)=>{
  const {isbn,title,author,publisher,publication_year,description,category_id,shelf_location,copy_count}=req.body;
  if(!String(title||'').trim()||!String(author||'').trim())return res.status(400).json({error:'Title and author are required.'});
  const count=Number(copy_count||1);if(!Number.isInteger(count)||count<1||count>500)return res.status(400).json({error:'copy_count must be an integer from 1 to 500.'});
  const client=await pool.connect();try{await client.query('BEGIN');const result=await client.query(`INSERT INTO books(isbn,title,author,publisher,publication_year,description,category_id,shelf_location) VALUES(NULLIF($1,''),$2,$3,NULLIF($4,''),NULLIF($5,'')::int,NULLIF($6,''),NULLIF($7,'')::bigint,NULLIF($8,'')) RETURNING *`,[isbn||'',String(title).trim(),String(author).trim(),publisher||'',publication_year||'',description||'',category_id||'',shelf_location||'']);for(let i=1;i<=count;i++)await client.query('INSERT INTO book_copies(book_id,barcode) VALUES($1,$2)',[result.rows[0].id,`BK-${result.rows[0].id}-${String(i).padStart(4,'0')}`]);await client.query('COMMIT');res.status(201).json({message:'Book created.',book:result.rows[0],copies_created:count});}catch(e){await client.query('ROLLBACK').catch(()=>{});if(e.code==='23505')return res.status(409).json({error:'ISBN or barcode already exists.'});next(e);}finally{client.release();}
});
router.put('/books/:id', requireRole('admin','librarian'), async(req,res,next)=>{
  try{
    const {isbn,title,author,publisher,publication_year,description,category_id,shelf_location}=req.body;
    if(!String(title||'').trim()||!String(author||'').trim())return res.status(400).json({error:'Title and author are required.'});
    const result=await pool.query(`UPDATE books SET isbn=NULLIF($1,''),title=$2,author=$3,publisher=NULLIF($4,''),publication_year=NULLIF($5,'')::int,description=NULLIF($6,''),category_id=NULLIF($7,'')::bigint,shelf_location=NULLIF($8,''),updated_at=NOW() WHERE id=$9 AND is_active=true RETURNING *`,[isbn||'',String(title).trim(),String(author).trim(),publisher||'',publication_year||'',description||'',category_id||'',shelf_location||'',req.params.id]);
    if(!result.rowCount)return res.status(404).json({error:'Book not found.'});res.json({message:'Book updated.',book:result.rows[0]});
  }catch(e){if(e.code==='23505')return res.status(409).json({error:'ISBN is already used by another book.'});next(e);}
});
router.post('/books/:id/copies', requireRole('admin','librarian'), async(req,res,next)=>{
  try{const count=Number(req.body.count||1);if(!Number.isInteger(count)||count<1||count>500)return res.status(400).json({error:'count must be an integer from 1 to 500.'});const book=await pool.query('SELECT id FROM books WHERE id=$1 AND is_active=true',[req.params.id]);if(!book.rowCount)return res.status(404).json({error:'Book not found.'});const client=await pool.connect();try{await client.query('BEGIN');const max=await client.query("SELECT COALESCE(MAX(CAST(SPLIT_PART(barcode,'-',3) AS INTEGER)),0)::int AS n FROM book_copies WHERE book_id=$1",[req.params.id]);const start=max.rows[0].n;const created=[];for(let i=1;i<=count;i++){const r=await client.query('INSERT INTO book_copies(book_id,barcode) VALUES($1,$2) RETURNING id,book_id,barcode,status',[req.params.id,`BK-${req.params.id}-${String(start+i).padStart(4,'0')}`]);created.push(r.rows[0]);}await client.query('COMMIT');res.status(201).json({message:'Copies added.',copies:created});}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}}catch(e){next(e);}
});
router.post('/books/:id/reservations', requireAuth, async(req,res,next)=>{try{const reservation=await service.reserveBook(req.session.user.id,req.params.id);res.status(201).json({reservation});}catch(e){res.status(400).json({error:e.message});}});
router.get('/reservations', requireAuth, async(req,res,next)=>{try{const staff=['admin','librarian'].includes(req.session.user.role);const result=await pool.query(`SELECT r.*,b.title,b.author,u.full_name,u.email,cp.barcode FROM reservations r JOIN books b ON b.id=r.book_id JOIN users u ON u.id=r.user_id LEFT JOIN book_copies cp ON cp.id=r.copy_id ${staff?'':'WHERE r.user_id=$1'} ORDER BY r.created_at DESC`,staff?[]:[req.session.user.id]);res.json({count:result.rowCount,reservations:result.rows});}catch(e){next(e);}});
router.post('/reservations/:id/cancel', requireAuth, async(req,res,next)=>{try{const result=await service.cancelReservation(req.session.user.id,req.params.id,['admin','librarian'].includes(req.session.user.role));res.json({message:'Reservation cancelled.',reservation:result});}catch(e){res.status(400).json({error:e.message});}});
router.post('/reservations/:id/collect', requireRole('admin','librarian'), async(req,res,next)=>{try{const loan=await service.collectReservation(req.params.id,req.session.user.id);res.status(201).json({message:'Collection recorded.',loan});}catch(e){res.status(400).json({error:e.message});}});
router.get('/loans', requireAuth, async(req,res,next)=>{try{const staff=['admin','librarian'].includes(req.session.user.role);const result=await pool.query(`SELECT l.*,b.title,b.author,cp.barcode,u.full_name,u.email FROM loans l JOIN books b ON b.id=l.book_id JOIN book_copies cp ON cp.id=l.copy_id JOIN users u ON u.id=l.user_id ${staff?'':'WHERE l.user_id=$1'} ORDER BY l.issued_at DESC`,staff?[]:[req.session.user.id]);res.json({count:result.rowCount,loans:result.rows});}catch(e){next(e);}});
router.post('/loans/:id/return', requireRole('admin','librarian'), async(req,res,next)=>{try{const loan=await service.returnLoan(req.params.id,req.session.user.id);res.json({message:'Book returned.',loan});}catch(e){res.status(400).json({error:e.message});}});
router.get('/categories', async(req,res,next)=>{try{const result=await pool.query('SELECT id,name,description FROM categories ORDER BY name');res.json({categories:result.rows});}catch(e){next(e);}});
router.post('/categories', requireRole('admin','librarian'), async(req,res,next)=>{try{const name=String(req.body.name||'').trim();if(name.length<2)return res.status(400).json({error:'Category name must have at least 2 characters.'});const result=await pool.query('INSERT INTO categories(name,description) VALUES($1,$2) RETURNING *',[name,req.body.description||null]);res.status(201).json({category:result.rows[0]});}catch(e){if(e.code==='23505')return res.status(409).json({error:'Category already exists.'});next(e);}});
router.get('/reports/summary', requireRole('admin','librarian'), async(req,res,next)=>{try{const result=await pool.query(`SELECT (SELECT COUNT(*)::int FROM books WHERE is_active) AS titles,(SELECT COUNT(*)::int FROM book_copies) AS copies,(SELECT COUNT(*)::int FROM book_copies WHERE status='available') AS available_copies,(SELECT COUNT(*)::int FROM reservations WHERE status IN ('waiting','ready')) AS active_reservations,(SELECT COUNT(*)::int FROM loans WHERE status='borrowed') AS current_loans,(SELECT COUNT(*)::int FROM loans WHERE status='borrowed' AND due_at<NOW()) AS overdue_loans`);res.json({summary:result.rows[0]});}catch(e){next(e);}});
router.get('/users', requireRole('admin'), async(req,res,next)=>{try{const result=await pool.query('SELECT id,full_name,email,role,student_id,is_active,created_at FROM users ORDER BY created_at DESC');res.json({users:result.rows});}catch(e){next(e);}});
router.patch('/users/:id/role', requireRole('admin'), async(req,res,next)=>{try{const role=req.body.role;if(!['admin','librarian','student'].includes(role))return res.status(400).json({error:'Role must be admin, librarian, or student.'});if(String(req.params.id)===String(req.session.user.id)&&role!=='admin')return res.status(400).json({error:'You cannot remove your own admin role.'});const result=await pool.query('UPDATE users SET role=$1 WHERE id=$2 RETURNING id,full_name,email,role',[role,req.params.id]);if(!result.rowCount)return res.status(404).json({error:'User not found.'});res.json({user:result.rows[0]});}catch(e){next(e);}});
module.exports=router;
