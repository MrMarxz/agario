import { DbConnection } from "@/module_bindings";
import type { EjectedMass, FoodPellet, Player, PlayerCell } from "@/module_bindings/types";

export type { Player, FoodPellet, EjectedMass, PlayerCell };

// Shared state readable from Phaser game loop
export const playerMap = new Map<string, Player>();
export const foodMap = new Map<bigint, FoodPellet>();
export const ejectedMassMap = new Map<bigint, EjectedMass>();
export const playerCellMap = new Map<bigint, PlayerCell>();

// Tracks food/ejected-mass IDs where a reducer call was already sent, to avoid double-calls
export const pendingFoodEats = new Set<bigint>();
export const pendingEjectedMassEats = new Set<bigint>();

let _conn: DbConnection | null = null;
let _localIdentityHex: string | null = null;
// Incremented on each connect; callbacks check this to ignore stale connections
let _generation = 0;

// Called when the local player's row is deleted while still connected (i.e. eaten)
let _onEatenCallback: (() => void) | null = null;
// Called when a PlayerCell row is deleted (split half merged back or eaten)
let _onCellDeletedCallback: ((cellId: bigint) => void) | null = null;

export function getConnection(): DbConnection | null {
  return _conn;
}

export function getLocalIdentityHex(): string | null {
  return _localIdentityHex;
}

export function setOnEatenCallback(cb: () => void): void {
  _onEatenCallback = cb;
}

export function clearOnEatenCallback(): void {
  _onEatenCallback = null;
}

export function setOnCellDeletedCallback(cb: (cellId: bigint) => void): void {
  _onCellDeletedCallback = cb;
}

export function clearOnCellDeletedCallback(): void {
  _onCellDeletedCallback = null;
}

const STDB_URL =
  process.env.NEXT_PUBLIC_SPACETIMEDB_URL ?? "https://maincloud.spacetimedb.com";

export function connectToSpacetimeDB(playerName: string, playerColor: number): DbConnection {
  const myGen = ++_generation;

  const savedToken =
    typeof localStorage !== "undefined"
      ? (localStorage.getItem("agario_token") ?? undefined)
      : undefined;

  const conn = DbConnection.builder()
    .withUri(STDB_URL)
    .withDatabaseName("agario")
    .withToken(savedToken)
    .onConnect((connection, identity, token) => {
      if (myGen !== _generation) return; // stale connection
      _localIdentityHex = identity.toHexString();
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("agario_token", token);
      }
      connection
        .subscriptionBuilder()
        .onApplied(() => {
          if (myGen !== _generation) return;
          console.log("[SpacetimeDB] Subscription applied — spawning player");
          void connection.reducers.spawnPlayer({ name: playerName, color: playerColor }).catch((err: unknown) => {
            console.error("[SpacetimeDB] spawnPlayer failed:", err);
          });
        })
        .subscribe([
          "SELECT * FROM player",
          "SELECT * FROM food_pellet",
          "SELECT * FROM ejected_mass",
          "SELECT * FROM player_cell",
        ]);
    })
    .onDisconnect((_ctx, err) => {
      if (myGen !== _generation) return;
      if (err) console.error("[SpacetimeDB] Disconnected with error:", err);
      _localIdentityHex = null;
    })
    .onConnectError((_ctx, err) => {
      if (myGen !== _generation) return;
      console.error("[SpacetimeDB] Connection error:", err);
    })
    .build();

  conn.db.player.onInsert((_ctx, player) => {
    if (myGen !== _generation) return;
    playerMap.set(player.identity.toHexString(), player);
  });
  conn.db.player.onUpdate((_ctx, _old, newPlayer) => {
    if (myGen !== _generation) return;
    playerMap.set(newPlayer.identity.toHexString(), newPlayer);
  });
  conn.db.player.onDelete((_ctx, player) => {
    if (myGen !== _generation) return;
    const deletedHex = player.identity.toHexString();
    playerMap.delete(deletedHex);

    // If the local player was deleted while still connected, they were eaten by another player
    if (deletedHex === _localIdentityHex && _conn !== null) {
      _onEatenCallback?.();
    }
  });

  conn.db.food_pellet.onInsert((_ctx, food) => {
    if (myGen !== _generation) return;
    foodMap.set(food.id, food);
    pendingFoodEats.delete(food.id);
  });
  conn.db.food_pellet.onDelete((_ctx, food) => {
    if (myGen !== _generation) return;
    foodMap.delete(food.id);
    pendingFoodEats.delete(food.id);
  });

  conn.db.ejected_mass.onInsert((_ctx, em) => {
    if (myGen !== _generation) return;
    ejectedMassMap.set(em.id, em);
  });
  conn.db.ejected_mass.onDelete((_ctx, em) => {
    if (myGen !== _generation) return;
    ejectedMassMap.delete(em.id);
    pendingEjectedMassEats.delete(em.id);
  });

  conn.db.player_cell.onInsert((_ctx, cell) => {
    if (myGen !== _generation) return;
    playerCellMap.set(cell.cellId, cell);
  });
  conn.db.player_cell.onUpdate((_ctx, _old, newCell) => {
    if (myGen !== _generation) return;
    playerCellMap.set(newCell.cellId, newCell);
  });
  conn.db.player_cell.onDelete((_ctx, cell) => {
    if (myGen !== _generation) return;
    playerCellMap.delete(cell.cellId);
    _onCellDeletedCallback?.(cell.cellId);
  });

  _conn = conn;
  return conn;
}

export function cleanupSpacetimeDB(): void {
  _generation++; // invalidate all pending callbacks
  _onEatenCallback = null;
  _onCellDeletedCallback = null;
  if (_conn) {
    void _conn.reducers
      .despawnPlayer({})
      .catch((err: unknown) =>
        console.warn("[SpacetimeDB] despawn_player failed:", err),
      );
    _conn.disconnect();
    _conn = null;
  }
  _localIdentityHex = null;
  playerMap.clear();
  foodMap.clear();
  ejectedMassMap.clear();
  playerCellMap.clear();
  pendingFoodEats.clear();
  pendingEjectedMassEats.clear();
}
