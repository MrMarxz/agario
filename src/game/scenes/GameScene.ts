import Phaser from "phaser";
import {
  playerMap,
  foodMap,
  pendingFoodEats,
  getConnection,
  getLocalIdentityHex,
} from "@/game/stdbClient";

const WORLD_SIZE = 3000;
const GRID_SIZE = 50;
const FOOD_RADIUS = 6;
const INITIAL_MASS = 100;
const BASE_SPEED = 150;
const POSITION_SEND_INTERVAL_MS = 50;

function massToRadius(mass: number): number {
  return Math.sqrt(mass) * 2;
}

type PlayerGfx = {
  circle: Phaser.GameObjects.Arc;
  nameText: Phaser.GameObjects.Text;
};

export class GameScene extends Phaser.Scene {
  private playerName = "Player";

  // Local player state (optimistic client-side prediction)
  private localX = WORLD_SIZE / 2;
  private localY = WORLD_SIZE / 2;
  private localMass = INITIAL_MASS;
  private localRadius = massToRadius(INITIAL_MASS);
  // True after first server position sync — prevents continuous snap reconciliation
  private serverPositionInitialized = false;

  // Local player graphics
  private localCircle!: Phaser.GameObjects.Arc;
  private localNameText!: Phaser.GameObjects.Text;

  // Remote players graphics (keyed by identity hex string)
  private remoteGfx = new Map<string, PlayerGfx>();

  // Food graphics (keyed by food id bigint)
  private foodGfx = new Map<bigint, Phaser.GameObjects.Arc>();

  private lastPositionSentAt = 0;

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: object): void {
    const d = data as Partial<{ playerName: string }>;
    this.playerName = d.playerName ?? "Player";
    this.localX = WORLD_SIZE / 2;
    this.localY = WORLD_SIZE / 2;
    this.localMass = INITIAL_MASS;
    this.localRadius = massToRadius(INITIAL_MASS);
    this.remoteGfx = new Map();
    this.foodGfx = new Map();
    this.lastPositionSentAt = 0;
    this.serverPositionInitialized = false;
  }

  create(): void {
    this.drawGrid();
    this.drawBoundary();
    this.createLocalPlayer();

    this.cameras.main.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);
    this.cameras.main.startFollow(this.localCircle, false, 0.1, 0.1);
  }

  update(time: number, delta: number): void {
    this.movePlayerTowardMouse(delta);
    this.syncFromServer();
    this.checkFoodCollisions();
    this.sendPositionUpdate(time);
    this.localNameText.setPosition(
      this.localCircle.x,
      this.localCircle.y - this.localRadius - 10,
    );
  }

  private drawGrid(): void {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, 0xaaaaaa, 0.2);
    for (let x = 0; x <= WORLD_SIZE; x += GRID_SIZE) {
      graphics.lineBetween(x, 0, x, WORLD_SIZE);
    }
    for (let y = 0; y <= WORLD_SIZE; y += GRID_SIZE) {
      graphics.lineBetween(0, y, WORLD_SIZE, y);
    }
  }

  private drawBoundary(): void {
    const graphics = this.add.graphics();
    graphics.lineStyle(6, 0xff4444, 1);
    graphics.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);
  }

  private createLocalPlayer(): void {
    this.localCircle = this.add.circle(
      this.localX,
      this.localY,
      this.localRadius,
      0x4a90d9,
    );
    this.localCircle.setStrokeStyle(2, 0x2c5f8a);
    this.localCircle.setDepth(10);

    this.localNameText = this.add
      .text(
        this.localX,
        this.localY - this.localRadius - 10,
        this.playerName,
        {
          fontSize: "16px",
          color: "#ffffff",
          stroke: "#000000",
          strokeThickness: 3,
        },
      )
      .setOrigin(0.5, 1)
      .setDepth(11);
  }

  private movePlayerTowardMouse(delta: number): void {
    const pointer = this.input.activePointer;
    const worldX = pointer.worldX;
    const worldY = pointer.worldY;

    const dx = worldX - this.localCircle.x;
    const dy = worldY - this.localCircle.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 5) {
      const speed = BASE_SPEED / Math.sqrt(this.localMass / INITIAL_MASS);
      const dt = delta / 1000;
      const vx = (dx / dist) * speed;
      const vy = (dy / dist) * speed;

      this.localX = Phaser.Math.Clamp(
        this.localCircle.x + vx * dt,
        this.localRadius,
        WORLD_SIZE - this.localRadius,
      );
      this.localY = Phaser.Math.Clamp(
        this.localCircle.y + vy * dt,
        this.localRadius,
        WORLD_SIZE - this.localRadius,
      );

      this.localCircle.setPosition(this.localX, this.localY);
    }
  }

  private syncFromServer(): void {
    const localIdentityHex = getLocalIdentityHex();

    // Pull latest mass/radius/color and reconcile position for local player from server
    if (localIdentityHex) {
      const serverPlayer = playerMap.get(localIdentityHex);
      if (serverPlayer) {
        // On first server data, snap to server-assigned spawn position
        if (!this.serverPositionInitialized) {
          this.serverPositionInitialized = true;
          this.localX = serverPlayer.x;
          this.localY = serverPlayer.y;
          this.localCircle.setPosition(this.localX, this.localY);
        }
        if (serverPlayer.mass !== this.localMass) {
          this.localMass = serverPlayer.mass;
          this.localRadius = massToRadius(serverPlayer.mass);
          this.localCircle.setRadius(this.localRadius);
        }
        // Sync server-assigned color
        this.localCircle.setFillStyle(serverPlayer.color);
      }
    }

    // Sync remote players
    const knownRemoteIds = new Set(this.remoteGfx.keys());

    for (const [identityHex, player] of playerMap) {
      if (identityHex === localIdentityHex) continue;

      knownRemoteIds.delete(identityHex);

      const existing = this.remoteGfx.get(identityHex);

      if (existing) {
        existing.circle.setPosition(player.x, player.y);
        existing.circle.setRadius(player.radius);
        existing.circle.setFillStyle(player.color);
        existing.nameText.setPosition(player.x, player.y - player.radius - 10);
        existing.nameText.setText(player.name);
      } else {
        const circle = this.add
          .circle(player.x, player.y, player.radius, player.color)
          .setStrokeStyle(2, 0x000000)
          .setDepth(9);
        const nameText = this.add
          .text(player.x, player.y - player.radius - 10, player.name, {
            fontSize: "14px",
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 3,
          })
          .setOrigin(0.5, 1)
          .setDepth(10);
        this.remoteGfx.set(identityHex, { circle, nameText });
      }
    }

    // Remove graphics for disconnected players
    for (const oldId of knownRemoteIds) {
      const gfx = this.remoteGfx.get(oldId);
      if (gfx) {
        gfx.circle.destroy();
        gfx.nameText.destroy();
        this.remoteGfx.delete(oldId);
      }
    }

    // Sync food pellets
    const knownFoodIds = new Set(this.foodGfx.keys());

    for (const [foodId, food] of foodMap) {
      knownFoodIds.delete(foodId);
      if (!this.foodGfx.has(foodId)) {
        const pellet = this.add
          .circle(food.x, food.y, FOOD_RADIUS, 0xff6b6b)
          .setDepth(1);
        this.foodGfx.set(foodId, pellet);
      }
    }

    // Destroy graphics for deleted food
    for (const oldFoodId of knownFoodIds) {
      const pellet = this.foodGfx.get(oldFoodId);
      if (pellet) {
        pellet.destroy();
        this.foodGfx.delete(oldFoodId);
      }
    }
  }

  private checkFoodCollisions(): void {
    const conn = getConnection();
    if (!conn) return;

    for (const [foodId, food] of foodMap) {
      if (pendingFoodEats.has(foodId)) continue;

      const dx = food.x - this.localX;
      const dy = food.y - this.localY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < this.localRadius + FOOD_RADIUS) {
        pendingFoodEats.add(foodId);
        void conn.reducers.eatFood({ foodId }).catch(() => {
          pendingFoodEats.delete(foodId);
        });
      }
    }
  }

  private sendPositionUpdate(time: number): void {
    if (time - this.lastPositionSentAt < POSITION_SEND_INTERVAL_MS) return;
    this.lastPositionSentAt = time;

    const conn = getConnection();
    if (!conn) return;

    void conn.reducers
      .updatePosition({ x: this.localX, y: this.localY })
      .catch((err: unknown) => {
        console.warn("[SpacetimeDB] update_position failed:", err);
      });
  }
}
