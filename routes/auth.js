import "dotenv/config";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

import { OAuth2Client } from "google-auth-library";

const router = express.Router();

const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Token formatı hatalı veya yok" });
  }

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: "Kullanıcı bulunamadı" });
    }

    req.user = user;
    req.userId = decoded.id;
    req.isPremium = decoded.isPremium || false;

    next();
  } catch (err) {
    return res.status(401).json({ error: "Geçersiz token" });
  }
};

/* =======================
   CONFIG
======================= */
const GOOGLE_WEB_CLIENT_ID =
  process.env.GOOGLE_WEB_CLIENT_ID ||
  "472876253224-c5cf3sobe1sd2eh8k1h2jikggentkdjd.apps.googleusercontent.com";

const GOOGLE_WEB_CLIENT_SECRET = process.env.GOOGLE_WEB_CLIENT_SECRET;

// Render domain / callback route'un
const GOOGLE_REDIRECT_URI =
  "https://moodflix-server.onrender.com/api/auth/google/callback";

// Deep link (app'e dönüş)
const APP_DEEPLINK = "aimovie://login-callback";

const oauth2Client = new OAuth2Client(
  GOOGLE_WEB_CLIENT_ID,
  GOOGLE_WEB_CLIENT_SECRET
);

/* =======================
   REGISTER (LOCAL)
======================= */
router.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name)
      return res.status(400).json({ message: "Missing fields" });

    const exists = await User.findOne({ email });
    if (exists)
      return res.status(400).json({ message: "User already exists" });

    const hash = await bcrypt.hash(password, 10);

    const user = await User.create({
      email,
      password: hash,
      name,
      authProvider: "local",
    });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({ token });
  } catch (e) {
  console.error("REGISTER ERROR FULL:", e);
  res.status(500).json({ message: e.message || "REGISTER_FAILED" });
  }
});

/* =======================
   LOGIN (LOCAL)
======================= */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user || user.authProvider !== "local")
      return res.status(400).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password || "");
    if (!ok)
      return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({ token });
  } catch (e) {
    console.error("LOGIN ERROR:", e);
    res.status(500).json({ message: "LOGIN_FAILED" });
  }
});

/* =====================================================
   🚀 GOOGLE LOGIN START
===================================================== */
router.get("/google/start", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["profile", "email"],
    prompt: "select_account",
    redirect_uri: GOOGLE_REDIRECT_URI,
  });

  res.redirect(url);
});

/* =====================================================
   🔁 GOOGLE CALLBACK
===================================================== */
router.get("/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.redirect(`${APP_DEEPLINK}?reason=NO_CODE`);

    const { tokens } = await oauth2Client.getToken({
      code,
      redirect_uri: GOOGLE_REDIRECT_URI,
    });

    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_WEB_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload?.email;
    if (!email) return res.redirect(`${APP_DEEPLINK}?reason=NO_EMAIL`);

    // Eğer local hesap varsa, google login engelle
    const localUser = await User.findOne({ email, authProvider: "local" });
    if (localUser) {
      return res.redirect(
        `${APP_DEEPLINK}?reason=EMAIL_REGISTERED_WITH_PASSWORD`
      );
    }

    let user = await User.findOne({ email, authProvider: "google" });

    if (!user) {
      user = await User.create({
        email,
        name: payload?.name || "Google User",
        authProvider: "google",
      });
    }

    const jwtToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    return res.redirect(
      `${APP_DEEPLINK}?token=${encodeURIComponent(jwtToken)}`
    );
  } catch (err) {
    console.error("GOOGLE CALLBACK ERROR:", err);
    res.redirect(`${APP_DEEPLINK}?reason=ERROR`);
  }
});

router.get("/me", authMiddleware, async (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
    },
  });
});

router.get("/test", (req, res) => {
  res.json({ ok: true, message: "Auth route çalışıyor" });
});


export default router;
