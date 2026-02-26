import Phaser from "phaser";

const WORLD_SIZE = 3000;
const GRID_SIZE = 50;
const FOOD_COUNT = 200;
const FOOD_RADIUS = 6;
const INITIAL_MASS = 100;
const BASE_SPEED = 150;

const FOOD_COLORS = [
  0xff6b6b, 0x4ecdc4, 0x45b7d1, 0x96ceb4, 0xffeaa7, 0xdda0dd, 0xff7675,
  0x74b9ff, 0xa29bfe, 0xfd79a8,
];

function massToRadius(mass: number): number {
  return Math.sqrt(mass) * 2;
}

export class GameScene extends Phaser.Scene {
  private playerName = "Player";
  private playerMass = INITIAL_MASS;
  private playerRadius = massToRadius(INITIAL_MASS);
  private playerCircle!: Phaser.GameObjects.Arc;
  private nameText!: Phaser.GameObjects.Text;
  private foodPellets: Phaser.GameObjects.Arc[] = [];

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: object): void {
    const d = data as Partial<{ playerName: string }>;
    this.playerName = d.playerName ?? "Player";
    this.playerMass = INITIAL_MASS;
    this.playerRadius = massToRadius(INITIAL_MASS);
    this.foodPellets = [];
  }

  create(): void {
    this.drawGrid();
    this.drawBoundary();
    this.spawnFood();
    this.createPlayer();

    this.cameras.main.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);
    this.cameras.main.startFollow(this.playerCircle, false, 0.1, 0.1);
  }

  update(_time: number, delta: number): void {
    this.movePlayerTowardMouse(delta);
    this.checkFoodCollisions();
    this.nameText.setPosition(
      this.playerCircle.x,
      this.playerCircle.y - this.playerRadius - 10,
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

  private spawnFood(): void {
    for (let i = 0; i < FOOD_COUNT; i++) {
      const x = Phaser.Math.Between(20, WORLD_SIZE - 20);
      const y = Phaser.Math.Between(20, WORLD_SIZE - 20);
      const colorIndex = Phaser.Math.Between(0, FOOD_COLORS.length - 1);
      const color = FOOD_COLORS[colorIndex] ?? 0xffffff;
      const pellet = this.add.circle(x, y, FOOD_RADIUS, color);
      this.foodPellets.push(pellet);
    }
  }

  private createPlayer(): void {
    const startX = WORLD_SIZE / 2;
    const startY = WORLD_SIZE / 2;

    this.playerCircle = this.add.circle(
      startX,
      startY,
      this.playerRadius,
      0x4a90d9,
    );
    this.playerCircle.setStrokeStyle(2, 0x2c5f8a);

    this.nameText = this.add
      .text(startX, startY - this.playerRadius - 10, this.playerName, {
        fontSize: "16px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);
  }

  private movePlayerTowardMouse(delta: number): void {
    const pointer = this.input.activePointer;
    const worldX = pointer.worldX;
    const worldY = pointer.worldY;

    const dx = worldX - this.playerCircle.x;
    const dy = worldY - this.playerCircle.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 5) {
      const speed = BASE_SPEED / Math.sqrt(this.playerMass / INITIAL_MASS);
      const dt = delta / 1000;
      const vx = (dx / dist) * speed;
      const vy = (dy / dist) * speed;

      this.playerCircle.x = Phaser.Math.Clamp(
        this.playerCircle.x + vx * dt,
        this.playerRadius,
        WORLD_SIZE - this.playerRadius,
      );
      this.playerCircle.y = Phaser.Math.Clamp(
        this.playerCircle.y + vy * dt,
        this.playerRadius,
        WORLD_SIZE - this.playerRadius,
      );
    }
  }

  private checkFoodCollisions(): void {
    for (let i = this.foodPellets.length - 1; i >= 0; i--) {
      const food = this.foodPellets[i];
      if (!food) continue;

      const dx = food.x - this.playerCircle.x;
      const dy = food.y - this.playerCircle.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < this.playerRadius + FOOD_RADIUS) {
        food.destroy();
        this.foodPellets.splice(i, 1);
        this.playerMass += 1;
        this.playerRadius = massToRadius(this.playerMass);
        this.playerCircle.setRadius(this.playerRadius);
      }
    }
  }
}
