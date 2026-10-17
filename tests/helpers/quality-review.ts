import type { CoachRequest } from '../../src/shared/types.js';

/** Synthetic pass for service/transport fixtures only; quality rejection and live models are tested separately. */
export function qualityReply(request: CoachRequest): { text: string } | undefined {
  if (request.responseSchema?.properties && 'verdict' in (request.responseSchema.properties as object)) {
    return { text: JSON.stringify({ reason: 'Synthetic quality-review fixture', verdict: 'pass' }) };
  }
}
