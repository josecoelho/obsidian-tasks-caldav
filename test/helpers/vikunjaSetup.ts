import { FetchHttpClient, } from './fetchHttpClient';
import { HttpResponse } from '../../src/caldav/httpClient';
import * as crypto from 'crypto';

export const VIKUNJA = {
  baseUrl: 'http://localhost:3457',
  davUrl: 'http://localhost:3457/dav',
  username: 'testuser',
  email: 'testuser@test.local',
  password: 'TestPass123!',
} as const;

const http = new FetchHttpClient();

let bootstrapped = false;
let cachedToken: string | null = null;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a request with exponential backoff on 429 responses.
 */
async function withRetry(
  fn: () => Promise<HttpResponse>,
  maxRetries = 5,
  baseDelayMs = 2000,
): Promise<HttpResponse> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fn();
    if (resp.status !== 429) return resp;
    if (attempt < maxRetries) {
      const delay = baseDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
  return fn();
}

/**
 * Register a test user and ensure they exist.
 * Idempotent — skips if already bootstrapped this process.
 */
export async function bootstrapVikunjaUser(): Promise<void> {
  if (bootstrapped) return;

  const registerResp = await withRetry(() =>
    http.request({
      url: `${VIKUNJA.baseUrl}/api/v1/register`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: VIKUNJA.username,
        email: VIKUNJA.email,
        password: VIKUNJA.password,
      }),
    }),
  );

  if (registerResp.status === 200 || registerResp.status === 201) {
    const data = JSON.parse(registerResp.text) as Record<string, unknown>;
    if (typeof data.token === 'string') {
      cachedToken = data.token;
    }
  } else {
    const loginResp = await withRetry(() =>
      http.request({
        url: `${VIKUNJA.baseUrl}/api/v1/login`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: VIKUNJA.username,
          password: VIKUNJA.password,
        }),
      }),
    );
    if (loginResp.status !== 200) {
      throw new Error(
        `Vikunja bootstrap failed: register=${registerResp.status} login=${loginResp.status} ${loginResp.text}`,
      );
    }
    const data = JSON.parse(loginResp.text) as { token: string };
    cachedToken = data.token;
  }

  bootstrapped = true;
}

/**
 * Get a JWT token for API calls. Caches the token to avoid rate limiting.
 */
async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  const resp = await withRetry(() =>
    http.request({
      url: `${VIKUNJA.baseUrl}/api/v1/login`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: VIKUNJA.username,
        password: VIKUNJA.password,
      }),
    }),
  );
  if (resp.status !== 200) {
    throw new Error(`Vikunja login failed: ${resp.status} ${resp.text}`);
  }
  const data = JSON.parse(resp.text) as { token: string };
  cachedToken = data.token;
  return cachedToken;
}

/**
 * Create an isolated Vikunja project (= CalDAV calendar) with a random name.
 * Returns the project title (used as calendarName for CalDAV discovery)
 * and cleanup functions.
 */
export async function createIsolatedCalendar(): Promise<{
  calendarName: string;
  projectId: number;
  clean: () => Promise<void>;
  cleanup: () => Promise<void>;
}> {
  await bootstrapVikunjaUser();
  const token = await getToken();

  const calendarName = `e2e-${crypto.randomBytes(6).toString('hex')}`;

  const createResp = await http.request({
    url: `${VIKUNJA.baseUrl}/api/v1/projects`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ title: calendarName }),
  });

  if (createResp.status !== 200 && createResp.status !== 201) {
    throw new Error(`Vikunja create project failed: ${createResp.status} ${createResp.text}`);
  }

  const project = JSON.parse(createResp.text) as { id: number };
  const projectId = project.id;

  return {
    calendarName,
    projectId,
    /** Delete all tasks in the project (use in beforeEach). */
    clean: async () => {
      const freshToken = await getToken();
      const tasksResp = await http.request({
        url: `${VIKUNJA.baseUrl}/api/v1/projects/${projectId}/tasks`,
        method: 'GET',
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      if (tasksResp.status === 200) {
        const tasks = JSON.parse(tasksResp.text) as Array<{ id: number }>;
        for (const task of tasks) {
          await http.request({
            url: `${VIKUNJA.baseUrl}/api/v1/tasks/${task.id}`,
            method: 'DELETE',
            headers: { Authorization: `Bearer ${freshToken}` },
          });
        }
      }
    },
    /** Delete the project permanently (use in afterAll). */
    cleanup: async () => {
      const freshToken = await getToken();
      await http.request({
        url: `${VIKUNJA.baseUrl}/api/v1/projects/${projectId}`,
        method: 'DELETE',
        headers: { Authorization: `Bearer ${freshToken}` },
      });
    },
  };
}
