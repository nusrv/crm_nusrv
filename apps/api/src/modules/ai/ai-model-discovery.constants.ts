/** Dynamic model discovery — a sane hard maximum protecting every provider adapter's `listModels()`
 * from an accidental infinite pagination loop (a misbehaving/malicious provider response looping a
 * page token/cursor back on itself). No real provider catalog is expected to approach this size;
 * reaching it means collection stops and whatever was safely gathered so far is returned. */
export const AI_MODEL_DISCOVERY_HARD_CAP = 1000;
