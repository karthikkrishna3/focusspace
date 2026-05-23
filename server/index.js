require("dotenv").config();
const http = require("http");
const app = require("./app");
const { initWS } = require("./ws");

const PORT = process.env.PORT || 4000;

const server = http.createServer(app);
initWS(server);

server.listen(PORT, () => {
  console.log(`\n🚀 FocusSpace server running on port ${PORT}`);
  console.log(`   REST  → http://localhost:${PORT}/api`);
  console.log(`   WS    → ws://localhost:${PORT}`);
  console.log(`   ENV   → ${process.env.NODE_ENV || "development"}\n`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received — shutting down gracefully");
  server.close(() => process.exit(0));
});
