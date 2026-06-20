import type { PlayerTransform } from "./types";

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_SPEED_PER_SEC   = 12;    // units/sec — run speed + tolerance
const MAX_TAG_DISTANCE    = 18;    // max distance for a valid tag
const MIN_TAG_DISTANCE    = 0;     // min distance (>0 = must be close)
const TAG_COOLDOWN_MS     = 500;   // min ms between tag attempts per hunter
const MAP_BOUNDARY        = 42;    // world boundary (units from center)

// ─── Validator ────────────────────────────────────────────────────────────────

export class Validator {
  // Track last position + time per player for speed check
  private lastPositions = new Map<string, { x: number; z: number; t: number }>();
  // Track last tag time per hunter
  private lastTagTime   = new Map<string, number>();

  // ── Position validation ───────────────────────────────────────────────────

  validateMove(
    playerId: string,
    transform: PlayerTransform,
  ): { valid: boolean; reason?: string; corrected?: PlayerTransform } {

    // ── Boundary check ───────────────────────────────────────────────────────
    const oob = Math.abs(transform.x) > MAP_BOUNDARY ||
                Math.abs(transform.z) > MAP_BOUNDARY;

    if (oob) {
      const corrected: PlayerTransform = {
        ...transform,
        x: Math.max(-MAP_BOUNDARY, Math.min(MAP_BOUNDARY, transform.x)),
        z: Math.max(-MAP_BOUNDARY, Math.min(MAP_BOUNDARY, transform.z)),
      };
      return { valid: false, reason: "out-of-bounds", corrected };
    }

    // ── Speed check ───────────────────────────────────────────────────────────
    const last = this.lastPositions.get(playerId);
    const now  = Date.now();

    if (last) {
      const dt   = (now - last.t) / 1000;
      if (dt > 0 && dt < 2) { // only check if time delta is reasonable
        const dx   = transform.x - last.x;
        const dz   = transform.z - last.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const speed = dist / dt;

        if (speed > MAX_SPEED_PER_SEC * 2) {
          // Teleport detected — reject
          return { valid: false, reason: "speed-hack" };
        }
      }
    }

    this.lastPositions.set(playerId, { x: transform.x, z: transform.z, t: now });
    return { valid: true };
  }

  // ── Tag validation ────────────────────────────────────────────────────────

  validateTag(
    hunterId:     string,
    hunterPos:    PlayerTransform,
    chameleonPos: PlayerTransform,
    phase:        string,
  ): { valid: boolean; reason?: string } {

    // Phase lock
    if (phase !== "hunt") {
      return { valid: false, reason: "phase-locked" };
    }

    // Cooldown
    const lastTag = this.lastTagTime.get(hunterId) ?? 0;
    if (Date.now() - lastTag < TAG_COOLDOWN_MS) {
      return { valid: false, reason: "cooldown" };
    }

    // Distance check
    const dx   = hunterPos.x - chameleonPos.x;
    const dz   = hunterPos.z - chameleonPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist > MAX_TAG_DISTANCE) {
      return { valid: false, reason: "too-far" };
    }

    this.lastTagTime.set(hunterId, Date.now());
    return { valid: true };
  }

  // ── Username validation ───────────────────────────────────────────────────

  static validateUsername(username: string): { valid: boolean; reason?: string } {
    if (!username || username.trim().length < 2) {
      return { valid: false, reason: "Username must be at least 2 characters." };
    }
    if (username.trim().length > 20) {
      return { valid: false, reason: "Username must be 20 characters or less." };
    }
    if (!/^[a-zA-Z0-9_\-\s]+$/.test(username)) {
      return { valid: false, reason: "Username contains invalid characters." };
    }
    return { valid: true };
  }

  // ── Room code validation ──────────────────────────────────────────────────

  static validateRoomCode(code: string): boolean {
    return /^[A-Z0-9]{4,8}$/.test(code.trim().toUpperCase());
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  removePlayer(playerId: string) {
    this.lastPositions.delete(playerId);
    this.lastTagTime.delete(playerId);
  }

  reset() {
    this.lastPositions.clear();
    this.lastTagTime.clear();
  }
}
