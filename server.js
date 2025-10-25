// server.js
const fs = require("fs");
const http = require("http");
const https = require("https");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const USE_HTTPS = process.env.USE_HTTPS === "true"; // optional flag for local testing

let server;

// 🧩 Local HTTPS (only if USE_HTTPS=true and certs exist)
if (USE_HTTPS && fs.existsSync("./certs/key.pem") && fs.existsSync("./certs/cert.pem")) {
  const key = fs.readFileSync("./certs/key.pem");
  const cert = fs.readFileSync("./certs/cert.pem");
  server = https.createServer({ key, cert }, app);
  console.log("✅ Using local HTTPS with mkcert");
} else {
  server = http.createServer(app);
  console.log("🌐 Using HTTP (Render/Production)");
}

const io = new Server(server, {
  cors: {
    origin: "*", // For production, restrict to your frontend domain
    methods: ["GET", "POST"]
  }
});

// 🔹 Active peers
const peers = new Map();

io.on("connection", socket => {
  const shortId = Math.random().toString(36).substring(2, 7);
  peers.set(socket.id, shortId);
  console.log(`Connected: ${socket.id} (shortId: ${shortId})`);

  socket.emit("me", shortId);

  socket.on("disconnect", () => {
    peers.delete(socket.id);
    console.log(`Disconnected: ${socket.id}`);
    socket.broadcast.emit("callEnded");
  });

  socket.on("callUser", ({ userToCall, signalData, from, name }) => {
    io.to(userToCall).emit("callUser", { signal: signalData, from, name });
  });

  socket.on("answerCall", data => {
    io.to(data.to).emit("callAccepted", data.signal);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on port ${PORT}`);
});