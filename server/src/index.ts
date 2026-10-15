
import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { randomUUID } from "node:crypto";
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

type OnlineUser = {
  username: string;
  color: string;
};

type PendingChatRequest = {
  from: string;
  to: string;
  fromUsername: string;
  toUsername: string;
};

const onlineUsers = new Map<string, OnlineUser>();
const pendingChatRequests = new Map<string, PendingChatRequest>();
const privateConversations = new Map<string, Set<string>>();

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
  const identity = socket.data.chatIdentity as OnlineUser;
  onlineUsers.set(socket.id, identity);
  socket.emit(
    "online-users",
    [...onlineUsers.entries()]
      .filter(([id]) => id !== socket.id)
      .map(([id, user]) => ({ id, ...user }))
  );
  socket.broadcast.emit("user-online", { id: socket.id, ...identity });
 
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
      const isAllowedRoom =
        data?.roomId === "general"
          ? socket.rooms.has("general")
          : typeof data?.roomId === "string" &&
            privateConversations.get(data.roomId)?.has(socket.id) === true &&
            socket.rooms.has(data.roomId);

      if (
        typeof data?.roomId !== "string" ||
        !isAllowedRoom ||
        typeof data?.message !== "string" ||
        !data.message.trim() ||
        data.message.trim().length > 2000
      ) {
        return;
      }

      socket.to(data.roomId).emit("receive-message", {
        id: Date.now() + Math.random(),
        roomId: data.roomId,
        message: data.message.trim(),
        username: identity.username,
        color: identity.color,
        timestamp: new Date().toISOString(),
      });
    }
  );

  socket.on("request-chat", (targetId: unknown) => {
    if (
      typeof targetId !== "string" ||
      targetId === socket.id ||
      !onlineUsers.has(targetId)
    ) {
      socket.emit("chat-request-result", {
        status: "unavailable",
        targetId,
      });
      return;
    }

    const hasPendingRequest = [...pendingChatRequests.values()].some(
      (request) => request.from === socket.id || request.to === socket.id
    );
    if (hasPendingRequest) {
      socket.emit("chat-request-result", {
        status: "pending",
        targetId,
      });
      return;
    }

    const requestId = randomUUID();
    const target = onlineUsers.get(targetId);
    if (!target) {
      socket.emit("chat-request-result", {
        status: "unavailable",
        targetId,
      });
      return;
    }

    pendingChatRequests.set(requestId, {
      from: socket.id,
      to: targetId,
      fromUsername: identity.username,
      toUsername: target.username,
    });
    io.to(targetId).emit("incoming-chat-request", {
      requestId,
      fromId: socket.id,
      username: identity.username,
      color: identity.color,
    });
    socket.emit("chat-request-result", {
      status: "sent",
      targetId,
      username: target.username,
    });
  });

  socket.on(
    "respond-chat-request",
    (data: { requestId?: unknown; accept?: unknown }) => {
      if (
        typeof data?.requestId !== "string" ||
        typeof data.accept !== "boolean"
      ) {
        return;
      }

      const request = pendingChatRequests.get(data.requestId);
      if (!request || request.to !== socket.id) return;
      pendingChatRequests.delete(data.requestId);

      const requester = io.sockets.sockets.get(request.from);
      if (!requester || !onlineUsers.has(request.from)) {
        socket.emit("chat-request-result", {
          status: "unavailable",
          targetId: request.from,
        });
        return;
      }

      if (!data.accept) {
        requester.emit("chat-request-result", {
          status: "declined",
          targetId: socket.id,
          username: identity.username,
        });
        return;
      }

      const roomId = `private-${randomUUID()}`;
      const members = new Set([request.from, socket.id]);
      privateConversations.set(roomId, members);
      requester.join(roomId);
      socket.join(roomId);
      requester.emit("private-chat-started", {
        roomId,
        username: identity.username,
      });
      socket.emit("private-chat-started", {
        roomId,
        username: request.fromUsername,
      });
    }
  );

  // Handle disconnections
  socket.on("disconnect", () => {
    onlineUsers.delete(socket.id);
    io.emit("user-offline", { id: socket.id });

    for (const [requestId, request] of pendingChatRequests) {
      if (request.from === socket.id || request.to === socket.id) {
        pendingChatRequests.delete(requestId);
        const otherId = request.from === socket.id ? request.to : request.from;
        io.to(otherId).emit("chat-request-result", {
          status: "unavailable",
          targetId: socket.id,
        });
      }
    }

    for (const [roomId, members] of privateConversations) {
      if (!members.has(socket.id)) continue;
      privateConversations.delete(roomId);
      for (const member of members) {
        if (member !== socket.id) {
          io.to(member).emit("private-chat-ended", { roomId });
        }
      }
    }

    console.log(`User disconnected: ${socket.id}`);
  });
});
 
// Start the server
httpServer.listen(PORT, () => {
  console.log(`Orbit API running at http://localhost:${PORT}`);
  console.log(`Allowed frontend origin: ${FRONTEND_URL}`);
});