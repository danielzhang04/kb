// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { compileRecurrence, decomposeRecurrence, RecurrencePicker } from './RecurrencePicker';

afterEach(() => cleanup());

describe('RecurrencePicker', () => {
  const showCustom = (): void => { fireEvent.change(screen.getByLabelText('Recurrence preset'), { target: { value: 'custom-raw' } }); };

  it('makes presets first-class and only reveals day and time selectors for Custom', () => {
    render(<RecurrencePicker initialCron="daily" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Recurrence preset')).toBeTruthy();
    expect(screen.queryByLabelText('Time 1')).toBeNull();
    showCustom();
    expect(screen.getByLabelText('Time 1')).toBeTruthy();
    expect(screen.getByLabelText('Mon')).toBeTruthy();
  });

  it('emits one validated five-field cron for selected weekdays and multiple custom times', () => {
    const onChange = vi.fn();
    render(<RecurrencePicker initialCron="0 9 * * mon,wed" onChange={onChange} />);
    showCustom();
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByLabelText('Tue'));
    fireEvent.click(screen.getByRole('button', { name: 'Add time' }));
    fireEvent.change(screen.getByLabelText('Time 2'), { target: { value: '09:30' } });
    expect(onChange).toHaveBeenLastCalledWith('0,30 9 * * tue,wed');
    expect(screen.getByText('Tue, Wed · 9:00 AM, 9:30 AM')).toBeTruthy();
  });

  it('removes a time row but never removes the final custom time', () => {
    render(<RecurrencePicker initialCron="0,30 9 * * mon" onChange={vi.fn()} />);
    showCustom();
    expect(screen.getAllByRole('button', { name: 'Remove time' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove time' })[0]);
    expect(screen.queryByRole('button', { name: 'Remove time' })).toBeNull();
    expect(screen.getByLabelText('Time 1')).toBeTruthy();
  });

  it('shows unrepresentable cron as Custom (raw), preserving it until the user chooses selectors', () => {
    expect(decomposeRecurrence('15 7,9 * * mon,fri')).toEqual({ days: ['mon', 'fri'], times: ['07:15', '09:15'] });
    expect(decomposeRecurrence('0,30 7,9 * * mon')).toBeNull();
    render(<RecurrencePicker initialCron="*/5 * * * *" onChange={vi.fn()} />);
    expect(screen.getByTestId('recurrence-picker-raw').textContent).toContain('*/5 * * * *');
    expect((screen.getByLabelText('Recurrence preset') as HTMLSelectElement).value).toBe('custom-raw');
    fireEvent.click(screen.getByRole('button', { name: 'Use custom selectors' }));
    expect(screen.getByTestId('recurrence-picker')).toBeTruthy();
  });

  it('refuses a time set that cron would turn into a larger cross-product and names row errors', () => {
    expect(compileRecurrence({ days: ['mon'], times: ['07:15', '09:30'] })).toBeNull();
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(<RecurrencePicker initialCron="0 9 * * mon" onChange={onChange} onValidityChange={onValidityChange} />);
    showCustom(); onChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Add time' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId('recurrence-time-error-1').textContent).toContain('duplicates time 2');
    fireEvent.change(screen.getByLabelText('Time 2'), { target: { value: '' } });
    expect(screen.getByTestId('recurrence-time-error-2').textContent).toContain('invalid');
  });

  it('reports zero selected custom days as invalid without emitting a stale cron', () => {
    const onChange = vi.fn(); const onValidityChange = vi.fn();
    render(<RecurrencePicker initialCron="0 9 * * mon" onChange={onChange} onValidityChange={onValidityChange} />);
    showCustom(); onChange.mockClear();
    fireEvent.click(screen.getByLabelText('Mon'));
    expect(onChange).not.toHaveBeenCalled();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByText('Choose at least one day.')).toBeTruthy();
  });
});
