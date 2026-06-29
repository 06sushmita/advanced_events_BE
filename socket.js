const { Server } = require("socket.io");

let io = null;

/**
 * Wires up Socket.io on top of the existing HTTP server so every
 * connected browser tab gets pushed updates the instant a booking is
 * created, edited, or removed — no manual refresh, no polling.
 */
function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_ORIGIN || "*",
    },
  });

  io.on("connection", (socket) => {
    console.log(`Realtime client connected: ${socket.id}`);

    socket.on("disconnect", () => {
      console.log(`Realtime client disconnected: ${socket.id}`);
    });
  });

  return io;
}

function getIO() {
  if (!io) {
    throw new Error("Socket.io has not been initialized. Call initSocket(server) first.");
  }
  return io;
}

/** Broadcasts an event to every connected client. Safe no-op if sockets aren't up yet. */
function emitEvent(eventName, payload) {
  if (io) {
    io.emit(eventName, payload);
  }
}

module.exports = { initSocket, getIO, emitEvent };
