import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Database,
  Download,
  HardDrive,
  Info,
  Laptop,
  Moon,
  Plus,
  ShieldCheck,
  Smartphone,
  Sun,
} from "lucide-react";
import type { AppData, CalendarEvent, Category } from "../types";
import {
  exportBackup,
  importBackup,
  requestPersistence,
  storageEstimate,
} from "../lib/storage";
import { parseCalendar } from "../lib/ics";
import { dateKey } from "../lib/calendar";
import { Dialog } from "./Dialog";
import { useToast } from "./Toast";
import { ALERTS, downloadBlob, ICONS } from "./EventEditor";
import { CalendarSubscriptionPanel } from "./CalendarSubscriptionPanel";
import type { CalendarSubscription } from "../lib/subscription";

type Tab = "general" | "categories" | "data" | "help";
export function SettingsPanel({
  data,
  subscription,
  initialTab = "general",
  onClose,
  onChange,
  onRestore,
  onExport,
}: {
  data: AppData;
  subscription: CalendarSubscription;
  initialTab?: Tab;
  onClose: () => void;
  onChange: (data: AppData) => Promise<void>;
  onRestore: (data: AppData) => void;
  onExport: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [settings, setSettings] = useState(data.settings);
  const [storage, setStorage] = useState<{
    usage: number;
    quota: number;
    persistent: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();
  const [error, setError] = useState("");
  const [category, setCategory] = useState<Category>({
    id: "",
    name: "",
    color: "#8672d9",
    icon: "⭐",
  });
  const [pendingImport, setPendingImport] = useState<{
    events: CalendarEvent[];
    warnings: string[];
    duplicates: number;
  } | null>(null);
  const [backup, setBackup] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const refreshStorage = () =>
    storageEstimate()
      .then(setStorage)
      .catch(() => setStorage(null));
  useEffect(() => {
    void refreshStorage();
  }, []);
  const run = async (action: () => Promise<void>, success?: string) => {
    setBusy(true);
    setError("");
    try {
      await action();
      if (success) notify(success);
      void refreshStorage();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Cette opération a échoué. Réessayez.",
      );
    } finally {
      setBusy(false);
    }
  };
  const prepareImport = async (file?: File) => {
    if (!file) return;
    setPendingImport(null);
    await run(async () => {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Le calendrier ne doit pas dépasser 10 Mo.");
      const result = parseCalendar(await file.text());
      const seen = new Set(data.events.map((e) => e.uid));
      const fallbackCategory =
        data.categories.find((category) => category.id === "personal") ??
        data.categories[0];
      const events = result.events
        .filter((event) => {
          if (seen.has(event.uid)) return false;
          seen.add(event.uid);
          return true;
        })
        .map((event) => ({
          ...event,
          categoryId: data.categories.some((c) => c.id === event.categoryId)
            ? event.categoryId
            : fallbackCategory.id,
        }));
      setPendingImport({
        events,
        warnings: result.warnings,
        duplicates: result.events.length - events.length,
      });
    });
  };
  return (
    <Dialog title="Réglages" onClose={() => !busy && onClose()} wide>
      <nav className="settings-tabs" aria-label="Rubriques des réglages">
        {(
          [
            ["general", "Général"],
            ["categories", "Calendriers"],
            ["data", "Mes données"],
            ["help", "Installation & Apple"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            disabled={busy}
            aria-current={tab === id ? "page" : undefined}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setTab(id);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="dialog-body settings-body">
        <fieldset disabled={busy} className="settings-fields">
          {tab === "general" && (
            <>
              <h3>Apparence</h3>
              <p className="muted">
                Clair, sombre ou selon les réglages de l’appareil.
              </p>
              <div className="theme-options">
                {(
                  [
                    ["light", "Clair", Sun],
                    ["dark", "Sombre", Moon],
                    ["system", "Automatique", Laptop],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    className={
                      settings.theme === id
                        ? "theme-option selected"
                        : "theme-option"
                    }
                    aria-pressed={settings.theme === id}
                    onClick={() => setSettings({ ...settings, theme: id })}
                  >
                    <Icon size={23} />
                    {label}
                    {settings.theme === id && <Check size={14} />}
                  </button>
                ))}
              </div>
              <h3>Au quotidien</h3>
              <label className="field">
                Rappel par défaut
                <select
                  value={settings.defaultAlert}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      defaultAlert: Number(e.target.value),
                    })
                  }
                >
                  <option value={-1}>Aucun</option>
                  {settings.defaultAlert >= 0 &&
                    !ALERTS.some(
                      (alert) => alert.value === settings.defaultAlert,
                    ) && (
                      <option value={settings.defaultAlert}>
                        {settings.defaultAlert} minutes avant
                      </option>
                    )}
                  {ALERTS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Fuseau des nouveaux événements
                <select
                  value={settings.timezone}
                  onChange={(e) =>
                    setSettings({ ...settings, timezone: e.target.value })
                  }
                >
                  <option value="Europe/Paris">Paris — Europe/Paris</option>
                  <option value="UTC">Temps universel — UTC</option>
                </select>
              </label>
              <p className="field-hint">
                Chaque événement conserve son fuseau. Les heures sont affichées
                dans le fuseau de l’événement.
              </p>
              <label className="switch-row">
                <span>
                  Afficher les jours fériés
                  <small>
                    {settings.region === "alsace"
                      ? "France · Alsace-Moselle"
                      : "Bretagne · France métropolitaine"}
                  </small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={settings.showHolidays}
                  onChange={(e) =>
                    setSettings({ ...settings, showHolidays: e.target.checked })
                  }
                />
              </label>
              <button
                className="primary-button"
                onClick={() =>
                  run(
                    () => onChange({ ...data, settings }),
                    "Préférences enregistrées.",
                  )
                }
              >
                Enregistrer les préférences
              </button>
            </>
          )}
          {tab === "categories" && (
            <>
              <h3>Calendriers</h3>
              <p className="muted">
                Personnalisez le nom, l’icône et la couleur de vos types
                d’événements.
              </p>
              <div className="category-settings-list">
                {data.categories.map((c) => (
                  <button
                    key={c.id}
                    className="category-setting"
                    onClick={() => setCategory({ ...c })}
                  >
                    <span
                      className="category-emoji"
                      style={{ background: `${c.color}18` }}
                    >
                      {c.icon}
                    </span>
                    <strong>{c.name}</strong>
                    <span
                      className="color-dot"
                      style={{ background: c.color }}
                    />
                    <small>Modifier</small>
                  </button>
                ))}
              </div>
              <form
                className="category-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const next = {
                      ...category,
                      name: category.name.trim(),
                      id: category.id || crypto.randomUUID(),
                    };
                    if (!next.name)
                      throw new Error("Ajoutez un nom à ce calendrier.");
                    if (
                      data.categories.some(
                        (c) =>
                          c.name.toLowerCase() === next.name.toLowerCase() &&
                          c.id !== next.id,
                      )
                    )
                      throw new Error("Ce nom de calendrier existe déjà.");
                    await onChange({
                      ...data,
                      categories: category.id
                        ? data.categories.map((c) =>
                            c.id === category.id ? next : c,
                          )
                        : [...data.categories, next],
                    });
                    setCategory({
                      id: "",
                      name: "",
                      color: "#8672d9",
                      icon: "⭐",
                    });
                  }, "Calendrier enregistré.");
                }}
              >
                <h3>
                  {category.id
                    ? "Modifier le calendrier"
                    : "Un nouveau calendrier"}
                </h3>
                <div className="inline-input">
                  <select
                    aria-label="Icône du calendrier"
                    value={category.icon}
                    onChange={(e) =>
                      setCategory({ ...category, icon: e.target.value })
                    }
                  >
                    {!ICONS.includes(category.icon) && (
                      <option>{category.icon}</option>
                    )}
                    {ICONS.map((icon) => (
                      <option key={icon}>{icon}</option>
                    ))}
                  </select>
                  <input
                    aria-label="Nom du calendrier"
                    placeholder="Ex. Voyages"
                    required
                    maxLength={100}
                    value={category.name}
                    onChange={(e) =>
                      setCategory({ ...category, name: e.target.value })
                    }
                  />
                  <input
                    type="color"
                    aria-label="Couleur du calendrier"
                    value={category.color}
                    onChange={(e) =>
                      setCategory({ ...category, color: e.target.value })
                    }
                  />
                </div>
                <div className="button-row">
                  {category.id && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        setCategory({
                          id: "",
                          name: "",
                          color: "#8672d9",
                          icon: "⭐",
                        })
                      }
                    >
                      Annuler
                    </button>
                  )}
                  <button type="submit" className="primary-button">
                    <Plus size={16} />
                    {category.id ? "Enregistrer" : "Ajouter"}
                  </button>
                </div>
              </form>
            </>
          )}
          {tab === "data" && (
            <>
              <div className="storage-card">
                <HardDrive size={28} />
                <div>
                  <strong>Vos données sont enregistrées ici.</strong>
                  <p>
                    Événements et documents sont enregistrés dans le stockage
                    privé de ce navigateur. Si vous activez l’abonnement Apple,
                    une copie des événements est aussi publiée sur le serveur.
                  </p>
                  {storage && (
                    <small>
                      {(storage.usage / (1024 * 1024)).toFixed(1)} Mo utilisés
                      {storage.quota > 0
                        ? ` sur ${(storage.quota / (1024 * 1024 * 1024)).toFixed(1)} Go estimés`
                        : ""}
                    </small>
                  )}
                </div>
              </div>
              <p className="notice">
                Effacer les données du navigateur, changer d’appareil ou une
                suppression automatique du stockage peut effacer votre
                calendrier. Faites régulièrement une sauvegarde complète.
              </p>
              <button
                className="secondary-button"
                onClick={() =>
                  run(async () => {
                    const granted = await requestPersistence();
                    notify(
                      granted
                        ? "Stockage persistant accordé par le navigateur."
                        : "Le navigateur ne garantit pas la persistance. Conservez une sauvegarde.",
                      granted ? "success" : "info",
                    );
                  })
                }
              >
                <ShieldCheck size={16} />
                {storage?.persistent
                  ? "Stockage persistant accordé"
                  : "Demander un stockage persistant"}
              </button>
              <CalendarSubscriptionPanel subscription={subscription} />
              <h3>Échanger un fichier avec Calendrier Apple</h3>
              <p className="muted">
                Import / export manuel au format .ics, avec les horaires,
                répétitions et rappels compatibles. Les documents restent dans
                Tempo.
              </p>
              <div className="button-row">
                <button
                  className="secondary-button"
                  onClick={() => fileRef.current?.click()}
                >
                  <ArrowDownToLine size={16} />
                  Importer un .ics
                </button>
                <button
                  className="secondary-button"
                  onClick={onExport}
                  disabled={!data.events.length}
                >
                  <ArrowUpFromLine size={16} />
                  Exporter les événements
                </button>
              </div>
              <input
                ref={fileRef}
                hidden
                type="file"
                accept=".ics,text/calendar"
                onChange={(e) => {
                  void prepareImport(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {pendingImport && (
                <div className="import-preview">
                  <strong>
                    {pendingImport.events.length} nouvel événement à importer
                  </strong>
                  <p>
                    {pendingImport.duplicates} doublon(s) ignoré(s) grâce à
                    l’identifiant du calendrier.
                  </p>
                  {pendingImport.warnings.length > 0 && (
                    <ul className="import-warnings">
                      {pendingImport.warnings.map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                    </ul>
                  )}
                  <div className="button-row">
                    <button
                      className="secondary-button"
                      onClick={() => setPendingImport(null)}
                    >
                      Annuler
                    </button>
                    <button
                      className="primary-button"
                      disabled={!pendingImport.events.length}
                      onClick={() =>
                        run(async () => {
                          await onChange({
                            ...data,
                            events: [...data.events, ...pendingImport.events],
                          });
                          setPendingImport(null);
                        }, "Événements importés.")
                      }
                    >
                      Confirmer l’import
                    </button>
                  </div>
                </div>
              )}
              <h3>Garder une copie de tout</h3>
              <p className="muted">
                La sauvegarde JSON comprend les événements, les préférences, les
                calendriers et tous les documents. Taille maximale : 250 Mo.
              </p>
              <div className="button-row">
                <button
                  className="primary-button"
                  onClick={() =>
                    run(
                      async () =>
                        downloadBlob(
                          await exportBackup(data),
                          `tempo-sauvegarde-${dateKey(new Date())}.json`,
                        ),
                      "Sauvegarde préparée. Conservez le fichier téléchargé.",
                    )
                  }
                >
                  <Download size={16} />
                  Sauvegarder
                </button>
                <button
                  className="secondary-button"
                  onClick={() => backupRef.current?.click()}
                >
                  <Database size={16} />
                  Restaurer
                </button>
              </div>
              <input
                hidden
                ref={backupRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  setBackup(e.target.files?.[0] || null);
                  e.target.value = "";
                }}
              />
              {backup && (
                <div className="import-preview">
                  <strong>Restaurer « {backup.name} » ?</strong>
                  <p>
                    Cette opération remplacera tous les événements, documents et
                    préférences actuels par la sauvegarde. Téléchargez d’abord
                    une copie si nécessaire.
                  </p>
                  <div className="button-row">
                    <button
                      className="secondary-button"
                      onClick={() => setBackup(null)}
                    >
                      Annuler
                    </button>
                    <button
                      className="danger-button"
                      onClick={() =>
                        run(async () => {
                          const restored = await importBackup(backup);
                          onRestore(restored);
                          setSettings(restored.settings);
                          setCategory({
                            id: "",
                            name: "",
                            color: "#8672d9",
                            icon: "⭐",
                          });
                          setBackup(null);
                          setPendingImport(null);
                        }, "Sauvegarde restaurée.")
                      }
                    >
                      Remplacer et restaurer
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {tab === "help" && (
            <>
              <div className="help-heading">
                <Smartphone size={28} />
                <h3>Installation</h3>
              </div>
              <h4>Installer sur iPhone</h4>
              <ol className="help-steps">
                <li>Ouvrez Tempo dans Safari, sur une adresse HTTPS.</li>
                <li>
                  Touchez le bouton de partage, puis{" "}
                  <strong>Sur l’écran d’accueil</strong>.
                </li>
                <li>
                  Ouvrez l’app une première fois avec une connexion pour
                  préparer l’accès hors ligne.
                </li>
              </ol>
              <p className="notice">
                Si le haut de la PWA reste flou après la mise à jour, sauvegardez
                vos données dans « Mes données » et révoquez l’abonnement éventuel
                avant de retirer puis réinstaller l’icône. iOS peut conserver
                le style de barre d’état choisi à l’installation.
              </p>
              <CalendarSubscriptionPanel subscription={subscription} />
              <h4>Importer manuellement dans Calendrier Apple</h4>
              <ol className="help-steps">
                <li>
                  Dans « Mes données », exportez vos événements au format{" "}
                  <strong>.ics</strong>.
                </li>
                <li>
                  Sur iPhone, ouvrez le fichier reçu en pièce jointe dans Mail,
                  puis ajoutez les événements proposés. Vous pouvez aussi
                  importer le fichier dans Calendrier sur Mac.
                </li>
                <li>
                  Vérifiez le calendrier de destination et les rappels dans
                  Calendrier Apple.
                </li>
              </ol>
              <div className="info-box">
                <Info size={18} />
                <p>
                  Il s’agit d’un transfert manuel. Modifier ou supprimer un
                  événement dans Tempo ne met pas à jour sa copie dans Apple. Un
                  nouvel import peut créer des doublons dans Apple.
                </p>
              </div>
              <h4>Ce que garde Tempo</h4>
              <p className="muted">
                Les types, icônes et documents enrichissent votre calendrier
                dans Tempo. Ils ne sont pas transmis à Apple. Les rappels sont
                exportés, mais Tempo ne déclenche pas d’alarme lorsqu’il est
                fermé.
              </p>
              <h4>Compatibilité des imports</h4>
              <p className="muted">
                Les répétitions simples et les fuseaux Europe/Paris et UTC sont
                pris en charge. Un aperçu signale les événements incompatibles
                (règles avancées, exceptions, autres fuseaux). Les invitations
                et participants ne sont pas gérés.
              </p>
              <a
                className="external-link"
                href="https://support.apple.com/fr-fr/guide/iphone/ipha0d932e96/ios"
                target="_blank"
                rel="noreferrer"
              >
                Consulter l’aide Apple sur l’import de calendriers ↗
              </a>
            </>
          )}
        </fieldset>
        {busy && (
          <p role="status" className="muted">
            Opération en cours…
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </div>
      <footer className="dialog-footer">
        <span className="muted version">Tempo · Version 0.1</span>
        <span className="spacer" />
        <button className="secondary-button" disabled={busy} onClick={onClose}>
          Fermer
        </button>
      </footer>
    </Dialog>
  );
}
