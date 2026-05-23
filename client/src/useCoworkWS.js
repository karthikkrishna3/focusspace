/**
 * useCoworkWS — React hook that manages the WebSocket connection to
 * the FocusSpace backend.
 *
 * Usage:
 *   const ws = useCoworkWS({ serverUrl: "ws://localhost:4000" });
 *
 *   ws.join(roomId, userName, avatarId)
 *   ws.sendChat(text)
 *   ws.controlTimer("start" | "pause" | "reset")
 *   ws.leave()
 *
 *   // reactive state
 *   ws.connected
 *   ws.room        — { id, name, emoji, durationSec, timerLeft, timerRunning }
 *   ws.users       — [{ name, avatarId, isMe }]
 *   ws.messages    — [{ id, from, text, avatarId, ts, system }]
 *   ws.timerLeft
 *   ws.timerRunning
 *   ws.sessionDone
 */

import { useCallback, useEffect, useRef, useState } from "react";

const RECONNECT_DELAY = 3000;
const MAX_MSG_HISTORY = 200;

export function useCoworkWS({ serverUrl }) {
  const [connected, setConnected]     = useState(false);
  const [room, setRoom]               = useState(null);
  const [users, setUsers]             = useState([]);
  const [messages, setMessages]       = useState([]);
  const [timerLeft, setTimerLeft]     = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [sessionDone, setSessionDone] = useState(false);

  const wsRef          = useRef(null);
  const pendingJoinRef = useRef(null);
  const reconnectRef   = useRef(null);
  const mountedRef     = useRef(true);

  const safe = fn => (...args) => { if (mountedRef.current) fn(...args); };

  // ── Send helper ────────────────────────────────────────────────────────────
  const sendRaw = useCallback(payload => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  // ── Message dispatcher ─────────────────────────────────────────────────────
  const onMessage = useCallback(safe(raw => {
    let msg;
    try { msg = JSON.parse(raw.data); } catch { return; }

    switch (msg.type) {
      case "welcome": {
        const { room: r, users: u, messages: m } = msg;
        setRoom(r);
        setUsers(u);
        setMessages(m);
        setTimerLeft(r.timerLeft);
        setTimerRunning(r.timerRunning);
        setSessionDone(false);
        break;
      }

      case "user_join":
        setUsers(prev => {
          const exists = prev.find(u => u.name === msg.user.name);
          return exists ? prev : [...prev, { ...msg.user, isMe: false }];
        });
        break;

      case "user_leave":
        setUsers(prev => prev.filter(u => u.name !== msg.name));
        break;

      case "chat":
        setMessages(prev => {
          const next = [...prev, msg.message];
          return next.length > MAX_MSG_HISTORY ? next.slice(-MAX_MSG_HISTORY) : next;
        });
        break;

      case "timer_sync":
        setTimerLeft(msg.timerLeft);
        setTimerRunning(msg.timerRunning);
        break;

      case "timer_done":
        setTimerLeft(0);
        setTimerRunning(false);
        setSessionDone(true);
        break;

      case "error":
        console.warn("[WS] Server error:", msg.message);
        break;

      default:
        break;
    }
  }), []);

  // ── Connect ────────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    const ws = new WebSocket(serverUrl);
    wsRef.current = ws;

    ws.onopen = safe(() => {
      setConnected(true);
      clearTimeout(reconnectRef.current);
      // Re-join if we were mid-session
      if (pendingJoinRef.current) {
        ws.send(JSON.stringify({ type: "join", ...pendingJoinRef.current }));
      }
    });

    ws.onmessage = onMessage;

    ws.onclose = safe(() => {
      setConnected(false);
      reconnectRef.current = setTimeout(connect, RECONNECT_DELAY);
    });

    ws.onerror = () => ws.close();
  }, [serverUrl, onMessage]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // ── Public API ─────────────────────────────────────────────────────────────

  const join = useCallback((roomId, name, avatarId) => {
    pendingJoinRef.current = { roomId, name, avatarId };
    sendRaw({ type: "join", roomId, name, avatarId });
  }, [sendRaw]);

  const leave = useCallback(() => {
    pendingJoinRef.current = null;
    sendRaw({ type: "leave" });
    setRoom(null);
    setUsers([]);
    setMessages([]);
    setSessionDone(false);
  }, [sendRaw]);

  const sendChat = useCallback(text => {
    if (text.trim()) sendRaw({ type: "chat", text });
  }, [sendRaw]);

  const controlTimer = useCallback(action => {
    sendRaw({ type: "timer", action });
  }, [sendRaw]);

  return {
    connected,
    room,
    users,
    messages,
    timerLeft,
    timerRunning,
    sessionDone,
    join,
    leave,
    sendChat,
    controlTimer,
  };
}
