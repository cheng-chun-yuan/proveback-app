import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAction } from '../lib/hooks';
import { DevTag, FormError } from '../components/ui';

/** 只接受站內相對路徑,避免被當成開放式轉址 */
const safeRedirect = (r: string | null) => (r && r.startsWith('/') && !r.startsWith('//') && !r.includes('\\') ? r : '/');

export function DevLoginPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('alice@acme.com');
  const [name, setName] = useState('Alice Chen');
  const action = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => api.devLogin({ email: email.trim(), name: name.trim() }))) {
      location.assign(safeRedirect(params.get('redirect')));
    }
  };

  return (
    <div className="center-page">
      <form className="card card-narrow" onSubmit={submit}>
        <DevTag>模擬畫面:這不是真的 Google 登入</DevTag>
        <h1>模擬 Google 登入</h1>
        <p className="hint">後端沒有設定 Google OAuth,所以用這個表單代替。輸入任何 Email 都能登入。</p>
        <label className="field">
          <span className="field-label">Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">顯示名稱</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <FormError message={action.error} />
        <button className="btn btn-primary btn-block" disabled={action.busy}>{action.busy ? '登入中…' : '登入'}</button>
      </form>
    </div>
  );
}
