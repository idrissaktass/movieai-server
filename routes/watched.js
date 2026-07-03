import { Router } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const router = Router();

/* ===============================
   🔐 INLINE AUTH MIDDLEWARE
================================ */

const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ error: "Token yok" });
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

    next();
  } catch (err) {
    return res.status(401).json({ error: "Geçersiz token" });
  }
};

/* ===============================
   🏆 CINEPHILE LEVEL THRESHOLDS
================================ */

const LEVELS = [
  { min: 10, key: "expert", label: "Uzman" },
  { min: 5, key: "cinephile", label: "Sinefil" },
  { min: 3, key: "enthusiast", label: "Meraklı" },
  { min: 1, key: "traveler", label: "Gezgin" },
];

const getLevel = (count) =>
  LEVELS.find((l) => count >= l.min) || null;

/* ===============================
   ✅ GET WATCHED LIST
================================ */

router.get("/", authMiddleware, (req, res) => {
  res.json(req.user.watched || []);
});

/* ===============================
   ✅ TOGGLE WATCHED
================================ */

router.post("/toggle", authMiddleware, async (req, res) => {
  const { movieId, title, posterPath, voteAverage, countries } = req.body;

  if (!movieId) {
    return res.status(400).json({ error: "movieId gerekli" });
  }

  const exists = req.user.watched.find((w) => w.movieId === movieId);

  if (exists) {
    req.user.watched = req.user.watched.filter((w) => w.movieId !== movieId);
  } else {
    req.user.watched.push({
      movieId,
      title,
      posterPath,
      voteAverage,
      countries: Array.isArray(countries) ? countries : [],
    });
  }

  await req.user.save();
  res.json(req.user.watched);
});

/* ===============================
   🌍 PASSPORT SUMMARY (per-country stats)
================================ */

router.get("/passport", authMiddleware, (req, res) => {
  const watched = req.user.watched || [];
  const byCountry = new Map();

  for (const w of watched) {
    for (const c of w.countries || []) {
      if (!c?.iso) continue;
      const entry = byCountry.get(c.iso) || { iso: c.iso, name: c.name, count: 0 };
      entry.count += 1;
      byCountry.set(c.iso, entry);
    }
  }

  const countries = Array.from(byCountry.values())
    .map((c) => ({ ...c, level: getLevel(c.count) }))
    .sort((a, b) => b.count - a.count);

  res.json({
    totalMovies: watched.length,
    totalCountries: countries.length,
    countries,
  });
});

export default router;
