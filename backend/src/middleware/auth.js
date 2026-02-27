const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'genztech_jwt_secret_change_in_production';

function signToken(payload, expiresIn = '30d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Chưa đăng nhập hoặc token không hợp lệ' });
  }
  const token = auth.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.' });
  }
}

module.exports = { authMiddleware, signToken };
