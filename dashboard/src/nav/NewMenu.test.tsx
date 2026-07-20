// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NewMenu } from './NewMenu';

afterEach(cleanup);

describe('direct New button', () => {
  it('opens Composer directly without an entity dropdown', () => {
    const onCreate = vi.fn();
    render(<NewMenu onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('can be disabled while a workspace is being created', () => {
    render(<NewMenu onCreate={() => {}} disabled />);
    expect((screen.getByRole('button', { name: 'New' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
