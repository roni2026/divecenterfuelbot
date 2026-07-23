function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

function login(req, res) {
  const { username, password } = req.body || {};
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    req.session.user = username;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
}

function logout(req, res) {
  req.session = null;
  res.json({ ok: true });
}

function me(req, res) {
  res.json({ loggedIn: !!(req.session && req.session.loggedIn) });
}

module.exports = { requireAuth, login, logout, me };
