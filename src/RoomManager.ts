import { Room, Player, PlayerRole } from "./types";

const ROOM_CODE_LENGTH = 6;
const MAX_ROOM_IDLE_MS = 1000 * 60 * 30; // 30 minutes

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();

  // ─── Create ─────────────────────────────────────────────────────────────────

  createRoom(hostId: string, username: string): Room {
    let code = generateRoomCode();
    while (this.rooms.has(code)) {
      code = generateRoomCode();
    }

    const host: Player = {
      id: hostId,
      username,
      role: "unassigned",
      color: "#ffffff",
      transform: { x: 0, y: 0, z: 0, rotationY: 0, animationState: "idle" },
      isAlive: true,
      score: 0,
      joinedAt: Date.now(),
    };

    const room: Room = {
      code,
      hostId,
      players: new Map([[hostId, host]]),
      status: "waiting",
      maxPlayers: 12,
      createdAt: Date.now(),
    };

    this.rooms.set(code, room);
    return room;
  }

  // ─── Join ────────────────────────────────────────────────────────────────────

  joinRoom(
    code: string,
    playerId: string,
    username: string
  ): { room: Room; player: Player } | { error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: "Room not found." };
    if (room.status === "playing") return { error: "Game already in progress." };
    if (room.players.size >= room.maxPlayers) return { error: "Room is full." };
    if (room.players.has(playerId)) return { error: "Already in this room." };

    const player: Player = {
      id: playerId,
      username,
      role: "unassigned",
      color: "#ffffff",
      transform: { x: 0, y: 0, z: 0, rotationY: 0, animationState: "idle" },
      isAlive: true,
      score: 0,
      joinedAt: Date.now(),
    };

    room.players.set(playerId, player);
    return { room, player };
  }

  // ─── Leave ───────────────────────────────────────────────────────────────────

  leaveRoom(playerId: string, code: string): Room | null {
    const room = this.rooms.get(code);
    if (!room) return null;

    room.players.delete(playerId);

    // If empty, delete the room
    if (room.players.size === 0) {
      this.rooms.delete(code);
      return null;
    }

    // Transfer host if needed
    if (room.hostId === playerId) {
      room.hostId = room.players.keys().next().value!;
    }

    return room;
  }

  // ─── Remove player from ALL rooms (on disconnect) ────────────────────────────

  removePlayerFromAllRooms(playerId: string): { room: Room; code: string } | null {
    for (const [code, room] of this.rooms.entries()) {
      if (room.players.has(playerId)) {
        room.players.delete(playerId);

        if (room.players.size === 0) {
          this.rooms.delete(code);
          return null;
        }

        if (room.hostId === playerId) {
          room.hostId = room.players.keys().next().value!;
        }

        return { room, code };
      }
    }
    return null;
  }

  // ─── Update Transform ────────────────────────────────────────────────────────

  updatePlayerTransform(
    playerId: string,
    code: string,
    transform: Player["transform"]
  ): boolean {
    const room = this.rooms.get(code);
    if (!room) return false;
    const player = room.players.get(playerId);
    if (!player) return false;
    player.transform = transform;
    return true;
  }

  // ─── Getters ─────────────────────────────────────────────────────────────────

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  getRoomOfPlayer(playerId: string): { room: Room; code: string } | null {
    for (const [code, room] of this.rooms.entries()) {
      if (room.players.has(playerId)) return { room, code };
    }
    return null;
  }

  getPlayersArray(room: Room): Player[] {
    return Array.from(room.players.values());
  }

  // ─── Cleanup stale rooms ──────────────────────────────────────────────────────

  cleanupStaleRooms(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      if (now - room.createdAt > MAX_ROOM_IDLE_MS && room.players.size === 0) {
        this.rooms.delete(code);
      }
    }
  }
}
