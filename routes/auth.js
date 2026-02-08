import "dotenv/config";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

import { OAuth2Client } from "google-auth-library";
import Post from "../models/Post.js";

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
const APP_DEEPLINK = "moodflix://login-callback";

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
   ❌ DELETE ACCOUNT
======================= */
router.delete("/delete", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;

    await User.findByIdAndDelete(userId);

    return res.json({
      success: true,
      message: "Hesap başarıyla silindi",
    });
  } catch (err) {
    console.error("DELETE ACCOUNT ERROR:", err);
    res.status(500).json({ message: "ACCOUNT_DELETE_FAILED" });
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
      isPremium: req.user.isPremium,
      dailyUsage: req.user.dailyUsage || null,
    },
  });
});

// routes/user.js veya auth.js içine ekle
router.get("/profile/:id", async (req, res) => {
  try {
    const targetUserId = req.params.id;

    // 1. Kullanıcıyı bul (followers ve following dizilerini de çekiyoruz)
    const user = await User.findById(targetUserId)
      .select("-password -email")
      .lean();

    if (!user) return res.status(404).json({ error: "User not found" });

    // 2. Postları bul
    const posts = await Post.find({ userId: targetUserId }).sort({ createdAt: -1 });

    // 3. Takip Kontrolü (Token varsa)
    let isFollowing = false;
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Kendi profilimizden bakıyorsak currentUser'ı çekip takip listesine bakıyoruz
        const currentUser = await User.findById(decoded.id).select("following");
        if (currentUser && currentUser.following) {
          isFollowing = currentUser.following.includes(targetUserId);
        }
      } catch (e) {
        console.log("Token verify error in profile:", e.message);
      }
    }

    // 4. Veriyi frontend'in beklediği formatta temizleyip gönder
    res.json({ 
      user: {
        ...user,
        followersCount: user.followers ? user.followers.length : 0,
        followingCount: user.following ? user.following.length : 0,
        favoritesCount: user.favorites ? user.favorites.length : 0,
        isFollowing 
      }, 
      posts 
    });
  } catch (e) {
    console.error("Profile route error:", e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/follow/:id", authMiddleware, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const currentUserId = req.userId;

    if (targetUserId === currentUserId.toString()) {
      return res.status(400).json({ error: "Kendinizi takip edemezsiniz" });
    }

    const targetUser = await User.findById(targetUserId);
    const currentUser = await User.findById(currentUserId);

    const isFollowing = currentUser.following.includes(targetUserId);

    if (isFollowing) {
      // Takibi bırak
      currentUser.following.pull(targetUserId);
      targetUser.followers.pull(currentUserId);
    } else {
      // Takip et
      currentUser.following.push(targetUserId);
      targetUser.followers.push(currentUserId);
    }

    await currentUser.save();
    await targetUser.save();

    res.json({ isFollowing: !isFollowing, count: targetUser.followers.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/test", (req, res) => {
  res.json({ ok: true, message: "Auth route çalışıyor" });
});


export default router;
