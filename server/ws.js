/**
 * WebSocket server for FocusSpace.
 *
 * Message protocol (JSON frames):
 *
 * CLIENT → SERVER
 *  { type: "join",    roomId, name, avatarId }
 *  { type: "leave" }
 *  { type: "chat",    text }
 *  { type: "timer",   action: "start"|"pause"|"reset" }
 *  { type: "ping" }
 *
 * SERVER → CLIENT
 *  { type: "welcome",    room, users, messages }
 *  { type: "user_join",  user, memberCount }
 *  { type: "user_leave", name, memberCount }
 *  { type: "chat",       message }
 *  { type: "timer_sync", timerLeft, timerRunning }
 *  { type: "timer_done" }
 *  { type: "room_list",  rooms }
 *  { type: "error",      message }
 *  { type: "pong" }
 */

const WebSocket = require("ws");
const store = require("./store");

const TIMER_TICK_MS = 1000;

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(wss, roomId, payload, excludeSocketId = null) {
  wss.clients.forEach(client => {
    if (
      client.readyState === WebSocket.OPEN &&
      client.roomId === roomId &&
      client.socketId !== excludeSocketId
    ) {
      client.send(JSON.stringify(payload));
    }
  });
}

function broadcastAll(wss, roomId, payload) {
  broadcast(wss, roomId, payload, null);
}

function initWS(server) {
  const wss = new WebSocket.Server({ server, path: "/" });

  console.log("[WS] WebSocket server initialised");

  // ── Global 1-second timer tick ────────────────────────────────────────────
  setInterval(() => {
    store.tickTimers(expiredRoomId => {
      // Notify all clients in the expired room
      broadcastAll(wss, expiredRoomId, { type: "timer_done" });
      // Also send final sync
      broadcastAll(wss, expiredRoomId, {
        type: "timer_sync",
        timerLeft: 0,
        timerRunning: false,
      });
      console.log(`[TIMER] Room "${expiredRoomId}" session completed`);
    });

    // Push live timer updates to all rooms that are running
    for (const room of store.rooms.values()) {
      if (!room.timerRunning) continue;
      const timerLeft = store.getTimerLeft(room);
      broadcastAll(wss, room.id, {
        type: "timer_sync",
        timerLeft,
        timerRunning: true,
      });
    }
  }, TIMER_TICK_MS);

  // ── Connection handler ────────────────────────────────────────────────────
  wss.on("connection", (ws, req) => {
    ws.socketId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    ws.roomId = null;
    ws.isAlive = true;

    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    console.log(`[WS] Client connected  id=${ws.socketId}  ip=${ip}`);

    // Heartbeat
    ws.on("pong", () => { ws.isAlive = true; });

    // ── Message handler ───────────────────────────────────────────────────
    ws.on("message", raw => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return send(ws, { type: "error", message: "Invalid JSON" });
      }

      switch (msg.type) {

        // ── join ────────────────────────────────────────────────────────────
        case "join": {
          const { roomId, name, avatarId } = msg;

          if (!roomId || !name) {
            return send(ws, { type: "error", message: "roomId and name required" });
          }

          // Leave previous room if any
          if (ws.roomId) _leaveRoom(ws, wss);

          const user = store.joinRoom(roomId, ws.socketId, name.trim().slice(0, 24), avatarId ?? 0);
          if (!user) {
            return send(ws, { type: "error", message: `Room "${roomId}" not found` });
          }

          ws.roomId = roomId;
          ws.name = name;
          ws.avatarId = avatarId ?? 0;

          const room = store.getRoom(roomId);

          // Send welcome packet to joining client
          send(ws, {
            type: "welcome",
            room: {
              id: room.id,
              name: room.name,
              emoji: room.emoji,
              durationSec: room.durationSec,
              timerLeft: store.getTimerLeft(room),
              timerRunning: room.timerRunning,
            },
            users: store.listUsers(roomId).map(u => ({
              name: u.name,
              avatarId: u.avatarId,
              isMe: u.socketId === ws.socketId,
            })),
            messages: store.getMessages(roomId, 50),
          });

          // Notify everyone else
          broadcast(wss, roomId, {
            type: "user_join",
            user: { name: user.name, avatarId: user.avatarId },
            memberCount: store.listUsers(roomId).length,
          }, ws.socketId);

          // System message in room
          const sysMsg = store.addMessage(roomId, "system", `${name} joined`, -1, true);
          broadcastAll(wss, roomId, { type: "chat", message: sysMsg });

          console.log(`[JOIN] "${name}" → room "${roomId}"  members=${store.listUsers(roomId).length}`);
          break;
        }

        // ── leave ───────────────────────────────────────────────────────────
        case "leave": {
          _leaveRoom(ws, wss);
          break;
        }

        // ── chat ────────────────────────────────────────────────────────────
        case "chat": {
          if (!ws.roomId) return send(ws, { type: "error", message: "Not in a room" });
          const text = (msg.text || "").trim().slice(0, 500);
          if (!text) return;

          const message = store.addMessage(ws.roomId, ws.name, text, ws.avatarId);
          broadcastAll(wss, ws.roomId, { type: "chat", message });
          break;
        }

        // ── timer control ───────────────────────────────────────────────────
        case "timer": {
          if (!ws.roomId) return send(ws, { type: "error", message: "Not in a room" });

          let payload;
          if (msg.action === "start")  payload = store.startTimer(ws.roomId);
          if (msg.action === "pause")  payload = store.pauseTimer(ws.roomId);
          if (msg.action === "reset")  payload = store.resetTimer(ws.roomId);

          if (payload) {
            broadcastAll(wss, ws.roomId, {
              type: "timer_sync",
              timerLeft: payload.timerLeft,
              timerRunning: payload.timerRunning,
              triggeredBy: ws.name,
            });
          }
          break;
        }

        // ── ping ────────────────────────────────────────────────────────────
        case "ping": {
          send(ws, { type: "pong" });
          break;
        }

        default:
          send(ws, { type: "error", message: `Unknown type: ${msg.type}` });
      }
    });

    // ── Disconnect ────────────────────────────────────────────────────────
    ws.on("close", () => {
      console.log(`[WS] Client disconnected  id=${ws.socketId}`);
      _leaveRoom(ws, wss);
    });

    ws.on("error", err => console.error(`[WS] Socket error id=${ws.socketId}`, err.message));
  });

  // ── Heartbeat interval (detect dead connections) ──────────────────────────
  const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);

  wss.on("close", () => clearInterval(heartbeat));

  return wss;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _leaveRoom(ws, wss) {
  if (!ws.roomId) return;
  const roomId = ws.roomId;
  const user = store.leaveRoom(roomId, ws.socketId);
  ws.roomId = null;

  if (!user) return;

  const sysMsg = store.addMessage(roomId, "system", `${user.name} left`, -1, true);
  broadcastAll(wss, roomId, { type: "chat", message: sysMsg });
  broadcast(wss, roomId, {
    type: "user_leave",
    name: user.name,
    memberCount: store.listUsers(roomId).length,
  }, ws.socketId);

  console.log(`[LEAVE] "${user.name}" ← room "${roomId}"  members=${store.listUsers(roomId).length}`);
}

module.exports = { initWS };
