const TMDB = "https://api.themoviedb.org/3";

// 429 (rate limit) veya geçici hata gelirse kısa bir bekleyip tekrar dener.
async function fetchJsonRetry(url, { retries = 3 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);

      if (res.status === 429) {
        // TMDB "Retry-After" başlığı saniye cinsinden döner; yoksa artan backoff uygula.
        const retryAfter = parseInt(res.headers.get("retry-after") || "", 10);
        const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : (attempt + 1) * 500;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      if (attempt === retries) return null;
      await new Promise((r) => setTimeout(r, (attempt + 1) * 500));
    }
  }
  return null;
}

// Görevleri en fazla `limit` tanesi aynı anda çalışacak şekilde işler (havuz modeli).
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, runner);
  await Promise.all(runners);
  return results;
}

export async function buildTasteProfile(user, apiKey, options = {}) {
  const {
    buildGenre = true,
    buildDirector = true,
    buildActor = true,
    concurrency = 5, // Aynı anda en fazla 5 film → 10 istek; TMDB için güvenli.
  } = options;

  const genreCount = {};
  const directorCount = {};
  const actorCount = {};

  await mapWithConcurrency(user.likes, concurrency, async (movie) => {
    // Bir filme ait detay + credits isteklerini paralel at (2 istek).
    const [md, credits] = await Promise.all([
      buildGenre
        ? fetchJsonRetry(`${TMDB}/movie/${movie.movieId}?api_key=${apiKey}`)
        : Promise.resolve(null),
      buildDirector || buildActor
        ? fetchJsonRetry(`${TMDB}/movie/${movie.movieId}/credits?api_key=${apiKey}`)
        : Promise.resolve(null),
    ]);

    if (buildGenre && md?.genres) {
      md.genres.forEach((g) => {
        genreCount[g.id] = (genreCount[g.id] || 0) + 1;
      });
    }

    if (credits) {
      if (buildDirector) {
        const director = credits.crew?.find(
          (c) => c.department === "Directing" && c.job.includes("Director")
        );
        if (director) {
          directorCount[director.id] = {
            id: director.id,
            name: director.name,
            count: (directorCount[director.id]?.count || 0) + 1,
          };
        }
      }

      if (buildActor) {
        credits.cast?.slice(0, 5).forEach((a) => {
          actorCount[a.id] = {
            id: a.id,
            name: a.name,
            count: (actorCount[a.id]?.count || 0) + 1,
          };
        });
      }
    }
  });

  const result = {
    topGenre: null,
    topDirector: null,
    topActor: null,
  };

  if (buildGenre) {
    const topGenre = Object.entries(genreCount).sort((a, b) => b[1] - a[1])[0];
    if (topGenre && topGenre[1] >= 2) {
      result.topGenre = {
        genreId: topGenre[0],
        count: topGenre[1],
        weak: topGenre[1] < 2,
        updatedAt: new Date(),
      };
    }
  }

  if (buildDirector) {
    const topDirector = Object.values(directorCount).sort((a, b) => b.count - a.count)[0];
    if (topDirector && topDirector.count >= 2) {
      result.topDirector = {
        ...topDirector,
        weak: topDirector.count < 2,
        updatedAt: new Date(),
      };
    }
  }

  if (buildActor) {
    const topActor = Object.values(actorCount).sort((a, b) => b.count - a.count)[0];
    if (topActor && topActor.count >= 2) {
      result.topActor = {
        ...topActor,
        weak: topActor.count < 2,
        updatedAt: new Date(),
      };
    }
  }

  return result;
}
