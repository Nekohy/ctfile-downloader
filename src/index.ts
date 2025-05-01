import { TOKENS } from "./token";

const CORS_HEADERS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': '*',
};

class CTFileAPI {
	private headers: HeadersInit;

	constructor() {
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

	async list(xtlink: string|null, token?: string|null) {
		return this.post('/p2/browser/file/list', { xtlink, token, reload: false });
	}

	async download(xtlink: string|null, file_id: string|null, token?: string|null) {
		return this.post('/p2/browser/file/fetch_url', { xtlink, file_id, token });
	}
}

function processXtlink(xtlink: string) {
	return xtlink.startsWith("ctfile://") ? xtlink : "ctfile://" + xtlink
}

async function main(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'GET') {
		return new Response('Method Not Allowed', { status: 405 });
	}
	
	const api = new CTFileAPI();

	try {
		const url = new URL(request.url);
		const params = url.searchParams
		const path = url.pathname

		if (path === '/meow') {
		  return new Response('Meow!', { status: 200 })
		}

		if (env.PASSWORD && env.PASSWORD !== params.get('token')) {
			return new Response('Wrong Password', { status: 403 });
		}
		let token;
		if (paramsToken) {
		  // 优先使用 URL 参数里的 token
		  token = paramsToken;
		} else if (Array.isArray(TOKEN) && TOKEN.length > 0) {
		  const idx = Math.floor(Math.random() * TOKEN.length);
		  token = TOKEN[idx];
		} else {
		  return new Response('No Token Found', { status: 400 });
		}

		switch (path) {
			case '/origin/list': {
			  var xtlink = params.get('xtlink')
			  if (!xtlink) {
				return new Response('Missing "xtlink" parameter', { status: 400 })
			  }
			  xtlink = processXtlink(xtlink)
			  const listResult = await api.list(xtlink, token)
			  return new Response(JSON.stringify(listResult), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			  })
			}
		
			case '/download': {
				var xtlink  = params.get('xtlink');
				const file_id = params.get('file_id');
				if (!xtlink || !file_id) {
				  return new Response('Missing required parameters', { status: 400 });
				}
				xtlink = processXtlink(xtlink)
				// 调用后端 API 拿到真正的下载地址
				const downloadResult = await api.download(xtlink, file_id, token);
				const upstreamUrl = downloadResult.download_url;
				if (!upstreamUrl) {
				  return new Response('No download_url returned', { status: 502 });
				}
			  
				// 直接 302 重定向到上游 URL
				return Response.redirect(upstreamUrl, 302);
			}
		
			case '/download_info': {
			  var xtlink   = params.get('xtlink')
			  const download = params.get('download') === 'true'
			  const file_id = params.getAll('file_id')  // ?file_id=1&file_id=2
		
			  if (!xtlink) {
				return new Response('Missing "xtlink" parameter', { status: 400 })
			  }
			  xtlink = processXtlink(xtlink)
		
			  let filesToDownload
			  if (file_id.length > 0) {
				filesToDownload = file_id.map(key => ({ key }))
			  } else {
				const listResult = await api.list(xtlink, token)
				filesToDownload = listResult.results.map((f: { key: string|undefined; name: string|undefined; }) => ({ key: f.key, name: f.name }))
			  }
		
			  const results = await Promise.all(
				filesToDownload.map(async (file: { key: string | null; }) => {
				  if (!download) {
					return file
				  } else {
					const dl = await api.download(xtlink, file.key, token)
					return { ...file, downloadUrl: dl.download_url }
				  }
				})
			  )
		
			  return new Response(JSON.stringify(results), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			  })
			}

		
			default:
			  return new Response('Not Found', { status: 404 })
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
