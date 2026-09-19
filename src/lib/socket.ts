// Socket.IO client wrapper for the tracking mini-service.
// Connects via the Caddy gateway using the XTransformPort query parameter.

"use client";

import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getTrackingSocket(): Socket {
  if (socket && socket.connected) return socket;
  if (!socket) {
    socket = io("/?XTransformPort=3003", {
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
