import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const router = express.Router();

/* REGISTER */
router.post("/register", async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name)
    return res.status(400).json({ message: "Missing fields" });

  const exists = await User.findOne({ email });
  if (exists)
    return res.status(400).json({ message: "User already exists" });

  const hash = await bcrypt.hash(password, 10);
  const user = await User.create({ email, password: hash, name });

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.json({ token });
});

/* LOGIN */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user)
    return res.status(400).json({ message: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok)
    return res.status(400).json({ message: "Invalid credentials" });

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.json({ token });
});

export default router;
