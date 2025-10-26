// server.js
const fs = require("fs");
const http = require("http");
const https = require("https");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const USE_HTTPS = process.env.USE_HTTPS === "true";

// Choose HTTP or HTTPS
let server;
if (
  USE_HTTPS &&
  fs.existsSync("./certs/key.pem") &&
  fs.existsSync("./certs/cert.pem")
) {
  const key = fs.readFileSync("./certs/key.pem");
  const cert = fs.readFileSync("./certs/cert.pem");
  server = https.createServer({ key, cert }, app);
  console.log("✅ Using local HTTPS with mkcert");
} else {
  server = http.createServer(app);
  console.log("🌐 Using HTTP (Render/Production)");
}

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all for now; restrict to your Vercel domain later
    methods: ["GET", "POST"],
  },
});

// Active socket connections
const peers = new Map();

io.on("connection", (socket) => {
  console.log(`🟢 Connected: ${socket.id}`);
  peers.set(socket.id, true);

  // Send connected ID to client
  socket.emit("connect-success", { id: socket.id });

  // ---- EVENTS ---- //

  // Manual connection: Connect to a friend by ID
  socket.on("connect-peer", (targetId) => {
    console.log(`🔗 ${socket.id} is connecting to ${targetId}`);
    io.to(targetId).emit("new-connection", socket.id);
  });

  // Chat messaging
  socket.on("send-message", ({ to, msg }) => {
    console.log(`💬 ${socket.id} -> ${to}: ${msg}`);
    io.to(to).emit("receive-message", { from: socket.id, msg });
  });

  // YouTube video sharing and playback synchronization
  socket.on("send-video", ({ to, url, action, time }) => {
    console.log(`🎬 Video event from ${socket.id} to ${to} | ${action || url}`);
    io.to(to).emit("receive-video", { url, action, time });
  });

  socket.on("disconnect", () => {
    peers.delete(socket.id);
    console.log(`🔴 Disconnected: ${socket.id}`);
    io.emit("user-left", { id: socket.id });
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
