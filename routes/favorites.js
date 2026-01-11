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
    req.isPremium = decoded.isPremium || false;

    next();
  } catch (err) {
    return res.status(401).json({ error: "Geçersiz token" });
  }
};

/* ===============================
   ❤️ GET FAVORITES
================================ */

router.get("/", authMiddleware, (req, res) => {
  res.json(req.user.favorites || []);
});

/* ===============================
   ❤️ TOGGLE FAVORITE
================================ */

router.post("/toggle", authMiddleware, async (req, res) => {
  const { movieId, title, posterPath, voteAverage } = req.body;

  if (!movieId) {
    return res.status(400).json({ error: "movieId gerekli" });
  }

  const exists = req.user.favorites.find(
    (f) => f.movieId === movieId
  );

  if (exists) {
    req.user.favorites = req.user.favorites.filter(
      (f) => f.movieId !== movieId
    );
  } else {
    req.user.favorites.push({
      movieId,
      title,
      posterPath,
      voteAverage,
    });
  }

  await req.user.save();
  res.json(req.user.favorites);
});
router.post("/like", authMiddleware, async (req, res) => {
  const { movieId, title, posterPath, voteAverage } = req.body;

  if (!movieId) return res.status(400).json({ error: "movieId gerekli" });

  // dislike varsa kaldır
  req.user.dislikes = req.user.dislikes.filter(d => d.movieId !== movieId);

  const exists = req.user.likes.find(l => l.movieId === movieId);

  if (exists) {
    req.user.likes = req.user.likes.filter(l => l.movieId !== movieId);
  } else {
    req.user.likes.push({ movieId, title, posterPath, voteAverage });
  }
  req.user.tasteProfile = {};
  await req.user.save();
  res.json({ likes: req.user.likes, dislikes: req.user.dislikes });
});
router.post("/dislike", authMiddleware, async (req, res) => {
  const { movieId, title, posterPath, voteAverage } = req.body;

  if (!movieId) return res.status(400).json({ error: "movieId gerekli" });

  // like varsa kaldır
  req.user.likes = req.user.likes.filter(l => l.movieId !== movieId);

  const exists = req.user.dislikes.find(d => d.movieId === movieId);

  if (exists) {
    req.user.dislikes = req.user.dislikes.filter(d => d.movieId !== movieId);
  } else {
    req.user.dislikes.push({ movieId, title, posterPath, voteAverage });
  }
  req.user.tasteProfile = {};
  await req.user.save();
  res.json({ likes: req.user.likes, dislikes: req.user.dislikes });
});

/* ===============================
   👍👎 GET REACTIONS
================================ */
router.get("/reactions", authMiddleware, (req, res) => {
  res.json({
    likes: req.user.likes || [],
    dislikes: req.user.dislikes || [],
  });
});


export default router;
