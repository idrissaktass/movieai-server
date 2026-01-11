export async function fetchFromTMDBByName(title: string) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=en-US`;

  const res = await fetch(url);
  const data = await res.json();

  return data.results?.[0] || null;
}
