function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Please log in first.' });
  req.session.returnTo = req.originalUrl;
  return res.redirect('/login');
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session?.user) {
      if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Please log in first.' });
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ error: 'You do not have permission to do this.' });
      req.session.flash = { type: 'error', message: 'You do not have permission to access that page.' };
      return res.redirect('/dashboard');
    }
    next();
  };
}
module.exports = { requireAuth, requireRole };
