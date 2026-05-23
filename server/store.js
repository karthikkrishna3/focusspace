/**
 * RoomStore — in-memory room state for the FocusSpace server.
 *
 * In production with multiple EC2 instances you'd back this with
 * ElastiCache (Redis) so all nodes share state. For a single t2.micro
 * free-tier deployment this in-memory store is sufficient.
 *
 * Data shape:
 *  rooms: Map<roomId, Room>
 *
 *  Room {
 *    id, name, emoji, durationSec,
 *    timerLeft, timerRunning, timerStartedAt,
 *    users: Map<socketId, User>
 *    messages: Message[]   (capped at MAX_MSGS)
 *  }
 *
 *  User  { socketId, name, avatarId, joinedAt }
 *  Message { id, from, text, avatarId, ts, system }
 */

const { v4: uuid } = require("uuid");

const MAX_MSGS = 200; // keep last N messages per room

// Seed rooms — matches the four rooms on the frontend
const SEED_ROOMS = [
  { id: "deep",   name: "Deep Focus",  emoji: "🪐", durationSec: 50 * 60 },
  { id: "flow",   name: "Flow State",  emoji: "🌊", durationSec: 90 * 60 },
  { id: "sprint", name: "Sprint Zone", emoji: "⚡", durationSec: 25 * 60 },
  { id: "chill",  name: "Chill Study", emoji: "🌸", durationSec: 60 * 60 },
];

class RoomStore {
  constructor() {
    this.rooms = new Map();
    this._init();
  }

  _init() {
    for (const seed of SEED_ROOMS) {
      this.rooms.set(seed.id, {
        ...seed,
        timerLeft: seed.durationSec,
        timerRunning: false,
        timerStartedAt: null,  // Date.now() when last started
        timerLeftAtStart: seed.durationSec,
        users: new Map(),
        messages: [],
      });
    }
  }

  // ── Rooms ──────────────────────────────────────────────────────────────────

  getRoom(id) {
    return this.rooms.get(id) || null;
  }

  listRooms() {
    return [...this.rooms.values()].map(r => this._publicRoom(r));
  }

  /** Computed seconds-left accounting for elapsed time since last start */
  getTimerLeft(room) {
    if (!room.timerRunning || !room.timerStartedAt) return room.timerLeft;
    const elapsed = Math.floor((Date.now() - room.timerStartedAt) / 1000);
    return Math.max(0, room.timerLeftAtStart - elapsed);
  }

  // ── Timer ──────────────────────────────────────────────────────────────────

  startTimer(roomId) {
    const r = this.getRoom(roomId);
    if (!r || r.timerRunning) return null;
    r.timerLeftAtStart = r.timerLeft;
    r.timerStartedAt = Date.now();
    r.timerRunning = true;
    return this._timerPayload(r);
  }

  pauseTimer(roomId) {
    const r = this.getRoom(roomId);
    if (!r || !r.timerRunning) return null;
    r.timerLeft = this.getTimerLeft(r);
    r.timerRunning = false;
    r.timerStartedAt = null;
    return this._timerPayload(r);
  }

  resetTimer(roomId) {
    const r = this.getRoom(roomId);
    if (!r) return null;
    r.timerLeft = r.durationSec;
    r.timerLeftAtStart = r.durationSec;
    r.timerRunning = false;
    r.timerStartedAt = null;
    return this._timerPayload(r);
  }

  /** Tick — called every second by the WS server for running rooms */
  tickTimers(onExpire) {
    for (const r of this.rooms.values()) {
      if (!r.timerRunning) continue;
      const left = this.getTimerLeft(r);
      if (left <= 0) {
        r.timerLeft = 0;
        r.timerRunning = false;
        r.timerStartedAt = null;
        onExpire(r.id);
      }
    }
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  joinRoom(roomId, socketId, name, avatarId) {
    const r = this.getRoom(roomId);
    if (!r) return null;
    const user = { socketId, name, avatarId, joinedAt: Date.now() };
    r.users.set(socketId, user);
    // Auto-start timer when first user joins
    if (r.users.size === 1 && !r.timerRunning && r.timerLeft > 0) {
      this.startTimer(roomId);
    }
    return user;
  }

  leaveRoom(roomId, socketId) {
    const r = this.getRoom(roomId);
    if (!r) return null;
    const user = r.users.get(socketId);
    r.users.delete(socketId);
    // Pause timer when room is empty
    if (r.users.size === 0 && r.timerRunning) {
      this.pauseTimer(roomId);
    }
    return user;
  }

  /** Find which room a socket is in */
  findRoomBySocket(socketId) {
    for (const r of this.rooms.values()) {
      if (r.users.has(socketId)) return r;
    }
    return null;
  }

  listUsers(roomId) {
    const r = this.getRoom(roomId);
    if (!r) return [];
    return [...r.users.values()];
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  addMessage(roomId, from, text, avatarId, system = false) {
    const r = this.getRoom(roomId);
    if (!r) return null;
    const msg = { id: uuid(), from, text, avatarId: avatarId ?? -1, ts: Date.now(), system };
    r.messages.push(msg);
    if (r.messages.length > MAX_MSGS) r.messages.shift();
    return msg;
  }

  getMessages(roomId, limit = 50) {
    const r = this.getRoom(roomId);
    if (!r) return [];
    return r.messages.slice(-limit);
  }

  // ── Serialisers ────────────────────────────────────────────────────────────

  _publicRoom(r) {
    return {
      id: r.id,
      name: r.name,
      emoji: r.emoji,
      durationSec: r.durationSec,
      timerLeft: this.getTimerLeft(r),
      timerRunning: r.timerRunning,
      memberCount: r.users.size,
    };
  }

  _timerPayload(r) {
    return {
      roomId: r.id,
      timerLeft: this.getTimerLeft(r),
      timerRunning: r.timerRunning,
    };
  }
}

module.exports = new RoomStore(); // singleton
