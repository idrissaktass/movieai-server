import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import recommendRoute from "./routes/discover.js";
import authRoutes from "./routes/auth.js";
import favoritesRoutes from "./routes/favorites.js";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/favorites", favoritesRoutes);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(console.error);

app.use("/api/auth", authRoutes);
app.use("/api/discover", recommendRoute);

app.listen(process.env.PORT, () =>
  console.log("Server running on", process.env.PORT)
);
