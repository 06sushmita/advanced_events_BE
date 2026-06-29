const { verifyToken } = require("../utils/jwt");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: "Sign in to continue." });
  }

  try {
    const payload = verifyToken(token);
    req.user = payload; // { id, name, email, role }
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Your session expired. Sign in again." });
  }
}

/** Use after requireAuth: requireRole("admin") or requireRole("admin", "staff"). */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "You don't have permission to do that." });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
