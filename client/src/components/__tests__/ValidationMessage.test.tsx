import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ValidationMessage from '../ValidationMessage';

describe('ValidationMessage', () => {
  it('renders null when no message is provided', () => {
    const { container } = render(<ValidationMessage message={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the error message when provided', () => {
    render(<ValidationMessage message="This field is required" />);
    expect(screen.getByText('This field is required')).toBeInTheDocument();
  });

  it('applies correct styling classes', () => {
    render(<ValidationMessage message="Error message" />);
    const message = screen.getByText('Error message');
    expect(message).toHaveClass('text-red-400');
  });
});
