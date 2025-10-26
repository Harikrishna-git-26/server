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

let server = http.createServer(app);

const io = new Server(server, {
  cors: {origin: "*", methods: ["GET", "POST"]}
});

// --- Room/Group logic: ---
const peers = new Map();
// groupPeers maps: shortId -> Set of connected peer shortIds (starts as just self)
const groupPeers = new Map();

function generateShortId() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Only send peer list of explicit connections (including self)
function buildPeerList(shortId) {
  const group = groupPeers.get(shortId) || new Set([shortId]);
  return Array.from(group).map(id => {
    const peer = peers.get(id);
    if (!peer) return null;
    return {
      id: peer.shortId,
      name: peer.name,
      camOn: peer.camOn,
      micOn: peer.micOn,
      streamId: peer.streamId ?? null,
    };
  }).filter(Boolean);
}

io.on("connection", socket => {
  const shortId = generateShortId();
  peers.set(shortId, {
    socketId: socket.id,
    shortId,
    name: "",
    camOn: false,
    micOn: false,
    streamId: null,
  });
  groupPeers.set(shortId, new Set([shortId]));

  socket.emit("connect-success", { id: shortId });
  socket.emit("update-peers", buildPeerList(shortId));

  // Name
  socket.on("set-name", ({ name }) => {
    const info = peers.get(shortId);
    if (info) {
      info.name = name;
      peers.set(shortId, info);
      socket.emit("peer-updated", {
        id: shortId,
        name,
        camOn: info.camOn,
        micOn: info.micOn,
      });
      socket.emit("update-peers", buildPeerList(shortId));
    }
  });

  // Cam/mic
  socket.on("update-status", (status) => {
    const info = peers.get(shortId);
    if (info) {
      info.camOn = !!status.camOn;
      info.micOn = !!status.micOn;
      peers.set(shortId, info);
      // Inform only group peers
      for (const peerId of (groupPeers.get(shortId) || [])) {
        const targetPeer = peers.get(peerId);
        if (targetPeer)
          io.to(targetPeer.socketId).emit("peer-updated", {
            id: shortId,
            name: info.name,
            camOn: info.camOn,
            micOn: info.micOn,
          });
      }
    }
  });

  // Connect to another by ID -- both gain each other as peers
  socket.on("connect-peer", (targetId) => {
    if (!targetId || !peers.has(targetId) || targetId === shortId) return;
    groupPeers.get(shortId).add(targetId);
    groupPeers.get(targetId).add(shortId);
    // update both, so peer lists reflect new group
    [shortId, targetId].forEach(id => {
      const p = peers.get(id);
      if (p) io.to(p.socketId).emit("update-peers", buildPeerList(id));
    });
  });

  // Offer/Answer signaling – only forward to peers in your group
  socket.on("offer", ({ to, signal, name }) => {
    if (groupPeers.get(shortId)?.has(to)) {
      const toPeer = peers.get(to);
      if (toPeer) io.to(toPeer.socketId).emit("offer", { from: shortId, signal, name });
    }
  });
  socket.on("answer", ({ to, signal }) => {
    if (groupPeers.get(shortId)?.has(to)) {
      const toPeer = peers.get(to);
      if (toPeer) io.to(toPeer.socketId).emit("answer", { from: shortId, signal });
    }
  });

  // Chat and video signaling (as above, only for group)
  socket.on("send-message", ({ to, msg, name }) => {
    if (groupPeers.get(shortId)?.has(to)) {
      const toPeer = peers.get(to);
      if (toPeer) io.to(toPeer.socketId).emit("receive-message", { from: shortId, name: name ?? "", msg });
    }
  });
  socket.on("send-video", ({ to, url, action, time }) => {
    if (groupPeers.get(shortId)?.has(to)) {
      const toPeer = peers.get(to);
      if (toPeer) io.to(toPeer.socketId).emit("receive-video", { url, action, time });
    }
  });

  // Remove/kick peer (host can only kick from group)
  socket.on("remove-peer", ({ id }) => {
    if (groupPeers.get(shortId)?.has(id)) {
      groupPeers.get(shortId).delete(id);
      groupPeers.get(id).delete(shortId);
      // update both
      [shortId, id].forEach(pid => {
        const peer = peers.get(pid);
        if (peer) io.to(peer.socketId).emit("update-peers", buildPeerList(pid));
      });
      // Optionally fully disconnect:
      const targetSocket = peers.get(id)?.socketId;
      if (targetSocket) {
        io.to(targetSocket).emit("remove-peer", { id });
        setTimeout(() => {
          if (io.sockets.sockets.get(targetSocket))
            io.sockets.sockets.get(targetSocket).disconnect(true);
        }, 200);
      }
    }
  });

  // Clean up
  socket.on("disconnect", () => {
    peers.delete(shortId);
    // Remove this peer from anyone's groups
    for (const groupSet of groupPeers.values()) {
      groupSet.delete(shortId);
    }
    groupPeers.delete(shortId);
  });

  socket.on("leave", () => socket.disconnect());
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
