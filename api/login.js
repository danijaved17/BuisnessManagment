const { login } = require('./_auth');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const r = await login(req);
  res.status(r.code).json(r.body);
};
