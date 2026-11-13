import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarEvent } from "../types";
import { exportCalendar } from "./ics";
import { loadData } from "./storage";

const STORAGE_KEY = "tempo-calendar-subscription";
interface SubscriptionRecord {
  key: string;
  digest?: string;
  publishedAt?: string;
  path?: string;
}

function readSubscription(): SubscriptionRecord | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const stored = JSON.parse(raw) as SubscriptionRecord;
  if (!/^[a-f0-9]{64}$/.test(stored.key))
    throw new Error("La clé d’abonnement enregistrée est invalide.");
  return stored;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");

export function useCalendarSubscription(events: CalendarEvent[] | undefined) {
  const [record, setRecord] = useState<SubscriptionRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(0);
  const perform = useCallback(async (action: "enable" | "sync" | "refresh" | "disable") => {
    pending.current++;
    setBusy(true);
    try {
      if (!navigator.locks) {
        if (action !== "sync" || localStorage.getItem(STORAGE_KEY))
          throw new Error("L’abonnement nécessite un navigateur récent et une adresse HTTPS.");
        return;
      }
      // Serialize publication and revocation across every tab of this browser.
      await navigator.locks.request("tempo-calendar-subscription", async () => {
        let current = readSubscription();
        if (action === "enable" && !current) {
          current = { key: hex(crypto.getRandomValues(new Uint8Array(32))) };
          // Persist before the network request so failed responses can be retried
          // without creating an orphaned feed or losing the revocation key.
          localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
        }
        setRecord(current);
        if (!current) { setError(""); return; }
        const headers = {
          Authorization: `Bearer ${current.key}`,
          "X-Tempo-Subscription": "1",
          "Content-Type": "text/calendar; charset=utf-8",
        };
        let calendar: string | undefined;
        let digest: string | undefined;
        if (action !== "disable") {
          // Always read committed data. A stale tab must not republish its view.
          const latest = await loadData(false);
          calendar = exportCalendar(latest.events, true);
          digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(calendar))));
          if (action === "sync" && current.digest === digest) { setError(""); return; }
        }
        const response = await fetch("/api/subscription", {
          method: action === "disable" ? "DELETE" : "PUT",
          headers,
          body: calendar,
          cache: "no-store",
          credentials: "omit",
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null);
          throw new Error(result?.error || "L’abonnement n’est pas disponible sur cet hébergement. Réessayez plus tard.");
        }
        if (action === "disable") {
          localStorage.removeItem(STORAGE_KEY);
          setRecord(null);
        } else {
          const result = await response.json();
          if (!/^\/api\/calendars\/[a-f0-9]{64}\.ics$/.test(result.path))
            throw new Error("Le serveur n’a pas renvoyé de lien d’abonnement valide.");
          const next = { ...current, digest, path: result.path, publishedAt: new Date().toISOString() };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          setRecord(next);
        }
        setError("");
      });
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== "TypeError" && cause.name !== "TimeoutError"
        ? cause.message
        : "Publication en attente. Vos événements sont enregistrés dans Tempo ; ouvrez l’app avec une connexion pour réessayer.");
    } finally {
      pending.current--;
      setBusy(pending.current > 0);
    }
  }, []);

  useEffect(() => {
    if (events) void perform("sync");
  }, [events, perform]);
  useEffect(() => {
    const retry = () => { void perform("sync"); };
    const visible = () => { if (document.visibilityState === "visible") retry(); };
    const storage = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) retry(); };
    const timer = window.setInterval(visible, 60_000);
    window.addEventListener("online", retry);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", retry);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [perform]);

  // Only expose the read capability to UI, never the publication key.
  const url = record?.path && /^\/api\/calendars\/[a-f0-9]{64}\.ics$/.test(record.path)
    ? new URL(record.path, window.location.origin).href : "";
  return {
    enabled: record !== null,
    publishedAt: record?.publishedAt,
    url,
    webcalUrl: url.replace(/^https?:/, "webcal:"),
    busy,
    error,
    enable: () => perform("enable"),
    refresh: () => perform("refresh"),
    disable: () => perform("disable"),
  };
}

export type CalendarSubscription = ReturnType<typeof useCalendarSubscription>;
