import mongoose from "mongoose";

const PostSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    username: String,

    movieId: Number,
    title: String,
    posterPath: String,

    caption: String,
    rating: Number,
year: Number,
    likes: {
      type: [mongoose.Schema.Types.ObjectId],
      default: [],
    },
    likeCount: { type: Number, default: 0 }, // ⭐ EKLE
genre: {
  type: [String],
  default: [],
  index: true,
},



    rating: {
  type: Number,
  min: 0,
  max: 10,
},
  },
  { timestamps: true }
);

export default mongoose.model("Post", PostSchema);
