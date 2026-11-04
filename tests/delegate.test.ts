import { describe, expect, it } from 'vitest';
import { AutoDelegate } from '../src/delegate';

describe('AutoDelegate', () => {
  it('keeps a fast GPU', () => {
    const a = new AutoDelegate(120, 30);
    expect(a.update('GPU', 10, 30)).toBeNull();
    expect(a.update('GPU', 30, 30)).toBeNull();
    expect(a.state).toBe('settled');
  });
  it('tries CPU when GPU is slow and keeps CPU if faster', () => {
    const a = new AutoDelegate(120, 30);
    expect(a.update('GPU', 30, 3000)).toBe('CPU');
    expect(a.update('CPU', 10, 150)).toBeNull(); // still in trial
    expect(a.update('CPU', 30, 150)).toBeNull();
    expect(a.state).toBe('settled');
  });
  it('returns to GPU if CPU turns out slower', () => {
    const a = new AutoDelegate(120, 30);
    expect(a.update('GPU', 30, 200)).toBe('CPU');
    expect(a.update('CPU', 30, 400)).toBe('GPU');
    expect(a.update('GPU', 60, 200)).toBeNull();
  });
  it('settles immediately if GPU never initialized', () => {
    const a = new AutoDelegate(120, 30);
    expect(a.update('CPU', 30, 500)).toBeNull();
    expect(a.state).toBe('settled');
  });
  it('ends a trial early on time when frames are very slow', () => {
    const a = new AutoDelegate(120, 30, 3000);
    expect(a.update('GPU', 2, 4000, 8000)).toBeNull(); // fewer than 3 frames
    expect(a.update('GPU', 3, 4000, 12000)).toBe('CPU');
  });
  it('stops experimenting after a GPU failure', () => {
    const a = new AutoDelegate();
    a.gpuFailed();
    expect(a.update('CPU', 100, 999)).toBeNull();
  });
});
