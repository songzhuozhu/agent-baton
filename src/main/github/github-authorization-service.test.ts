import { describe, expect, it } from 'vitest';
import { CredentialVault } from '../security/credential-vault';
import { LocalStateStore } from '../storage/local-state-store';
import { GitHubAuthorizationService } from './github-authorization-service';

describe('GitHubAuthorizationService', () => {
  it('keeps the device code in memory and persists only a successful user token in the vault', async () => {
    const store = new LocalStateStore(':memory:');
    const vault = new CredentialVault(store, {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'keychain',
      encryptString: (value) => Buffer.from(`encrypted:${value}`),
      decryptString: (value) => value.toString().replace('encrypted:', '')
    });
    const flow = {
      begin: async () => ({
        deviceCode: 'private-device-code', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device',
        expiresAt: '2026-08-09T00:15:00.000Z', pollIntervalSeconds: 5, nextPollAt: '2026-08-09T00:00:05.000Z'
      }),
      poll: async () => ({ status: 'authorized' as const, accessToken: 'token', tokenType: 'bearer' })
    };
    const service = new GitHubAuthorizationService(flow as never, vault);

    const start = await service.start();
    expect(start).toMatchObject({ userCode: 'ABCD-EFGH' });
    await expect(service.poll(start.id)).resolves.toEqual({ status: 'authorized' });
    expect(service.isConnected()).toBe(true);
    expect(store.getLocalSetting('credential:github-app-user-token')).not.toContain('token');
    expect(service.gitEnvironment()).toMatchObject({
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from('x-access-token:token').toString('base64')}`
    });
    store.close();
  });
});
