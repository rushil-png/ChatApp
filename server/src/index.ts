
import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import authRouter from "./auth";
 
const app = express();
const httpServer = createServer(app);
 
const PORT = Number(process.env.PORT ?? 3000);
const FRONTEND_URL =
  process.env.FRONTEND_URL ?? "http://localhost:5173";
 
// Middleware
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
    // PATCH is required for changing usernames (PATCH /api/auth/username)
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
  })
);
 
app.use(express.json());
 
// Basic health check
app.get("/", (_req, res) => {
  res.json({
    message: "Orbit API is running",
  });
});
 
// Email registration, verification, login, username and logout routes
app.use("/api/auth", authRouter);
 
// Socket.IO setup
const io = new Server(httpServer, {
  cors: {
    origin: FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST"],
  },
});
 
// Chat connections
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
 
  // Join a chat room
  socket.on("join-room", (roomId: string) => {
    if (typeof roomId !== "string" || !roomId.trim()) {
      return;
    }
 
    socket.join(roomId);
    socket.to(roomId).emit("user-joined", {
      socketId: socket.id,
    });
  });
 
  // Send a message to everyone in the room
  socket.on(
    "send-message",
    (data: { roomId?: string; message?: string; username?: string }) => {
      if (
        typeof data?.roomId !== "string" ||
        typeof data?.message !== "string" ||
        !data.roomId.trim() ||
        !data.message.trim()
      ) {
        return;
      }
 
      io.to(data.roomId).emit("receive-message", {
        message: data.message.trim(),
        username:
          typeof data.username === "string" && data.username.trim()
            ? data.username.trim()
            : "User",
        timestamp: new Date().toISOString(),
      });
    }
  );
 
  // Handle disconnections
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});
 
// Start the server
httpServer.listen(PORT, () => {
  console.log(`Orbit API running at http://localhost:${PORT}`);
  console.log(`Allowed frontend origin: ${FRONTEND_URL}`);
});