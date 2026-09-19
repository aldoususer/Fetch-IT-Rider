// Socket.IO client wrapper for optional real-time tracking.
//
// Real-time updates degrade gracefully: live tracking always works via the
// 6-second polling fallback baked into the dashboards, and the socket is
// only used when a tracking service is configured.
//
// To enable it, point a small socket.io server at your deployment and set
// `NEXT_PUBLIC_TRACKING_SOCKET_URL` (e.g. `wss://tracking.example.com`).
// When the variable is absent — the default on Vercel — getTrackingSocket()
// returns null and the UI silently relies on polling.

"use client";

import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

const SOCKET_URL = process.env.NEXT_PUBLIC_TRACKING_SOCKET_URL;

export function getTrackingSocket(): Socket | null {
  // No tracking service configured — rely on polling.
  if (!SOCKET_URL) return null;

  if (socket && socket.connected) return socket;
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  } else {
    socket.connect();
  }
  return socket;
}

export function disconnectTrackingSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
