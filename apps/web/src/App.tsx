import { Navigate, Route, Routes } from 'react-router-dom';
import { webRoutes } from '@proveback/contract';
import { api } from './api/client';
import { useLoad } from './lib/hooks';
import { ErrorBox, Loading } from './components/ui';
import { WorkspaceLayout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { MeetingsPage } from './pages/Meetings';
import { MeetingDetailPage } from './pages/MeetingDetail';
import { PoliciesPage } from './pages/Policies';
import { MembersPage } from './pages/Members';
import { GuestsPage } from './pages/Guests';
import { JoinPage } from './pages/Join';
import { BotScreenPage } from './pages/BotScreen';
import { DevLoginPage } from './pages/DevLogin';
import { DevSelfPage } from './pages/DevSelf';

function Home() {
  const me = useLoad(() => api.me(), []);
  if (me.error) return <div className="center-page"><ErrorBox message={me.error} onRetry={me.reload} /></div>;
  const first = me.data?.workspaces[0];
  if (!me.data) return <div className="center-page"><Loading /></div>;
  if (!first) return <div className="center-page"><ErrorBox message="這個帳號還沒有任何 workspace。" /></div>;
  return <Navigate to={webRoutes.meetings(first.id)} replace />;
}

export function App() {
  return (
    <>
      {import.meta.env.VITE_MOCK === '1' && (
        <div className="mock-ribbon">
          Mock 模式:資料是假的,只存在這個瀏覽器。
          <button
            onClick={async () => {
              (await import('./mock/store')).resetMock();
              location.assign('/');
            }}
          >
            重設資料
          </button>
        </div>
      )}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path={webRoutes.login} element={<LoginPage />} />
        <Route path="/w/:wsId" element={<WorkspaceLayout />}>
          <Route index element={<Navigate to="meetings" replace />} />
          <Route path="meetings" element={<MeetingsPage />} />
          <Route path="meetings/:mtgId" element={<MeetingDetailPage />} />
          <Route path="policies" element={<PoliciesPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="guests" element={<GuestsPage />} />
        </Route>
        <Route path="/join/:joinToken" element={<JoinPage />} />
        <Route path="/bot-screen/:joinToken" element={<BotScreenPage />} />
        <Route path={webRoutes.devLogin} element={<DevLoginPage />} />
        <Route path="/dev/self/:sessionId" element={<DevSelfPage />} />
        <Route path="*" element={<div className="center-page"><ErrorBox message="找不到這個頁面。" /></div>} />
      </Routes>
    </>
  );
}
