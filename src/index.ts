import express from "express";
import http from "http";
import cors from "cors";
import { Server, Socket } from "socket.io";
import { RoomManager } from "./RoomManager";
import { GameRoom } from "./GameRoom";
import { Validator } from "./Validator";
import {
  CreateRoomPayload,
  JoinRoomPayload,
  PlayerMovePayload,
} from "./types";

// ─── Setup ────────────────────────────────────────────────────────────────────

const PORT          = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] },
});

const roomManager = new RoomManager();

// Per-room game logic instances
const gameRooms = new Map<string, GameRoom>();

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), rooms: gameRooms.size });
});

// ─── Cleanup stale rooms every 10 min ─────────────────────────────────────────

setInterval(() => roomManager.cleanupStaleRooms(), 1000 * 60 * 10);

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on("connection", (socket: Socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // ── CREATE ROOM ─────────────────────────────────────────────────────────────
  socket.on("create_room", ({ username }: CreateRoomPayload) => {
    const nameCheck = Validator.validateUsername(username);
    if (!nameCheck.valid) {
      socket.emit("error", { message: nameCheck.reason });
      return;
    }

    const room   = roomManager.createRoom(socket.id, username.trim());
    socket.join(room.code);
    const player = room.players.get(socket.id)!;

    socket.emit("room_created", { roomCode: room.code, player });
    console.log(`[ROOM] Created: ${room.code} by ${username}`);
  });

  // ── JOIN ROOM ───────────────────────────────────────────────────────────────
  socket.on("join_room", ({ roomCode, username }: JoinRoomPayload) => {
    const nameCheck = Validator.validateUsername(username);
    if (!nameCheck.valid) { socket.emit("error", { message: nameCheck.reason }); return; }
    if (!Validator.validateRoomCode(roomCode)) { socket.emit("error", { message: "Invalid room code." }); return; }

    const result = roomManager.joinRoom(roomCode.trim(), socket.id, username.trim());
    if ("error" in result) { socket.emit("error", { message: result.error }); return; }

    const { room, player } = result;
    socket.join(room.code);

    const existingPlayers = roomManager.getPlayersArray(room).filter((p) => p.id !== socket.id);
    socket.emit("room_joined",   { roomCode: room.code, player, existingPlayers });
    socket.to(room.code).emit("player_joined", { player });
    console.log(`[ROOM] ${username} joined ${room.code}`);
  });

  // ── PLAYER MOVE ─────────────────────────────────────────────────────────────
  socket.on("player_move", ({ transform }: PlayerMovePayload) => {
    const result = roomManager.getRoomOfPlayer(socket.id);
    if (!result) return;

    const { code } = result;
    const gameRoom  = gameRooms.get(code);

    // Validate & possibly correct the move
    const finalTransform = gameRoom
      ? gameRoom.handlePlayerMove(socket.id, transform)
      : transform;

    roomManager.updatePlayerTransform(socket.id, code, finalTransform);
    socket.to(code).emit("player_moved", { playerId: socket.id, transform: finalTransform });
  });

  // ── COLOR CHANGE ────────────────────────────────────────────────────────────
  socket.on("player_color_change", ({ color }: { color: { r: number; g: number; b: number } }) => {
    const result = roomManager.getRoomOfPlayer(socket.id);
    if (!result) return;
    socket.to(result.code).emit("player_color_changed", { playerId: socket.id, color });
  });

  // ── START GAME (host only) ───────────────────────────────────────────────────
  socket.on("start_game", () => {
    const result = roomManager.getRoomOfPlayer(socket.id);
    if (!result) return;
    const { room, code } = result;

    if (room.hostId !== socket.id) {
      socket.emit("error", { message: "Only the host can start the game." });
      return;
    }
    if (gameRooms.has(code)) {
      socket.emit("error", { message: "Game already started." });
      return;
    }

    const gameRoom = new GameRoom(io, room);
    gameRooms.set(code, gameRoom);
    gameRoom.startGame();
    console.log(`[GAME] Started in room ${code}`);
  });

  // ── TAG ATTEMPT (hunter → chameleon) ─────────────────────────────────────────
  socket.on("tag_attempt", ({
    chameleonId,
    hunterTransform,
    chameleonTransform,
  }: {
    chameleonId:        string;
    hunterTransform:    { x: number; y: number; z: number; rotationY: number; animationState: string };
    chameleonTransform: { x: number; y: number; z: number; rotationY: number; animationState: string };
  }) => {
    const result = roomManager.getRoomOfPlayer(socket.id);
    if (!result) return;

    const gameRoom = gameRooms.get(result.code);
    if (!gameRoom) { socket.emit("error", { message: "Game not started." }); return; }

    gameRoom.handleTagAttempt(socket.id, chameleonId, hunterTransform, chameleonTransform);
  });

  // ── LEAVE ROOM ──────────────────────────────────────────────────────────────
  socket.on("leave_room", () => handleLeave(socket));

  // ── DISCONNECT ──────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    handleLeave(socket);
  });

  // ── GET ROOM STATE ───────────────────────────────────────────────────────────
  socket.on("get_room_state", () => {
    const result = roomManager.getRoomOfPlayer(socket.id);
    if (!result) { socket.emit("error", { message: "Not in a room." }); return; }
    const { room, code } = result;
    socket.emit("room_state", {
      roomCode: code,
      players:  roomManager.getPlayersArray(room),
      status:   room.status,
    });
  });
});

// ─── Leave helper ─────────────────────────────────────────────────────────────

function handleLeave(socket: Socket) {
  // Notify active game room
  const roomResult = roomManager.getRoomOfPlayer(socket.id);
  if (roomResult) {
    const gameRoom = gameRooms.get(roomResult.code);
    gameRoom?.handlePlayerLeave(socket.id);
  }

  const result = roomManager.removePlayerFromAllRooms(socket.id);
  if (!result) return;

  const { room, code } = result;
  socket.leave(code);

  const username = room.players.get(socket.id)?.username ?? "Unknown";
  io.to(code).emit("player_left",  { playerId: socket.id, username });
  io.to(code).emit("room_state",   {
    roomCode: code,
    players:  roomManager.getPlayersArray(room),
    status:   room.status,
  });

  // Clean up game room if empty
  if (room.players.size === 0) {
    gameRooms.get(code)?.dispose();
    gameRooms.delete(code);
  }

  console.log(`[ROOM] ${socket.id} left ${code}`);
}

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`🦎 Chameleon server running on port ${PORT}`);
});
