const bcrypt = require('bcryptjs');
const pool = require('../config/db');

exports.showLogin = (req, res) => res.render('login', { title: 'Login' });
exports.showRegister = (req, res) => res.render('register', { title: 'Create account' });

exports.register = async (req, res, next) => {
  try {
    const fullName = String(req.body.full_name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const studentId = String(req.body.student_id || '').trim() || null;
    if (fullName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
      const message = 'Enter a valid name and email. Password must contain at least 8 characters.';
      if (req.originalUrl.startsWith('/api/')) return res.status(400).json({ error: message });
      req.session.flash = { type: 'error', message };
      return res.redirect('/register');
    }
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (full_name,email,password_hash,student_id,role) VALUES ($1,$2,$3,$4,'student') RETURNING id,full_name,email,role`,
      [fullName, email, hash, studentId]
    );
    req.session.user = result.rows[0];
    if (req.originalUrl.startsWith('/api/')) return res.status(201).json({ message: 'Account created successfully.', user: req.session.user });
    req.session.flash = { type: 'success', message: 'Account created successfully.' };
    res.redirect('/dashboard');
  } catch (err) {
    if (err.code === '23505') {
      const message = 'That email or student ID is already registered.';
      if (req.originalUrl.startsWith('/api/')) return res.status(409).json({ error: message });
      req.session.flash = { type: 'error', message };
      return res.redirect('/register');
    }
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const result = await pool.query('SELECT id,full_name,email,password_hash,role,is_active FROM users WHERE email=$1', [email]);
    const user = result.rows[0];
    if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
      if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Invalid email or password.' });
      req.session.flash = { type: 'error', message: 'Invalid email or password.' };
      return res.redirect('/login');
    }
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, full_name: user.full_name, email: user.email, role: user.role };
      if (req.originalUrl.startsWith('/api/')) return res.json({ message: 'Login successful.', user: req.session.user });
      const destination = req.session.returnTo || '/dashboard';
      delete req.session.returnTo;
      res.redirect(destination);
    });
  } catch (err) { next(err); }
};

exports.logout = (req, res, next) => req.session.destroy((err) => {
  if (err) return next(err);
  res.clearCookie('library.sid');
  if (req.originalUrl.startsWith('/api/')) return res.json({ message: 'Logged out.' });
  res.redirect('/login');
});
