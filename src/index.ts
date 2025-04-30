interface Env {
	TOKENS: string;
}

const CORS_HEADERS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

class CTFileAPI {
	private headers: HeadersInit;

	constructor(private token: string) {
		this.headers = {
			'User-Agent': 'okhttp/4.9.2',
			'Content-Type': 'application/json',
		};
	}

	private async post<T>(endpoint: string, payload: any): Promise<T> {
		const response = await fetch(`https://rest.ctfile.com${endpoint}`, {
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			throw new Error(`Upstream error: ${response.status}`);
		}

		return response.json();
	}

	async list(xtlink: string, tokenOverride?: string) {
		const token = tokenOverride || this.token;
		return this.post('/p2/browser/file/list', { xtlink, token, reload: false });
	}

	async download(xtlink: string, file_id: string, tokenOverride?: string) {
		const token = tokenOverride || this.token;
		return this.post('/p2/browser/file/fetch_url', { xtlink, file_id, token });
	}
}

async function main(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'POST') {
		return new Response('Method Not Allowed', { status: 405 });
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return new Response('Invalid JSON body', { status: 400, headers: { 'Content-Type': 'text/plain' } });
	}

	// 随机选取一个 token
	const tokens = env.TOKENS
		? env.TOKENS.split(',').map(t => t.trim()).filter(Boolean)
		: [];
	const selectedToken = tokens[Math.floor(Math.random() * tokens.length)];
	const api = new CTFileAPI(selectedToken);

	try {
		const url = new URL(request.url);
		switch (url.pathname) {
			case '/meow':
				return new Response('Meow', { status: 200 });

			case '/origin//list':
				if (!body.xtlink) {
					return new Response('Missing "xtlink" parameter', { status: 400 });
				}
				const listResult = await api.list(body.xtlink, body.token);
				return new Response(JSON.stringify(listResult), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});

			case '/origin/download':
				if (!body.xtlink || !body.file_id) {
					return new Response('Missing required parameters', { status: 400 });
				}
				const downloadResult = await api.download(body.xtlink, body.file_id, body.token);
				return new Response(JSON.stringify(downloadResult), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});

			case '/download': {
				if (!body.xtlink) {
					return new Response('Missing "xtlink" parameter', { status: 400 });
				}

				const listResult = await api.list(body.xtlink, body.token);
				let filesToDownload: Array<{ key: string; name: string }>;
				if (Array.isArray(body.file_ids) && body.file_ids.length > 0) {
					filesToDownload = body.file_ids
						.map((id: string) => {
							const file = listResult.results.find(f => f.key === id);
							return file ? { key: file.key, name: file.name } : null;
						})
						.filter((f): f is { key: string; name: string } => f !== null);
				} else {
					filesToDownload = listResult.results.map(f => ({ key: f.key, name: f.name }));
				}

				const results = await Promise.all(
					filesToDownload.map(async file => {
						if (body.onlyview || body.OnlyView) {
							return { key: file.key, name: file.name };
						}
						const dl = await api.download(body.xtlink, file.key, body.token);
						return { key: file.key, name: file.name, downloadUrl: dl.download_url };
					})
				);

				return new Response(JSON.stringify(results), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			default:
				return new Response('Not Found', { status: 404 });
		}
	} catch (error: any) {
		return new Response(`Internal Server Error: ${error.message}`, { status: 500 });
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		const response = await main(request, env);

		const headers = new Headers(response.headers);
		for (const [key, value] of Object.entries(CORS_HEADERS)) {
			headers.set(key, value);
		}

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	},
} as ExportedHandler<Env>;
