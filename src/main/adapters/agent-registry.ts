import type { AgentAdapter } from './agent-adapter';
import { ClaudeCodeAdapter } from './claude-code-adapter';
import { CodexAdapter } from './codex-adapter';
import { CursorAdapter } from './cursor-adapter';
import { OpenCodeAdapter } from './opencode-adapter';
import { TraeAdapter } from './trae-adapter';

export function createBuiltInAgentAdapters(homeDirectory?: string): AgentAdapter[] {
  return [
    new CodexAdapter(homeDirectory),
    new ClaudeCodeAdapter(homeDirectory),
    new CursorAdapter(homeDirectory),
    new TraeAdapter(),
    new OpenCodeAdapter(homeDirectory)
  ];
}
