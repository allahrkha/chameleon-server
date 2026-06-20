import express from "express";
import http from "http";
import cors from "cors";
import { Server, Socket } from "socket.io";
import { RoomManager } from "./RoomManager";
import {
  CreateRoomPayload,
  JoinRoomPayload,
  PlayerMovePayload,
} from "./types";

// ─── Setup ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  },
});

const roomManager = new RoomManager();

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// ─── Cleanup stale rooms every 10 minutes ────────────────────────────────────

setInterval(() => roomManager.cleanupStaleRooms(), 1000 * 60 * 10);

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on("connection", (socket: Socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // ── CREATE ROOM ─────────────────────────────────────────────────────────────
  socket.on("create_room", ({ username }: CreateRoomPayload) => {
    if (!username?.trim()) {
      socket.emit("error", { message: "Username is required." });
      return;
    }

    const room = roomManager.createRoom(socket.id, username.trim());
    socket.join(room.code);

    const player = room.players.get(socket.id)!;

    socket.emit("room_created", {
      roomCode: room.code,
      player,
    });

    console.log(`[ROOM] Created: ${room.code} by ${username} (${socket.id})`);
  });

  // ── JOIN ROOM ───────────────────────────────────────────────────────────────
  socket.on("join_room", ({ roomCode, username }: JoinRoomPayload) => {
    if (!username?.trim() || !roomCode?.trim()) {
      socket.emit("error", { message: "Username and room code are required." });
      return;
    }

    const result = roomManager.joinRoom(roomCode.trim(), socket.id, username.trim());

    if ("error" in result) {
      socket.emit("error", { message: result.error });
      return;
    }

    const { room, player } = result;
    socket.join(room.code);

    // Tell the joining player about everyone already in the room
    const existingPlayers = roomManager
      .getPlayersArray(room)
      .filter((p) => p.id !== socket.id);

    socket.emit("room_joined", {
      roomCode: room.code,
      player,
      existingPlayers,
    });

    // Tell everyone else a new player joined
    socket.to(room.code).emit("player_joined", { player });

    console.log(`[ROOM] ${username} joined ${room.code} (${socket.id})`);
  });

  // ── PLAYER MOVE ─────────────────────────────────────────────────────────────
  socket.on("player_move", ({ transform }: PlayerMovePayload) => {
    const result = roomManager.getRoomOfPlayer(socket.id);
    if (!result) return;

    const { code } = result;
    roomManager.updatePlayerTransform(socket.id, code, transform);

    // Broadcast to everyone else in the room (not sender)
    socket.to(code).emit("player_moved", {
      playerId: socket.id,
      transform,
    });
  });

  // ── LEAVE ROOM ──────────────────────────────────────────────────────────────
  socket.on("leave_room", () => {
    handlePlayerLeave(socket);
  });

  // ── DISCONNECT ──────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    handlePlayerLeave(socket);
  });

  // ── REQUEST ROOM STATE ──────────────────────────────────────────────────────
  socket.on("get_room_state", () => {
    const result = roomManager.getRoomOfPlayer(socket.id);
    if (!result) {
      socket.emit("error", { message: "You are not in a room." });
      return;
    }
    const { room, code } = result;
    socket.emit("room_state", {
      roomCode: code,
      players: roomManager.getPlayersArray(room),
      status: room.status,
    });
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function handlePlayerLeave(socket: Socket): void {
  const result = roomManager.removePlayerFromAllRooms(socket.id);
  if (!result) return;

  const { room, code } = result;
  socket.leave(code);

  const player = room.players.get(socket.id);
  const username = player?.username ?? "Unknown";

  io.to(code).emit("player_left", {
    playerId: socket.id,
    username,
  });

  // Optionally broadcast updated room state
  io.to(code).emit("room_state", {
    roomCode: code,
    players: roomManager.getPlayersArray(room),
    status: room.status,
  });

  console.log(`[ROOM] ${socket.id} left ${code}`);
}

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`🦎 Chameleon server running on port ${PORT}`);
});
