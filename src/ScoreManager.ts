// ─── Points config ────────────────────────────────────────────────────────────

export const POINTS = {
  ELIMINATION:      300,   // hunter eliminates a chameleon
  SURVIVAL_BONUS:   500,   // chameleon survives the full round
  SURVIVAL_TICK:    2,     // chameleon earns per second survived
  ASSIST:           50,    // hunter spotted a chameleon (that was then caught)
  MISS_PENALTY:    -25,    // hunter misses a tag
};

export const XP_MULTIPLIER = 0.5; // XP = score * 0.5

// ─── Player score record ──────────────────────────────────────────────────────

export interface PlayerScore {
  playerId:      string;
  username:      string;
  role:          "chameleon" | "hunter";
  score:         number;
  xp:            number;
  eliminations:  number;   // hunters: how many caught | chameleons: 0
  survivalTime:  number;   // seconds survived (chameleons)
  isAlive:       boolean;
  eliminatedAt:  number | null; // timestamp
}

export interface MatchResult {
  winner:      "chameleons" | "hunters";
  mvp:         string;       // username of top scorer
  scores:      PlayerScore[];
  duration:    number;       // total round seconds
}

// ─── ScoreManager ─────────────────────────────────────────────────────────────

export class ScoreManager {
  private scores = new Map<string, PlayerScore>();
  private startTime = 0;

  // ── Setup ─────────────────────────────────────────────────────────────────

  registerPlayer(playerId: string, username: string, role: "chameleon" | "hunter") {
    this.scores.set(playerId, {
      playerId,
      username,
      role,
      score:        0,
      xp:           0,
      eliminations: 0,
      survivalTime: 0,
      isAlive:      true,
      eliminatedAt: null,
    });
  }

  removePlayer(playerId: string) {
    this.scores.delete(playerId);
  }

  startRound() {
    this.startTime = Date.now();
  }

  // ── Score events ──────────────────────────────────────────────────────────

  recordElimination(hunterId: string, chameleonId: string) {
    const hunter    = this.scores.get(hunterId);
    const chameleon = this.scores.get(chameleonId);

    if (hunter) {
      hunter.score        += POINTS.ELIMINATION;
      hunter.eliminations += 1;
      hunter.xp            = Math.floor(hunter.score * XP_MULTIPLIER);
    }

    if (chameleon) {
      const survived        = (Date.now() - this.startTime) / 1000;
      chameleon.survivalTime = Math.floor(survived);
      chameleon.isAlive      = false;
      chameleon.eliminatedAt = Date.now();
    }
  }

  recordMiss(hunterId: string) {
    const hunter = this.scores.get(hunterId);
    if (!hunter) return;
    hunter.score = Math.max(0, hunter.score + POINTS.MISS_PENALTY);
    hunter.xp    = Math.floor(hunter.score * XP_MULTIPLIER);
  }

  // ── Survival tick (call every second during hunt phase) ──────────────────

  tickSurvival() {
    this.scores.forEach((p) => {
      if (p.role === "chameleon" && p.isAlive) {
        p.score        += POINTS.SURVIVAL_TICK;
        p.survivalTime += 1;
        p.xp            = Math.floor(p.score * XP_MULTIPLIER);
      }
    });
  }

  // ── Survival bonus (round end — chameleons who survived) ─────────────────

  applySurvivalBonus() {
    this.scores.forEach((p) => {
      if (p.role === "chameleon" && p.isAlive) {
        p.score += POINTS.SURVIVAL_BONUS;
        p.xp     = Math.floor(p.score * XP_MULTIPLIER);
      }
    });
  }

  // ── Final result ─────────────────────────────────────────────────────────

  buildResult(winner: "chameleons" | "hunters"): MatchResult {
    if (winner === "chameleons") this.applySurvivalBonus();

    const scores = Array.from(this.scores.values())
      .sort((a, b) => b.score - a.score);

    const mvp = scores[0]?.username ?? "Unknown";
    const duration = Math.floor((Date.now() - this.startTime) / 1000);

    return { winner, mvp, scores, duration };
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  getScore(playerId: string): PlayerScore | undefined {
    return this.scores.get(playerId);
  }

  getAllScores(): PlayerScore[] {
    return Array.from(this.scores.values()).sort((a, b) => b.score - a.score);
  }

  reset() {
    this.scores.clear();
    this.startTime = 0;
  }
}
