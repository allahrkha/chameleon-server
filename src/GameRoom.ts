import type { Server } from "socket.io";
import type { Room, Player, PlayerTransform } from "./types";
import { ScoreManager } from "./ScoreManager";
import { Validator } from "./Validator";

// ─── Phase ───────────────────────────────────────────────────────────────────

export type GamePhase = "waiting" | "hide" | "hunt" | "ended";

const HIDE_DURATION  = 20;   // seconds
const HUNT_DURATION  = 180;  // seconds
const MIN_PLAYERS    = 2;

// ─── GameRoom ────────────────────────────────────────────────────────────────

export class GameRoom {
  private phase: GamePhase = "waiting";
  private timeLeft  = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  private chameleons = new Set<string>(); // player ids
  private hunters    = new Set<string>();

  private scoreManager = new ScoreManager();
  private validator    = new Validator();

  constructor(
    private io: Server,
    private room: Room,
  ) {}

  // ── Start game ────────────────────────────────────────────────────────────

  startGame() {
    if (this.phase !== "waiting") return;
    if (this.room.players.size < MIN_PLAYERS) {
      this.broadcast("error", { message: "Need at least 2 players to start." });
      return;
    }

    this.assignRoles();
    this.scoreManager.reset();
    this.validator.reset();

    // Register all players with score manager
    this.room.players.forEach((p) => {
      const role = this.chameleons.has(p.id) ? "chameleon" : "hunter";
      this.scoreManager.registerPlayer(p.id, p.username, role);
    });

    this.transitionTo("hide");
  }

  // ── Role assignment (1 hunter per 4 players, min 1) ──────────────────────

  private assignRoles() {
    const players = Array.from(this.room.players.values());
    const shuffled = players.sort(() => Math.random() - 0.5);
    const hunterCount = Math.max(1, Math.floor(players.length / 4));

    this.hunters.clear();
    this.chameleons.clear();

    shuffled.forEach((p, i) => {
      if (i < hunterCount) this.hunters.add(p.id);
      else                  this.chameleons.add(p.id);
    });

    // Notify each player of their role
    this.room.players.forEach((p) => {
      const role = this.hunters.has(p.id) ? "hunter" : "chameleon";
      this.io.to(p.id).emit("role_assigned", { role });
    });

    // Broadcast team composition
    this.broadcast("teams_assigned", {
      hunters:    Array.from(this.hunters),
      chameleons: Array.from(this.chameleons),
    });
  }

  // ── Phase transitions ─────────────────────────────────────────────────────

  private transitionTo(phase: GamePhase) {
    this.stopTick();
    this.phase = phase;

    switch (phase) {
      case "hide":
        this.timeLeft = HIDE_DURATION;
        this.room.status = "playing";
        this.broadcast("phase_change", { phase: "hide", timeLeft: HIDE_DURATION });
        this.broadcast("announce", { message: "HIDE! Find your spot!" });
        this.startTick();
        break;

      case "hunt":
        this.timeLeft = HUNT_DURATION;
        this.scoreManager.startRound();
        this.broadcast("phase_change", { phase: "hunt", timeLeft: HUNT_DURATION });
        this.broadcast("announce", { message: "HUNTERS RELEASED! The hunt begins!" });
        this.startTick();
        break;

      case "ended":
        this.room.status = "ended";
        this.endGame();
        break;
    }
  }

  // ── Tick ─────────────────────────────────────────────────────────────────

  private startTick() {
    this.tickTimer = setInterval(() => {
      this.timeLeft = Math.max(0, this.timeLeft - 1);

      // Survival score tick during hunt
      if (this.phase === "hunt") {
        this.scoreManager.tickSurvival();

        // 1-minute warning
        if (this.timeLeft === 60) {
          this.broadcast("announce", { message: "ONE MINUTE REMAINING!" });
        }

        // Final countdown
        if (this.timeLeft <= 3 && this.timeLeft > 0) {
          this.broadcast("countdown_beep", { count: this.timeLeft });
        }
      }

      // Broadcast game state every second
      this.broadcastGameState();

      if (this.timeLeft <= 0) this.handleTimerEnd();
    }, 1000);
  }

  private stopTick() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private handleTimerEnd() {
    if (this.phase === "hide") {
      this.transitionTo("hunt");
    } else if (this.phase === "hunt") {
      // Chameleons survived → they win
      this.determineWinner("chameleons");
    }
  }

  // ── Broadcast game state ──────────────────────────────────────────────────

  private broadcastGameState() {
    this.broadcast("game_state", {
      phase:           this.phase,
      timeLeft:        this.timeLeft,
      chameleonsAlive: this.chameleons.size,
      huntersAlive:    this.hunters.size,
      scores:          this.scoreManager.getAllScores(),
    });
  }

  // ── Tag attempt (called from socket handler) ──────────────────────────────

  handleTagAttempt(
    hunterId:    string,
    chameleonId: string,
    hunterPos:   PlayerTransform,
    chameleonPos: PlayerTransform,
  ): { success: boolean; reason?: string } {

    if (!this.hunters.has(hunterId)) {
      return { success: false, reason: "not-a-hunter" };
    }
    if (!this.chameleons.has(chameleonId)) {
      return { success: false, reason: "target-not-found" };
    }

    // Server-side validation
    const check = this.validator.validateTag(hunterId, hunterPos, chameleonPos, this.phase);
    if (!check.valid) {
      // Miss penalty
      this.scoreManager.recordMiss(hunterId);
      this.io.to(hunterId).emit("tag_result", { success: false, reason: check.reason });
      return { success: false, reason: check.reason };
    }

    // Valid hit — eliminate the chameleon
    this.scoreManager.recordElimination(hunterId, chameleonId);
    this.chameleons.delete(chameleonId);

    // Notify everyone
    this.io.to(chameleonId).emit("you_were_eliminated", {
      by: this.room.players.get(hunterId)?.username ?? "A Hunter",
    });
    this.broadcast("player_eliminated", {
      chameleonId,
      hunterId,
      chameleonsRemaining: this.chameleons.size,
    });
    this.io.to(hunterId).emit("tag_result", {
      success: true,
      score:   this.scoreManager.getScore(hunterId)?.score ?? 0,
    });

    // Check win condition
    if (this.chameleons.size === 0) {
      this.determineWinner("hunters");
    }

    this.broadcastGameState();
    return { success: true };
  }

  // ── Move validation (called from socket handler) ──────────────────────────

  handlePlayerMove(playerId: string, transform: PlayerTransform): PlayerTransform {
    const result = this.validator.validateMove(playerId, transform);

    if (!result.valid && result.corrected) {
      // Send correction back to the cheating client
      this.io.to(playerId).emit("position_corrected", result.corrected);
      return result.corrected;
    }

    return transform;
  }

  // ── End game ──────────────────────────────────────────────────────────────

  private determineWinner(winner: "chameleons" | "hunters") {
    this.stopTick();
    this.phase = "ended";
    this.room.status = "ended";
    const result = this.scoreManager.buildResult(winner);
    this.broadcast("round_end", result);
    this.broadcast("announce", {
      message: winner === "hunters" ? "HUNTERS WIN!" : "CHAMELEONS WIN!",
    });
  }

  private endGame() {
    this.stopTick();
  }

  // ── Player disconnects mid-game ───────────────────────────────────────────

  handlePlayerLeave(playerId: string) {
    this.chameleons.delete(playerId);
    this.hunters.delete(playerId);
    this.validator.removePlayer(playerId);
    this.scoreManager.removePlayer(playerId);

    // If no chameleons left → hunters win
    if (this.phase === "hunt" && this.chameleons.size === 0 && this.hunters.size > 0) {
      this.determineWinner("hunters");
    }
    // If no hunters left → chameleons win
    if (this.phase === "hunt" && this.hunters.size === 0 && this.chameleons.size > 0) {
      this.determineWinner("chameleons");
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private broadcast(event: string, data: unknown) {
    this.io.to(this.room.code).emit(event, data);
  }

  getPhase()    { return this.phase; }
  isPlaying()   { return this.phase === "hunt" || this.phase === "hide"; }
  getTimeLeft() { return this.timeLeft; }

  dispose() {
    this.stopTick();
  }
}
