const { configured } = require('./_auth');
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ required: true, setupNeeded: false, configured: configured() });
};
