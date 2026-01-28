import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const TMDB_KEY = process.env.TMDB_API_KEY || "404bc2a47139c3a5d826814f03794b21";
const TMDB_BASE = "https://api.themoviedb.org/3";

const providers = {
  netflix: 8,
  prime: 9,
  hbo: 384,
};

function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

router.get("/:platform", async (req, res) => {
  try {
    const { platform } = req.params;
    const providerId = providers[platform];

    if (!providerId) {
      return res.status(400).json({ error: "Unknown platform" });
    }

    const randomPage = Math.floor(Math.random() * 20) + 1;

    const url = `${TMDB_BASE}/discover/movie?api_key=${TMDB_KEY}` +
      `&with_watch_providers=${providerId}` +
      `&watch_region=TR` +
      `&sort_by=popularity.desc` +
      `&page=${randomPage}`;

    const response = await fetch(url);
    const data = await response.json();

    const movies = shuffle(data.results || []).slice(0, 12);

    res.json(movies);
  } catch (e) {
    console.log("PLATFORM API ERROR:", e);
    res.status(500).json({ error: "Platform fetch failed" });
  }
});

export default router;
