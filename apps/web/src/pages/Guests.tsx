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
      <h1>來賓名冊</h1>
      <p className="lead">
        通過護照驗證的來賓會留下一筆記錄,下次開會出示同一本護照時能認出是同一人。這裡不保存護照號碼、生日或完整姓名。
      </p>
      <section className="card">
        {guests.loading && !guests.data && <Loading />}
        {guests.error && <ErrorBox message={guests.error} onRetry={guests.reload} />}
        {guests.data?.items.length === 0 && <Empty>還沒有來賓通過驗證。</Empty>}
        <FormError message={revoke.error} />
        <ul className="rows">
          {guests.data?.items.map((g) => (
            <li key={g.id} className="row-block">
              <div className="row-main">
                <strong>
                  {g.label} {g.nationality && <Chip>{g.nationality}</Chip>} {g.revoked && <Chip tone="bad">已撤銷</Chip>}
                </strong>
                <span className="muted">
                  首次出現 {formatTime(g.firstSeenAt)} · 最近驗證 {formatTime(g.lastVerifiedAt)} · 參加過 {g.meetingCount} 場會議
                </span>
              </div>
              {!g.revoked && (
                <div className="actions">
                  <button
                    className="btn btn-small btn-danger"
                    disabled={revoke.busy}
                    onClick={() =>
                      confirm(`撤銷「${g.label}」的綁定?之後同一本護照再出現會被當成新來賓。`) &&
                      revoke.run(async () => { await api.revokeGuest(g.id); guests.reload(); })
                    }
                  >
                    撤銷綁定
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
