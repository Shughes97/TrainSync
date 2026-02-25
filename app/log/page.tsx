"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import BottomNav from "@/components/BottomNav";
import type { WodifyParsed, EnrichedSession, PersonalBest } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function LogPage() {
  const { status } = useSession();
  const router = useRouter();

  const [date, setDate] = useState(todayISO());
  const [imageDataUrls, setImageDataUrls] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<WodifyParsed | null>(null);
  const [enriched, setEnriched] = useState<EnrichedSession | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [notes, setNotes] = useState("");
  const [confirmingNotes, setConfirmingNotes] = useState(false);
  const [newPRs, setNewPRs] = useState<PersonalBest[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status, router]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    e.target.value = "";

    setParsed(null);
    setEnriched(null);
    setParseError(null);
    setConfirmed(false);
    setNotes("");
    setNewPRs([]);

    let loaded = 0;
    const urls: string[] = new Array(files.length);

    files.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = () => {
        urls[idx] = reader.result as string;
        loaded++;
        if (loaded === files.length) setImageDataUrls(urls);
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleParse() {
    if (!imageDataUrls.length) return;
    setParsing(true);
    setParseError(null);
    try {
      const res = await fetch("/api/wodify/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: imageDataUrls, date }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Parse failed");
      }
      const data = await res.json();
      setParsed(data.parsed);
      setEnriched(data.enriched);
    } catch (err) {
      setParseError(String(err));
    } finally {
      setParsing(false);
    }
  }

  // Auto-parse when images are ready
  useEffect(() => {
    if (imageDataUrls.length && !parsed && !parsing) {
      handleParse();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageDataUrls]);

  async function handleConfirm() {
    setConfirmingNotes(true);
    try {
      if (notes.trim() && parsed) {
        const res = await fetch("/api/session/parse-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, notes, wodContext: parsed }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.newPersonalBests?.length) {
            setNewPRs(data.newPersonalBests);
          }
        }
      }
    } catch {
      // non-fatal — notes parsing failure shouldn't block confirmation
    } finally {
      setConfirmingNotes(false);
      setConfirmed(true);
    }
  }

  const allMovements = parsed?.sections.flatMap((s) => s.movements) ?? [];
  const uniqueMovements = allMovements.filter((m, i) => allMovements.indexOf(m) === i);

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-gray-50/90 backdrop-blur border-b border-gray-200">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="font-bold text-gray-900 text-lg">Log Session</h1>
          <input
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value)}
            className="text-sm text-gray-600 border border-gray-200 rounded-lg px-2 py-1 bg-white"
          />
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-5">
        {/* Upload area */}
        {!confirmed && (
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
                imageDataUrls.length
                  ? "border-indigo-300 bg-indigo-50"
                  : "border-gray-300 bg-white hover:border-indigo-300 hover:bg-indigo-50"
              }`}
            >
              <span className="text-4xl">📸</span>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700">
                  {imageDataUrls.length
                    ? `${imageDataUrls.length} screenshot${imageDataUrls.length > 1 ? "s" : ""} selected — tap to change`
                    : "Upload Wodify screenshots"}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Select all screenshots for this session
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Thumbnail strip */}
        {imageDataUrls.length > 0 && !confirmed && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {imageDataUrls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={url}
                alt={`Screenshot ${i + 1}`}
                className="h-24 w-auto rounded-xl border border-gray-200 flex-shrink-0 object-contain bg-white"
              />
            ))}
          </div>
        )}

        {/* Parsing spinner */}
        {parsing && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">
              {imageDataUrls.length > 1
                ? `Combining ${imageDataUrls.length} screenshots…`
                : "Parsing your WOD…"}
            </p>
          </div>
        )}

        {/* Parse error */}
        {parseError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <p className="text-sm text-red-600">{parseError}</p>
            <button
              onClick={handleParse}
              className="mt-2 text-sm text-red-500 underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Result card */}
        {parsed && !confirmed && !parsing && (
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className="text-xs font-medium bg-orange-100 text-orange-700 border border-orange-200 rounded-full px-2.5 py-1">
                🏋️ {parsed.sessionType.replace(/_/g, " ")}
              </span>
              <span className={`text-xs font-medium border rounded-full px-2.5 py-1 ${loadBadgeStyle(parsed.overallLoad)}`}>
                {parsed.overallLoad.replace("_", " ")} load
              </span>
              {parsed.box && (
                <span className="text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200 rounded-full px-2.5 py-1">
                  📍 {parsed.box}
                </span>
              )}
            </div>

            {parsed.sections.length > 0 && (
              <div className="space-y-2">
                {parsed.sections.map((section, i) => (
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

            {uniqueMovements.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                  Movements
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {uniqueMovements.map((m) => (
                    <span
                      key={m}
                      className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full px-2.5 py-1"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {enriched?.performance ? (
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-3">
                <span className="text-lg">🏃</span>
                <div className="text-xs text-green-700">
                  <p className="font-semibold">Strava matched</p>
                  <p>
                    {enriched.performance.duration} min
                    {enriched.performance.averageHR != null &&
                      ` · avg HR ${enriched.performance.averageHR} bpm`}
                    {enriched.performance.calories != null &&
                      ` · ${enriched.performance.calories} kcal`}
                  </p>
                </div>
              </div>
            ) : enriched?.pendingMatch ? (
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
                <span className="text-lg">⏳</span>
                <p className="text-xs text-amber-700">
                  Strava sync pending — will match automatically when your session syncs.
                </p>
              </div>
            ) : null}

            {enriched?.enrichedIntensity != null && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Intensity
                  </p>
                  <span className="text-sm font-bold text-gray-900">
                    {enriched.enrichedIntensity}/10
                  </span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${intensityColor(enriched.enrichedIntensity)}`}
                    style={{ width: `${enriched.enrichedIntensity * 10}%` }}
                  />
                </div>
              </div>
            )}

            {/* Session notes */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Session notes (optional)
              </p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything to add? e.g. weights you used, how it felt, any notes"
                rows={3}
                className="w-full text-sm rounded-xl border border-gray-200 px-3 py-2.5 bg-gray-50 placeholder-gray-400 resize-none focus:outline-none focus:border-indigo-300"
              />
            </div>

            <button
              onClick={handleConfirm}
              disabled={confirmingNotes}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
            >
              {confirmingNotes ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Saving…
                </>
              ) : "Looks good ✓"}
            </button>
          </div>
        )}

        {/* Success */}
        {confirmed && (
          <div className="space-y-3">
            {/* Personal best celebration */}
            {newPRs.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <p className="text-amber-800 font-semibold text-sm mb-2">
                  🏆 New Personal Best{newPRs.length > 1 ? "s" : ""}!
                </p>
                {newPRs.map((pr) => (
                  <p key={pr.lift} className="text-amber-700 text-sm">
                    {pr.lift.replace(/([A-Z])/g, " $1").trim()}: estimated 1RM —{" "}
                    <span className="font-semibold">
                      {Math.round(pr.weight * (1 + pr.reps / 30) * 10) / 10}kg
                    </span>
                  </p>
                ))}
              </div>
            )}
            <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center">
              <p className="text-3xl mb-3">✅</p>
              <p className="text-green-700 font-semibold">Session logged!</p>
              <p className="text-green-600/70 text-sm mt-1">
                {parsed?.box ? `${parsed.box} WOD saved` : "WOD saved"} for {date}.
              </p>
              <button
                onClick={() => {
                  setImageDataUrls([]);
                  setParsed(null);
                  setEnriched(null);
                  setConfirmed(false);
                  setNotes("");
                  setNewPRs([]);
                  setDate(todayISO());
                }}
                className="mt-4 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Log another session
              </button>
            </div>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
