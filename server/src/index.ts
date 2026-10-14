
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import authRouter from "./auth";

const app = express();

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
  },
});

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("join-room", (roomId: string) => {
    socket.join(roomId);
    socket.emit("room-joined", roomId);
  });

  socket.on("send-message", (message) => {
    if (
      typeof message?.roomId !== "string" ||
      typeof message?.text !== "string" ||
      !message.text.trim() ||
      message.text.length > 2000
    ) {
      return;
    }

    io.to(message.roomId).emit("new-message", {
      id: crypto.randomUUID(),
      roomId: message.roomId,
      text: message.text.trim(),
      senderId: socket.id,
      createdAt: new Date().toISOString(),
    });
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
  });
});

httpServer.listen(3000, () => {
  httpServer.listen(3000, "0.0.0.0", () => {
    console.log("ChatApp server running on port 3000");
  });
});