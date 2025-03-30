import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { GameState, Player } from "../shared/types";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

const PORT = 3001;
const LASER_SPEED = 10;
const LASER_DAMAGE = 10;
const MAX_HEALTH = 100;
const DEFAULT_GAME_WIDTH = 1920;
const DEFAULT_GAME_HEIGHT = 1080;

const gameState: GameState = {
  players: new Map<string, Player>(),
  lasers: [],
  gameStatus: "waiting",
  waitingPlayers: [],
  gameWidth: DEFAULT_GAME_WIDTH,
  gameHeight: DEFAULT_GAME_HEIGHT,
};

// Add game loop for laser movement and collision detection
setInterval(() => {
  if (gameState.gameStatus !== "playing") return;

  gameState.lasers = gameState.lasers.filter((laser) => {
    // Move laser based on rotation
    const angle = laser.rotation;
    laser.x += Math.sin(angle) * LASER_SPEED;
    laser.y -= Math.cos(angle) * LASER_SPEED;

    // Check for collisions
    gameState.players.forEach((player, playerId) => {
      if (playerId !== laser.playerId) {
        const distance = Math.sqrt(
          Math.pow(player.x - laser.x, 2) + Math.pow(player.y - laser.y, 2)
        );
        if (distance < 20) {
          // Collision radius
          player.health -= laser.damage;
          if (player.health <= 0) {
            gameState.gameStatus = "ended";
            io.emit("gameState", {
              players: Object.fromEntries(gameState.players),
              lasers: gameState.lasers,
              gameStatus: gameState.gameStatus,
              waitingPlayers: gameState.waitingPlayers,
              gameWidth: gameState.gameWidth,
              gameHeight: gameState.gameHeight,
            });
          }
          return false; // Remove laser after hit
        }
      }
    });

    // Remove lasers that are out of bounds with some padding
    const padding = 100; // Add padding to prevent lasers from disappearing too early
    return (
      laser.x >= -padding &&
      laser.x <= gameState.gameWidth + padding &&
      laser.y >= -padding &&
      laser.y <= gameState.gameHeight + padding
    );
  });

  // Emit updated game state
  io.emit("gameState", {
    players: Object.fromEntries(gameState.players),
    lasers: gameState.lasers,
    gameStatus: gameState.gameStatus,
    waitingPlayers: gameState.waitingPlayers,
    gameWidth: gameState.gameWidth,
    gameHeight: gameState.gameHeight,
  });
}, 1000 / 60); // 60 FPS

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("joinGame", () => {
    // Reset player's health and position
    const existingPlayer = gameState.players.get(socket.id);
    if (existingPlayer) {
      existingPlayer.health = MAX_HEALTH;
      existingPlayer.x = Math.random() * gameState.gameWidth;
      existingPlayer.y = Math.random() * gameState.gameHeight;
      existingPlayer.rotation = 0;
      existingPlayer.velocity = { x: 0, y: 0 };
    } else {
      const player: Player = {
        id: socket.id,
        x: Math.random() * gameState.gameWidth,
        y: Math.random() * gameState.gameHeight,
        rotation: 0,
        velocity: { x: 0, y: 0 },
        health: MAX_HEALTH,
        maxHealth: MAX_HEALTH,
      };
      gameState.players.set(socket.id, player);
    }

    // Add to waiting players if not already there
    if (!gameState.waitingPlayers.includes(socket.id)) {
      gameState.waitingPlayers.push(socket.id);
    }

    // Clear all lasers
    gameState.lasers = [];

    // Check for matchmaking
    if (gameState.waitingPlayers.length >= 2) {
      gameState.gameStatus = "playing";
      gameState.waitingPlayers = [];
    }

    io.emit("gameState", {
      players: Object.fromEntries(gameState.players),
      lasers: gameState.lasers,
      gameStatus: gameState.gameStatus,
      waitingPlayers: gameState.waitingPlayers,
      gameWidth: gameState.gameWidth,
      gameHeight: gameState.gameHeight,
    });
  });

  socket.on(
    "playerMove",
    (data: { x: number; y: number; rotation: number }) => {
      const player = gameState.players.get(socket.id);
      if (player) {
        player.x = data.x;
        player.y = data.y;
        player.rotation = data.rotation;
        io.emit("gameState", {
          players: Object.fromEntries(gameState.players),
          lasers: gameState.lasers,
          gameStatus: gameState.gameStatus,
          waitingPlayers: gameState.waitingPlayers,
          gameWidth: gameState.gameWidth,
          gameHeight: gameState.gameHeight,
        });
      }
    }
  );

  socket.on("shoot", (data: { x: number; y: number; rotation: number }) => {
    const laser = {
      id: `${socket.id}-${Date.now()}`,
      x: data.x,
      y: data.y,
      rotation: data.rotation,
      playerId: socket.id,
      damage: LASER_DAMAGE,
    };
    gameState.lasers.push(laser);
    io.emit("gameState", {
      players: Object.fromEntries(gameState.players),
      lasers: gameState.lasers,
      gameStatus: gameState.gameStatus,
      waitingPlayers: gameState.waitingPlayers,
      gameWidth: gameState.gameWidth,
      gameHeight: gameState.gameHeight,
    });
  });

  socket.on(
    "updateGameDimensions",
    (data: { width: number; height: number }) => {
      gameState.gameWidth = data.width;
      gameState.gameHeight = data.height;
      io.emit("gameState", {
        players: Object.fromEntries(gameState.players),
        lasers: gameState.lasers,
        gameStatus: gameState.gameStatus,
        waitingPlayers: gameState.waitingPlayers,
        gameWidth: gameState.gameWidth,
        gameHeight: gameState.gameHeight,
      });
    }
  );

  socket.on("disconnect", () => {
    gameState.players.delete(socket.id);
    gameState.lasers = gameState.lasers.filter(
      (laser) => laser.playerId !== socket.id
    );
    gameState.waitingPlayers = gameState.waitingPlayers.filter(
      (id) => id !== socket.id
    );

    // Reset game status if not enough players
    if (gameState.players.size < 2) {
      gameState.gameStatus = "waiting";
    }

    io.emit("gameState", {
      players: Object.fromEntries(gameState.players),
      lasers: gameState.lasers,
      gameStatus: gameState.gameStatus,
      waitingPlayers: gameState.waitingPlayers,
      gameWidth: gameState.gameWidth,
      gameHeight: gameState.gameHeight,
    });
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
