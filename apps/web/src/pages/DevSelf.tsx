import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import type { VerifySession } from '@proveback/contract';
import { api } from '../api/client';
import { useAction, useLoad } from '../lib/hooks';
import { failureLabel } from '../lib/labels';
import { DevTag, ErrorBox, FormError, Loading } from '../components/ui';

export function DevSelfPage() {
  const { sessionId = '' } = useParams();
  const session = useLoad(() => api.publicSession(sessionId), [sessionId]);
  const [result, setResult] = useState<VerifySession | null>(null);
  const [form, setForm] = useState({ passportId: 'P-0001', name: '', nationality: 'TWN', ofacClear: true, age: '30' });
  const action = useAction();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await action.run(async () => {
      setResult(
        await api.devCompleteSession(sessionId, {
          passportId: form.passportId.trim(),
          name: form.name.trim(),
          nationality: form.nationality.trim().toUpperCase(),
          ofacClear: form.ofacClear,
          age: Number(form.age),
        }),
      );
    });
  };

  const done = result ?? (session.data && session.data.status !== 'pending' ? session.data : null);

  return (
    <div className="center-page">
      <div className="card card-narrow">
        <DevTag>模擬畫面:這不是真的 Self app</DevTag>
        <h1>模擬掃描護照</h1>
        {session.loading && <Loading />}
        {session.error && <ErrorBox message={session.error} onRetry={session.reload} />}
        {done && (
          <div className={`result ${done.status === 'verified' ? 'result-good' : 'result-bad'}`}>
            <strong>{done.status === 'verified' ? '證明已送出,驗證通過' : done.status === 'expired' ? '這個驗證連結已過期' : '證明已送出,驗證未通過'}</strong>
            {done.failureReason && <span>{failureLabel[done.failureReason]}</span>}
            <span className="hint">可以關閉這個分頁,回到原本的驗證頁查看結果。</span>
          </div>
        )}
        {session.data && !done && (
          <form onSubmit={submit}>
            <p className="hint">後端沒有設定 Self,所以用這個表單假裝送出一份護照證明。護照編號相同代表同一本護照。</p>
            <label className="field">
              <span className="field-label">護照編號(只用來辨識是不是同一本)</span>
              <input required value={form.passportId} onChange={(e) => set('passportId', e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">護照上的姓名</span>
              <input required value={form.name} placeholder="例:WANG ZOE" onChange={(e) => set('name', e.target.value)} />
            </label>
            <div className="field-row">
              <label className="field">
                <span className="field-label">國籍(三碼)</span>
                <input required pattern="[A-Za-z]{3}" maxLength={3} value={form.nationality} onChange={(e) => set('nationality', e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">年齡</span>
                <input required type="number" min={0} max={120} value={form.age} onChange={(e) => set('age', e.target.value)} />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={form.ofacClear} onChange={(e) => set('ofacClear', e.target.checked)} />
              不在制裁名單上(OFAC 檢查通過)
            </label>
            <FormError message={action.error} />
            <button className="btn btn-primary btn-block" disabled={action.busy}>{action.busy ? '送出中…' : '送出證明'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
