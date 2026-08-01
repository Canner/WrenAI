import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { EditDropdown } from '../EditDropdown';

// jsdom has no built-in Clipboard API, so we stub `navigator.clipboard`
// ourselves. `userEvent.setup()` unconditionally attaches its *own* clipboard
// stub on the window as part of setup, which would clobber a stub installed
// beforehand — so `stubClipboard()` must run *after* `userEvent.setup()`.
function stubClipboard() {
  const writeText = vi.fn((_text: string) => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe('EditDropdown', () => {
  it('offers VS Code, Cursor, and Claude Code CLI as the Edit options', async () => {
    const user = userEvent.setup();
    stubClipboard();
    renderWithProviders(
      <EditDropdown
        filePath="wren_project/models/orders.model.yaml"
        projectPath="/Users/you/wren-projects/acme-genbi"
        projectName="acme-genbi"
        downstream={[{ key: 'measure.revenue', name: 'revenue', kind: 'measure' }]}
        verifiedPairCount={18}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Edit/ }));

    // Absolute path (projectPath + filePath), and the single-slash
    // `vscode://file/<abs>` form — not `vscode://file//<abs>`.
    expect(screen.getByRole('link', { name: 'Open in VS Code' })).toHaveAttribute(
      'href',
      'vscode://file/Users/you/wren-projects/acme-genbi/wren_project/models/orders.model.yaml',
    );
    expect(screen.getByRole('link', { name: 'Open in Cursor' })).toHaveAttribute(
      'href',
      'cursor://file/Users/you/wren-projects/acme-genbi/wren_project/models/orders.model.yaml',
    );
    expect(screen.getByText('Claude Code CLI')).toBeInTheDocument();
  });

  it('never produces a double slash in the deep links when projectPath has a trailing slash', async () => {
    const user = userEvent.setup();
    stubClipboard();
    renderWithProviders(
      <EditDropdown
        filePath="wren_project/models/orders.model.yaml"
        projectPath="/Users/you/wren-projects/acme-genbi/"
        projectName="acme-genbi"
        downstream={[]}
        verifiedPairCount={18}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Edit/ }));

    const href = screen.getByRole('link', { name: 'Open in VS Code' }).getAttribute('href');
    expect(href).toBe('vscode://file/Users/you/wren-projects/acme-genbi/wren_project/models/orders.model.yaml');
    expect(href).not.toContain('file//');
  });

  it('opens a copy-ready prompt with file path, project, downstream, and a verify-gate note', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    renderWithProviders(
      <EditDropdown
        filePath="wren_project/models/orders.model.yaml"
        projectPath="/Users/you/wren-projects/acme-genbi"
        projectName="acme-genbi"
        downstream={[{ key: 'measure.revenue', name: 'revenue', kind: 'measure' }]}
        verifiedPairCount={18}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Edit/ }));
    await user.click(screen.getByText('Claude Code CLI'));

    const dialog = screen.getByRole('dialog');
    // The prompt's `File:` line uses the absolute path, not the bare
    // project-relative `filePath`.
    expect(dialog).toHaveTextContent('/Users/you/wren-projects/acme-genbi/wren_project/models/orders.model.yaml');
    expect(dialog).toHaveTextContent('acme-genbi');
    expect(dialog).toHaveTextContent('revenue (measure)');
    expect(dialog).toHaveTextContent(/verify/i);
    expect(dialog).toHaveTextContent('18');

    await user.click(screen.getByRole('button', { name: /Copy prompt/ }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain(
      '/Users/you/wren-projects/acme-genbi/wren_project/models/orders.model.yaml',
    );
  });
});
