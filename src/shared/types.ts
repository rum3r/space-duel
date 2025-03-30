export interface Vector2 {
  x: number;
  y: number;
}

export interface Player {
  id: string;
  x: number;
  y: number;
  rotation: number;
  velocity: Vector2;
  health: number;
  maxHealth: number;
}

export interface Laser {
  id: string;
  x: number;
  y: number;
  rotation: number;
  playerId: string;
  damage: number;
}

export interface GameState {
  players: Map<string, Player>;
  lasers: Laser[];
  gameStatus: "waiting" | "playing" | "ended";
  waitingPlayers: string[];
  gameWidth: number;
  gameHeight: number;
}
