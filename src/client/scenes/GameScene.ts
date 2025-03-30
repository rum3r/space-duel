import { Scene } from "phaser";
import io from "socket.io-client";
import { GameState, Player, Laser } from "../../shared/types";

export class GameScene extends Scene {
  private socket: any;
  private gameState: GameState;
  private playerSprites: Map<string, Phaser.GameObjects.Sprite>;
  private laserSprites: Map<string, Phaser.GameObjects.Rectangle>;
  private healthBars: Map<string, Phaser.GameObjects.Graphics>;

  constructor() {
    super({ key: "GameScene" });
    this.gameState = {
      players: new Map(),
      lasers: [],
      gameStatus: "waiting",
      waitingPlayers: [],
      gameWidth: window.innerWidth,
      gameHeight: window.innerHeight,
    };
    this.playerSprites = new Map();
    this.laserSprites = new Map();
    this.healthBars = new Map();
  }

  preload() {
    console.log("Preloading assets...");
    // Load game assets
    this.load.image("ship", "assets/ship.svg");
    this.load.image("laser", "assets/laser.svg");
  }

  create() {
    console.log("Creating game scene...");
    this.cameras.main.setBackgroundColor("#000000");

    // Set up fullscreen with proper scaling
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Configure the game scale
    this.scale.setGameSize(width, height);
    this.scale.setZoom(1);

    // Set camera size to match game size and ensure it covers the entire viewport
    this.cameras.main.setSize(width, height);
    this.cameras.main.setBounds(0, 0, width, height);
    this.cameras.main.setViewport(0, 0, width, height);

    // Connect to server
    this.socket = io("http://localhost:3001", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    // Send initial game dimensions to server
    this.socket.emit("updateGameDimensions", {
      width: width,
      height: height,
    });

    this.setupSocketListeners();

    // Handle window resize
    window.addEventListener("resize", () => {
      const newWidth = window.innerWidth;
      const newHeight = window.innerHeight;

      // Update game scale
      this.scale.setGameSize(newWidth, newHeight);

      // Update camera size, bounds, and viewport
      this.cameras.main.setSize(newWidth, newHeight);
      this.cameras.main.setBounds(0, 0, newWidth, newHeight);
      this.cameras.main.setViewport(0, 0, newWidth, newHeight);

      // Send new dimensions to server
      if (this.socket) {
        this.socket.emit("updateGameDimensions", {
          width: newWidth,
          height: newHeight,
        });
      }
    });

    // Setup input handlers
    this.setupInputHandlers();

    // Start game loop
    this.time.addEvent({
      delay: 1000 / 60,
      callback: this.updateGameState,
      callbackScope: this,
      loop: true,
    });
  }

  private setupSocketListeners() {
    this.socket.on("connect", () => {
      console.log("Connected to server");
      // Send current game dimensions when connecting
      this.socket.emit("updateGameDimensions", {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      this.socket.emit("joinGame");
    });

    this.socket.on("gameState", (state: GameState) => {
      console.log("Received game state:", state);
      this.gameState = {
        players: new Map(Object.entries(state.players)),
        lasers: state.lasers,
        gameStatus: state.gameStatus,
        waitingPlayers: state.waitingPlayers,
        gameWidth: state.gameWidth,
        gameHeight: state.gameHeight,
      };
      this.updateSprites();
      this.updateHealthBars();
      this.updateWaitingScreen();
      this.updateEndingScreen();
    });
  }

  private updateWaitingScreen() {
    // Remove existing waiting text if any
    const existingText = this.children.list.find(
      (child) =>
        child instanceof Phaser.GameObjects.Text &&
        (child as Phaser.GameObjects.Text).text.includes("Waiting")
    );
    if (existingText) {
      existingText.destroy();
    }

    if (this.gameState.gameStatus === "waiting") {
      const waitingText = this.add
        .text(
          this.cameras.main.centerX,
          this.cameras.main.centerY,
          "Waiting for opponent...",
          {
            fontSize: "32px",
            color: "#ffffff",
          }
        )
        .setOrigin(0.5);
    }
  }

  private updateEndingScreen() {
    // Remove existing ending text and restart button if any
    this.children.list.forEach((child) => {
      if (
        child instanceof Phaser.GameObjects.Text &&
        (child.text.includes("Won") ||
          child.text.includes("Press SPACE to Restart"))
      ) {
        child.destroy();
      }
    });

    if (this.gameState.gameStatus === "ended") {
      // Find the winning player (the one with health > 0)
      const winningPlayer = Array.from(this.gameState.players.values()).find(
        (player) => player.health > 0
      );

      if (winningPlayer) {
        const playerNumber =
          Array.from(this.gameState.players.keys()).indexOf(winningPlayer.id) +
          1;
        const endingText = this.add
          .text(
            this.cameras.main.centerX,
            this.cameras.main.centerY,
            `Player ${playerNumber} Won!`,
            {
              fontSize: "48px",
              color: "#ffffff",
              fontStyle: "bold",
            }
          )
          .setOrigin(0.5);

        // Add a restart button
        const restartButton = this.add
          .text(
            this.cameras.main.centerX,
            this.cameras.main.centerY + 60,
            "Press SPACE to Restart",
            {
              fontSize: "24px",
              color: "#ffffff",
            }
          )
          .setOrigin(0.5);

        // Make the button interactive
        restartButton.setInteractive({ useHandCursor: true });

        // Add click handler for the restart button
        restartButton.on("pointerdown", () => {
          this.socket.emit("joinGame");
        });

        // Add space key handler for restart
        if (this.input?.keyboard) {
          this.input.keyboard.once("keydown-SPACE", () => {
            this.socket.emit("joinGame");
          });
        }
      }
    }
  }

  private updateHealthBars() {
    this.gameState.players.forEach((player: Player) => {
      let healthBar = this.healthBars.get(player.id);
      if (!healthBar) {
        healthBar = this.add.graphics();
        this.healthBars.set(player.id, healthBar);
      }

      // Clear previous health bar
      healthBar.clear();

      // Draw background (red)
      healthBar.fillStyle(0xff0000, 1);
      healthBar.fillRect(player.x - 25, player.y - 40, 50, 5);

      // Draw health (green)
      const healthWidth = (player.health / player.maxHealth) * 50;
      healthBar.fillStyle(0x00ff00, 1);
      healthBar.fillRect(player.x - 25, player.y - 40, healthWidth, 5);
    });

    // Remove health bars for disconnected players
    this.healthBars.forEach((healthBar, id) => {
      if (!this.gameState.players.has(id)) {
        healthBar.destroy();
        this.healthBars.delete(id);
      }
    });
  }

  private setupInputHandlers() {
    if (!this.input?.keyboard) return;

    const cursors = this.input.keyboard.createCursorKeys();
    const speed = 8;
    const rotationSpeed = 0.1;

    // Add Q and E keys to cursors
    const qKey = this.input.keyboard.addKey("Q");
    const eKey = this.input.keyboard.addKey("E");

    // Update game state based on key states
    this.time.addEvent({
      delay: 1000 / 60,
      callback: () => {
        if (this.gameState.gameStatus !== "playing") return;

        const player = this.gameState.players.get(this.socket.id);
        if (!player) return;

        // Handle movement
        if (cursors.left.isDown) {
          player.velocity.x = -speed;
        } else if (cursors.right.isDown) {
          player.velocity.x = speed;
        } else {
          player.velocity.x = 0;
        }

        if (cursors.up.isDown) {
          player.velocity.y = -speed;
        } else if (cursors.down.isDown) {
          player.velocity.y = speed;
        } else {
          player.velocity.y = 0;
        }

        // Handle rotation
        if (qKey.isDown) {
          player.rotation -= rotationSpeed;
        }
        if (eKey.isDown) {
          player.rotation += rotationSpeed;
        }
      },
      loop: true,
    });

    // Handle shooting
    this.input.keyboard.on("keydown-SPACE", () => {
      if (this.gameState.gameStatus !== "playing") return;

      const player = this.gameState.players.get(this.socket.id);
      if (player) {
        const spawnDistance = 30;
        const spawnX = player.x + Math.sin(player.rotation) * spawnDistance;
        const spawnY = player.y - Math.cos(player.rotation) * spawnDistance;

        this.socket.emit("shoot", {
          x: spawnX,
          y: spawnY,
          rotation: player.rotation,
        });
      }
    });
  }

  private updateGameState() {
    if (this.gameState.gameStatus !== "playing") return;

    const player = this.gameState.players.get(this.socket.id);
    if (!player) return;

    // Update player position
    player.x += player.velocity.x;
    player.y += player.velocity.y;

    // Keep player in bounds
    player.x = Phaser.Math.Clamp(player.x, 0, this.cameras.main.width);
    player.y = Phaser.Math.Clamp(player.y, 0, this.cameras.main.height);

    // Emit player movement
    this.socket.emit("playerMove", {
      x: player.x,
      y: player.y,
      rotation: player.rotation,
    });
  }

  private updateSprites() {
    // Update player sprites
    this.gameState.players.forEach((player: Player) => {
      let sprite = this.playerSprites.get(player.id);
      if (!sprite) {
        sprite = this.add.sprite(player.x, player.y, "ship");
        this.playerSprites.set(player.id, sprite);
      } else {
        sprite.setPosition(player.x, player.y);
        sprite.setRotation(player.rotation);
      }
    });

    // Update laser sprites
    this.gameState.lasers.forEach((laser: Laser) => {
      let sprite = this.laserSprites.get(laser.id);
      if (!sprite) {
        sprite = this.add.rectangle(laser.x, laser.y, 4, 12, 0xff0000);
        this.laserSprites.set(laser.id, sprite);
      } else {
        sprite.setPosition(laser.x, laser.y);
        sprite.setRotation(laser.rotation);
      }
    });

    // Remove old sprites
    this.cleanupSprites();
  }

  private cleanupSprites() {
    // Remove disconnected player sprites
    this.playerSprites.forEach((sprite, id) => {
      if (!this.gameState.players.has(id)) {
        sprite.destroy();
        this.playerSprites.delete(id);
      }
    });

    // Remove old laser sprites
    this.laserSprites.forEach((sprite, id) => {
      if (!this.gameState.lasers.find((laser) => laser.id === id)) {
        sprite.destroy();
        this.laserSprites.delete(id);
      }
    });
  }
}
