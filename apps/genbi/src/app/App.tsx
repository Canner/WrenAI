import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AppShell } from './shell/AppShell';
import { compatibilityPages, pages, defaultPath } from './registry';
import { SessionsPage } from '@/sessions/SessionsPage';
import { AskPage } from '@/pages/AskPage';
import { structuredAskPath } from '@/sessions/structuredAsk';

function LegacyAskRedirect() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <Navigate to={structuredAskPath(sessionId)} replace />;
}

/**
 * The route tree, router-agnostic so tests can mount it under a MemoryRouter.
 * All pages render inside the AppShell layout route; every unknown path falls
 * back to the default landing route.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={defaultPath} replace />} />
        {pages.map(({ key, path, Page }) => (
          <Route key={key} path={path} element={<Page />} />
        ))}
        {compatibilityPages.map(({ key, path, Page }) => <Route key={key} path={path} element={<Page />} />)}
        <Route path="/sessions/ask" element={<AskPage />} />
        <Route path="/sessions/ask/:sessionId" element={<AskPage />} />
        <Route path="/ask" element={<LegacyAskRedirect />} />
        <Route path="/ask/:sessionId" element={<LegacyAskRedirect />} />
        <Route path="/sessions/:id" element={<SessionsPage />} />
        <Route path="*" element={<Navigate to={defaultPath} replace />} />
      </Route>
    </Routes>
  );
}

/** Production entry: the route tree under a browser (history API) router. */
export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
