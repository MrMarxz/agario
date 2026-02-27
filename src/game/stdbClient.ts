import { DbConnection } from "@/module_bindings";
import type { FoodPellet, Player } from "@/module_bindings/types";

export type { Player, FoodPellet };

// Shared state readable from Phaser game loop
export const playerMap = new Map<string, Player>();
export const foodMap = new Map<bigint, FoodPellet>();
// Tracks food IDs where eat_food reducer was already called, to avoid double-calls
export const pendingFoodEats = new Set<bigint>();

let _conn: DbConnection | null = null;
let _localIdentityHex: string | null = null;
// Incremented on each connect; callbacks check this to ignore stale connections
let _generation = 0;

export function getConnection(): DbConnection | null {
  return _conn;
}

export function getLocalIdentityHex(): string | null {
  return _localIdentityHex;
}

export function connectToSpacetimeDB(playerName: string): DbConnection {
  const myGen = ++_generation;

  const savedToken =
    typeof localStorage !== "undefined"
      ? (localStorage.getItem("agario_token") ?? undefined)
      : undefined;

  const conn = DbConnection.builder()
    .withUri("https://maincloud.spacetimedb.com")
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
          void connection.reducers.spawnPlayer({ name: playerName }).catch((err: unknown) => {
            console.error("[SpacetimeDB] spawnPlayer failed:", err);
          });
        })
        .subscribe(["SELECT * FROM player", "SELECT * FROM food_pellet"]);
    })
    .onDisconnect((_ctx, err) => {
      if (myGen !== _generation) return;
      if (err) console.error("[SpacetimeDB] Disconnected with error:", err);
      _localIdentityHex = null;
    })
    .onConnectError((_ctx, err) => {
      if (myGen !== _generation) return; // stale connection, ignore
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
    playerMap.delete(player.identity.toHexString());
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

  _conn = conn;
  return conn;
}

export function cleanupSpacetimeDB(): void {
  _generation++; // invalidate all pending callbacks
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
  pendingFoodEats.clear();
}
