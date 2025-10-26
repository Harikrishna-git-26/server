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

app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

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

function generateShortId() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

const peers = new Map();
const socketToShort = new Map();
let hostShortId = null;

const buildPeerList = () =>
  Array.from(peers.values()).map((p) => ({
    id: p.shortId,
    name: p.name,
    camOn: p.camOn,
    micOn: p.micOn,
    streamId: p.streamId ?? null,
  }));

io.on("connection", (socket) => {
  const shortId = generateShortId();
  peers.set(shortId, {
    socketId: socket.id,
    shortId,
    name: "",
    camOn: false,
    micOn: false,
    streamId: null,
  });
  socketToShort.set(socket.id, shortId);

  if (!hostShortId) hostShortId = shortId;

  socket.emit("connect-success", { id: shortId });
  io.emit("host", { id: hostShortId });
  io.emit("update-peers", buildPeerList());

  socket.on("set-name", ({ name }) => {
    const info = peers.get(shortId);
    if (info) {
      info.name = name;
      peers.set(shortId, info);
      io.emit("peer-updated", {
        id: shortId,
        name,
        camOn: info.camOn,
        micOn: info.micOn,
      });
      io.emit("update-peers", buildPeerList());
    }
  });

  socket.on("update-status", (status) => {
    const info = peers.get(shortId);
    if (info) {
      info.camOn = !!status.camOn;
      info.micOn = !!status.micOn;
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

  socket.on("offer", ({ to, signal, name }) => {
    const toPeer = peers.get(to);
    if (toPeer) {
      io.to(toPeer.socketId).emit("offer", {
        from: shortId,
        signal,
        name,
      });
    }
  });

  socket.on("answer", ({ to, signal }) => {
    const toPeer = peers.get(to);
    if (toPeer) {
      io.to(toPeer.socketId).emit("answer", {
        from: shortId,
        signal,
      });
    }
  });

  socket.on("send-message", ({ to, msg, name }) => {
    const toPeer = peers.get(to);
    if (toPeer) {
      io.to(toPeer.socketId).emit("receive-message", {
        from: shortId,
        name: name || "",
        msg,
      });
    }
  });

  socket.on("send-video", ({ to, url, action, time }) => {
    const toPeer = peers.get(to);
    if (toPeer) {
      io.to(toPeer.socketId).emit("receive-video", { url, action, time });
    }
  });

  socket.on("connect-peer", () => {});

  socket.on("remove-peer", ({ id }) => {
    const info = peers.get(id);
    if (info) {
      io.to(info.socketId).emit("remove-peer", { id });
      setTimeout(() => {
        if (io.sockets.sockets.get(info.socketId)) {
          io.sockets.sockets.get(info.socketId).disconnect(true);
        }
      }, 200);
    }
  });

  socket.on("disconnect", () => {
    peers.delete(shortId);
    socketToShort.delete(socket.id);
    io.emit("peer-left", { id: shortId });

    if (shortId === hostShortId) {
      const nextHost = peers.keys().next().value || null;
      hostShortId = nextHost;
      io.emit("host", { id: hostShortId });
    }
    io.emit("update-peers", buildPeerList());
  });

  socket.on("leave", () => {
    socket.disconnect();
  });

  socket.on("request-peers", () => {
    socket.emit("update-peers", buildPeerList());
  });

  socket.on("get-host", () => {
    socket.emit("host", { id: hostShortId });
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
