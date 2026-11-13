import { useState } from "react";
import type { CalendarSubscription } from "../lib/subscription";

export function CalendarSubscriptionPanel({ subscription }: { subscription: CalendarSubscription }) {
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  return (
    <section className="subscription-panel" aria-label="Abonnement Calendrier Apple">
      <h3>Abonnement Calendrier Apple</h3>
      <p className="muted">
        Retrouvez automatiquement vos événements dans Calendrier Apple.
        Les ajouts, modifications et suppressions sont publiés depuis Tempo.
        Apple consulte le calendrier à son rythme : les mises à jour ne sont pas immédiates.
      </p>
      <p className="field-hint">
        En activant l’abonnement, une copie de tous vos événements, y compris les lieux,
        notes et rappels, est envoyée au serveur de Tempo. Les documents restent sur cet appareil.
        Toute personne possédant le lien peut consulter ce calendrier en lecture seule.
      </p>
      {!subscription.enabled ? (
        <button className="primary-button" disabled={subscription.busy} onClick={() => { void subscription.enable(); }}>
          Activer l’abonnement
        </button>
      ) : (
        <>
          {subscription.url && <>
            <a className="primary-button" href={subscription.webcalUrl} referrerPolicy="no-referrer">
              S’abonner dans Calendrier Apple
            </a>
            <label className="field">
              Lien privé d’abonnement
              <input readOnly value={subscription.url} onFocus={event => event.target.select()} />
            </label>
            <button className="secondary-button" onClick={async () => {
              try { await navigator.clipboard.writeText(subscription.url); setCopyMessage("Lien copié."); }
              catch { setCopyMessage("Sélectionnez le lien ci-dessus pour le copier."); }
            }}>Copier le lien</button>
            {copyMessage && <p role="status" className="field-hint">{copyMessage}</p>}
            <p className="field-hint">
              Vous pouvez aussi coller ce lien dans Calendrier → Calendriers → Ajouter un calendrier
              → Ajouter un abonnement. Modifiez les événements dans Tempo.
              Vérifiez les alertes dans les options de l’abonnement Apple.
            </p>
          </>}
          <p className="field-hint" role="status">
            {subscription.busy ? "Mise à jour de l’abonnement…"
              : subscription.error ? "Publication en attente."
              : subscription.publishedAt ? `Publié le ${new Date(subscription.publishedAt).toLocaleString("fr-FR")}.`
              : "En attente de la première publication."}
          </p>
          <p className="field-hint">Après une modification hors connexion, ouvrez Tempo avec du réseau pour la transmettre à Apple.</p>
          <div className="button-row">
            <button className="secondary-button" disabled={subscription.busy} onClick={() => { void subscription.refresh(); }}>Publier maintenant</button>
            <button className="text-button" disabled={subscription.busy} onClick={() => setConfirmRevoke(true)}>Désactiver l’abonnement</button>
          </div>
          {confirmRevoke && <div className="notice">
            <p>Le lien deviendra inutilisable et la copie sur le serveur sera supprimée.
              Vos événements resteront dans Tempo. Retirez aussi cet abonnement de Calendrier Apple.</p>
            <div className="button-row">
              <button className="secondary-button" disabled={subscription.busy} onClick={() => setConfirmRevoke(false)}>Annuler</button>
              <button className="danger-button" disabled={subscription.busy} onClick={async () => { await subscription.disable(); setConfirmRevoke(false); }}>Révoquer le lien</button>
            </div>
          </div>}
        </>
      )}
      {subscription.error && <p className="error-message" role="alert">{subscription.error}</p>}
    </section>
  );
}
