import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusTag, verifiedStateOf } from '@/ui/StatusTag';

describe('StatusTag', () => {
  it('renders a text label alongside color (non-color a11y channel)', () => {
    render(<StatusTag state="verified" />);
    // The label text must be present, not conveyed by color alone.
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('supports a custom label', () => {
    render(<StatusTag state="estimate" label="Forecast" />);
    expect(screen.getByText('Forecast')).toBeInTheDocument();
  });

  it('maps the envelope verified flag to a state', () => {
    expect(verifiedStateOf(true)).toBe('verified');
    expect(verifiedStateOf(false)).toBe('unverified');
    expect(verifiedStateOf(null)).toBe('unverified');
    expect(verifiedStateOf(undefined)).toBe('unverified');
  });
});
