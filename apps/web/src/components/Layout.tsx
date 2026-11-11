import { createContext, useContext } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { webRoutes, type MeResponse, type Workspace } from '@proveback/contract';
import { api } from '../api/client';
import { useLoad } from '../lib/hooks';
import { ErrorBox, Loading } from './ui';

interface WorkspaceCtx {
  me: MeResponse;
  workspace: Workspace;
  reloadMe: () => void;
}
const Ctx = createContext<WorkspaceCtx | null>(null);

export function useWorkspace(): WorkspaceCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWorkspace 只能在 WorkspaceLayout 內使用');
  return ctx;
}

export function WorkspaceLayout() {
  const { wsId = '' } = useParams();
  const navigate = useNavigate();
  const me = useLoad(() => api.me(), []);

  if (me.error) return <div className="center-page"><ErrorBox message={me.error} onRetry={me.reload} /></div>;
  if (!me.data) return <div className="center-page"><Loading /></div>;

  const workspace = me.data.workspaces.find((w) => w.id === wsId);
  const logout = async () => {
    await api.logout().catch(() => undefined);
    location.assign(webRoutes.login);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">ProveBack</span>
          <select
            className="ws-switch"
            aria-label="切換 workspace"
            value={workspace?.id ?? ''}
            onChange={(e) => navigate(webRoutes.meetings(e.target.value))}
          >
            {!workspace && <option value="">選擇 workspace</option>}
            {me.data.workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}{w.type === 'personal' ? '(個人)' : ''}</option>
            ))}
          </select>
          <span className="topbar-user">
            <span className="user-email">{me.data.user.email}</span>
            <button className="btn btn-small btn-ghost" onClick={logout}>登出</button>
          </span>
        </div>
        {workspace && (
          <nav className="tabs" aria-label="主要導覽">
            <NavLink to={webRoutes.meetings(workspace.id)}>會議</NavLink>
            <NavLink to={webRoutes.policies(workspace.id)}>驗證政策</NavLink>
            <NavLink to={webRoutes.members(workspace.id)}>成員</NavLink>
            <NavLink to={webRoutes.guests(workspace.id)}>來賓名冊</NavLink>
          </nav>
        )}
      </header>
      <main className="content">
        {workspace ? (
          <Ctx.Provider value={{ me: me.data, workspace, reloadMe: me.reload }}>
            <Outlet />
          </Ctx.Provider>
        ) : (
          <ErrorBox message="找不到這個 workspace,或你不是它的成員。請從上方切換。" />
        )}
      </main>
    </div>
  );
}
