// server.js
const fs = require("fs");
const http = require("http");
const https = require("https");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();

// -------------------------
// Express & Server Setup
// -------------------------
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const USE_HTTPS = process.env.USE_HTTPS === "true";

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

// -------------------------
// Socket.IO Setup
// -------------------------
const io = new Server(server, {
  cors: {
    origin: "*", // allow all for dev; restrict to frontend domain later
    methods: ["GET", "POST"],
  },
});

// Map shortIds to real socketIds
const idMap = new Map();

// Generate short unique IDs
function generateShortId() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// -------------------------
// Socket.IO Events
// -------------------------
io.on("connection", (socket) => {
  const shortId = generateShortId();
  idMap.set(shortId, socket.id);

  console.log(`🟢 Connected: ${socket.id} => ${shortId}`);

  // Send the short ID to the connected client
  socket.emit("connect-success", { id: shortId });

  // Connect manually via entered ID
  socket.on("connect-peer", (targetShortId) => {
    const targetSocketId = idMap.get(targetShortId);
    if (targetSocketId) {
      console.log(`🔗 ${shortId} connecting to ${targetShortId}`);
      io.to(targetSocketId).emit("new-connection", shortId);
    } else {
      socket.emit("error-message", `❌ No user found with ID ${targetShortId}`);
    }
  });

  // Chat message handling
  socket.on("send-message", ({ to, msg }) => {
    const targetSocketId = idMap.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit("receive-message", { from: shortId, msg });
    }
    console.log(`💬 ${shortId} → ${to}: ${msg}`);
  });

  // Video sync and URL sharing
  socket.on("send-video", ({ to, url, action, time }) => {
    const targetSocketId = idMap.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit("receive-video", { url, action, time });
    }
    console.log(`🎬 ${shortId} → ${to} | ${action || url}`);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`🔴 Disconnected: ${shortId} (${socket.id})`);
    idMap.delete(shortId);
    io.emit("user-left", { id: shortId });
  });
});

// -------------------------
// Server Startup
// -------------------------
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
