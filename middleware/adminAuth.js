// Middleware: checks if the logged-in user is an admin OR superadmin.
// Must be used AFTER the auth middleware (which sets req.user).

function adminAuth(req, res, next) {
  const role = req.user?.role;
  if (role !== "admin" && role !== "superadmin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

module.exports = adminAuth;
