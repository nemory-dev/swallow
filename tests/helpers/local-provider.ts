import type { AIModel, CoachRequest, OllamaState } from '../../src/shared/types.js';
export function localProvider(slug = 'test') {
  const model: AIModel = { slug, displayName: 'Fixture', providerId: 'ollama', connectionId: 'fixture', upstreamModelId: slug, modelFingerprint: 'version-one', capabilities: { text: 'supported', vision: 'unsupported', structuredOutput: 'supported', executionLocation: 'same-device' } };
  const state: OllamaState = { status: 'ready', endpoint: { host: '127.0.0.1', port: 11434 }, revision: 1, models: [model], message: '' };
  return {
    state, initialize: async () => {}, connect: async () => {}, refresh: async () => {}, cancel() {}, dispose() {},
    disconnect: async () => { state.status = 'disconnected'; state.models = []; },
    streamResponse: async (_request: CoachRequest): Promise<{ text: string }> => ({ text: '{}' }),
  };
}
