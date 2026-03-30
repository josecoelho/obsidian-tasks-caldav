import { FetchHttpClient } from './fetchHttpClient';
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

/**
 * Register a test user and ensure they exist.
 * Idempotent — skips if already bootstrapped this process.
 */
export async function bootstrapVikunjaUser(): Promise<void> {
  if (bootstrapped) return;

  // Try to register — 200 means created, 400 may mean already exists
  const registerResp = await http.request({
    url: `${VIKUNJA.baseUrl}/api/v1/register`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: VIKUNJA.username,
      email: VIKUNJA.email,
      password: VIKUNJA.password,
    }),
  });

  if (registerResp.status !== 200 && registerResp.status !== 201) {
    // User may already exist — verify by logging in
    const loginResp = await http.request({
      url: `${VIKUNJA.baseUrl}/api/v1/login`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: VIKUNJA.username,
        password: VIKUNJA.password,
      }),
    });
    if (loginResp.status !== 200) {
      throw new Error(
        `Vikunja bootstrap failed: register=${registerResp.status} login=${loginResp.status} ${loginResp.text}`,
      );
    }
  }

  bootstrapped = true;
}

/**
 * Get a JWT token for API calls.
 */
async function getToken(): Promise<string> {
  const resp = await http.request({
    url: `${VIKUNJA.baseUrl}/api/v1/login`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: VIKUNJA.username,
      password: VIKUNJA.password,
    }),
  });
  if (resp.status !== 200) {
    throw new Error(`Vikunja login failed: ${resp.status} ${resp.text}`);
  }
  const data = JSON.parse(resp.text) as { token: string };
  return data.token;
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
