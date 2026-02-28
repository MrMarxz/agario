"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PALETTE: { hex: string; bg: string }[] = [
  { hex: "4a90d9", bg: "#4a90d9" },
  { hex: "e74c3c", bg: "#e74c3c" },
  { hex: "2ecc71", bg: "#2ecc71" },
  { hex: "f39c12", bg: "#f39c12" },
  { hex: "9b59b6", bg: "#9b59b6" },
  { hex: "1abc9c", bg: "#1abc9c" },
  { hex: "e91e63", bg: "#e91e63" },
  { hex: "00bcd4", bg: "#00bcd4" },
];

export default function LobbyPage() {
  const [name, setName] = useState("");
  const [color, setColor] = useState("4a90d9");
  const router = useRouter();

  const handlePlay = () => {
    const trimmed = name.trim();
    if (trimmed) {
      router.push(`/game?name=${encodeURIComponent(trimmed)}&color=${color}`);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-900 text-white">
      <h1 className="mb-2 text-6xl font-extrabold tracking-tight">Agar.io</h1>
      <p className="mb-10 text-gray-400">Clone</p>
      <div className="flex w-64 flex-col gap-4">
        <input
          type="text"
          placeholder="Enter your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handlePlay()}
          className="rounded-lg border border-gray-600 bg-white px-4 py-3 text-lg text-gray-900 placeholder-gray-400 outline-none focus:border-green-400 focus:ring-2 focus:ring-green-400"
          maxLength={20}
          autoFocus
        />
        <div>
          <p className="mb-2 text-sm text-gray-400">Pick a color</p>
          <div className="flex gap-2">
            {PALETTE.map((c) => (
              <button
                key={c.hex}
                onClick={() => setColor(c.hex)}
                style={{ backgroundColor: c.bg }}
                className={`h-8 w-8 rounded-full border-2 transition-transform ${
                  color === c.hex
                    ? "scale-125 border-white"
                    : "border-transparent hover:scale-110"
                }`}
                aria-label={`Color ${c.hex}`}
              />
            ))}
          </div>
        </div>
        <button
          onClick={handlePlay}
          disabled={!name.trim()}
          className="rounded-lg bg-green-500 px-6 py-3 text-xl font-bold transition-colors hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Play
        </button>
      </div>
    </main>
  );
}
