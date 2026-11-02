require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pool = require('./config/db');
const webRoutes = require('./routes/web');
const apiRoutes = require('./routes/api');

const app = express();
app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters in production.');
  console.warn('WARNING: Set a long random SESSION_SECRET in .env before deployment.');
}
app.use(session({
  name: 'library.sid',
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'local-development-secret-change-this-please',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 8 }
}));
app.use((req,res,next)=>{
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.currentPath = req.path;
  next();
});
app.get('/health', async (req,res)=>{
  try { await pool.query('SELECT 1'); res.json({status:'ok',database:'connected'}); }
  catch (_) { res.status(503).json({status:'error',database:'unavailable'}); }
});
app.use('/api', apiRoutes);
app.use('/', webRoutes);
app.use((req,res)=>{
  if(req.originalUrl.startsWith('/api/')) return res.status(404).json({error:'API endpoint not found.'});
  res.status(404).render('error',{title:'Page not found',message:'The page you requested does not exist.'});
});
app.use((err,req,res,next)=>{
  console.error(err.stack || err.message || err);
  if(req.originalUrl.startsWith('/api/')) return res.status(500).json({error: process.env.NODE_ENV === 'production' ? 'An unexpected server error occurred.' : err.message});
  res.status(500).render('error',{title:'Server error',message:process.env.NODE_ENV==='production'?'An unexpected error occurred. Please try again.':err.message});
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, ()=>console.log(`Library Reservation System running at ${process.env.APP_URL || `http://localhost:${port}`}`));
}
module.exports = app;
