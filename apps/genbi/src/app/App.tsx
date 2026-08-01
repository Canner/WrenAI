import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './shell/AppShell';
import { AskPage } from '@/pages/AskPage';
import { pages, defaultPath } from './registry';

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
        <Route path="/ask/:sessionId" element={<AskPage />} />
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
