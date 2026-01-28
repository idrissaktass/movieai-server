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

router.post("/create", authMiddleware, async (req, res) => {
  const code = crypto.randomBytes(3).toString("hex");

  const party = await WatchParty.create({
    code,
    host: req.userId
  });

  console.log("🔥 PARTY CREATED:", code); // 👈 BUNU EKLE

  res.json({ code });
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

  // 👉 SADECE BİR REQUEST "generating" yapabilsin
  let party = await WatchParty.findOneAndUpdate(
    { code: req.params.code, status: "ready" },
    { status: "generating" },
    { new: true }
  ).populate("host guest");

  // Eğer ready → generating olmadıysa:
  if (!party) {
    const existing = await WatchParty.findOne({ code: req.params.code });

    if (!existing) return res.status(404).json({ error: "Room not found" });

    // Zaten üretilmiş
    if (existing.status === "done") {
      return res.json({ results: existing.results });
    }

    // Başkası şu an üretiyor
    return res.json({ loading: true });
  }

  // 🧠 SADECE BURAYA 1 KİŞİ GİRER
  try {
    const aiResults = await getWatchPartyMatches(
      { ...party.hostAnswers, taste: party.host.tasteProfile },
      { ...party.guestAnswers, taste: party.guest.tasteProfile }
    );

    let finalResults = [];

    for (const item of aiResults) {
      const movie = await fetchFromTMDBByName(item.title);
      if (!movie || !movie.poster_path) continue;

      finalResults.push({
        ...movie,
        aiMatch: item.match,
        aiExp: item.exp
      });
    }

    finalResults = finalResults.slice(0, 5);

    party.results = finalResults;
    party.status = "done";
    await party.save();

    return res.json({ results: finalResults });

  } catch (e) {
    console.error("AI ERROR:", e);
    await WatchParty.updateOne(
      { code: req.params.code },
      { status: "ready" }
    );
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
