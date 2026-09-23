export const AI_QUEUE = 'ai-classification';
export const AI_CLASSIFY_JOB = 'classify-message';
export const AI_RECOVERY_JOB = 'recover-pending';
export const AI_RECOVERY_SCHEDULER = 'periodic-ai-recovery-scan';

// Slice G — routing shares this SAME queue (distinct job names only), rather than standing up a
// second BullMQ queue purely for the sake of having one (§8).
export const AI_ROUTE_JOB = 'route-classification';
export const AI_ROUTING_RECOVERY_JOB = 'recover-pending-routing';
export const AI_ROUTING_RECOVERY_SCHEDULER = 'periodic-ai-routing-recovery-scan';
