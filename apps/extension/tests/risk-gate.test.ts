import { describe, expect, it } from 'vitest';
import { riskBlock } from '../src/engine/context';
import { assessRisk } from '../src/shared/risk';

const NOW = Date.now();
const HOUR = 3_600_000;

describe('riskBlock: whether a job may start', () => {
  it('lets a job start with no warnings', () => {
    expect(riskBlock(assessRisk([], NOW))).toBeNull();
  });

  it('holds a job back during a resume lock and says until when', () => {
    const message = riskBlock(assessRisk([{ accountId: 'a', kind: 'automation_flag', at: NOW - HOUR }], NOW));
    expect(message).toMatch(/Risk level 2 \(Retreat\)/);
    expect(message).toMatch(/Resume is locked until/);
  });

  it('holds a job back on a full stop, with no automatic end', () => {
    const message = riskBlock(assessRisk([{ accountId: 'a', kind: 'suspended', at: NOW - HOUR }], NOW));
    expect(message).toMatch(/Risk level 4 \(Full stop\)/);
    expect(message).toMatch(/won’t resume on its own/);
  });

  it('lets a job start after the person typed an override, at a reduced pace', () => {
    const risk = assessRisk(
      [
        { accountId: 'a', kind: 'suspended', at: NOW - 2 * HOUR },
        { accountId: 'a', kind: 'override', at: NOW - HOUR },
      ],
      NOW,
    );
    expect(riskBlock(risk)).toBeNull();
    expect(risk.capFactor).toBe(0.25);
  });
});
