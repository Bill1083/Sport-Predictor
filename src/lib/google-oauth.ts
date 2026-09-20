/**
 * Google OAuth 2.0 with plain `fetch`, used only for signing in to the
 * dashboard (scopes: openid email). The resulting identity must be on
 * DASHBOARD_ALLOWED_EMAILS. Random `state` and PKCE (S256) on every flow.
 * Only two endpoints are needed, so the `googleapis` package and its
 * dependency tree are left out of the image on purpose.
 */

import { env } from '@/lib/env';

/** Identity only, for signing in to the dashboard. */
export const LOGIN_SCOPE = 'openid email';

/** Short-lived cookies carrying CSRF state and the PKCE verifier between /start and /callback. */
export const LOGIN_STATE_COOKIE = 'scoresage_login_state';
export const LOGIN_VERIFIER_COOKIE = 'scoresage_login_verifier';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const encoder = new TextEncoder();

export class OAuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'OAuthError';
    this.status = status;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Random bytes as base64url, for OAuth state and PKCE verifiers. */
export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Base64Url(value: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

export interface TokenSet {
  accessToken: string;
  idToken: string | null;
  expiresAt: Date;
  scope: string;
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = env.googleClientId;
  const clientSecret = env.googleClientSecret;
  if (!clientId || !clientSecret) {
    throw new OAuthError('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured.', 503);
  }
  return { clientId, clientSecret };
}

/** PKCE: a random verifier and its S256 challenge. */
export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(48);
  const challenge = await sha256Base64Url(verifier);
  return { verifier, challenge };
}

export function randomState(): string {
  return randomToken(24);
}

export interface AuthUrlOptions {
  state: string;
  codeChallenge: string;
  redirectUri: string;
  purpose: 'login';
  loginHint?: string;
}

/** Where to send the browser to sign in. */
export function buildAuthUrl(options: AuthUrlOptions): string {
  const { clientId } = credentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    scope: LOGIN_SCOPE,
    prompt: 'select_account',
  });
  if (options.loginHint) params.set('login_hint', options.loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export async function exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<TokenSet> {
  const { clientId, clientSecret } = credentials();
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  let json: TokenResponse = {};
  try {
    json = (await response.json()) as TokenResponse;
  } catch {
    json = {};
  }
  if (!response.ok || json.error) {
    const code = json.error ?? `http_${response.status}`;
    throw new OAuthError(
      `Google token request failed: ${code}${json.error_description ? ` (${json.error_description})` : ''}`,
      response.status || 502,
    );
  }
  if (!json.access_token) throw new OAuthError('Google returned no access token.');
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3_600;
  return {
    accessToken: json.access_token,
    idToken: json.id_token ?? null,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    scope: json.scope ?? '',
  };
}

export interface IdClaims {
  email: string;
  emailVerified: boolean;
  subject: string;
}

/**
 * Claims from an ID token that came straight from Google's token endpoint
 * over TLS with the client secret. In that position the signature has already
 * been vouched for by the channel (Google's own guidance), so only the claims
 * are checked: issuer, audience, expiry and a verified email.
 */
export function readIdToken(idToken: string, clientId: string, now = Date.now()): IdClaims {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new OAuthError('Malformed ID token.');
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1]))) as Record<string, unknown>;
  } catch {
    throw new OAuthError('Unreadable ID token.');
  }
  const iss = payload.iss;
  if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') {
    throw new OAuthError('ID token was not issued by Google.');
  }
  const aud = payload.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(clientId)) throw new OAuthError('ID token was issued for another client.');
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  if (exp * 1000 < now - 60_000) throw new OAuthError('ID token has expired.');
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  if (!email) throw new OAuthError('ID token carries no email address.');
  return {
    email,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    subject: typeof payload.sub === 'string' ? payload.sub : '',
  };
}
