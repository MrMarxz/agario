"use client";

import { useEffect, useRef } from "react";
import type PhaserType from "phaser";
import { connectToSpacetimeDB, cleanupSpacetimeDB } from "@/game/stdbClient";

type GameCanvasProps = {
  playerName: string;
  playerColor: number;
};

export default function GameCanvas({ playerName, playerColor }: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let game: PhaserType.Game | null = null;
    let cancelled = false;

    const initGame = async () => {
      try {
        connectToSpacetimeDB(playerName, playerColor);

        const Phaser = (await import("phaser")).default;
        if (cancelled) return;

        const { GameScene } = await import("@/game/scenes/GameScene");
        if (cancelled) return;

        game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: containerRef.current ?? undefined,
          backgroundColor: "#1a1a2e",
          scale: {
            mode: Phaser.Scale.RESIZE,
            autoCenter: Phaser.Scale.CENTER_BOTH,
          },
        });

        game.events.once("ready", () => {
          if (cancelled) {
            game?.destroy(true);
            game = null;
            return;
          }
          game?.scene.add("GameScene", GameScene, true, { playerName, playerColor });
        });
      } catch (err: unknown) {
        console.error("[GameCanvas] Failed to initialize game:", err);
      }
    };

    void initGame();

    return () => {
      cancelled = true;
      cleanupSpacetimeDB();
      game?.destroy(true);
      game = null;
    };
  }, [playerName, playerColor]);

  return (
    <div ref={containerRef} className="h-screen w-screen overflow-hidden" />
  );
}
