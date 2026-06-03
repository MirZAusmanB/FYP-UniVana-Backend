function adminAuth(req, res, next) {
  const role = req.user?.role;
  if (role !== "admin" && role !== "superadmin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

module.exports = adminAuth;
