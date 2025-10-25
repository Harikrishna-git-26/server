import express from "express";
import https from "https";
import fs from "fs";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());

const server = https.createServer({
  key: fs.readFileSync("192.168.0.126-key.pem"),
  cert: fs.readFileSync("192.168.0.126.pem")
}, app);

const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const socketMap = {};
const namesMap = {};

function generateShortId() {
  return Math.random().toString(36).substring(2, 7);
}

io.on("connection", (socket) => {
  let shortId;
  do { shortId = generateShortId(); } while (socketMap[shortId]);
  socket.shortId = shortId;
  socketMap[shortId] = socket.id;

  socket.emit("yourShortId", shortId);

  socket.on("setName", (name) => { namesMap[socket.shortId] = name; });

  socket.on("signal", ({ toShortId, type, payload }) => {
    const to = socketMap[toShortId];
    if (to) io.to(to).emit("signal", { from: socket.shortId, type, payload });
  });

  socket.on("chat", (data) => {
    const name = data.name || namesMap[socket.shortId] || "User";
    io.emit("chat", { name, text: data.text });
  });

  socket.on("disconnect", () => {
    delete socketMap[socket.shortId];
    delete namesMap[socket.shortId];
  });
});

server.listen(5000, () => console.log("✅ HTTPS signaling server running on port 5000"));
