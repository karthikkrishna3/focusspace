/**
 * scripts/test-ws.js
 * Quick smoke test — run with: node scripts/test-ws.js
 * Requires the server to be running on localhost:4000
 */

const WebSocket = require("ws");
const http = require("http");

const BASE = "http://localhost:4000";
const WS_URL = "ws://localhost:4000";
let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}`);
    failed++;
  }
}

function get(path) {
  return new Promise((res, rej) => {
    http.get(`${BASE}${path}`, resp => {
      let data = "";
      resp.on("data", d => (data += d));
      resp.on("end", () => {
        try { res({ status: resp.statusCode, body: JSON.parse(data) }); }
        catch { res({ status: resp.statusCode, body: data }); }
      });
    }).on("error", rej);
  });
}

async function runTests() {
  console.log("\n🧪  FocusSpace Server Tests\n");

  // REST: health
  console.log("── REST ────────────────────────────────");
  const health = await get("/api/health");
  assert("GET /api/health returns 200",    health.status === 200);
  assert("health.status === 'ok'",         health.body.status === "ok");
  assert("health has uptime",              typeof health.body.uptime === "number");

  const rooms = await get("/api/rooms");
  assert("GET /api/rooms returns 200",     rooms.status === 200);
  assert("returns array of 4 rooms",       rooms.body.rooms?.length === 4);
  assert("rooms have timerLeft",           rooms.body.rooms?.[0]?.timerLeft >= 0);

  const room = await get("/api/rooms/deep");
  assert("GET /api/rooms/deep returns 200", room.status === 200);
  assert("room has durationSec",            room.body.durationSec === 3000);

  const notFound = await get("/api/rooms/doesnotexist");
  assert("GET /api/rooms/fake returns 404", notFound.status === 404);

  // WS: join, chat, leave
  console.log("\n── WebSocket ───────────────────────────");
  await new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    const received = [];

    ws.on("open", () => {
      assert("WS connection established", true);
      ws.send(JSON.stringify({ type: "join", roomId: "sprint", name: "testbot", avatarId: 0 }));
    });

    ws.on("message", raw => {
      const msg = JSON.parse(raw);
      received.push(msg.type);

      if (msg.type === "welcome") {
        assert("welcome packet received",      true);
        assert("welcome.room.id === 'sprint'", msg.room.id === "sprint");
        assert("welcome.users is array",       Array.isArray(msg.users));
        assert("welcome.messages is array",    Array.isArray(msg.messages));
        // Send a chat message
        ws.send(JSON.stringify({ type: "chat", text: "hello from testbot" }));
      }

      if (msg.type === "chat" && !msg.message?.system && msg.message?.from === "testbot") {
        assert("chat echo received",    true);
        assert("chat text matches",     msg.message.text === "hello from testbot");
        // Trigger a timer action
        ws.send(JSON.stringify({ type: "timer", action: "pause" }));
      }

      if (msg.type === "timer_sync") {
        assert("timer_sync received after pause", true);
        ws.send(JSON.stringify({ type: "ping" }));
      }

      if (msg.type === "pong") {
        assert("pong received", true);
        ws.close();
      }
    });

    ws.on("close", () => {
      assert("WS closed cleanly", true);
      resolve();
    });

    ws.on("error", err => {
      console.error("  WS error:", err.message);
      assert("WS connection (failed)", false);
      resolve();
    });

    setTimeout(() => { ws.terminate(); resolve(); }, 8000);
  });

  // Summary
  console.log(`\n────────────────────────────────────────`);
  console.log(`  Passed: ${passed}   Failed: ${failed}`);
  if (failed === 0) console.log("  🎉 All tests passed!\n");
  else console.log("  ⚠️  Some tests failed — is the server running?\n");

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error("Test runner error:", err);
  process.exit(1);
});
