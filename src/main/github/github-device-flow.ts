const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export interface DeviceFlowHttpClient {
  postForm(url: string, fields: Record<string, string>): Promise<Record<string, unknown>>;
}

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: string;
  pollIntervalSeconds: number;
  /** The caller must not poll before this time. */
  nextPollAt: string;
}

export type DeviceAuthorizationPoll =
  | { status: 'pending'; nextPollAt: string }
  | { status: 'slow-down'; nextPollAt: string }
  | { status: 'denied' | 'expired' }
  | { status: 'authorized'; accessToken: string; tokenType: string; scope?: string };

export class GitHubDeviceFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubDeviceFlowError';
  }
}

/**
 * Implements GitHub App user authorization via OAuth Device Flow. The public
 * client ID is supplied at packaging time; no client secret or PAT is ever
 * accepted by this module.
 */
export class GitHubDeviceFlow {
  constructor(
    private readonly clientId: string | undefined,
    private readonly http: DeviceFlowHttpClient = new FetchDeviceFlowHttpClient()
  ) {}

  async begin(now = new Date()): Promise<DeviceAuthorization> {
    if (!this.clientId) {
      throw new GitHubDeviceFlowError('此构建未配置 GitHub App Client ID，不能发起 Device Flow。');
    }
    const response = await this.http.postForm(GITHUB_DEVICE_CODE_URL, { client_id: this.clientId });
    const deviceCode = requiredString(response, 'device_code');
    const userCode = requiredString(response, 'user_code');
    const verificationUri = requiredString(response, 'verification_uri');
    const expiresIn = requiredNumber(response, 'expires_in');
    const intervalSeconds = optionalNumber(response, 'interval') ?? 5;
    return {
      deviceCode,
      userCode,
      verificationUri,
      ...(typeof response.verification_uri_complete === 'string' ? { verificationUriComplete: response.verification_uri_complete } : {}),
      expiresAt: new Date(now.getTime() + expiresIn * 1_000).toISOString(),
      pollIntervalSeconds: intervalSeconds,
      nextPollAt: new Date(now.getTime() + intervalSeconds * 1_000).toISOString()
    };
  }

  async poll(authorization: DeviceAuthorization, now = new Date()): Promise<DeviceAuthorizationPoll> {
    if (!this.clientId) throw new GitHubDeviceFlowError('此构建未配置 GitHub App Client ID。');
    if (new Date(authorization.expiresAt).getTime() <= now.getTime()) return { status: 'expired' };
    if (new Date(authorization.nextPollAt).getTime() > now.getTime()) {
      throw new GitHubDeviceFlowError('尚未到 GitHub 允许的下一次轮询时间。');
    }
    const response = await this.http.postForm(GITHUB_TOKEN_URL, {
      client_id: this.clientId,
      device_code: authorization.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    });
    if (typeof response.access_token === 'string') {
      return {
        status: 'authorized',
        accessToken: response.access_token,
        tokenType: typeof response.token_type === 'string' ? response.token_type : 'bearer',
        ...(typeof response.scope === 'string' ? { scope: response.scope } : {})
      };
    }
    const error = requiredString(response, 'error');
    if (error === 'authorization_pending') return { status: 'pending', nextPollAt: plusSeconds(now, authorization.pollIntervalSeconds) };
    if (error === 'slow_down') return { status: 'slow-down', nextPollAt: plusSeconds(now, authorization.pollIntervalSeconds + 5) };
    if (error === 'access_denied') return { status: 'denied' };
    if (error === 'expired_token') return { status: 'expired' };
    throw new GitHubDeviceFlowError(`GitHub Device Flow 失败：${error}`);
  }
}

export class FetchDeviceFlowHttpClient implements DeviceFlowHttpClient {
  async postForm(url: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields)
    });
    const body = await response.json().catch(() => undefined);
    if (!response.ok || !isRecord(body)) {
      throw new GitHubDeviceFlowError(`GitHub Device Flow 请求失败（HTTP ${response.status}）。`);
    }
    return body;
  }
}

function plusSeconds(start: Date, seconds: number): string {
  return new Date(start.getTime() + seconds * 1_000).toISOString();
}

function requiredString(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== 'string' || !value[key]) throw new GitHubDeviceFlowError(`GitHub 响应缺少 ${key}。`);
  return value[key];
}

function requiredNumber(value: Record<string, unknown>, key: string): number {
  if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) throw new GitHubDeviceFlowError(`GitHub 响应缺少 ${key}。`);
  return value[key];
}

function optionalNumber(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
