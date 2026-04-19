const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,         
  isVerified: { type: Boolean, default: false },
  role: { type: String, enum: ["user", "admin", "superadmin"], default: "user" },
  otp: String,
  otpExpires: Date,
});

module.exports = mongoose.model("User", userSchema);
