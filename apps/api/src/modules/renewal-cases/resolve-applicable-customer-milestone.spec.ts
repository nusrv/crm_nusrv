import { resolveApplicableCustomerMilestone } from './renewal-engine.service';

const milestones = [30, 21, 14, 7, 2, 0].map((daysBeforeDue) => ({
  daysBeforeDue,
  id: `rule-${daysBeforeDue}`,
}));

describe('resolveApplicableCustomerMilestone', () => {
  it('returns the exact milestone when the engine runs on schedule', () => {
    expect(resolveApplicableCustomerMilestone(milestones, 30)?.daysBeforeDue).toBe(30);
    expect(resolveApplicableCustomerMilestone(milestones, 0)?.daysBeforeDue).toBe(0);
  });

  // Slice B §2 worked example, verbatim: D-20 -> D-21, D-12 -> D-14, D-6 -> D-7, D0 -> D0.
  it('selects the nearest missed-but-not-yet-fired milestone (the "latest suitable" one)', () => {
    expect(resolveApplicableCustomerMilestone(milestones, 20)?.daysBeforeDue).toBe(21);
    expect(resolveApplicableCustomerMilestone(milestones, 12)?.daysBeforeDue).toBe(14);
    expect(resolveApplicableCustomerMilestone(milestones, 6)?.daysBeforeDue).toBe(7);
    expect(resolveApplicableCustomerMilestone(milestones, 0)?.daysBeforeDue).toBe(0);
  });

  it('never selects an older milestone than the nearest applicable one', () => {
    // At D-12, both 21 and 14 qualify (>=12) but 14 is nearer — 21 must never be chosen.
    const result = resolveApplicableCustomerMilestone(milestones, 12);
    expect(result?.daysBeforeDue).not.toBe(21);
    expect(result?.daysBeforeDue).not.toBe(30);
  });

  it('returns null once the subscription is overdue, never a stale reminder', () => {
    expect(resolveApplicableCustomerMilestone(milestones, -1)).toBeNull();
    expect(resolveApplicableCustomerMilestone(milestones, -30)).toBeNull();
  });

  it('returns null when no configured milestone is large enough to have been reached yet', () => {
    expect(resolveApplicableCustomerMilestone(milestones, 45)).toBeNull();
  });
});
