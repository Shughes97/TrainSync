"use client";

import { useEffect, useState, useCallback } from "react";
import type { TrainingLoad, RescheduleEvent, StoredActivity } from "@/lib/kv";

interface SyncStatus {
  lastStravaSync: string | null;
  lastCalendarCheck: string | null;
  trainingLoad: TrainingLoad | null;
  recentReschedules: RescheduleEvent[];
  stravaConnected: boolean;
  recentActivities: StoredActivity[];
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatMins(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function activityIcon(type: string): string {
  switch (type) {
    case "Ride":
    case "VirtualRide": return "🚴";
    case "Run":
    case "VirtualRun": return "🏃";
    case "WeightTraining":
    case "Crossfit": return "🏋️";
    default: return "🏅";
  }
}

export default function SyncStatusCard() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/sync/status");
      if (res.ok) setStatus(await res.json());
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  async function handleSyncNow() {
    setSyncing(true);
    setError(null);
    try {
      const [stravaRes, calRes] = await Promise.all([
        fetch("/api/cron/strava-sync", { method: "POST" }),
        fetch("/api/cron/calendar-sync", { method: "POST" }),
      ]);
      const stravaData = await stravaRes.json();
      const calData = await calRes.json();
      if (!stravaRes.ok) {
        setError(stravaData.error ?? "Strava sync failed");
      } else if (!calRes.ok) {
        if (calData.error?.includes("Google Calendar not connected")) {
          setError("Sign out and back in to enable calendar sync");
        } else {
          setError(calData.error ?? "Calendar sync failed");
        }
        await fetchStatus();
      } else {
        await fetchStatus();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncing(false);
    }
  }

  if (!status) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-5 animate-pulse shadow-sm">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="h-3 bg-gray-100 rounded w-2/3 mb-2" />
        <div className="h-3 bg-gray-100 rounded w-1/2" />
      </div>
    );
  }

  const tl = status.trainingLoad;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-900 text-sm">Activity & Sync</h2>
          <p className="text-xs text-gray-500 mt-0.5">Strava imports · Calendar conflicts</p>
        </div>
        <button
          onClick={handleSyncNow}
          disabled={syncing}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {syncing ? "Syncing…" : "Sync Now"}
        </button>
      </div>

      {error && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Last sync times */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-sm">🟠</span>
            <p className="text-xs font-medium text-gray-700">Strava</p>
          </div>
          <p className="text-sm font-semibold text-gray-900">{formatRelative(status.lastStravaSync)}</p>
          <p className="text-xs text-gray-400 mt-0.5">Last activity import</p>
          {!status.stravaConnected && (
            <a
              href="/api/strava/connect"
              className="text-xs text-orange-600 hover:text-orange-700 mt-1.5 block"
            >
              Connect Strava →
            </a>
          )}
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-sm">📅</span>
            <p className="text-xs font-medium text-gray-700">Calendar</p>
          </div>
          <p className="text-sm font-semibold text-gray-900">{formatRelative(status.lastCalendarCheck)}</p>
          <p className="text-xs text-gray-400 mt-0.5">Last conflict scan</p>
        </div>
      </div>

      {/* Training load */}
      {tl && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Last 7 days</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
              <p className="text-sm font-bold text-blue-600 leading-none">{tl.weekBikeKm ?? 0} km</p>
              <p className="text-xs text-blue-400 mt-1">🚴 Cycling</p>
            </div>
            <div className="bg-green-50 border border-green-100 rounded-xl p-3">
              <p className="text-sm font-bold text-green-600 leading-none">{tl.weekRunKm ?? 0} km</p>
              <p className="text-xs text-green-400 mt-1">🏃 Running</p>
            </div>
            <div className="bg-orange-50 border border-orange-100 rounded-xl p-3">
              <p className="text-sm font-bold text-orange-600 leading-none">
                {formatMins((tl.weekCrossfitMins ?? 0) * 60)}
              </p>
              <p className="text-xs text-orange-400 mt-1">🏋️ CrossFit</p>
            </div>
            <div className="bg-purple-50 border border-purple-100 rounded-xl p-3">
              <p className="text-sm font-bold text-purple-600 leading-none">
                {formatMins((tl.weekStrengthMins ?? 0) * 60)}
              </p>
              <p className="text-xs text-purple-400 mt-1">💪 Strength</p>
            </div>
          </div>
          {tl.sessionsScheduled > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 flex items-center justify-between">
              <p className="text-xs text-gray-500">Sessions completed this week</p>
              <p className="text-sm font-bold text-gray-800">
                {tl.sessionsCompleted} / {tl.sessionsScheduled}
              </p>
            </div>
          )}
          {(tl.longestRideKm ?? 0) > 0 && (
            <p className="text-xs text-gray-500">
              Longest ride:{" "}
              <span className="font-medium text-gray-800">{tl.longestRideKm} km</span>
              {tl.longRideTargetHit && (
                <span className="ml-1 text-green-600 font-medium">Long ride target hit!</span>
              )}
            </p>
          )}
        </div>
      )}

      {/* Recent reschedules */}
      {status.recentReschedules.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Auto-rescheduled</p>
          {status.recentReschedules.map((r, i) => (
            <div key={i} className="text-xs text-gray-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <span className="font-medium text-gray-800">{r.sessionType}</span>
              {" "}moved from {r.originalDay} {r.originalTime} → {r.newDay} {r.newTime}
              {r.conflictWith && (
                <span className="text-gray-400"> (conflict: {r.conflictWith})</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Recent activities */}
      {status.recentActivities.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Recent Activities</p>
          {status.recentActivities.slice(0, 3).map((a) => {
            const dateStr = new Date(a.start_date).toLocaleDateString("en-GB", {
              weekday: "short", day: "numeric", month: "short",
            });
            return (
              <div key={a.id} className="flex items-center gap-2.5 text-xs">
                <span className="flex-shrink-0">{activityIcon(a.type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-gray-700">{a.name}</p>
                  <p className="text-gray-400">{dateStr}</p>
                </div>
                <span className="text-gray-500 flex-shrink-0">
                  {a.distance > 0 ? `${a.distance} km` : formatMins(a.moving_time)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
