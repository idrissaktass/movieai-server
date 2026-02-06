import mongoose from "mongoose";
import dotenv from "dotenv";
import axios from "axios";
import Post from "../models/Post.js";
import User from "../models/User.js";

dotenv.config();

await mongoose.connect(process.env.MONGO_URI);

const TMDB_KEY = process.env.TMDB_API_KEY;

/* ================= GENRE MAP ================= */
// TMDB genre id -> name çeviri
async function fetchGenres() {
  const res = await axios.get(
    `https://api.themoviedb.org/3/genre/movie/list?api_key=${TMDB_KEY}`
  );

  const map = {};
  res.data.genres.forEach(g => (map[g.id] = g.name));
  return map;
}

/* ================= MOVIES FETCH ================= */

async function fetchMovies(genreMap) {
  const urls = [
    // 2025
    `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&primary_release_year=2025&page=1&sort_by=popularity.desc`,
    `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&primary_release_year=2025&page=2&sort_by=popularity.desc`,

    // 2026
    `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&primary_release_year=2026&page=1&sort_by=popularity.desc`,
    `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&primary_release_year=2026&page=2&sort_by=popularity.desc`
  ];

  const responses = await Promise.all(urls.map(u => axios.get(u)));

  const all = responses.flatMap(r => r.data.results);

  const clean = all.filter(m => m.poster_path);

  const unique = [...new Map(clean.map(m => [m.id, m])).values()];

  unique.sort(() => Math.random() - 0.5);

  return unique.slice(0, 50).map(m => ({
    movieId: m.id,
    title: m.title,
    posterPath: m.poster_path,
    year: Number(m.release_date?.slice(0, 4)),

    // ⭐ GERÇEK GENRE
    genre: m.genre_ids.map(id => genreMap[id]).filter(Boolean)
  }));
}

/* ================= RANDOM DATA ================= */

const captions = [
  "Pure cinema 🎬","Hidden gem","Loved every second",
  "Crazy visuals","Plot twist insane","Weekend vibes",
  "Comfort movie","Masterpiece","So emotional 😭",
  "Instant favorite","Underrated fr","10/10 recommend"
];

const usernames = [
  "Luna","Kai","Mila","Noah","Zara","Leo","Ivy","Aria","Eren","Sofia",
  "Atlas","Nova","Mason","Elena","Theo","Hazel","Jade","Owen","Ava","Rex"
];

const random = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomRating = () => +(Math.random() * 10).toFixed(1);
const randomLikes = () => Math.floor(Math.random() * 21);

/* ================= SEED ================= */

async function run() {

  /* USERS */
  let users = await User.find().limit(20);

  if (users.length < 20) {
    await User.insertMany(
      usernames.map((name, i) => ({
        name,
        email: `${name}${i}@test.com`,
        password: "123456"
      }))
    );
    users = await User.find().limit(20);
  }

  /* GENRES */
  const genreMap = await fetchGenres();

  /* MOVIES */
  const movies = await fetchMovies(genreMap);

  const posts = movies.map(movie => {
    const user = random(users);
    const likeCount = randomLikes();

    return {
      userId: user._id,
      username: user.name,

      movieId: movie.movieId,
      title: movie.title,
      posterPath: movie.posterPath,

      caption: random(captions),
      rating: randomRating(),

      year: movie.year,       // ⭐ sadece 2025/2026
      genre: movie.genre,     // ⭐ gerçek genre

      likes: Array(likeCount).fill(user._id),
      likeCount
    };
  });

  await Post.insertMany(posts);

  console.log("✅ 2025-2026 gerçek genre + poster + 50 post eklendi");
  process.exit();
}

run();
