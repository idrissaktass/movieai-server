import { Router } from "express";
import fetch from "node-fetch";
import OpenAI from "openai";
import "dotenv/config";
import express from "express";
import User from "../models/User.js";
import jwt from "jsonwebtoken";
import { buildTasteProfile } from "../utils/tasteProfiler.js";

const router = Router();

const TMDB_API_KEY = "404bc2a47139c3a5d826814f03794b21";
const TMDB_BASE = "https://api.themoviedb.org/3";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
    req.isPremium = user.isPremium || false;


    next();
  } catch (err) {
    return res.status(401).json({ error: "Geçersiz token" });
  }
};

export async function fetchFromTMDBByName(title) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=en-US`;

  const res = await fetch(url);
  const data = await res.json();

  return data.results?.[0] || null;
}

async function getAIMovieMatches(filters) {
  const prompt = `
You are an advanced AI movie recommendation engine.

User preferences:
Intent: ${filters.intent}
Energy: ${filters.energy}
Runtime: ${filters.runtime}
Aura: ${filters.aura}
Quick tags: ${filters.quickTags?.join(", ")}

Task:
Suggest exactly 5 movies.

For each movie:
- Give a match score between 80 and 99 based on how well it fits.
- Higher = better match.
- For each movie give a short explanation that why this movie is recommended for that user.
- The short explanation MUST clearly reference the user's intent, energy, aura, runtime or quick tags.Focus on WHY this movie fits THIS user’s current mood and request.
respond in JSON array format DO NOT add any extra text.
Return ONLY valid JSON in this format:

[
  { "title": "Movie name", "match": 92, "exp": "Short Explanation" }
]
match
No explanation. No text. Only JSON.
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.8,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.choices[0].message.content;

  return JSON.parse(raw);
}


/* 🎭 MOOD → GENRE MAP */
const moodMap = {
  happy: { with_genres: "35" },      // Comedy
  sad: { with_genres: "18" },        // Drama
  relaxed: { with_genres: "10749" }, // Romance
  excited: { with_genres: "28,12" }, // Action + Adventure
};

/* 🎲 RANDOM HELPERS */
function getRandomPage(max = 20) {
  return Math.floor(Math.random() * max) + 1;
}

function pickRandomItems(array, count = 3) {
  return [...array].sort(() => 0.5 - Math.random()).slice(0, count);
}

// backend/routes/discover.ts (Veya ilgili dosyanız)

const auraKeywords = {
  dark: "209709,233513",     // Psychological, dark atmosphere
  feelgood: "155030,171120", // Feel-good, uplifting
  tense: "10683",            // High tension/thriller
  inspiring: "10620,18037",  // Biography, survival
  mindblow: "233513,3101",   // Mind-bending, mind-f*ck
  mystery: "9826",           // Whodunit
  romantic: "10749",         // Romance
  epic: "156942,10500"       // Epic, adventure
};

const tagKeywords = {
  immersive: "10726", // Cinematography
  underrated: "vote_count.lte=5000&vote_average.gte=7.5", // Yüksek puan, az oylama
  oscar: "18054",     // Academy Award winner
  twist: "10620",     // Plot twist
};

// backend/routes/discover.js

router.post("/ai", authMiddleware, async (req, res) => {
  try {
    const DAILY_LIMIT = 3;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD formatı

    /* ====================================================
        1. LIMIT VE TARIH KONTROLÜ (SYNCHRONIZATION)
    ==================================================== */
    if (!req.isPremium) {
      // Eğer user modelinde dailyUsage alanı hiç oluşmamışsa başlat
      if (!req.user.dailyUsage) {
        req.user.dailyUsage = { count: 0, date: today };
      }

      // Yeni bir güne girilmişse sayacı sıfırla ve tarihi güncelle
      if (req.user.dailyUsage.date !== today) {
        req.user.dailyUsage.date = today;
        req.user.dailyUsage.count = 0;
      }

      // Limit kontrolü
      if (req.user.dailyUsage.count >= DAILY_LIMIT) {
        return res.json({
          success: false,
          limitReached: true,
          remaining: 0,
          currentCount: req.user.dailyUsage.count
        });
      }

      // Hakkı burada düşüyoruz (İstek başarılı sayılmadan önce)
      req.user.dailyUsage.count += 1;
      req.user.markModified("dailyUsage");
      await req.user.save();
    }

    /* ====================================================
        2. AI RECOMMENDATION LOGIC
    ==================================================== */
    const filters = req.body;
    const recommendedIds = req.user.recommendedHistory || [];

    // OpenAI'dan önerileri al
    let aiResults;
    try {
      aiResults = await getAIMovieMatches(filters);
    } catch (aiErr) {
      // AI patlarsa kullanıcının hakkını geri ver
      if (!req.isPremium) {
        req.user.dailyUsage.count -= 1;
        req.user.markModified("dailyUsage");
        await req.user.save();
      }
      throw new Error("AI Service temporary unavailable: " + aiErr.message);
    }
    
    let freshResults = [];
    let fallbackResults = [];

    // TMDB'de ara + geçmiş kontrolü
    for (const item of aiResults) {
      const movie = await fetchFromTMDBByName(item.title);
      if (!movie || !movie.poster_path) continue;

      const enriched = {
        ...movie,
        aiMatch: item.match,
        aiExp: item.exp,
      };

      // Daha önce önerilmediyse fresh listesine, önerildiyse fallback listesine
      if (!recommendedIds.includes(movie.id)) {
        freshResults.push(enriched);
      } else {
        fallbackResults.push(enriched);
      }
    }

    // Sonuçları birleştir (Öncelik hiç görülmemişlerde)
    let finalResults = [...freshResults];
    if (finalResults.length < 5) {
      finalResults.push(...fallbackResults.slice(0, 5 - finalResults.length));
    }

    /* ====================================================
        3. FAILSAFE (YETERLI SONUÇ YOKSA)
    ==================================================== */
    if (finalResults.length < 5) {
      const r = await fetch(
        `${TMDB_BASE}/discover/movie?api_key=${process.env.TMDB_API_KEY}&sort_by=popularity.desc&vote_count.gte=200&vote_average.gte=6`
      );
      const d = await r.json();
      const extra = (d.results || [])
        .filter(m => m.poster_path && !recommendedIds.includes(m.id) && !finalResults.some(f => f.id === m.id))
        .slice(0, 5 - finalResults.length)
        .map(m => ({
          ...m,
          aiMatch: 80,
          aiExp: "A highly rated choice based on your general preferences.",
        }));
      finalResults.push(...extra);
    }

    finalResults = finalResults.slice(0, 5);

    /* ====================================================
        4. DB GÜNCELLEME VE YANIT
    ==================================================== */
    // Önerilenleri geçmişe ekle
    await User.findByIdAndUpdate(req.userId, {
      $addToSet: {
        recommendedHistory: { $each: finalResults.map(m => m.id) }
      }
    });

    res.json({
      success: true,
      results: finalResults,
      remaining: req.isPremium ? "unlimited" : DAILY_LIMIT - req.user.dailyUsage.count,
      currentCount: req.user.dailyUsage.count
    });

  } catch (err) {
    console.error("AI ROUTE ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { intent, energy, runtime, aura, quickTags, genres } = req.body;

    let queryParams = new URLSearchParams({
      api_key: process.env.TMDB_API_KEY,
      language: "en-US",
      include_adult: "false",
      "vote_count.gte": "10", // 300'den 150'ye düşürdük (daha çok sonuç için)
      "vote_average.gte": "1.5", // 6.0'dan 5.5'e düşürdük
      sort_by: "popularity.desc",
    });

    let with_genres = genres && genres.length > 0 ? genres.join(",") : "";
    let with_keywords = [];

    // 1. AURA -> Keyword (Eğer keyword çok kısıtlıyorsa genre'ya ek yapalım)
    if (aura && auraKeywords[aura]) {
       // Bazı auralar anahtar kelime yerine tür eklemeli
       if (aura === 'romantic') with_genres += with_genres ? ",10749" : "10749";
       else with_keywords.push(auraKeywords[aura]);
    }

    // 2. ENERGY -> Tür ekleme (Çok katı yapma)
    if (energy === "high") {
        with_genres += with_genres ? ",28" : "28"; // Sadece Aksiyon
    }

    // 3. RUNTIME (Sadece seçildiyse ekle)
    if (runtime === "short") queryParams.set("with_runtime.lte", "100");
    if (runtime === "long") queryParams.set("with_runtime.gte", "130");

    // 4. QUICK TAGS
    if (quickTags && quickTags.length > 0) {
      quickTags.forEach(tag => {
        if (tag === "last5") queryParams.set("primary_release_date.gte", "2020-01-01");
        if (tag === "90s") {
            queryParams.set("primary_release_date.gte", "1990-01-01");
            queryParams.set("primary_release_date.lte", "1999-12-31");
        }
        if (tagKeywords[tag] && !tagKeywords[tag].includes("=")) {
            with_keywords.push(tagKeywords[tag]);
        }
      });
    }

    if (with_genres) queryParams.set("with_genres", with_genres);
    
    // 🔥 ÖNEMLİ: Keywordleri virgül yerine pipe (|) ile birleştirirsen "OR" (VEYA) mantığı çalışır.
    // Bu sayede "ya mindblow olsun YA DA twist olsun" der, sonuç gelme ihtimali artar.
    if (with_keywords.length > 0) {
        queryParams.set("with_keywords", with_keywords.join("|")); 
    }

    // Rastgele sayfa (Eğer sonuç azsa sayfa 1'e zorla)
    queryParams.set("page", (Math.floor(Math.random() * 3) + 1).toString());

// ... önceki kodlar (queryParams oluşturma vs.)

    const url = `${TMDB_BASE}/discover/movie?${queryParams.toString()}`;
    console.log("🔗 DENENEN URL:", url);

    const response = await fetch(url);
    const data = await response.json();

    let finalResults = data.results || [];

    // 🔴 HATA BURADAYDI: fbRes.res.json() düzeltildi ve failsafe güçlendirildi
    if (finalResults.length === 0) {
        console.log("⚠️ Sonuç gelmedi, filtreler gevşetiliyor...");
        
        // Daha geniş bir arama için sadece ana türü ve popülerliği baz alıyoruz
        const fallbackUrl = `${TMDB_BASE}/discover/movie?api_key=${process.env.TMDB_API_KEY}&language=en-US&sort_by=popularity.desc&vote_count.gte=100&with_genres=${with_genres || ""}`;
        
        const fbRes = await fetch(fallbackUrl);
        const fbData = await fbRes.json(); // ✅ DÜZELTİLDİ: fbRes.res.json() -> fbRes.json()
        finalResults = fbData.results || [];
    }

    // 🎲 Sonuçları karıştır ve ilk 8'i al (Eğer hiç sonuç yoksa boş array döner, çökmez)
    const shuffled = finalResults.length > 0 
        ? finalResults.sort(() => 0.5 - Math.random()).slice(0, 8) 
        : [];

    res.json({ 
        success: true, 
        mood: shuffled, 
        genre: shuffled 
    });

  } catch (err) {
    console.error("❌ SERVER ERROR:", err);
    res.status(500).json({ success: false, error: "Server Error", details: err.message });
  }
});

router.get("/hidden-gems", authMiddleware, async (req, res) => {
  try {
    const topGenreRes = await fetch(
      `${process.env.BASE_URL}/api/discover/top-genre`,
      {
        headers: { Authorization: req.headers.authorization }
      }
    );

    const { genreId } = await topGenreRes.json();

    if (!genreId) return res.json([]);

    const url = `${TMDB_BASE}/discover/movie?api_key=${process.env.TMDB_API_KEY}&with_genres=${genreId}&vote_average.gte=6&vote_count.gte=400&sort_by=vote_average.desc`;

    const r = await fetch(url);
    const d = await r.json();

    res.json(d.results?.slice(0, 10) || []);
  } catch (e) {
    console.error("HIDDEN GEMS ERROR:", e);
    res.status(500).json([]);
  }
});

router.post("/ai-personal", authMiddleware, async (req, res) => {
  try {
    if (!req.isPremium) {
      return res.status(403).json({
        premiumRequired: true
      });
    }

    const likes = req.user.likes || [];

    if (likes.length < 3) {
      return res.json([]);
    }

    const likedTitles = likes.slice(0, 10).map(l => l.title).join(", ");

    const prompt = `
User liked these movies:
${likedTitles}

Recommend 10 very similar movies.

Return ONLY JSON, no explanations, no text, no apologies, no disclaimers, no notes, just JSON in this format:
[
 { "title": "movie name" }
]
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.9
    });

    const ai = JSON.parse(response.choices[0].message.content);

    const movies = [];

    for (const item of ai) {
      const movie = await fetchFromTMDBByName(item.title);
      if (movie?.poster_path) movies.push(movie);
    }

    res.json(movies.slice(0, 10));

  } catch (e) {
    console.log("AI PERSONAL ERROR", e);
    res.status(500).json([]);
  }
});

export default router;
