// ─── Player ───────────────────────────────────────────────────────────────────

export type PlayerRole = "chameleon" | "hunter" | "unassigned";

export interface PlayerTransform {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  animationState: string; // "idle" | "walk" | "run" | "jump" etc.
}

export interface Player {
  id: string;          // socket.id
  username: string;
  role: PlayerRole;
  color: string;       // hex color for chameleons
  transform: PlayerTransform;
  isAlive: boolean;
  score: number;
  joinedAt: number;
}

// ─── Room ─────────────────────────────────────────────────────────────────────

export type RoomStatus = "waiting" | "playing" | "ended";

export interface Room {
  code: string;
  hostId: string;
  players: Map<string, Player>;
  status: RoomStatus;
  maxPlayers: number;
  createdAt: number;
}

// ─── Socket Events (Client → Server) ──────────────────────────────────────────

export interface CreateRoomPayload {
  username: string;
}

export interface JoinRoomPayload {
  roomCode: string;
  username: string;
}

export interface PlayerMovePayload {
  transform: PlayerTransform;
}

export interface LeaveRoomPayload {
  roomCode: string;
}

// ─── Socket Events (Server → Client) ──────────────────────────────────────────

export interface RoomCreatedPayload {
  roomCode: string;
  player: Player;
}

export interface RoomJoinedPayload {
  roomCode: string;
  player: Player;
  existingPlayers: Player[];
}

export interface PlayerJoinedPayload {
  player: Player;
}

export interface PlayerLeftPayload {
  playerId: string;
  username: string;
}

export interface PlayerMovedPayload {
  playerId: string;
  transform: PlayerTransform;
}

export interface ErrorPayload {
  message: string;
}

export interface RoomStatePayload {
  roomCode: string;
  players: Player[];
  status: RoomStatus;
}
