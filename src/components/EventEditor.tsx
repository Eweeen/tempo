import { useEffect, useState, type FormEvent } from "react";
import {
  Download,
  FileText,
  MapPin,
  Paperclip,
  Trash2,
  Plus,
  Bell,
  Repeat2,
} from "lucide-react";
import type { AppData, Attachment, CalendarEvent } from "../types";
import { addDays, dateKey, wallString, wallTime } from "../lib/calendar";
import { getAttachments, MAX_ATTACHMENT_SIZE } from "../lib/storage";
import { Dialog } from "./Dialog";

export const ICONS = [
  "💼",
  "🏠",
  "💳",
  "🧾",
  "🎵",
  "🎪",
  "🎂",
  "🏃",
  "✈️",
  "🍽️",
  "🍺",
  "💙",
  "📚",
  "🩺",
  "⭐",
  "🎬",
  "📅",
];
export const ALERTS = [
  { value: 0, label: "À l’heure de l’événement" },
  { value: 5, label: "5 minutes avant" },
  { value: 15, label: "15 minutes avant" },
  { value: 30, label: "30 minutes avant" },
  { value: 60, label: "1 heure avant" },
  { value: 120, label: "2 heures avant" },
  { value: 1440, label: "1 jour avant" },
  { value: 2880, label: "2 jours avant" },
  { value: 10080, label: "1 semaine avant" },
];

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function newEvent(day: Date, data: AppData): CalendarEvent {
  const id = crypto.randomUUID();
  return {
    id,
    uid: `${id}@tempo.local`,
    title: "",
    start: `${dateKey(day)}T09:00`,
    end: `${dateKey(day)}T10:00`,
    allDay: false,
    categoryId: data.categories.some((category) => category.id === "personal")
      ? "personal"
      : data.categories[0].id,
    icon: "",
    location: "",
    notes: "",
    url: "",
    availability: "busy",
    alerts: data.settings.defaultAlert < 0 ? [] : [data.settings.defaultAlert],
    recurrence: { frequency: "none", interval: 1 },
    timezone: data.settings.timezone,
    attachmentIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function EventEditor({
  initial,
  data,
  existing,
  onClose,
  onSave,
  onDelete,
  onExport,
}: {
  initial: CalendarEvent;
  data: AppData;
  existing: boolean;
  onClose: () => void;
  onSave: (
    event: CalendarEvent,
    files: File[],
    removed: string[],
  ) => Promise<void>;
  onDelete: (event: CalendarEvent) => Promise<void>;
  onExport: (event: CalendarEvent) => void;
}) {
  const [event, setEvent] = useState(initial);
  const [files, setFiles] = useState<File[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showIcons, setShowIcons] = useState(false);
  useEffect(() => {
    let active = true;
    if (existing)
      getAttachments(initial.id)
        .then((items) => {
          if (active)
            setAttachments(
              items.filter((item) => initial.attachmentIds.includes(item.id)),
            );
        })
        .catch(() => {
          if (active)
            setError(
              "Impossible de charger les documents. Réessayez avant de modifier cet événement.",
            );
        });
    return () => {
      active = false;
    };
  }, [initial.id, initial.attachmentIds, existing]);
  const update = <K extends keyof CalendarEvent>(
    key: K,
    value: CalendarEvent[K],
  ) => setEvent((prev) => ({ ...prev, [key]: value }));
  const updateStart = (start: string) =>
    setEvent((previous) => {
      if (!Number.isFinite(wallTime(start))) return previous;
      const duration = wallTime(previous.end) - wallTime(previous.start);
      return {
        ...previous,
        start,
        end: wallString(
          wallTime(start) +
            (Number.isFinite(duration) && duration > 0
              ? duration
              : previous.allDay
                ? 86_400_000
                : 3_600_000),
        ),
      };
    });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!event.title.trim()) {
      setError("Ajoutez un titre à votre événement.");
      return;
    }
    if (event.end <= event.start) {
      setError("La fin doit être située après le début.");
      return;
    }
    if (
      event.recurrence.frequency !== "none" &&
      event.recurrence.until &&
      event.recurrence.until < event.start.slice(0, 10)
    ) {
      setError("La fin de répétition doit être après le début.");
      return;
    }
    if (new Set(event.alerts).size !== event.alerts.length) {
      setError("Choisissez des délais différents pour chaque rappel.");
      return;
    }
    if (event.url && !/^https?:\/\//i.test(event.url)) {
      setError("Le lien doit commencer par https:// ou http://.");
      return;
    }
    setBusy(true);
    try {
      await onSave(
        {
          ...event,
          title: event.title.trim(),
          recurrence:
            event.recurrence.frequency === "none"
              ? { frequency: "none", interval: 1 }
              : event.recurrence,
          updatedAt: new Date().toISOString(),
        },
        files,
        removed,
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Enregistrement impossible.",
      );
    } finally {
      setBusy(false);
    }
  };
  const deleteEvent = async () => {
    setBusy(true);
    try {
      await onDelete(event);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  };
  const endDate = event.allDay
    ? dateKey(addDays(new Date(`${event.end.slice(0, 10)}T12:00`), -1))
    : event.end.slice(0, 10);
  return (
    <Dialog
      title={existing ? "Modifier l’événement" : "Nouvel événement"}
      subtitle={
        existing && event.recurrence.frequency !== "none"
          ? "Les modifications concernent toute la série."
          : undefined
      }
      onClose={() => !busy && onClose()}
    >
      <form onSubmit={save} className="event-form">
        <div className="dialog-body">
          <fieldset
            disabled={busy}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <div className="title-input">
              <button
                type="button"
                className="event-icon-picker"
                aria-label="Choisir une icône"
                aria-expanded={showIcons}
                onClick={() => setShowIcons(!showIcons)}
              >
                {event.icon ||
                  data.categories.find((c) => c.id === event.categoryId)
                    ?.icon ||
                  "📅"}
              </button>
              <input
                aria-label="Titre de l’événement"
                placeholder="Titre de l’événement"
                autoFocus
                required
                maxLength={500}
                value={event.title}
                onChange={(e) => update("title", e.target.value)}
              />
            </div>
            {showIcons && (
              <div className="icon-options">
                {ICONS.map((icon) => (
                  <button
                    type="button"
                    key={icon}
                    aria-label={`Icône ${icon}`}
                    className={event.icon === icon ? "selected" : ""}
                    onClick={() => {
                      update("icon", icon);
                      setShowIcons(false);
                    }}
                  >
                    {icon}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    update("icon", "");
                    setShowIcons(false);
                  }}
                >
                  Auto
                </button>
              </div>
            )}
            <label className="field">
              Calendrier / type
              <select
                value={event.categoryId}
                onChange={(e) => update("categoryId", e.target.value)}
              >
                {data.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-section">
              <label className="switch-row">
                <span>Toute la journée</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={event.allDay}
                  onChange={(e) => {
                    const allDay = e.target.checked;
                    setEvent((prev) => ({
                      ...prev,
                      allDay,
                      start:
                        prev.start.slice(0, 10) +
                        (allDay ? "T00:00" : "T09:00"),
                      end: allDay
                        ? dateKey(
                            addDays(
                              new Date(`${prev.end.slice(0, 10)}T12:00`),
                              prev.end.endsWith("T00:00") ? 0 : 1,
                            ),
                          ) + "T00:00"
                        : dateKey(
                            addDays(
                              new Date(`${prev.end.slice(0, 10)}T12:00`),
                              -1,
                            ),
                          ) + "T10:00",
                    }));
                  }}
                />
              </label>
              <div className="date-row">
                <span>Début</span>
                <input
                  aria-label="Date de début"
                  type="date"
                  required
                  value={event.start.slice(0, 10)}
                  onChange={(e) => {
                    if (e.target.value)
                      updateStart(e.target.value + event.start.slice(10));
                  }}
                />
                {!event.allDay && (
                  <input
                    aria-label="Heure de début"
                    type="time"
                    required
                    value={event.start.slice(11, 16)}
                    onChange={(e) => {
                      if (e.target.value)
                        updateStart(event.start.slice(0, 11) + e.target.value);
                    }}
                  />
                )}
              </div>
              <div className="date-row">
                <span>Fin</span>
                <input
                  aria-label="Date de fin"
                  type="date"
                  required
                  min={event.start.slice(0, 10)}
                  value={endDate}
                  onChange={(e) => {
                    if (e.target.value)
                      update(
                        "end",
                        event.allDay
                          ? dateKey(
                              addDays(new Date(e.target.value + "T12:00"), 1),
                            ) + "T00:00"
                          : e.target.value + event.end.slice(10),
                      );
                  }}
                />
                {!event.allDay && (
                  <input
                    aria-label="Heure de fin"
                    type="time"
                    required
                    value={event.end.slice(11, 16)}
                    onChange={(e) =>
                      update("end", event.end.slice(0, 11) + e.target.value)
                    }
                  />
                )}
              </div>
              <p className="field-hint">
                Fuseau : {event.timezone}. Les heures affichées sont celles de
                ce fuseau.
              </p>
            </div>
            <label className="field">
              <span>
                <Repeat2 size={15} /> Répéter
              </span>
              <select
                value={event.recurrence.frequency}
                onChange={(e) =>
                  update("recurrence", {
                    ...event.recurrence,
                    frequency: e.target
                      .value as CalendarEvent["recurrence"]["frequency"],
                  })
                }
              >
                <option value="none">Jamais</option>
                <option value="daily">Tous les jours</option>
                <option value="weekly">Toutes les semaines</option>
                <option value="monthly">Tous les mois</option>
                <option value="yearly">Tous les ans</option>
              </select>
            </label>
            {event.recurrence.frequency !== "none" && (
              <div className="two-fields">
                <label className="field">
                  Intervalle
                  <input
                    type="number"
                    min="1"
                    max="365"
                    required
                    value={event.recurrence.interval}
                    onChange={(e) =>
                      update("recurrence", {
                        ...event.recurrence,
                        interval: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="field">
                  Jusqu’au (facultatif)
                  <input
                    type="date"
                    min={event.start.slice(0, 10)}
                    value={event.recurrence.until || ""}
                    onChange={(e) =>
                      update("recurrence", {
                        ...event.recurrence,
                        until: e.target.value || undefined,
                      })
                    }
                  />
                </label>
              </div>
            )}
            <div className="field">
              <span>
                <Bell size={15} /> Rappels
              </span>
              {(event.alerts.length ? event.alerts : [-1]).map((alert, i) => (
                <div className="inline-input" key={i}>
                  <select
                    aria-label={`Rappel ${i + 1}`}
                    value={alert}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      update("alerts", value < 0
                        ? event.alerts.filter((_, index) => index !== i)
                        : event.alerts.length
                          ? event.alerts.map((a, index) => index === i ? value : a)
                          : [value]);
                    }}
                  >
                    <option value={-1}>Aucun</option>
                    {alert >= 0 && !ALERTS.some((a) => a.value === alert) && (
                      <option value={alert}>{alert} minutes avant</option>
                    )}
                    {ALERTS.map((a) => (
                      <option
                        key={a.value}
                        value={a.value}
                        disabled={
                          a.value !== alert && event.alerts.includes(a.value)
                        }
                      >
                        {a.label}
                      </option>
                    ))}
                  </select>
                  {alert >= 0 && <button
                    className="icon-button"
                    type="button"
                    aria-label={`Supprimer le rappel ${i + 1}`}
                    onClick={() =>
                      update(
                        "alerts",
                        event.alerts.filter((_, index) => i !== index),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </button>}
                </div>
              ))}
              {event.alerts.length > 0 && event.alerts.length < 10 &&
                ALERTS.some((item) => !event.alerts.includes(item.value)) && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      const next = ALERTS.find(
                        (item) => !event.alerts.includes(item.value),
                      );
                      if (next) update("alerts", [...event.alerts, next.value]);
                    }}
                  >
                    <Plus size={14} /> Ajouter un rappel
                  </button>
                )}
              <p className="field-hint">
                Inclus dans le fichier .ics. Pour être averti quand Tempo est
                fermé, utilisez l’abonnement ou importez l’événement dans Calendrier Apple.
              </p>
            </div>
            <label className="field">
              <span>
                <MapPin size={15} /> Lieu
              </span>
              <input
                placeholder="Une adresse, une salle…"
                maxLength={2000}
                value={event.location}
                onChange={(e) => update("location", e.target.value)}
              />
            </label>
            <div className="two-fields">
              <label className="field">
                Disponibilité
                <select
                  value={event.availability}
                  onChange={(e) =>
                    update("availability", e.target.value as "busy" | "free")
                  }
                >
                  <option value="busy">Occupé</option>
                  <option value="free">Libre</option>
                </select>
              </label>
              <label className="field">
                Lien
                <input
                  type="url"
                  placeholder="https://"
                  maxLength={4000}
                  value={event.url}
                  onChange={(e) => update("url", e.target.value)}
                />
              </label>
            </div>
            <label className="field">
              Notes
              <textarea
                rows={3}
                placeholder="Les petits détails à garder en tête…"
                maxLength={100000}
                value={event.notes}
                onChange={(e) => update("notes", e.target.value)}
              />
            </label>
            <div className="field">
              <span>
                <Paperclip size={15} /> Documents
              </span>
              <p className="field-hint">
                Billets, factures, photos… Conservés sur cet appareil,
                uniquement dans Tempo. 20 Mo maximum par document.
              </p>
              {attachments
                .filter((a) => !removed.includes(a.id))
                .map((a) => (
                  <div className="attachment" key={a.id}>
                    <FileText size={18} />
                    <span>
                      {a.name}
                      <small>{(a.size / 1024).toFixed(0)} Ko</small>
                    </span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Télécharger ${a.name}`}
                      onClick={() => downloadBlob(a.blob, a.name)}
                    >
                      <Download size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Retirer ${a.name}`}
                      onClick={() => setRemoved([...removed, a.id])}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              {files.map((file, i) => (
                <div className="attachment" key={i}>
                  <FileText size={18} />
                  <span>
                    {file.name}
                    <small>Nouveau · {(file.size / 1024).toFixed(0)} Ko</small>
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Retirer ${file.name}`}
                    onClick={() =>
                      setFiles(files.filter((_, idx) => idx !== i))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <label className="upload-area">
                <Paperclip size={18} />
                <span>Ajouter des documents</span>
                <input
                  type="file"
                  multiple
                  aria-label="Ajouter des documents"
                  onChange={(e) => {
                    const added = [...(e.target.files || [])];
                    if (added.some((f) => f.size > MAX_ATTACHMENT_SIZE))
                      setError("Chaque document doit faire au maximum 20 Mo.");
                    else {
                      setFiles([...files, ...added]);
                      setError("");
                    }
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {error && (
              <div role="alert" className="error-message">
                {error}
              </div>
            )}
            {confirmDelete && (
              <div className="delete-confirm">
                <p>
                  Supprimer{" "}
                  {event.recurrence.frequency !== "none"
                    ? "toute cette série"
                    : "cet événement"}{" "}
                  et ses documents ? Cette action est définitive.
                </p>
                <button
                  type="button"
                  className="danger-button"
                  disabled={busy}
                  onClick={deleteEvent}
                >
                  Confirmer la suppression
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setConfirmDelete(false)}
                >
                  Annuler
                </button>
              </div>
            )}
          </fieldset>
        </div>
        <footer className="dialog-footer">
          {existing && (
            <>
              <button
                type="button"
                className="icon-button danger"
                disabled={busy}
                aria-label="Supprimer l’événement"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={18} />
              </button>
              <button
                type="button"
                className="icon-button"
                disabled={busy}
                aria-label="Exporter la version enregistrée de cet événement"
                onClick={() => onExport(initial)}
              >
                <Download size={18} />
              </button>
            </>
          )}
          <span className="spacer" />
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
          >
            Annuler
          </button>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
