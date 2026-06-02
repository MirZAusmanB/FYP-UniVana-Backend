function superAdminAuth(req, res, next) {
  if (req.user?.role !== "superadmin") {
    return res.status(403).json({ message: "Super admin access required" });
  }
  next();
}

module.exports = superAdminAuth;
