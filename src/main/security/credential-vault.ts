import { LocalStateStore } from '../storage/local-state-store';

export interface PlatformSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(cipherText: Buffer): string;
  getSelectedStorageBackend?: () => string;
}

export class CredentialVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialVaultError';
  }
}

/**
 * Stores only encrypted credential blobs in SQLite. Linux's Electron
 * `basic_text` fallback is expressly rejected: it is not a secure substitute
 * for Secret Service and AgentBaton must never silently downgrade to cleartext.
 */
export class CredentialVault {
  constructor(
    private readonly stateStore: LocalStateStore,
    private readonly safeStorage: PlatformSafeStorage
  ) {}

  save(key: string, secret: string): void {
    this.assertSecureStorage();
    if (!key.trim() || !secret) throw new CredentialVaultError('凭据名称和内容不能为空。');
    const encrypted = this.safeStorage.encryptString(secret);
    this.stateStore.saveLocalSetting(this.settingKey(key), encrypted.toString('base64'));
  }

  load(key: string): string | undefined {
    this.assertSecureStorage();
    const value = this.stateStore.getLocalSetting(this.settingKey(key));
    return value ? this.safeStorage.decryptString(Buffer.from(value, 'base64')) : undefined;
  }

  remove(key: string): void {
    this.stateStore.deleteLocalSetting(this.settingKey(key));
  }

  isAvailable(): boolean {
    try {
      this.assertSecureStorage();
      return true;
    } catch {
      return false;
    }
  }

  private assertSecureStorage(): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new CredentialVaultError('当前系统没有可用的安全凭据存储，不能连接 GitHub。');
    }
    if (this.safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      throw new CredentialVaultError('Linux Secret Service 不可用，拒绝以 basic_text 保存 GitHub 凭据。');
    }
  }

  private settingKey(key: string): string {
    return `credential:${key}`;
  }
}
