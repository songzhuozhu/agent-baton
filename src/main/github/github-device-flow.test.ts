import { describe, expect, it } from 'vitest';
import { GitHubDeviceFlow, GitHubDeviceFlowError, type DeviceFlowHttpClient } from './github-device-flow';

class FakeHttp implements DeviceFlowHttpClient {
  constructor(private readonly responses: Record<string, unknown>[]) {}

  async postForm(): Promise<Record<string, unknown>> {
    const response = this.responses.shift();
    if (!response) throw new Error('Unexpected HTTP request');
    return response;
  }
}

describe('GitHubDeviceFlow', () => {
  it('uses the Device Flow polling interval and returns a user token without a client secret', async () => {
    const http = new FakeHttp([
      { device_code: 'device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 7 },
      { error: 'authorization_pending' },
      { access_token: 'token', token_type: 'bearer', scope: 'repo' }
    ]);
    const flow = new GitHubDeviceFlow('public-client-id', http);
    const start = new Date('2026-08-09T00:00:00.000Z');

    const authorization = await flow.begin(start);
    expect(authorization).toMatchObject({ userCode: 'ABCD-EFGH', pollIntervalSeconds: 7, nextPollAt: '2026-08-09T00:00:07.000Z' });
    await expect(flow.poll(authorization, start)).rejects.toThrow('下一次轮询时间');
    const pending = await flow.poll(authorization, new Date('2026-08-09T00:00:07.000Z'));
    expect(pending).toEqual({ status: 'pending', nextPollAt: '2026-08-09T00:00:14.000Z' });
    if (pending.status !== 'pending') throw new Error('Expected pending authorization');
    const authorized = await flow.poll({ ...authorization, nextPollAt: pending.nextPollAt }, new Date('2026-08-09T00:00:14.000Z'));
    expect(authorized).toEqual({ status: 'authorized', accessToken: 'token', tokenType: 'bearer', scope: 'repo' });
  });

  it('will not start without the packaged GitHub App client ID', async () => {
    await expect(new GitHubDeviceFlow(undefined, new FakeHttp([])).begin()).rejects.toBeInstanceOf(GitHubDeviceFlowError);
  });
});
