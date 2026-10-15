import { describe, expect, it } from 'vitest';
import { Playback } from '../src/lib/playback.ts';

type Ev = { ms: number; id: string };
const events: Ev[] = [
  { ms: 0, id: 'a' },
  { ms: 100, id: 'b' },
  { ms: 300, id: 'c' },
];

describe('Playback', () => {
  it('emits events when their time has come, at x1', () => {
    const p = new Playback(events, 1);
    expect(p.advance(50).map((x) => x.event.id)).toEqual(['a']);
    expect(p.advance(60).map((x) => x.event.id)).toEqual(['b']);
    expect(p.advance(200).map((x) => x.event.id)).toEqual(['c']);
    expect(p.done).toBe(true);
  });

  it('plays twice as fast at x2', () => {
    const p = new Playback(events, 2);
    expect(p.advance(50).map((x) => x.event.id)).toEqual(['a', 'b']);
    expect(p.advance(100).map((x) => x.event.id)).toEqual(['c']);
  });

  it('stops while paused and continues after resume', () => {
    const p = new Playback(events, 1);
    p.pause();
    expect(p.advance(500)).toEqual([]);
    p.resume();
    expect(p.advance(500).length).toBe(3);
  });

  it('continues after a decision with a list identical up to the decision point', () => {
    const p = new Playback(events, 1);
    const first = p.advance(100);
    expect(first.map((x) => x.index)).toEqual([0, 1]);
    const next: Ev[] = [...events.slice(0, 2), { ms: 150, id: 'x' }];
    p.resumeWith(next, 1);
    expect(p.advance(200).map((x) => x.event.id)).toEqual(['x']);
  });
});
