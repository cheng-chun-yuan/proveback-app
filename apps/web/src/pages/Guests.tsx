import { api } from '../api/client';
import { useAction, useLoad } from '../lib/hooks';
import { formatTime } from '../lib/labels';
import { useWorkspace } from '../components/Layout';
import { Chip, Empty, ErrorBox, FormError, Loading } from '../components/ui';

export function GuestsPage() {
  const { workspace } = useWorkspace();
  const guests = useLoad(() => api.guests(workspace.id), [workspace.id]);
  const revoke = useAction();

  return (
    <div className="page">
      <h1>Guests</h1>
      <p className="lead">
        Each guest who is verified by passport is recorded, so a returning guest is recognized when they present the same passport at a later meeting. Passport numbers, birth dates and full names are not stored.
      </p>
      <section className="card">
        {guests.loading && !guests.data && <Loading />}
        {guests.error && <ErrorBox message={guests.error} onRetry={guests.reload} />}
        {guests.data?.items.length === 0 && <Empty>No guests have been verified yet.</Empty>}
        <FormError message={revoke.error} />
        <ul className="rows">
          {guests.data?.items.map((g) => (
            <li key={g.id} className="row-block">
              <div className="row-main">
                <strong>
                  {g.label} {g.nationality && <Chip>{g.nationality}</Chip>} {g.revoked && <Chip tone="bad">Revoked</Chip>}
                </strong>
                <span className="muted">
                  First seen {formatTime(g.firstSeenAt)} · Last verified {formatTime(g.lastVerifiedAt)} · {g.meetingCount} {g.meetingCount === 1 ? 'meeting' : 'meetings'}
                </span>
              </div>
              {!g.revoked && (
                <div className="actions">
                  <button
                    className="btn btn-small btn-danger"
                    disabled={revoke.busy}
                    onClick={() =>
                      confirm(`Revoke the passport link for "${g.label}"? If the same passport appears again, it will be treated as a new guest.`) &&
                      revoke.run(async () => { await api.revokeGuest(g.id); guests.reload(); })
                    }
                  >
                    Revoke
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
