
import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import authRouter, { getChatIdentity } from "./auth.js";
 
const app = express();
const httpServer = createServer(app);
 
const PORT = Number(process.env.PORT ?? 3000);
const FRONTEND_URL = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://192.168.1.164:5173",
];
 
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

io.use((socket, next) => {
  const identity = getChatIdentity(socket.request.headers.cookie);

  if (!identity) {
    next(new Error("Authentication required"));
    return;
  }

  socket.data.chatIdentity = identity;
  next();
});

// Chat connections
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
 
  // Join a chat room
  socket.on("join-room", (roomId: string) => {
    if (roomId !== "general") {
      return;
    }
 
    socket.join(roomId);
    socket.to(roomId).emit("user-joined", {
      socketId: socket.id,
    });
  });
 
  // Broadcast each message to the other users in the shared room.
  socket.on(
    "send-message",
    (data: { roomId?: string; message?: string }) => {
      if (
        data?.roomId !== "general" ||
        !socket.rooms.has("general") ||
        typeof data?.message !== "string" ||
        !data.message.trim() ||
        data.message.trim().length > 2000
      ) {
        return;
      }

      const identity = socket.data.chatIdentity as {
        username: string;
        color: string;
      };

      socket.to(data.roomId).emit("receive-message", {
        id: Date.now() + Math.random(),
        message: data.message.trim(),
        username: identity.username,
        color: identity.color,
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