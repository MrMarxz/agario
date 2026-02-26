"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LobbyPage() {
  const [name, setName] = useState("");
  const router = useRouter();

  const handlePlay = () => {
    const trimmed = name.trim();
    if (trimmed) {
      router.push(`/game?name=${encodeURIComponent(trimmed)}`);
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
          className="rounded-lg px-4 py-3 text-lg text-gray-900 outline-none focus:ring-2 focus:ring-green-400"
          maxLength={20}
          autoFocus
        />
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
