// Middleware: checks if the logged-in user is a superadmin.
// Must be used AFTER the auth middleware (which sets req.user).

function superAdminAuth(req, res, next) {
  if (req.user?.role !== "superadmin") {
    return res.status(403).json({ message: "Super admin access required" });
  }
  next();
}

module.exports = superAdminAuth;
