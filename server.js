import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import recommendRoute from "./routes/discover.js";
import authRoutes from "./routes/auth.js";
import favoritesRoutes from "./routes/favorites.js";
import watchPartyRoutes from "./routes/watchparty.js";
import { Server } from "socket.io";
import http from "http";
import platformRoutes from "./routes/platform.js";
import postsRoutes from "./routes/posts.js";
import premiumRoutes from "./routes/premium.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/favorites", favoritesRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/discover", recommendRoute);
app.use("/api/watchparty", watchPartyRoutes);
app.use("/api/platform", platformRoutes);
app.use("/api/posts", postsRoutes);
app.use("/api/premium", premiumRoutes);

/* ================= DATABASE ================= */

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((e) => console.error("❌ Mongo error:", e));

/* ================= SERVER ================= */

const server = http.createServer(app);

/* ================= SOCKET ================= */

export const io = new Server(server, {
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  console.log("⚡ user connected:", socket.id);

  /* -------- JOIN ROOM -------- */
  socket.on("join-room", ({ roomCode, userId }) => {
    socket.join(roomCode);

    const size = io.sockets.adapter.rooms.get(roomCode)?.size || 0;

    io.to(roomCode).emit("room-update", {
      type: "join",
      userId,
      size
    });

    console.log(`🏠 ${socket.id} joined ${roomCode} | users: ${size}`);
  });

  /* -------- MODE SELECTION -------- */
  socket.on("host-selecting-mode", ({ roomCode }) => {
    io.to(roomCode).emit("go-mode-selection");
  });

  /* -------- USER FINISHED FORM -------- */
  socket.on("user-finished", ({ roomCode, role }) => {
    io.to(roomCode).emit("user-finished", { role });
  });

  /* -------- ALL FINISHED → RESULTS -------- */
  socket.on("all-finished", ({ roomCode }) => {
    io.to(roomCode).emit("go-results");
  });

  /* -------- CLOSE ROOM -------- */
  socket.on("close-room", ({ roomCode }) => {
    io.to(roomCode).emit("room-closed");
    io.socketsLeave(roomCode);
  });

  /* -------- DISCONNECT -------- */
  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms];

    rooms.forEach((room) => {
      if (room !== socket.id) {
        io.to(room).emit("user-left");
      }
    });
  });

  socket.on("disconnect", () => {
    console.log("❌ user disconnected:", socket.id);
  });
});

/* ================= START ================= */

server.listen(process.env.PORT, () =>
  console.log("🚀 Server running on", process.env.PORT)
);
