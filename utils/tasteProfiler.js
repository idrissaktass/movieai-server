export async function buildTasteProfile(user, apiKey, options = {}) {
const TMDB = "https://api.themoviedb.org/3";
  const { buildGenre = true, buildDirector = true, buildActor = true, includeWeak = false, } = options;

  const genreCount = {};
  const directorCount = {};
  const actorCount = {};

  for (const movie of user.likes) {
    // movie details (genre için)
    if (buildGenre) {
      const m = await fetch(`${TMDB}/movie/${movie.movieId}?api_key=${apiKey}`);
      const md = await m.json();
      md.genres?.forEach(g => {
        genreCount[g.id] = (genreCount[g.id] || 0) + 1;
      });
    }

    // credits (director & actor için)
    if (buildDirector || buildActor) {
      const r = await fetch(`${TMDB}/movie/${movie.movieId}/credits?api_key=${apiKey}`);
      const d = await r.json();

      if (buildDirector) {
        const director = d.crew?.find(
          c => c.department === "Directing" && c.job.includes("Director")
        );

        if (director) {
          directorCount[director.id] = {
            id: director.id,
            name: director.name,
            count: (directorCount[director.id]?.count || 0) + 1
          };
        }
      }

      if (buildActor) {
        d.cast?.slice(0, 5).forEach(a => {
          actorCount[a.id] = {
            id: a.id,
            name: a.name,
            count: (actorCount[a.id]?.count || 0) + 1
          };
        });
      }
    }
  }

    const result = {
    topGenre: null,
    topDirector: null,
    topActor: null,
    };

  if (buildGenre) {
    const topGenre = Object.entries(genreCount).sort((a,b)=>b[1]-a[1])[0];
    if (topGenre && topGenre[1] >= 2) {
      result.topGenre = {
        genreId: topGenre[0],
        count: topGenre[1],
        weak: topGenre[1] < 2,
        updatedAt: new Date()
      };
    }
  }

  if (buildDirector) {
    const topDirector = Object.values(directorCount).sort((a,b)=>b.count-a.count)[0];
    if (topDirector && topDirector.count >= 2) {
      result.topDirector = {
        ...topDirector,
        weak: topDirector.count < 2,
        updatedAt: new Date()
      };
    }
  }

  if (buildActor) {
    const topActor = Object.values(actorCount).sort((a,b)=>b.count-a.count)[0];
    if (topActor && topActor.count >= 2) {
      result.topActor = {
        ...topActor,
        weak: topActor.count < 2,
        updatedAt: new Date()
      };
    }
  }
console.log("🎬 processing likes:", user.likes.map(l => l.movieId));
console.log("📊 GENRE COUNT:", genreCount);
console.log("🎬 DIRECTOR COUNT:", directorCount);
console.log("🎭 ACTOR COUNT:", actorCount);

  return result;
}
