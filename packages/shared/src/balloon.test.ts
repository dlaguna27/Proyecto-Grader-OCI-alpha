import { describe, expect, it } from 'vitest';
import { assignBalloonColors, balloonTextColor, ICPC_BALLOON_COLORS, ioiColorStrength } from './index.js';

describe('balloons', () => {
  const probs = [
    { id: 'a', balloonColor: '#123456' },
    { id: 'b', balloonColor: null },
    { id: 'c', balloonColor: 'bogus' },
  ];
  it('uses the preset order for ICPC palettes, ignoring custom colors', () => {
    const m = assignBalloonColors('ICPC', probs);
    expect([...m.values()]).toEqual(ICPC_BALLOON_COLORS.slice(0, 3).map((c) => c.hex));
  });
  it('uses custom colors when set, falling back to the preset', () => {
    const m = assignBalloonColors('CUSTOM', probs);
    expect(m.get('a')).toBe('#123456');
    expect(m.get('b')).toBe(ICPC_BALLOON_COLORS[1]!.hex);
    expect(m.get('c')).toBe(ICPC_BALLOON_COLORS[2]!.hex);
  });
  it('wraps around the preset', () => {
    const many = Array.from({ length: ICPC_BALLOON_COLORS.length + 1 }, (_, i) => ({ id: String(i), balloonColor: null }));
    expect(assignBalloonColors('ICPC', many).get(String(ICPC_BALLOON_COLORS.length))).toBe(ICPC_BALLOON_COLORS[0]!.hex);
  });
  it('scales IOI strength with the score', () => {
    expect(ioiColorStrength(0, 10000)).toBe(0);
    expect(ioiColorStrength(500, null)).toBe(0);
    expect(ioiColorStrength(10000, 10000)).toBe(1);
    expect(ioiColorStrength(5000, 10000)).toBeCloseTo(0.575);
    expect(ioiColorStrength(2500, 10000)).toBeLessThan(ioiColorStrength(7500, 10000));
  });
  it('picks readable text', () => {
    expect(balloonTextColor('#fdd835')).toBe('#111111');
    expect(balloonTextColor('#1e63d6')).toBe('#ffffff');
  });
});
