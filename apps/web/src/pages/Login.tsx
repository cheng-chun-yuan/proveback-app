import { useNavigate } from 'react-router-dom';
import { webRoutes } from '@proveback/contract';
import { api } from '../api/client';
import { MOCK } from '../api/events';

export function LoginPage() {
  const navigate = useNavigate();
  const start = () => {
    // mock 模式沒有後端可以轉址,直接進模擬登入頁;其餘一律交給後端決定(真 Google 或假登入)
    if (MOCK) navigate(`${webRoutes.devLogin}?redirect=${encodeURIComponent('/')}`);
    else location.assign(api.googleStartUrl('/'));
  };
  return (
    <div className="center-page">
      <div className="card card-narrow login-card">
        <h1 className="brand brand-large">ProveBack</h1>
        <p className="lead">會議身分驗證。讓外部來賓用護照證明自己,只揭露你要求的項目。</p>
        <button className="btn btn-primary btn-block" onClick={start}>使用 Google 登入</button>
        <p className="hint">登入後會自動為你建立一個個人 workspace。</p>
      </div>
    </div>
  );
}
