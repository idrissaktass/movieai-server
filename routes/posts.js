import express from "express";
import Post from "../models/Post.js";
import User from "../models/User.js";
import jwt from "jsonwebtoken";

const router = express.Router();

const auth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Token formatı hatalı veya yok" });
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
/* ================= CREATE POST ================= */

router.post("/", auth, async (req, res) => {
  try {
    const { movieId, title, posterPath, caption, rating, year, genre } = req.body;

    const user = await User.findById(req.user.id);

    const post = await Post.create({
      userId: user._id,
      username: user.name,
      movieId,
      title,
      posterPath,
      caption,
      rating,
      year,
      genre: Array.isArray(genre) ? genre : [genre],
    });
    res.json(post);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ================= FEED ================= */

router.get("/", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;
  const { search, year, minRating, sort, genre, type } = req.query;

  let query = {};

  // --- TAKİP EDİLENLER FİLTRESİ ---
// routes/posts.js içindeki router.get("/") kısmı
if (type === "following") {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Giriş yapmalısınız" });

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    
    // Takip ettikleri + Kendisi (Kendi postlarını da akışta görmek için)
    const feedIds = [...user.following, decoded.id];
    
    query.userId = { $in: feedIds };
  } catch (err) {
    return res.status(401).json({ error: "Geçersiz token" });
  }
}

  // Mevcut filtrelerin (arama, rating vs.) devamı
  if (genre) query.genre = { $in: [genre] };
  if (search) query.title = { $regex: search, $options: "i" };
  if (minRating) query.rating = { $gte: Number(minRating) };
  if (year) query.year = Number(year);

  let sortObj = { createdAt: -1 };
  if (sort === "likes") sortObj = { likeCount: -1 };
  if (sort === "rating") sortObj = { rating: -1 };

const posts = await Post.find(query)
  .sort(sortObj)
  .skip((page - 1) * limit)
  .limit(limit);

const formatted = posts.map(p => ({
  ...p.toObject(),
  likes: p.likes || [],
  likeCount: p.likes?.length || 0,
}));

res.json(formatted);

});

/* ================= USER POSTS ================= */

router.get("/user/:id", async (req, res) => {
  const posts = await Post.find({ userId: req.params.id })
    .sort({ createdAt: -1 });

  res.json(posts);
});

/* ================= LIKE ================= */

router.post("/:id/like", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    // req.userId'nin string olduğundan emin olun
    const userId = req.userId.toString();
    const alreadyLiked = post.likes.map(id => id.toString()).includes(userId);

    if (alreadyLiked) {
      post.likes.pull(req.userId);
    } else {
      post.likes.push(req.userId);
    }
    
    // likeCount'u manuel yönetmek yerine her zaman likes.length'e eşitlemek daha güvenlidir
    post.likeCount = post.likes.length;
    await post.save();

    res.json({ likes: post.likeCount, isLiked: !alreadyLiked });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ================= DELETE ================= */
/* ================= DELETE POST ================= */
router.delete("/:id", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    // Güvenlik kontrolü: Sadece post sahibi silebilir
    if (post.userId.toString() !== req.userId) {
      return res.status(403).json({ error: "Unauthorized: You can only delete your own posts" });
    }

    await Post.findByIdAndDelete(req.params.id);
    res.json({ message: "Post deleted successfully" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
/* ================= UPDATE POST ================= */
router.put("/:id", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    // Sadece sahibi düzenleyebilir
    if (post.userId.toString() !== req.userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const { caption, rating } = req.body;
    post.caption = caption;
    post.rating = rating;

    await post.save();
    res.json(post);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ================= USER POSTS ================= */
// Bu route profil sayfasındaki "Posts" sekmesini besler
router.get("/user/:id", async (req, res) => {
  try {
    const posts = await Post.find({ userId: req.params.id })
      .sort({ createdAt: -1 })
      .lean();
    res.json(posts);
  } catch (e) {
    console.error("User posts error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
