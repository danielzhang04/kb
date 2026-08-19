// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { compileRecurrence, decomposeRecurrence, RecurrencePicker } from './RecurrencePicker';

afterEach(() => cleanup());

describe('RecurrencePicker', () => {
  it('emits one validated five-field cron for selected weekdays and multiple times', () => {
    const onChange = vi.fn();
    render(<RecurrencePicker initialCron="0 9 * * mon,wed" onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByLabelText('Tue'));
    fireEvent.click(screen.getByRole('button', { name: 'Add time' }));
    fireEvent.change(screen.getByLabelText('Time 2'), { target: { value: '09:30' } });

    expect(onChange).toHaveBeenLastCalledWith('0,30 9 * * tue,wed');
    expect(screen.getByText('Runs on Tue, Wed at 09:00, 09:30.')).toBeTruthy();
  });

  it('removes a time row but never removes the final time', () => {
    render(<RecurrencePicker initialCron="0,30 9 * * mon" onChange={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: 'Remove time' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove time' })[0]);
    expect(screen.queryByRole('button', { name: 'Remove time' })).toBeNull();
    expect(screen.getByLabelText('Time 1')).toBeTruthy();
  });

  it('decomposes only a representable weekday/time cron and preserves other cron as raw', () => {
    expect(decomposeRecurrence('15 7,9 * * mon,fri')).toEqual({ days: ['mon', 'fri'], times: ['07:15', '09:15'] });
    expect(decomposeRecurrence('0,30 7,9 * * mon')).toBeNull();
    render(<RecurrencePicker initialCron="*/5 * * * *" onChange={vi.fn()} />);
    expect(screen.getByTestId('recurrence-picker-raw').textContent).toContain('*/5 * * * *');
    fireEvent.click(screen.getByRole('button', { name: 'Use weekday and time picker' }));
    expect(screen.getByTestId('recurrence-picker')).toBeTruthy();
  });

  it('refuses a time set that cron would turn into a larger cross-product', () => {
    expect(compileRecurrence({ days: ['mon'], times: ['07:15', '09:30'] })).toBeNull();
  });

  it('does not normalize duplicate or invalid time rows into a cron, and names the bad rows', () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(<RecurrencePicker initialCron="0 9 * * mon" onChange={onChange} onValidityChange={onValidityChange} />);

    onChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Add time' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId('recurrence-time-error-1').textContent).toContain('duplicates time 2');
    expect(screen.getByTestId('recurrence-time-error-2').textContent).toContain('duplicates time 1');

    fireEvent.change(screen.getByLabelText('Time 2'), { target: { value: '' } });
    expect(screen.getByTestId('recurrence-time-error-2').textContent).toContain('invalid');
    expect(compileRecurrence({ days: ['mon'], times: ['09:00', '09:00'] })).toBeNull();
    expect(compileRecurrence({ days: ['mon'], times: ['09:00', 'not-a-time'] })).toBeNull();
  });

  it('reports zero selected days as invalid without emitting a stale cron', () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(<RecurrencePicker initialCron="0 9 * * mon" onChange={onChange} onValidityChange={onValidityChange} />);

    onChange.mockClear();
    fireEvent.click(screen.getByLabelText('Mon'));
    expect(onChange).not.toHaveBeenCalled();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByText('Choose at least one day.')).toBeTruthy();
  });
});
