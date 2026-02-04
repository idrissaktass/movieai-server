import express from "express";
import crypto from "crypto";
import WatchParty from "../models/WatchParty.js";
import User from "../models/User.js";
import jwt from "jsonwebtoken";
import OpenAI from "openai";
import fetch from "node-fetch";

const router = express.Router();

/* ================= AUTH ================= */

const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ error: "User not found" });

    req.user = user;
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
};

/* ================= OPENAI ================= */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function getWatchPartyMatches(host, guest) {
  const prompt = `
Two people want to watch a movie together.

Person A:
${JSON.stringify(host)}

Person B:
${JSON.stringify(guest)}

Task:
Recommend exactly 5 movies both people would enjoy together.

Rules:
- Balance both tastes
- Avoid extreme solo-type movies
- Focus on shared emotional experience
- Give each a match score (80–99)
- Short joint explanation

Return ONLY JSON, Do NOT add any extra text.
Format must be like this:
[
 { "title": "Movie name", "match": 92, "exp": "Why it fits both" }
]
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.8,
    messages: [{ role: "user", content: prompt }]
  });

  return JSON.parse(res.choices[0].message.content);
}

/* ================= TMDB ================= */

async function fetchFromTMDBByName(title) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(title)}`;
  const r = await fetch(url);
  const d = await r.json();
  return d.results?.[0] || null;
}

/* ================= ROUTES ================= */
// 1. ODA OLUŞTURMA (Burada sadece ön kontrol yapıyoruz, hak düşmüyoruz)
// routes/watchparty.js -> /create rotası

router.post("/create", authMiddleware, async (req, res) => {
  const WEEKLY_LIMIT = 3;
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  if (!req.user.isPremium) {
    if (!req.user.weeklyRoomUsage) {
      req.user.weeklyRoomUsage = { count: 0, lastResetDate: todayStr };
    }

    // Haftalık sıfırlama kontrolü
    const lastReset = new Date(req.user.weeklyRoomUsage.lastResetDate);
    const diffDays = Math.ceil(Math.abs(today - lastReset) / (1000 * 60 * 60 * 24));
    
    if (diffDays >= 7) {
      req.user.weeklyRoomUsage.count = 0;
      req.user.weeklyRoomUsage.lastResetDate = todayStr;
    }

    if (req.user.weeklyRoomUsage.count >= WEEKLY_LIMIT) {
      return res.status(403).json({ error: "Weekly limit reached", limitReached: true });
    }

    // 🔥 KRİTİK EKSİK BURASI: Sayacı artır ve kaydet
    req.user.weeklyRoomUsage.count += 1;
    req.user.markModified("weeklyRoomUsage"); // Obje içindeki değişiklikleri Mongoose'a bildir
    await req.user.save();
  }

  const code = crypto.randomBytes(3).toString("hex").toUpperCase();
  await WatchParty.create({ code, host: req.userId });

  // Güncel count değerini dön
  res.json({ code, weeklyCount: req.user.weeklyRoomUsage?.count || 0 });
});


router.post("/join/:code", authMiddleware, async (req, res) => {
  const party = await WatchParty.findOne({ code: req.params.code });
  if (!party) return res.status(404).json({ error: "Room not found" });

  if (party.host.toString() === req.userId)
    return res.status(400).json({ error: "Host cannot join as guest" });

  if (party.guest && party.guest.toString() !== req.userId)
    return res.status(400).json({ error: "Room full" });

  party.guest = req.userId;
  party.status = "answering";
  await party.save();

  res.json({ success: true });
});

router.post("/answers/:code", authMiddleware, async (req, res) => {
  const party = await WatchParty.findOne({ code: req.params.code });
  if (!party) return res.status(404).json({ error: "Room not found" });

  const isHost = party.host.toString() === req.userId;

  if (isHost) {
    party.hostAnswers = req.body;
    party.hostDone = true;
  } else {
    party.guestAnswers = req.body;
    party.guestDone = true;
  }

  if (party.hostDone && party.guestDone) {
    party.status = "ready";
  }

  await party.save();
  res.json({ ready: party.status === "ready" });
});

router.post("/generate/:code", authMiddleware, async (req, res) => {
  // 1. Odayı bul ve Host bilgilerini getir
  let party = await WatchParty.findOne({ code: req.params.code }).populate("host");

  if (!party) return res.status(404).json({ error: "Room not found" });

  // Eğer zaten üretilmişse sonucu dön (Hak düşmez)
  if (party.status === "done") {
    return res.json({ results: party.results });
  }

  // 2. 🛡️ HOST LİMİT KONTROLÜ
  const host = party.host;
  const DAILY_LIMIT = 3;
  const today = new Date().toISOString().slice(0, 10);

  // Premium değilse kontrol et
  if (!host.isPremium) {
    if (!host.dailyUsage) host.dailyUsage = { count: 0, date: today };

    if (host.dailyUsage.date !== today) {
      host.dailyUsage.date = today;
      host.dailyUsage.count = 0;
    }

    if (host.dailyUsage.count >= DAILY_LIMIT) {
      console.log("🚫 Host limit reached:", host.email);
      return res.json({ limitReached: true }); // Frontend bu "limitReached"i yakalayacak
    }
  }

  // 3. Status "generating" yap (Double request koruması)
  const lockedParty = await WatchParty.findOneAndUpdate(
    { code: req.params.code, status: "ready" },
    { status: "generating" },
    { new: true }
  ).populate("host guest");

  if (!lockedParty) return res.json({ loading: true });

  try {
    // 🧠 AI Üretimi
    const aiResults = await getWatchPartyMatches(
      { ...lockedParty.hostAnswers, taste: lockedParty.host.tasteProfile },
      { ...lockedParty.guestAnswers, taste: lockedParty.guest.tasteProfile }
    );

    let finalResults = [];
    for (const item of aiResults) {
      const movie = await fetchFromTMDBByName(item.title);
      if (!movie || !movie.poster_path) continue;
      finalResults.push({ ...movie, aiMatch: item.match, aiExp: item.exp });
    }

    finalResults = finalResults.slice(0, 5);

    // 4. ✅ BAŞARILI: Host'un hakkını düş ve odayı tamamla
    if (!host.isPremium) {
      host.dailyUsage.count += 1;
      host.markModified("dailyUsage");
      await host.save();
    }

    lockedParty.results = finalResults;
    lockedParty.status = "done";
    await lockedParty.save();

    return res.json({ results: finalResults });

  } catch (e) {
    console.error("AI ERROR:", e);
    await WatchParty.updateOne({ code: req.params.code }, { status: "ready" });
    return res.status(500).json({ error: "GENERATION_FAILED" });
  }
});

router.get("/status/:code", authMiddleware, async (req, res) => {
  const party = await WatchParty.findOne({ code: req.params.code });

  if (!party) return res.status(404).json({ error: "Room not found" });

  let count = 1;
  if (party.guest) count = 2;

  res.json({ members: count, status: party.status });
});

router.post("/close/:code", authMiddleware, async (req, res) => {
  const party = await WatchParty.findOne({ code: req.params.code });

  if (!party) return res.status(404).json({ error: "Room not found" });

  if (party.host.toString() !== req.userId)
    return res.status(403).json({ error: "Only host can close the room" });

  await WatchParty.deleteOne({ code: req.params.code });

  res.json({ success: true });
});

export default router;
