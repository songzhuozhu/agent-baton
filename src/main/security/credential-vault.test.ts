import { describe, expect, it } from 'vitest';
import { LocalStateStore } from '../storage/local-state-store';
import { CredentialVault, CredentialVaultError, type PlatformSafeStorage } from './credential-vault';

function fakeSafeStorage(overrides: Partial<PlatformSafeStorage> = {}): PlatformSafeStorage {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString('utf8').replace('encrypted:', ''),
    getSelectedStorageBackend: () => 'keychain',
    ...overrides
  };
}

describe('CredentialVault', () => {
  it('stores only an encrypted blob in local state and decrypts only on demand', () => {
    const store = new LocalStateStore(':memory:');
    const vault = new CredentialVault(store, fakeSafeStorage());

    vault.save('github:default', 'github-token');

    expect(store.getLocalSetting('credential:github:default')).not.toContain('github-token');
    expect(vault.load('github:default')).toBe('github-token');
    store.close();
  });

  it('refuses Linux basic_text fallback and unavailable encryption', () => {
    const store = new LocalStateStore(':memory:');
    const basicText = new CredentialVault(store, fakeSafeStorage({ getSelectedStorageBackend: () => 'basic_text' }));
    const unavailable = new CredentialVault(store, fakeSafeStorage({ isEncryptionAvailable: () => false }));

    expect(() => basicText.save('github', 'token')).toThrow(CredentialVaultError);
    expect(() => unavailable.save('github', 'token')).toThrow(CredentialVaultError);
    store.close();
  });
});
