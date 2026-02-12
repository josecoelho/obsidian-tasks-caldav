import { requestUrl } from 'obsidian';

export interface HttpResponse {
  status: number;
  text: string;
  headers: Record<string, string>;
}

export interface HttpRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  throw?: boolean;
}

export interface HttpClient {
  request(params: HttpRequest): Promise<HttpResponse>;
}

/**
 * Default HttpClient that delegates to Obsidian's requestUrl.
 * Used in production; tests and E2E can substitute a different implementation.
 */
export class ObsidianHttpClient implements HttpClient {
  async request(params: HttpRequest): Promise<HttpResponse> {
    const response = await requestUrl({
      url: params.url,
      method: params.method,
      headers: params.headers,
      body: params.body,
      throw: params.throw,
    });
    return {
      status: response.status,
      text: response.text,
      headers: response.headers,
    };
  }
}
