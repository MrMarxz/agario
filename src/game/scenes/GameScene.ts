import Phaser from "phaser";
import {
  playerMap,
  foodMap,
  ejectedMassMap,
  playerCellMap,
  pendingFoodEats,
  pendingEjectedMassEats,
  getConnection,
  getLocalIdentityHex,
  setOnEatenCallback,
  clearOnEatenCallback,
} from "@/game/stdbClient";

const WORLD_SIZE = 3000;
const GRID_SIZE = 50;
const FOOD_RADIUS = 6;
const INITIAL_MASS = 100;
const BASE_SPEED = 150;
const POSITION_SEND_INTERVAL_MS = 50;
const EJECT_COOLDOWN_MS = 200;
const SPLIT_COOLDOWN_MS = 500;
const SPLIT_LAUNCH_SPEED = 700; // px/sec initial velocity for split half

// Minimap constants (bottom-right corner)
const MMAP_SIZE = 160;
const MMAP_PAD = 12;

// Leaderboard constants (top-left corner)
const LB_X = 12;
const LB_Y = 12;
const LB_WIDTH = 180;

function massToRadius(mass: number): number {
  return Math.sqrt(mass) * 2;
}

type PlayerGfx = {
  circle: Phaser.GameObjects.Arc;
  nameText: Phaser.GameObjects.Text;
  splitCircle: Phaser.GameObjects.Arc;
};


export class GameScene extends Phaser.Scene {
  private playerName = "Player";

  // Local player state (optimistic client-side prediction)
  private localX = WORLD_SIZE / 2;
  private localY = WORLD_SIZE / 2;
  private localMass = INITIAL_MASS;
  private localRadius = massToRadius(INITIAL_MASS);
  private serverPositionInitialized = false;

  // Local player graphics
  private localCircle!: Phaser.GameObjects.Arc;
  private localNameText!: Phaser.GameObjects.Text;
  private localSplitCircle!: Phaser.GameObjects.Arc;

  // Split cell client-side state
  private splitCellId: bigint | null = null;
  private splitClientX = 0;
  private splitClientY = 0;
  private splitLaunchVx = 0;
  private splitLaunchVy = 0;
  private splitLaunching = false;
  private pendingSplitDir: { nx: number; ny: number } | null = null;
  // Merge animation: exponentially approach main cell each frame (tracks player movement)
  private splitMerging = false;
  private splitMergeElapsed = 0;

  // Ejected mass IDs currently being tweened to server position (immune to collision)
  private ejectedAnimating = new Set<bigint>();
  // Pending eject direction set when W is pressed; consumed on next ejected-mass insert
  private pendingEjectDir: { nx: number; ny: number; at: number } | null = null;

  // Remote players graphics (keyed by identity hex string)
  private remoteGfx = new Map<string, PlayerGfx>();

  // Food graphics (keyed by food id bigint)
  private foodGfx = new Map<bigint, Phaser.GameObjects.Arc>();

  // Ejected mass graphics (keyed by id bigint)
  private ejectedGfx = new Map<bigint, Phaser.GameObjects.Arc>();

  // Position sending throttle
  private lastPositionSentAt = 0;

  // Eject/split key cooldowns
  private lastEjectAt = 0;
  private lastSplitAt = 0;

  // Player-eats-player in-flight tracking
  private pendingPlayerEats = new Set<string>();

  // Eaten / respawn state
  private isEaten = false;
  private eatenOverlay!: Phaser.GameObjects.Container;

  // Minimap HUD elements
  private minimapLocalDot!: Phaser.GameObjects.Arc;
  private minimapPlayerDots = new Map<string, Phaser.GameObjects.Arc>();

  // Leaderboard HUD text entries
  private lbEntries: Phaser.GameObjects.Text[] = [];

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
    this.ejectedGfx = new Map();
    this.lastPositionSentAt = 0;
    this.lastEjectAt = 0;
    this.lastSplitAt = 0;
    this.pendingPlayerEats = new Set();
    this.minimapPlayerDots = new Map();
    this.lbEntries = [];
    this.serverPositionInitialized = false;
    this.isEaten = false;
    this.splitCellId = null;
    this.splitClientX = 0;
    this.splitClientY = 0;
    this.splitLaunchVx = 0;
    this.splitLaunchVy = 0;
    this.splitLaunching = false;
    this.splitMerging = false;
    this.splitMergeElapsed = 0;
    this.pendingSplitDir = null;
    this.pendingEjectDir = null;
    this.ejectedAnimating = new Set();
  }

  create(): void {
    this.drawGrid();
    this.drawBoundary();
    this.createLocalPlayer();
    this.createHUD();

    this.cameras.main.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);
    // startFollow is deferred until the server confirms our spawn position
    // to avoid the camera snapping across the world on first join.

    // Register eaten callback (fires when server deletes our player row)
    setOnEatenCallback(() => {
      this.handleEaten();
    });

    // Cleanup callbacks when scene shuts down
    this.events.once("shutdown", () => {
      clearOnEatenCallback();
      // Kill any in-flight ejected mass tweens to prevent callbacks on destroyed objects
      for (const emId of this.ejectedAnimating) {
        const gfx = this.ejectedGfx.get(emId);
        if (gfx) this.tweens.killTweensOf(gfx);
      }
      this.ejectedAnimating.clear();
    });

    // W key: eject mass toward cursor
    this.input.keyboard?.on("keydown-W", () => {
      this.tryEjectMass();
    });

    // Space key: split cell toward cursor
    this.input.keyboard?.on("keydown-SPACE", () => {
      this.trySplitCell();
    });
  }

  update(time: number, delta: number): void {
    if (this.isEaten) return;

    this.movePlayerTowardMouse(delta);
    this.updateSplitCells(delta);
    this.syncFromServer();
    this.checkFoodCollisions();
    this.checkEjectedMassCollisions();
    this.checkPlayerCollisions();
    this.sendPositionUpdate(time);
    this.updateLocalNameText();
    this.updateMinimap();
    this.updateLeaderboard();
  }

  // ---------------------------------------------------------------------------
  // World creation helpers
  // ---------------------------------------------------------------------------

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
    // Hidden until the server confirms the spawn position to avoid a camera jump
    this.localCircle = this.add
      .circle(this.localX, this.localY, this.localRadius, 0x4a90d9)
      .setStrokeStyle(2, 0x2c5f8a)
      .setDepth(10)
      .setVisible(false);

    // Split half rendered at depth 9 (below main cell)
    this.localSplitCircle = this.add
      .circle(this.localX, this.localY, this.localRadius, 0x4a90d9)
      .setStrokeStyle(2, 0x2c5f8a)
      .setDepth(9)
      .setVisible(false);

    this.localNameText = this.add
      .text(this.localX, this.localY - this.localRadius - 10, this.playerName, {
        fontSize: "16px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(11)
      .setVisible(false);
  }

  // ---------------------------------------------------------------------------
  // HUD creation
  // ---------------------------------------------------------------------------

  private createHUD(): void {
    const W = this.scale.width;
    const H = this.scale.height;

    // --- Minimap (bottom-right) ---
    const mx = W - MMAP_SIZE - MMAP_PAD;
    const my = H - MMAP_SIZE - MMAP_PAD;

    // Dark background
    this.add
      .rectangle(mx + MMAP_SIZE / 2, my + MMAP_SIZE / 2, MMAP_SIZE, MMAP_SIZE, 0x0a0a1e, 0.8)
      .setScrollFactor(0)
      .setDepth(98);

    // Border
    this.add
      .rectangle(mx + MMAP_SIZE / 2, my + MMAP_SIZE / 2, MMAP_SIZE + 2, MMAP_SIZE + 2)
      .setScrollFactor(0)
      .setDepth(99)
      .setStrokeStyle(2, 0x888888)
      .setFillStyle(0, 0);

    // "MAP" label
    this.add
      .text(mx + MMAP_SIZE / 2, my - 2, "MAP", {
        fontSize: "10px",
        color: "#aaaaaa",
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(101);

    // Local player dot (white, always on top)
    this.minimapLocalDot = this.add
      .circle(mx, my, 4, 0xffffff)
      .setScrollFactor(0)
      .setDepth(102)
      .setStrokeStyle(1, 0x000000);

    // --- Leaderboard (top-left) ---
    const lbHeight = 5 * 22 + 40;
    this.add
      .rectangle(LB_X + LB_WIDTH / 2, LB_Y + lbHeight / 2, LB_WIDTH, lbHeight, 0x000000, 0.6)
      .setScrollFactor(0)
      .setDepth(98)
      .setStrokeStyle(1, 0x555555);

    this.add
      .text(LB_X + 8, LB_Y + 8, "LEADERBOARD", {
        fontSize: "12px",
        color: "#ffdd00",
        fontStyle: "bold",
      })
      .setScrollFactor(0)
      .setDepth(100);

    for (let i = 0; i < 5; i++) {
      const entry = this.add
        .text(LB_X + 8, LB_Y + 28 + i * 22, "", {
          fontSize: "13px",
          color: "#ffffff",
        })
        .setScrollFactor(0)
        .setDepth(100);
      this.lbEntries.push(entry);
    }

    // --- Eaten overlay (centered) ---
    const overlayBg = this.add
      .rectangle(0, 0, 400, 120, 0x000000, 0.7)
      .setStrokeStyle(2, 0xff4444);

    const overlayText = this.add
      .text(0, -18, "You were eaten!", {
        fontSize: "28px",
        color: "#ff4444",
        stroke: "#000000",
        strokeThickness: 4,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const overlaySubtext = this.add
      .text(0, 18, "Respawning in 2 seconds...", {
        fontSize: "16px",
        color: "#cccccc",
      })
      .setOrigin(0.5);

    this.eatenOverlay = this.add
      .container(W / 2, H / 2, [overlayBg, overlayText, overlaySubtext])
      .setScrollFactor(0)
      .setDepth(200)
      .setVisible(false);
  }

  // ---------------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------------

  private movePlayerTowardMouse(delta: number): void {
    if (!this.serverPositionInitialized) return;
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

  // Move local split cell toward cursor; apply launch velocity when freshly split;
  // animate merge back into main cell when server removes the PlayerCell row
  private updateSplitCells(delta: number): void {
    // Merge animation: exponentially approach current main cell position each frame
    // (tracks the player as they move, unlike a fixed-target tween)
    if (this.splitMerging) {
      this.splitMergeElapsed += delta;
      const factor = 1 - Math.exp(-10 * (delta / 1000));
      this.splitClientX += (this.localX - this.splitClientX) * factor;
      this.splitClientY += (this.localY - this.splitClientY) * factor;
      this.localSplitCircle.setPosition(this.splitClientX, this.splitClientY);

      const dx = this.localX - this.splitClientX;
      const dy = this.localY - this.splitClientY;
      if (Math.sqrt(dx * dx + dy * dy) < 5 || this.splitMergeElapsed > 600) {
        this.splitMerging = false;
        this.localSplitCircle.setVisible(false);
      }
      return;
    }

    if (this.splitCellId === null) return;

    const cell = playerCellMap.get(this.splitCellId);
    if (!cell) return;

    const dt = delta / 1000;

    if (this.splitLaunching) {
      // Decay launch velocity to near-zero in ~1 second: e^(-5*1) ≈ 0.007
      const decay = Math.exp(-5 * dt);
      this.splitLaunchVx *= decay;
      this.splitLaunchVy *= decay;

      this.splitClientX = Phaser.Math.Clamp(
        this.splitClientX + this.splitLaunchVx * dt,
        cell.radius,
        WORLD_SIZE - cell.radius,
      );
      this.splitClientY = Phaser.Math.Clamp(
        this.splitClientY + this.splitLaunchVy * dt,
        cell.radius,
        WORLD_SIZE - cell.radius,
      );

      const speed = Math.sqrt(this.splitLaunchVx ** 2 + this.splitLaunchVy ** 2);
      if (speed < 30) {
        this.splitLaunching = false;
      }
    } else {
      // Follow cursor at mass-scaled speed
      const pointer = this.input.activePointer;
      const dx = pointer.worldX - this.splitClientX;
      const dy = pointer.worldY - this.splitClientY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 5) {
        const speed = BASE_SPEED / Math.sqrt(cell.mass / INITIAL_MASS);
        this.splitClientX = Phaser.Math.Clamp(
          this.splitClientX + (dx / dist) * speed * dt,
          cell.radius,
          WORLD_SIZE - cell.radius,
        );
        this.splitClientY = Phaser.Math.Clamp(
          this.splitClientY + (dy / dist) * speed * dt,
          cell.radius,
          WORLD_SIZE - cell.radius,
        );
      }
    }

    this.localSplitCircle.setPosition(this.splitClientX, this.splitClientY);
  }

  private updateLocalNameText(): void {
    this.localNameText.setPosition(
      this.localCircle.x,
      this.localCircle.y - this.localRadius - 10,
    );
  }

  // ---------------------------------------------------------------------------
  // Server sync
  // ---------------------------------------------------------------------------

  private syncFromServer(): void {
    const localIdentityHex = getLocalIdentityHex();

    // Reconcile local player with server state
    if (localIdentityHex) {
      const serverPlayer = playerMap.get(localIdentityHex);
      if (serverPlayer) {
        if (!this.serverPositionInitialized) {
          this.serverPositionInitialized = true;
          this.localX = serverPlayer.x;
          this.localY = serverPlayer.y;
          this.localCircle.setPosition(this.localX, this.localY);
          // Reveal circle and name text now that we have the real position
          this.localCircle.setVisible(true);
          this.localNameText.setVisible(true);
          // Snap camera to spawn point then begin smooth following
          this.cameras.main.centerOn(this.localX, this.localY);
          this.cameras.main.startFollow(this.localCircle, false, 0.1, 0.1);
        }
        if (serverPlayer.mass !== this.localMass) {
          this.localMass = serverPlayer.mass;
          this.localRadius = massToRadius(serverPlayer.mass);
          this.localCircle.setRadius(this.localRadius);
        }
        this.localCircle.setFillStyle(serverPlayer.color);
        this.localSplitCircle.setFillStyle(serverPlayer.color);

        // Sync local split cell using PlayerCell table.
        // The Rust module allows only one split at a time, so we take the first match.
        let localCell: (typeof playerCellMap extends Map<bigint, infer V> ? V : never) | undefined;
        for (const c of playerCellMap.values()) {
          if (c.playerIdentity.toHexString() === localIdentityHex) {
            localCell = c;
            break;
          }
        }

        if (localCell !== undefined) {
          const cell = localCell;

          if (this.splitCellId !== cell.cellId) {
            // New split cell appeared — cancel any ongoing merge animation
            this.splitMerging = false;
            this.splitCellId = cell.cellId;

            if (this.pendingSplitDir) {
              // Launch animation: start at main cell center, shoot outward
              this.splitClientX = this.localX;
              this.splitClientY = this.localY;
              this.splitLaunchVx = this.pendingSplitDir.nx * SPLIT_LAUNCH_SPEED;
              this.splitLaunchVy = this.pendingSplitDir.ny * SPLIT_LAUNCH_SPEED;
              this.splitLaunching = true;
              this.pendingSplitDir = null;
            } else {
              // No pending direction (e.g. reconnect) — snap to server position
              this.splitClientX = cell.x;
              this.splitClientY = cell.y;
              this.splitLaunchVx = 0;
              this.splitLaunchVy = 0;
              this.splitLaunching = false;
            }
            this.localSplitCircle.setPosition(this.splitClientX, this.splitClientY);
          }

          // Always update radius from server
          this.localSplitCircle.setRadius(massToRadius(cell.mass)).setVisible(true);
        } else if (this.splitCellId !== null) {
          // Split cell disappeared — start frame-by-frame merge animation
          this.splitCellId = null;
          this.splitLaunching = false;

          if (this.localSplitCircle.visible) {
            this.splitMerging = true;
            this.splitMergeElapsed = 0;
          }
        }
      }
    }

    // Sync remote players
    const knownRemoteIds = new Set(this.remoteGfx.keys());

    for (const [identityHex, player] of playerMap) {
      if (identityHex === localIdentityHex) continue;
      knownRemoteIds.delete(identityHex);

      // Find this remote player's split cell (if any) — no array allocation
      let remoteCell: (typeof playerCellMap extends Map<bigint, infer V> ? V : never) | null = null;
      for (const c of playerCellMap.values()) {
        if (c.playerIdentity.toHexString() === identityHex) {
          remoteCell = c;
          break;
        }
      }

      const existing = this.remoteGfx.get(identityHex);
      if (existing) {
        existing.circle.setPosition(player.x, player.y);
        existing.circle.setRadius(player.radius);
        existing.circle.setFillStyle(player.color);
        existing.nameText.setPosition(player.x, player.y - player.radius - 10);
        existing.nameText.setText(player.name);

        if (remoteCell) {
          existing.splitCircle
            .setPosition(remoteCell.x, remoteCell.y)
            .setRadius(massToRadius(remoteCell.mass))
            .setFillStyle(player.color)
            .setVisible(true);
        } else {
          existing.splitCircle.setVisible(false);
        }
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
        const splitCircle = this.add
          .circle(
            remoteCell?.x ?? player.x,
            remoteCell?.y ?? player.y,
            massToRadius(Math.max(remoteCell?.mass ?? 1, 1)),
            player.color,
          )
          .setStrokeStyle(2, 0x000000)
          .setDepth(8)
          .setVisible(remoteCell !== null);
        this.remoteGfx.set(identityHex, { circle, nameText, splitCircle });
      }
    }

    // Remove graphics for disconnected/eaten players
    for (const oldId of knownRemoteIds) {
      const gfx = this.remoteGfx.get(oldId);
      if (gfx) {
        gfx.circle.destroy();
        gfx.nameText.destroy();
        gfx.splitCircle.destroy();
        this.remoteGfx.delete(oldId);
      }
      this.pendingPlayerEats.delete(oldId);
    }

    // Sync food pellets
    const knownFoodIds = new Set(this.foodGfx.keys());
    for (const [foodId, food] of foodMap) {
      knownFoodIds.delete(foodId);
      if (!this.foodGfx.has(foodId)) {
        const pellet = this.add.circle(food.x, food.y, FOOD_RADIUS, 0xff6b6b).setDepth(1);
        this.foodGfx.set(foodId, pellet);
      }
    }
    for (const oldFoodId of knownFoodIds) {
      this.foodGfx.get(oldFoodId)?.destroy();
      this.foodGfx.delete(oldFoodId);
    }

    // Sync ejected mass pellets
    const knownEjectedIds = new Set(this.ejectedGfx.keys());
    for (const [emId, em] of ejectedMassMap) {
      knownEjectedIds.delete(emId);
      if (!this.ejectedGfx.has(emId)) {
        // Determine animation start position.
        // Consume pending eject direction if set within last 1 second so the
        // pellet appears to shoot from the surface of the blob regardless of size.
        let startX = em.x;
        let startY = em.y;
        let doTween = false;

        if (this.pendingEjectDir && this.time.now - this.pendingEjectDir.at < 1000) {
          startX = this.localX + this.pendingEjectDir.nx * this.localRadius;
          startY = this.localY + this.pendingEjectDir.ny * this.localRadius;
          this.pendingEjectDir = null;
          doTween = true;
        }

        const pellet = this.add
          .circle(startX, startY, em.radius, 0xf5a623)
          .setStrokeStyle(1, 0xcc8800)
          .setDepth(2);
        this.ejectedGfx.set(emId, pellet);

        if (doTween) {
          // Tween from player surface to the authoritative server position.
          // Using server position as the target eliminates both snap-back and
          // self-collision: the pellet always ends up exactly where the server
          // placed it, and it is immune to collision while the tween runs.
          this.ejectedAnimating.add(emId);
          this.tweens.add({
            targets: pellet,
            x: em.x,
            y: em.y,
            duration: 400,
            ease: "Power2",
            onComplete: () => {
              this.ejectedAnimating.delete(emId);
            },
          });
        }
      }
    }
    for (const oldEmId of knownEjectedIds) {
      const gfx = this.ejectedGfx.get(oldEmId);
      if (gfx) {
        if (this.ejectedAnimating.has(oldEmId)) {
          this.tweens.killTweensOf(gfx);
        }
        gfx.destroy();
      }
      this.ejectedGfx.delete(oldEmId);
      this.ejectedAnimating.delete(oldEmId);
    }
  }

  // ---------------------------------------------------------------------------
  // Collision detection
  // ---------------------------------------------------------------------------

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

  private checkEjectedMassCollisions(): void {
    const conn = getConnection();
    if (!conn) return;

    for (const [massId, em] of ejectedMassMap) {
      if (pendingEjectedMassEats.has(massId)) continue;
      if (this.ejectedAnimating.has(massId)) continue;
      const dx = em.x - this.localX;
      const dy = em.y - this.localY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < this.localRadius + em.radius) {
        pendingEjectedMassEats.add(massId);
        void conn.reducers.eatEjectedMass({ massId }).catch(() => {
          pendingEjectedMassEats.delete(massId);
        });
      }
    }
  }

  private checkPlayerCollisions(): void {
    const conn = getConnection();
    const localIdentityHex = getLocalIdentityHex();
    if (!conn || !localIdentityHex) return;

    // Clean up stale pending entries for players already removed from the map
    for (const pendingId of this.pendingPlayerEats) {
      if (!playerMap.has(pendingId)) {
        this.pendingPlayerEats.delete(pendingId);
      }
    }

    for (const [identityHex, player] of playerMap) {
      if (identityHex === localIdentityHex) continue;
      if (this.pendingPlayerEats.has(identityHex)) continue;
      // Must be at least 10% larger
      if (this.localMass < player.mass * 1.1) continue;

      const dx = player.x - this.localX;
      const dy = player.y - this.localY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Eat when local center overlaps target center within local radius
      if (dist < this.localRadius) {
        this.pendingPlayerEats.add(identityHex);
        void conn.reducers
          .eatPlayer({ targetIdentity: player.identity })
          .then(() => {
            this.pendingPlayerEats.delete(identityHex);
          })
          .catch(() => {
            this.pendingPlayerEats.delete(identityHex);
          });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Eject mass / split cell
  // ---------------------------------------------------------------------------

  private tryEjectMass(): void {
    if (this.isEaten) return;
    const now = this.time.now;
    if (now - this.lastEjectAt < EJECT_COOLDOWN_MS) return;
    this.lastEjectAt = now;

    const conn = getConnection();
    if (!conn) return;

    const pointer = this.input.activePointer;
    const dirX = pointer.worldX - this.localX;
    const dirY = pointer.worldY - this.localY;
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len < 1) return;

    const nx = dirX / len;
    const ny = dirY / len;

    // Save direction with timestamp so the next ejected-mass insert can animate
    this.pendingEjectDir = { nx, ny, at: now };

    void conn.reducers
      .ejectMass({ dirX: nx, dirY: ny })
      .catch((err: unknown) => {
        console.warn("[SpacetimeDB] ejectMass failed:", err);
        this.pendingEjectDir = null;
      });
  }

  private trySplitCell(): void {
    if (this.isEaten) return;
    const now = this.time.now;
    if (now - this.lastSplitAt < SPLIT_COOLDOWN_MS) return;
    this.lastSplitAt = now;

    const conn = getConnection();
    if (!conn) return;

    const pointer = this.input.activePointer;
    const dirX = pointer.worldX - this.localX;
    const dirY = pointer.worldY - this.localY;
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len < 1) return;

    const nx = dirX / len;
    const ny = dirY / len;

    // Save direction so the new split cell can launch with animation
    this.pendingSplitDir = { nx, ny };

    void conn.reducers
      .splitCell({ dirX: nx, dirY: ny })
      .catch((err: unknown) => {
        console.warn("[SpacetimeDB] splitCell failed:", err);
        this.pendingSplitDir = null;
      });
  }

  // ---------------------------------------------------------------------------
  // Eaten / respawn flow
  // ---------------------------------------------------------------------------

  private handleEaten(): void {
    if (this.isEaten) return;
    this.isEaten = true;
    this.eatenOverlay.setVisible(true);

    // Reset local visuals and split state
    this.localMass = INITIAL_MASS;
    this.localRadius = massToRadius(INITIAL_MASS);
    this.serverPositionInitialized = false;
    // Hide circle and name until the server confirms the new spawn position
    this.localCircle.setVisible(false);
    this.localNameText.setVisible(false);
    this.tweens.killTweensOf(this.localSplitCircle);
    this.localSplitCircle.setVisible(false);
    this.pendingPlayerEats.clear();
    this.splitCellId = null;
    this.splitLaunching = false;
    this.splitMerging = false;
    this.splitMergeElapsed = 0;
    this.pendingSplitDir = null;
    this.pendingEjectDir = null;
    // Kill in-flight ejected mass tweens so callbacks don't fire after respawn
    for (const emId of this.ejectedAnimating) {
      const gfx = this.ejectedGfx.get(emId);
      if (gfx) this.tweens.killTweensOf(gfx);
    }
    this.ejectedAnimating.clear();

    // Auto-respawn after 2 seconds
    this.time.delayedCall(2000, () => {
      this.doRespawn();
    });
  }

  private doRespawn(): void {
    this.isEaten = false;
    this.eatenOverlay.setVisible(false);

    const conn = getConnection();
    if (!conn) return;

    void conn.reducers
      .spawnPlayer({ name: this.playerName })
      .catch((err: unknown) => {
        console.error("[GameScene] respawn failed:", err);
      });
  }

  // ---------------------------------------------------------------------------
  // HUD updates
  // ---------------------------------------------------------------------------

  private updateMinimap(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const mx = W - MMAP_SIZE - MMAP_PAD;
    const my = H - MMAP_SIZE - MMAP_PAD;

    // Update local dot position
    const localDotX = mx + (this.localX / WORLD_SIZE) * MMAP_SIZE;
    const localDotY = my + (this.localY / WORLD_SIZE) * MMAP_SIZE;
    this.minimapLocalDot.setPosition(localDotX, localDotY);

    const localIdentityHex = getLocalIdentityHex();
    const knownDotIds = new Set(this.minimapPlayerDots.keys());

    for (const [identityHex, player] of playerMap) {
      if (identityHex === localIdentityHex) continue;
      knownDotIds.delete(identityHex);

      const dotX = mx + (player.x / WORLD_SIZE) * MMAP_SIZE;
      const dotY = my + (player.y / WORLD_SIZE) * MMAP_SIZE;

      const existing = this.minimapPlayerDots.get(identityHex);
      if (existing) {
        existing.setPosition(dotX, dotY);
        existing.setFillStyle(player.color);
      } else {
        const dot = this.add
          .circle(dotX, dotY, 3, player.color)
          .setScrollFactor(0)
          .setDepth(102);
        this.minimapPlayerDots.set(identityHex, dot);
      }
    }

    // Remove dots for players who left
    for (const oldId of knownDotIds) {
      this.minimapPlayerDots.get(oldId)?.destroy();
      this.minimapPlayerDots.delete(oldId);
    }
  }

  private updateLeaderboard(): void {
    const allPlayers = [...playerMap.values()].sort((a, b) => b.mass - a.mass).slice(0, 5);
    const localIdentityHex = getLocalIdentityHex();

    for (let i = 0; i < 5; i++) {
      const entry = this.lbEntries[i];
      if (!entry) continue;
      if (i < allPlayers.length) {
        const p = allPlayers[i]!;
        const isLocal = p.identity.toHexString() === localIdentityHex;
        entry.setText(`${i + 1}. ${p.name}  ${Math.round(p.mass)}`);
        entry.setColor(isLocal ? "#ffdd00" : "#ffffff");
      } else {
        entry.setText("");
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Position sending
  // ---------------------------------------------------------------------------

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

    // Also send split cell position when not in launch phase
    if (this.splitCellId !== null && !this.splitLaunching) {
      const cellId = this.splitCellId;
      void conn.reducers
        .updateCellPosition({ cellId, x: this.splitClientX, y: this.splitClientY })
        .catch((err: unknown) => {
          console.warn("[SpacetimeDB] update_cell_position failed:", err);
        });
    }
  }
}
