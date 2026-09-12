/// <reference types="vite/client" />

import type { AgentBatonApi } from '../shared/ipc';

declare global {
  interface Window {
    agentBaton: AgentBatonApi;
  }
}

export {};
