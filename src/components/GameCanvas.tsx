"use client";

import { useEffect, useRef } from "react";
import type PhaserType from "phaser";

type GameCanvasProps = {
  playerName: string;
};

export default function GameCanvas({ playerName }: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let game: PhaserType.Game | null = null;

    const initGame = async () => {
      const Phaser = (await import("phaser")).default;
      const { GameScene } = await import("@/game/scenes/GameScene");

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
        game?.scene.add("GameScene", GameScene, true, { playerName });
      });
    };

    void initGame();

    return () => {
      game?.destroy(true);
      game = null;
    };
  }, [playerName]);

  return <div ref={containerRef} className="h-screen w-screen overflow-hidden" />;
}
