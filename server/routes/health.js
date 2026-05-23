const router = require("express").Router();
const store  = require("../store");

router.get("/", (_req, res) => {
  const rooms = store.listRooms();
  const totalUsers = rooms.reduce((acc, r) => acc + r.memberCount, 0);

  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    memoryMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
    rooms: rooms.length,
    totalUsers,
    ts: new Date().toISOString(),
  });
});

module.exports = router;
