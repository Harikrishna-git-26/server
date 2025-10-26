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
} else {
  server = http.createServer(app);
}

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Short ID generator (5 uppercase characters)
function generateShortId() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Maps shortId to { socketId, name, camOn, micOn }
const peers = new Map();
// Reverse map for socketId -> shortId
const socketToShort = new Map();

// Track host (first connected)
let hostShortId = null;

// Helper: get peer list as array for broadcast
const buildPeerList = () => {
  return Array.from(peers.values()).map((p) => ({
    id: p.shortId,
    name: p.name,
    camOn: p.camOn,
    micOn: p.micOn,
  }));
};

io.on("connection", (socket) => {
  const shortId = generateShortId();
  peers.set(shortId, {
    socketId: socket.id,
    shortId,
    name: "",
    camOn: true,
    micOn: true,
  });
  socketToShort.set(socket.id, shortId);

  // Set host if none present
  if (!hostShortId) hostShortId = shortId;

  socket.emit("connect-success", { id: shortId });
  io.emit("host", { id: hostShortId });
  io.emit("update-peers", buildPeerList());

  // Set user name
  socket.on("set-name", ({ name }) => {
    const info = peers.get(shortId);
    if (info) {
      info.name = name;
      peers.set(shortId, info);
    }
    io.emit("peer-updated", {
      id: shortId,
      name,
      camOn: info.camOn,
      micOn: info.micOn,
    });
    io.emit("update-peers", buildPeerList());
  });

  // Change camera/mic status
  socket.on("update-status", (status) => {
    const info = peers.get(shortId);
    if (info) {
      info.camOn = status.camOn;
      info.micOn = status.micOn;
      peers.set(shortId, info);
      io.emit("peer-updated", {
        id: shortId,
        name: info.name,
        camOn: info.camOn,
        micOn: info.micOn,
      });
      io.emit("update-peers", buildPeerList());
    }
  });

  // Manual peer connection via ID – updates are now handled live by broadcast
  socket.on("connect-peer", (targetId) => {
    // No-op: peer list auto-updates, keep for future (direct events)
  });

  // Leave/Remove functionality
  socket.on("remove-peer", ({ id }) => {
    const info = peers.get(id);
    if (info) {
      const targetSocketId = info.socketId;
      io.to(targetSocketId).emit("remove-peer", { id }); // signal client to clean up/leave
      setTimeout(() => {
        if (io.sockets.sockets.get(targetSocketId)) {
          io.sockets.sockets.get(targetSocketId).disconnect(true);
        }
      }, 200); // give time for frontend to handle
    }
  });

  // Chat
  socket.on("send-message", ({ to, msg }) => {
    const toPeer = peers.get(to);
    if (toPeer) {
      io.to(toPeer.socketId).emit("receive-message", { from: shortId, msg });
    }
  });

  // Video sync
  socket.on("send-video", ({ to, url, action, time }) => {
    const toPeer = peers.get(to);
    if (toPeer) {
      io.to(toPeer.socketId).emit("receive-video", { url, action, time });
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    peers.delete(shortId);
    socketToShort.delete(socket.id);
    io.emit("peer-left", { id: shortId });

    // Reassign host if host left
    if (shortId === hostShortId) {
      const nextHost = peers.keys().next().value || null;
      hostShortId = nextHost;
      io.emit("host", { id: hostShortId });
    }
    io.emit("update-peers", buildPeerList());
  });

  // Forcibly leave (user exit) – just disconnects socket
  socket.on("leave", () => {
    socket.disconnect();
  });

  // For troubleshooting, allow full peer list request
  socket.on("request-peers", () => {
    socket.emit("update-peers", buildPeerList());
  });

  // Host info on demand
  socket.on("get-host", () => socket.emit("host", { id: hostShortId }));
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
