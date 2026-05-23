const router = require("express").Router();
const store = require("../store");

// GET /api/rooms  — list all rooms with live counts
router.get("/", (_req, res) => {
  res.json({ rooms: store.listRooms() });
});

// GET /api/rooms/:id  — single room detail + recent messages
router.get("/:id", (req, res) => {
  const room = store.getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: "Room not found" });

  res.json({
    id: room.id,
    name: room.name,
    emoji: room.emoji,
    durationSec: room.durationSec,
    timerLeft: store.getTimerLeft(room),
    timerRunning: room.timerRunning,
    memberCount: room.users.size,
    messages: store.getMessages(room.id, 50),
    users: store.listUsers(room.id).map(u => ({
      name: u.name,
      avatarId: u.avatarId,
    })),
  });
});

module.exports = router;
