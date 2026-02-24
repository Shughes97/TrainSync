"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import BottomNav from "@/components/BottomNav";
import type { WodifyParsed, EnrichedSession } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadBadgeStyle(load: string): string {
  switch (load) {
    case "very_high": return "bg-red-100 text-red-700 border-red-200";
    case "high":      return "bg-orange-100 text-orange-700 border-orange-200";
    case "moderate":  return "bg-amber-100 text-amber-700 border-amber-200";
    default:          return "bg-green-100 text-green-700 border-green-200";
  }
}

function intensityColor(score: number): string {
  if (score >= 8) return "bg-red-500";
  if (score >= 6) return "bg-orange-500";
  if (score >= 4) return "bg-amber-500";
  return "bg-green-500";
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ParseItem = {
  id: string;
  dataUrl: string;
  status: "pending" | "parsing" | "done" | "error";
  parsed?: WodifyParsed;
  enriched?: EnrichedSession;
  error?: string;
  confirmed: boolean;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function LogPage() {
  const { status } = useSession();
  const router = useRouter();

  const [items, setItems] = useState<ParseItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status, router]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    e.target.value = ""; // reset so same files can be re-selected

    const newItems: ParseItem[] = new Array(files.length);
    let loaded = 0;

    files.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = () => {
        newItems[idx] = {
          id: `${Date.now()}-${idx}`,
          dataUrl: reader.result as string,
          status: "pending",
          confirmed: false,
        };
        loaded++;
        if (loaded === files.length) {
          setItems((prev) => [...prev, ...newItems]);
        }
      };
      reader.readAsDataURL(file);
    });
  }

  // Process pending items one at a time
  useEffect(() => {
    if (processingRef.current) return;
    const pending = items.find((item) => item.status === "pending");
    if (!pending) return;

    processingRef.current = true;

    setItems((prev) =>
      prev.map((item) =>
        item.id === pending.id ? { ...item, status: "parsing" } : item
      )
    );

    (async () => {
      try {
        const res = await fetch("/api/wodify/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: pending.dataUrl }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? "Parse failed");
        }
        const data = await res.json();
        setItems((prev) =>
          prev.map((item) =>
            item.id === pending.id
              ? { ...item, status: "done", parsed: data.parsed, enriched: data.enriched }
              : item
          )
        );
      } catch (err) {
        setItems((prev) =>
          prev.map((item) =>
            item.id === pending.id
              ? { ...item, status: "error", error: String(err) }
              : item
          )
        );
      } finally {
        processingRef.current = false;
      }
    })();
  }, [items]);

  function confirmItem(id: string) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, confirmed: true } : item))
    );
  }

  function retryItem(id: string) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status: "pending", error: undefined } : item
      )
    );
  }

  function reset() {
    setItems([]);
  }

  const allConfirmed = items.length > 0 && items.every((i) => i.confirmed);
  const confirmedCount = items.filter((i) => i.confirmed).length;
  const pendingCount = items.filter((i) => !i.confirmed).length;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-gray-50/90 backdrop-blur border-b border-gray-200">
        <div className="max-w-lg mx-auto px-4 py-3">
          <h1 className="font-bold text-gray-900 text-lg">Log Session</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-5">
        {/* Upload area */}
        {!allConfirmed && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <label
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center gap-3 w-full rounded-2xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
                pendingCount > 0
                  ? "border-indigo-300 bg-indigo-50"
                  : "border-gray-300 bg-white hover:border-indigo-300 hover:bg-indigo-50"
              }`}
            >
              <span className="text-4xl">📸</span>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700">
                  {items.length > 0
                    ? `${items.length} screenshot${items.length > 1 ? "s" : ""} selected — tap to add more`
                    : "Upload Wodify screenshots"}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Select one or multiple screenshots from your camera roll
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Per-item cards */}
        {items.map((item, idx) => (
          <div key={item.id} className="rounded-2xl overflow-hidden border border-gray-200 shadow-sm">
            {/* Image preview — hidden once confirmed */}
            {!item.confirmed && (
              <div className="bg-white border-b border-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.dataUrl}
                  alt={`Screenshot ${idx + 1}`}
                  className="w-full max-h-48 object-contain"
                />
              </div>
            )}

            {/* Parsing spinner */}
            {item.status === "parsing" && (
              <div className="flex flex-col items-center gap-3 py-6 bg-white">
                <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-gray-500">Parsing screenshot {idx + 1}…</p>
              </div>
            )}

            {/* Error */}
            {item.status === "error" && (
              <div className="bg-red-50 p-4">
                <p className="text-sm text-red-600">{item.error}</p>
                <button
                  onClick={() => retryItem(item.id)}
                  className="mt-2 text-sm text-red-500 underline"
                >
                  Try again
                </button>
              </div>
            )}

            {/* Result */}
            {item.status === "done" && item.parsed && !item.confirmed && (
              <div className="bg-white p-4 space-y-4">
                {item.parsed.date && (
                  <p className="text-xs text-gray-400">{item.parsed.date}</p>
                )}

                {/* Badges */}
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs font-medium bg-orange-100 text-orange-700 border border-orange-200 rounded-full px-2.5 py-1">
                    🏋️ {item.parsed.sessionType.replace(/_/g, " ")}
                  </span>
                  <span className={`text-xs font-medium border rounded-full px-2.5 py-1 ${loadBadgeStyle(item.parsed.overallLoad)}`}>
                    {item.parsed.overallLoad.replace("_", " ")} load
                  </span>
                  {item.parsed.box && (
                    <span className="text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200 rounded-full px-2.5 py-1">
                      📍 {item.parsed.box}
                    </span>
                  )}
                </div>

                {/* Sections */}
                {item.parsed.sections.length > 0 && (
                  <div className="space-y-2">
                    {item.parsed.sections.map((section, i) => (
                      <div key={i} className="bg-gray-50 rounded-xl p-3">
                        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
                          {section.type} — {section.name}
                        </p>
                        <p className="text-xs text-gray-600 whitespace-pre-line leading-relaxed">
                          {section.description}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Movements */}
                {(() => {
                  const all = item.parsed.sections.flatMap((s) => s.movements);
                  const unique = all.filter((m, i) => all.indexOf(m) === i);
                  return unique.length > 0 ? (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                        Movements
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {unique.map((m) => (
                          <span
                            key={m}
                            className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full px-2.5 py-1"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}

                {/* Strava match */}
                {item.enriched?.performance ? (
                  <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-3">
                    <span className="text-lg">🏃</span>
                    <div className="text-xs text-green-700">
                      <p className="font-semibold">Strava matched</p>
                      <p>
                        {item.enriched.performance.duration} min
                        {item.enriched.performance.averageHR != null &&
                          ` · avg HR ${item.enriched.performance.averageHR} bpm`}
                        {item.enriched.performance.calories != null &&
                          ` · ${item.enriched.performance.calories} kcal`}
                      </p>
                    </div>
                  </div>
                ) : item.enriched?.pendingMatch ? (
                  <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <span className="text-lg">⏳</span>
                    <p className="text-xs text-amber-700">
                      Strava sync pending — will match automatically when your session syncs.
                    </p>
                  </div>
                ) : null}

                {/* Intensity bar */}
                {item.enriched?.enrichedIntensity != null && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Intensity
                      </p>
                      <span className="text-sm font-bold text-gray-900">
                        {item.enriched.enrichedIntensity}/10
                      </span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${intensityColor(item.enriched.enrichedIntensity)}`}
                        style={{ width: `${item.enriched.enrichedIntensity * 10}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Confirm */}
                <button
                  onClick={() => confirmItem(item.id)}
                  className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors"
                >
                  Looks good ✓
                </button>
              </div>
            )}

            {/* Confirmed row */}
            {item.confirmed && item.parsed && (
              <div className="flex items-center gap-3 bg-green-50 px-4 py-3">
                <span>✅</span>
                <div className="text-xs text-green-700">
                  <p className="font-semibold">
                    {item.parsed.box ? `${item.parsed.box} WOD` : "WOD"} logged
                  </p>
                  <p className="text-green-600/70">{item.parsed.date}</p>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* All done */}
        {allConfirmed && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center">
            <p className="text-3xl mb-3">✅</p>
            <p className="text-green-700 font-semibold">
              {confirmedCount} session{confirmedCount > 1 ? "s" : ""} logged!
            </p>
            <button
              onClick={reset}
              className="mt-4 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              Log more sessions
            </button>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
