import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  { 
    recommendedHistory: {
      type: [Number], // TMDB movieId
      default: [],
    },

    name: { type: String, required: true },

    email: { type: String, required: true, unique: true },

    // 🔐 AUTH
    password: { type: String }, // ❗ artık zorunlu değil
    authProvider: { 
      type: String, 
      enum: ["local", "google"], 
      default: "local" 
    },

    createdAt: { type: Date, default: Date.now },

    // 🎬 FAVORITES
    favorites: [
      {
        movieId: Number,
        title: String,
        posterPath: String,
        voteAverage: Number,
        overview: String
      },
    ],

    // 👍 LIKES
    likes: {
      type: [
        {
          movieId: Number,
          title: String,
          posterPath: String,
          voteAverage: Number,
          overview: String
        },
      ],
      default: [],
    },

    // 👎 DISLIKES
    dislikes: {
      type: [
        {
          movieId: Number,
          title: String,
          posterPath: String,
          voteAverage: Number,
          overview: String
        },
      ],
      default: [],
    },

    // 🧠 TASTE PROFILE
    tasteProfile: {
      type: {
        topGenre: {
          genreId: String,
          count: Number,
          updatedAt: Date,
        },
        topDirector: {
          id: Number,
          name: String,
          count: Number,
          updatedAt: Date,
        },
        topActor: {
          id: Number,
          name: String,
          count: Number,
          updatedAt: Date,
        },
      },
      default: {
        topGenre: null,
        topDirector: null,
        topActor: null,
      },
    },

    tasteProfileMeta: {
      likesCountAtBuild: Number,
    }
  },
  { versionKey: false }
);

export default mongoose.model("User", UserSchema);
