import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TextAnswer } from '../TextAnswer';

describe('TextAnswer', () => {
  it('shows a Verified badge for a data answer grounded by a successful query', () => {
    render(
      <TextAnswer answer={{ form: 'text', text: 'Revenue is up 12%.', verified: true, dataAnswer: true }} />,
    );
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('shows an Unverified badge for a data answer whose query failed or was refused', () => {
    render(
      <TextAnswer
        answer={{ form: 'text', text: "I couldn't complete that query.", verified: false, dataAnswer: true }}
      />,
    );
    expect(screen.getByText('Unverified')).toBeInTheDocument();
  });

  it('hides the badge entirely for a conversational answer with no data claim', () => {
    render(
      <TextAnswer
        answer={{ form: 'text', text: 'I can help you explore your data model and metrics.', verified: false, dataAnswer: false }}
      />,
    );
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(screen.queryByText('Unverified')).not.toBeInTheDocument();
  });
});
