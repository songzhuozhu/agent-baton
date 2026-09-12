import { randomUUID } from 'node:crypto';
import { CredentialVault } from '../security/credential-vault';
import type { GitCommandEnvironment } from '../git/git-worktree';
import {
  GitHubDeviceFlow,
  type DeviceAuthorization,
  type DeviceAuthorizationPoll
} from './github-device-flow';

export interface GitHubAuthorizationStart {
  id: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: string;
}

interface PendingAuthorization {
  authorization: DeviceAuthorization;
}

/** Keeps device codes only in memory and persists only a successful token. */
export class GitHubAuthorizationService {
  private readonly pending = new Map<string, PendingAuthorization>();

  constructor(
    private readonly deviceFlow: GitHubDeviceFlow,
    private readonly vault: CredentialVault
  ) {}

  async start(): Promise<GitHubAuthorizationStart> {
    if (!this.vault.isAvailable()) {
      throw new Error('当前系统没有可用的安全凭据存储，不能连接 GitHub。');
    }
    const authorization = await this.deviceFlow.begin();
    const id = randomUUID();
    this.pending.set(id, { authorization });
    return {
      id,
      userCode: authorization.userCode,
      verificationUri: authorization.verificationUri,
      ...(authorization.verificationUriComplete ? { verificationUriComplete: authorization.verificationUriComplete } : {}),
      expiresAt: authorization.expiresAt
    };
  }

  async poll(id: string): Promise<Exclude<DeviceAuthorizationPoll, { status: 'authorized'; accessToken: string; tokenType: string; scope?: string }> | { status: 'authorized' }> {
    const pending = this.pending.get(id);
    if (!pending) throw new Error('GitHub 授权会话不存在或已结束。');
    const result = await this.deviceFlow.poll(pending.authorization);
    if (result.status === 'pending' || result.status === 'slow-down') {
      pending.authorization = { ...pending.authorization, nextPollAt: result.nextPollAt };
      return result;
    }
    if (result.status === 'authorized') {
      this.vault.save('github-app-user-token', result.accessToken);
      this.pending.delete(id);
      return { status: 'authorized' };
    }
    this.pending.delete(id);
    return result;
  }

  isConnected(): boolean {
    try {
      return this.vault.load('github-app-user-token') !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Supplies a GitHub HTTPS authorization header only to a spawned Git
   * process. The access token never appears in command-line arguments,
   * renderer IPC, the repository, or a temporary askpass file.
   */
  gitEnvironment(): GitCommandEnvironment {
    const token = this.vault.load('github-app-user-token');
    if (!token) throw new Error('请先通过 GitHub App 完成授权，再访问私有同步仓库。');
    const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
    return {
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`
    };
  }

  disconnect(): void {
    this.pending.clear();
    this.vault.remove('github-app-user-token');
  }
}
