import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageContainer } from '../PageContainer';

describe('PageContainer', () => {
  it('renders the title as a heading', () => {
    render(<PageContainer title="Harness"><p>body</p></PageContainer>);
    expect(screen.getByRole('heading', { name: 'Harness' })).toBeInTheDocument();
  });

  it('renders children', () => {
    render(<PageContainer title="Harness"><p>body content</p></PageContainer>);
    expect(screen.getByText('body content')).toBeInTheDocument();
  });

  it('renders no heading when title is omitted', () => {
    render(<PageContainer><p>body</p></PageContainer>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('renders an optional lead and right-aligned actions', () => {
    render(
      <PageContainer title="Eval" lead="Muted description" actions={<button>Run</button>}>
        <p>body</p>
      </PageContainer>,
    );
    expect(screen.getByText('Muted description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
  });

  it('applies the requested max-width', () => {
    render(<PageContainer maxWidth={1180} title="Context"><p>body</p></PageContainer>);
    expect(screen.getByRole('heading', { name: 'Context' }).closest('.genbi-page')).toHaveStyle({
      maxWidth: '1180px',
    });
  });
});
