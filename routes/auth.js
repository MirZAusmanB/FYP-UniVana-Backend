const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const User = require("../models/user");
const auth = require("../middleware/auth"); 
require("dotenv").config();

const router = express.Router();

// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  connectionTimeout: 15000,
  socketTimeout: 15000,
});

function sendMailWithTimeout(transporter, mailOptions, ms = 15000) {
  return Promise.race([
    transporter.sendMail(mailOptions),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("SMTP timeout")), ms)
    ),
  ]);
}

router.post("/send-otp", async (req, res) => {
  const { email } = req.body;

  try {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = Date.now() + 10 * 60 * 1000;

    let user = await User.findOne({ email });
    if (!user) user = new User({ email });

    user.otp = otp;
    user.otpExpires = otpExpires;
    await user.save();

    console.log("OTP API hit:", email);

    const mailOptions = {
      from: `"UniVana" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your OTP Code",
      text: `Your OTP is ${otp}. It expires in 10 minutes.`,
    };

    await sendMailWithTimeout(transporter, mailOptions, 15000);

    return res.status(200).json({ message: "OTP sent to email" });
  } catch (err) {
    console.error("OTP failed:", err);
    return res.status(500).json({ message: err.message || "OTP failed" });
  }
});


router.post("/signup", async (req, res) => {
  const {name, email, password, otp} = req.body
  try {
    const user = await User.findOne({email})
    if (!user) {
      return res.status(400).json({message:"No OTP requested for this email"})
    }
    if(user.isVerified){
      return res.status(400).json({message:"User Already Existed"})
    }
    if (user.otp !== otp) {
      return res.status(400).json({message:"Invalid OTP"})
    }
    if(user.otpExpires < Date.now)
    {
      return res.status(400).json({message:"OTP Expires"})
    }

    const hashed = await bcrypt.hash(password, 10)
    user.name = name;
    user.password = hashed;
    user.otp = undefined;
    user.otpExpires = undefined;
    user.isVerified = true
    await user.save();
    res.json({message: "Signup successful! You can now log in."})
  } catch (error) {
    res.status(500).json({message: error.message})
  }
});

router.post("/login", async (req, res) =>{
  if (!req.body) {
    return res.status(400).json({message: "Request body is empty"})
  }
  const {email, password} = req.body
  try {
    const user = await User.findOne({email})
    if (!user) {
      return res.status(400).json({message:"User not found"})
    }
    if (!user.isVerified) {
      return res.status(400).json({message:"User is not Verified"})
    }

    const match = await bcrypt.compare(password, user.password)
    if(!match){
      return res.status(400).json({message:"Invalid email or password"})
    }

    const univanaAuthToken = jwt.sign(
      {id: user._id, email: user.email, name: user.name},
      process.env.JWT_SECRET,
      {expiresIn: "2h"}
    )

    res.cookie("univanaAuthToken",univanaAuthToken,{
      httpOnly: true,
      maxAge: 2 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    })

    res.json({message: "Login Successful"})

  } catch (error) {
     res.status(500).json({ message: error.message });
  }
})

router.post("/logout", async(req, res) =>{
  res.clearCookie("univanaAuthToken",{
    httpOnly:true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  })
  res.status(200).json({ message: "Logged out" });
})

router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password -otp -otpExpires");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/forgot-password",async (req,res) =>{
  const {email} = req.body
  try {
    const user = await User.findOne({email})
    if (!user) {
      return res.status(400).json({message:"No account found with this email"})
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = Date.now() + 10 * 60 * 1000
    
    user.otp = otp
    user.otpExpires = otpExpires
    await user.save()

    await transporter.sendMail({
      from: `"UniVana" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Reset Your UniVana Password",
      text: `Your password reset OTP is ${otp}. It expires in 10 minutes.`,
    });
    
    res.json({ message: "Password reset OTP sent to email" });

  } catch (error) {
      res.status(500).json({ message: error.message });
  }
})

router.post("/reset-password", async (req, res)=>{
  const {email, newPassword, otp} = req.body

  try {
    const user = await User.findOne({email})
    if (!user) {
      return res.status(400).json({message: "Invalid email"})
    }
    if (otp !== user.otp) {
      return res.status(400).json({message: "Invalid OTP"})
    }
    if (Date.now > user.otpExpires) {
      return res.status(400).json({ message: "OTP expired" });
    }

    const hashed = await bcrypt.hash(newPassword, 10)

    user.password = hashed
    user.otp = undefined
    user.otpExpires = undefined
    user.save()

    res.json({ message: "Password successfully reset!" });
  } catch (error) {
      res.status(500).json({ message: error.message });
  }
})

module.exports = router;
