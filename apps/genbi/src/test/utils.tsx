import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/app/theme/ThemeProvider';

interface Options extends Omit<RenderOptions, 'wrapper'> {
  /** Initial history entry for the MemoryRouter. */
  route?: string;
}

/** Render a UI tree with the app theme + an in-memory router (for tests). */
export function renderWithProviders(ui: ReactElement, { route = '/', ...options }: Options = {}) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </ThemeProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}
