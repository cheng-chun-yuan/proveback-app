import { useState, type FormEvent } from 'react';
import type { CreatePolicyBody, Policy } from '@proveback/contract';
import { api } from '../api/client';
import { useAction, useLoad } from '../lib/hooks';
import { parseCountries } from '../lib/labels';
import { useWorkspace } from '../components/Layout';
import { Chip, Empty, ErrorBox, FormError, Loading } from '../components/ui';

const blank: CreatePolicyBody = {
  name: '', isDefault: false, requireOfacClear: true, excludedCountries: [], discloseNationality: true, nameMatch: 'warn', minimumAge: null,
};

function PolicyForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial: CreatePolicyBody;
  submitLabel: string;
  onSubmit: (body: CreatePolicyBody) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [f, setF] = useState(initial);
  const [countries, setCountries] = useState(initial.excludedCountries.join(', '));
  const [age, setAge] = useState(initial.minimumAge === null ? '' : String(initial.minimumAge));
  const action = useAction();
  const parsed = parseCountries(countries);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (parsed.invalid.length) return;
    const ok = await action.run(() => onSubmit({ ...f, name: f.name.trim(), excludedCountries: parsed.codes, minimumAge: age === '' ? null : Number(age) }));
    if (ok && !onCancel) {
      setF(blank);
      setCountries('');
      setAge('');
    }
  };

  return (
    <form onSubmit={submit}>
      <label className="field">
        <span className="field-label">政策名稱</span>
        <input required value={f.name} placeholder="例:標準外部會議" onChange={(e) => setF({ ...f, name: e.target.value })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={f.requireOfacClear} onChange={(e) => setF({ ...f, requireOfacClear: e.target.checked })} />
        必須不在制裁名單上(OFAC)
      </label>
      <label className="field">
        <span className="field-label">排除的國籍(ISO 三碼,用逗號分隔;留空表示不排除)</span>
        <input value={countries} placeholder="PRK, IRN" onChange={(e) => setCountries(e.target.value)} />
        {parsed.invalid.length > 0 && <span className="form-error">不是三碼國家代碼:{parsed.invalid.join('、')}</span>}
      </label>
      <label className="check">
        <input type="checkbox" checked={f.discloseNationality} onChange={(e) => setF({ ...f, discloseNationality: e.target.checked })} />
        向主辦方顯示來賓的國籍(關閉時只知道是否在排除名單)
      </label>
      <label className="field">
        <span className="field-label">護照姓名與會議顯示名稱比對</span>
        <select value={f.nameMatch} onChange={(e) => setF({ ...f, nameMatch: e.target.value as Policy['nameMatch'] })}>
          <option value="off">不比對</option>
          <option value="warn">比對,不符時只提醒</option>
          <option value="require">比對,不符時驗證失敗</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">最低年齡(留空表示不檢查)</span>
        <input type="number" min={0} max={120} value={age} placeholder="例:18" onChange={(e) => setAge(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} />
        設為預設政策
      </label>
      <FormError message={action.error} />
      <div className="actions">
        <button className="btn btn-primary" disabled={action.busy || parsed.invalid.length > 0}>{action.busy ? '儲存中…' : submitLabel}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>取消</button>}
      </div>
    </form>
  );
}

const nameMatchWord = { off: '不比對', warn: '不符時提醒', require: '必須相符' } as const;

export function PoliciesPage() {
  const { workspace } = useWorkspace();
  const policies = useLoad(() => api.policies(workspace.id), [workspace.id]);
  const [editing, setEditing] = useState<string | null>(null);
  const remove = useAction();

  const toBody = ({ id: _id, workspaceId: _ws, ...rest }: Policy): CreatePolicyBody => rest;

  return (
    <div className="page">
      <h1>驗證政策</h1>
      <p className="lead">政策決定來賓要證明什麼,以及哪些資訊會顯示給主辦方。來賓在驗證前會看到完整的揭露項目。</p>
      <div className="split">
        <section className="card">
          <h2>新增政策</h2>
          <PolicyForm initial={blank} submitLabel="新增政策" onSubmit={async (b) => { await api.createPolicy(workspace.id, b); policies.reload(); }} />
        </section>

        <section className="card">
          <h2>現有政策</h2>
          {policies.loading && !policies.data && <Loading />}
          {policies.error && <ErrorBox message={policies.error} onRetry={policies.reload} />}
          {policies.data?.items.length === 0 && <Empty>還沒有政策。</Empty>}
          <FormError message={remove.error} />
          <ul className="rows">
            {policies.data?.items.map((p) => (
              <li key={p.id} className="row-block">
                {editing === p.id ? (
                  <PolicyForm
                    initial={toBody(p)}
                    submitLabel="儲存"
                    onCancel={() => setEditing(null)}
                    onSubmit={async (b) => { await api.updatePolicy(p.id, b); setEditing(null); policies.reload(); }}
                  />
                ) : (
                  <>
                    <div className="row-main">
                      <strong>{p.name} {p.isDefault && <Chip tone="info">預設</Chip>}</strong>
                      <span className="checks">
                        <Chip>{p.requireOfacClear ? '檢查制裁名單' : '不檢查制裁名單'}</Chip>
                        <Chip>{p.excludedCountries.length ? `排除:${p.excludedCountries.join('、')}` : '不排除國籍'}</Chip>
                        <Chip>{p.discloseNationality ? '顯示國籍' : '不顯示國籍'}</Chip>
                        <Chip>姓名:{nameMatchWord[p.nameMatch]}</Chip>
                        <Chip>{p.minimumAge === null ? '不檢查年齡' : `滿 ${p.minimumAge} 歲`}</Chip>
                      </span>
                    </div>
                    <div className="actions">
                      <button className="btn btn-small" onClick={() => setEditing(p.id)}>編輯</button>
                      <button
                        className="btn btn-small btn-danger"
                        disabled={remove.busy}
                        onClick={() => confirm(`確定刪除政策「${p.name}」?`) && remove.run(async () => { await api.deletePolicy(p.id); policies.reload(); })}
                      >
                        刪除
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
