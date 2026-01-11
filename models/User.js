import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  { 
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    favorites: [
    {
      movieId: Number,
      title: String,
      posterPath: String,
      voteAverage: Number,
    },
  ],
  likes: {
  type: [
    {
      movieId: Number,
      title: String,
      posterPath: String,
      voteAverage: Number,
    },
  ],
  default: [],
},

dislikes: {
  type: [
    {
      movieId: Number,
      title: String,
      posterPath: String,
      voteAverage: Number,
    },
  ],
  default: [],
},
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
