"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

const GameCanvas = dynamic(() => import("@/components/GameCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-black text-white">
      Loading game...
    </div>
  ),
});

function GameContent() {
  const searchParams = useSearchParams();
  const playerName = searchParams.get("name") ?? "Player";
  const colorStr = searchParams.get("color") ?? "0";
  const parsed = parseInt(colorStr, 16);
  const playerColor = isNaN(parsed) ? 0 : parsed;
  return <GameCanvas playerName={playerName} playerColor={playerColor} />;
}

export default function GamePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center bg-black text-white">
          Loading...
        </div>
      }
    >
      <GameContent />
    </Suspense>
  );
}
