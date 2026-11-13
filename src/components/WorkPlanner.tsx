import { useMemo, useState, type FormEvent } from "react";
import { ArrowRight, Check, Sunrise, Sunset } from "lucide-react";
import type { AppData, CalendarEvent } from "../types";
import {
  addDays,
  buildWorkEvents,
  dateKey,
  getOccurrences,
  startOfWeek,
} from "../lib/calendar";
import { wallToUTC } from "../lib/ics";
import { Dialog } from "./Dialog";
import { ALERTS } from "./EventEditor";

export function WorkPlanner({
  day,
  data,
  onClose,
  onCreate,
}: {
  day: Date;
  data: AppData;
  onClose: () => void;
  onCreate: (events: CalendarEvent[]) => Promise<void>;
}) {
  const [week, setWeek] = useState(dateKey(startOfWeek(day)));
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState("05:00");
  const [endTime, setEndTime] = useState("13:00");
  const [title, setTitle] = useState("Travail");
  const [alert, setAlert] = useState(data.settings.defaultAlert);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const workCategory =
    data.categories.find((c) => c.id === "work") || data.categories[0];
  const preview = useMemo(() => {
    try {
      return buildWorkEvents({
        week,
        days,
        startTime,
        endTime,
        title,
        categoryId: workCategory.id,
        icon: "",
        alerts: alert < 0 ? [] : [alert],
        timezone: data.settings.timezone,
      });
    } catch {
      return [];
    }
  }, [
    week,
    days,
    startTime,
    endTime,
    title,
    workCategory.id,
    alert,
    data.settings.timezone,
  ]);
  const existingOccurrences = useMemo(() => {
    if (!preview.length) return [];
    // Include surrounding days for overnight work and Europe/Paris ↔ UTC offsets.
    return getOccurrences(
      data.events,
      addDays(new Date(`${preview[0].start.slice(0, 10)}T00:00`), -2),
      addDays(new Date(`${preview.at(-1)!.end.slice(0, 10)}T00:00`), 3),
    );
  }, [data.events, preview]);
  const duplicates = preview.filter((event) =>
    existingOccurrences.some(
      (old) =>
        !old.event.allDay &&
        old.event.categoryId === event.categoryId &&
        wallToUTC(old.start, old.event.timezone) ===
          wallToUTC(event.start, event.timezone) &&
        wallToUTC(old.end, old.event.timezone) ===
          wallToUTC(event.end, event.timezone),
    ),
  );
  const overlaps = preview.filter(
    (event) =>
      !duplicates.includes(event) &&
      existingOccurrences.some((old) => {
        if (old.event.availability !== "busy") return false;
        if (old.event.allDay)
          return old.start < event.end && old.end > event.start;
        return (
          wallToUTC(old.start, old.event.timezone) <
            wallToUTC(event.end, event.timezone) &&
          wallToUTC(old.end, old.event.timezone) >
            wallToUTC(event.start, event.timezone)
        );
      }),
  );
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!title.trim()) {
      setError("Ajoutez un titre à vos périodes de travail.");
      return;
    }
    if (!days.length) {
      setError("Choisissez au moins un jour.");
      return;
    }
    if (startTime === endTime) {
      setError("Choisissez des heures de début et de fin différentes.");
      return;
    }
    if (!preview.length) {
      setError("Vérifiez les dates et les horaires.");
      return;
    }
    setBusy(true);
    try {
      const events = preview.filter((item) => !duplicates.includes(item));
      if (!events.length) {
        setError("Ces périodes de travail existent déjà.");
        return;
      }
      await onCreate(events);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Ma semaine de travail" onClose={() => !busy && onClose()}>
      <form onSubmit={create}>
        <div className="dialog-body">
          <fieldset
            disabled={busy}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <label className="field">
              Semaine du lundi
              <input
                type="date"
                required
                value={week}
                onChange={(e) => {
                  if (e.target.value)
                    setWeek(
                      dateKey(startOfWeek(new Date(e.target.value + "T12:00"))),
                    );
                }}
              />
            </label>
            <div className="shift-options">
              <button
                type="button"
                aria-pressed={startTime === "05:00" && endTime === "13:00"}
                className={
                  startTime === "05:00" && endTime === "13:00"
                    ? "shift selected"
                    : "shift"
                }
                onClick={() => {
                  setStartTime("05:00");
                  setEndTime("13:00");
                }}
              >
                <Sunrise size={25} />
                <strong>Du matin</strong>
                <span>05:00 — 13:00</span>
              </button>
              <button
                type="button"
                aria-pressed={startTime === "13:00" && endTime === "21:00"}
                className={
                  startTime === "13:00" && endTime === "21:00"
                    ? "shift selected"
                    : "shift"
                }
                onClick={() => {
                  setStartTime("13:00");
                  setEndTime("21:00");
                }}
              >
                <Sunset size={25} />
                <strong>De l’après-midi</strong>
                <span>13:00 — 21:00</span>
              </button>
            </div>
            <div className="two-fields">
              <label className="field">
                Début
                <input
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </label>
              <label className="field">
                Fin
                <input
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </label>
            </div>
            {endTime < startTime && (
              <p className="field-hint">La période se termine le lendemain.</p>
            )}
            <div className="field">
              <span>Jours travaillés</span>
              <div className="weekdays-picker">
                {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map(
                  (label, i) => (
                    <button
                      type="button"
                      key={label}
                      aria-pressed={days.includes(i + 1)}
                      className={days.includes(i + 1) ? "selected" : ""}
                      onClick={() =>
                        setDays(
                          days.includes(i + 1)
                            ? days.filter((d) => d !== i + 1)
                            : [...days, i + 1].sort(),
                        )
                      }
                    >
                      {label}
                      <span>
                        {days.includes(i + 1) ? <Check size={14} /> : "·"}
                      </span>
                    </button>
                  ),
                )}
              </div>
            </div>
            <div className="one-fields">
              <label className="field">
                Titre
                <input
                  required
                  maxLength={500}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="field">
                Rappel
                <select
                  value={alert}
                  onChange={(e) => setAlert(Number(e.target.value))}
                >
                  <option value={-1}>Aucun</option>
                  {alert >= 0 &&
                    !ALERTS.some((item) => item.value === alert) && (
                      <option value={alert}>{alert} minutes avant</option>
                    )}
                  {ALERTS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="work-summary">
              <strong>
                {preview.length - duplicates.length} événement
                {preview.length - duplicates.length > 1 ? "s" : ""} à créer
              </strong>
              <span>
                {new Date(week + "T12:00").toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "long",
                })}{" "}
                <ArrowRight size={14} />{" "}
                {addDays(new Date(week + "T12:00"), 6).toLocaleDateString(
                  "fr-FR",
                  { day: "numeric", month: "long" },
                )}
              </span>
              <p>
                Enregistrés dans {workCategory.icon} {workCategory.name} ·{" "}
                {data.settings.timezone}
              </p>
            </div>
            {!!duplicates.length && (
              <p className="notice">
                {duplicates.length} période(s) identique(s) déjà présente(s)
                seront ignorées.
              </p>
            )}
            {!!overlaps.length && (
              <p className="notice">
                {overlaps.length} journée(s) chevauchent un événement existant.
              </p>
            )}
            <p className="field-hint">
              Les jours fériés restent sélectionnables. Les rappels seront
              transmis lors de l’export .ics vers Calendrier.
            </p>
            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}
          </fieldset>
        </div>
        <footer className="dialog-footer">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
          >
            Annuler
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={busy || !days.length}
          >
            {busy ? "Création…" : "Ajouter ma semaine"}
            <ArrowRight size={16} />
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
