import { HttpClient, HttpRequest, HttpResponse } from '../../src/caldav/httpClient';

/**
 * HttpClient backed by Node.js native fetch.
 * Used in E2E tests against a real CalDAV server (Radicale).
 */
export class FetchHttpClient implements HttpClient {
  async request(params: HttpRequest): Promise<HttpResponse> {
    const resp = await fetch(params.url, {
      method: params.method,
      headers: params.headers,
      body: params.body,
    });

    const text = await resp.text();
    const headers: Record<string, string> = {};
    resp.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return { status: resp.status, text, headers };
  }
}
