interface Env {
	TOKENS: string;
}

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

async function main(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'GET') {
		return new Response('Method Not Allowed', { status: 405 });
	}
	
	const api = new CTFileAPI();

	try {
		const url = new URL(request.url);
		const params = url.searchParams
		// 获取 URL 参数中的 token
		const paramToken = params.get('token');

		// 将环境变量中的 TOKENS 拆分为数组（如果存在）
		const tokensList = env.TOKENS
			? env.TOKENS.split(',').map(t => t.trim()).filter(Boolean)
			: [];

		// 优先使用 URL 参数传来的 token，否则随机从 TOKENS 中选一个
		const token: string | null = paramToken
		?? (tokensList.length > 0
			? tokensList[Math.floor(Math.random() * tokensList.length)]
			: null);

		// 如果最终还是没有 token，就返回 400
		if (!token) {
			return new Response('No Token Found', { status: 400 });
		}
		switch (url.pathname) {
			case '/meow':
			  return new Response('Meow', { status: 200 })
		
			case '/origin/list': {
			  const xtlink = params.get('xtlink')
			  const token  = params.get('token')
			  if (!xtlink) {
				return new Response('Missing "xtlink" parameter', { status: 400 })
			  }
			  const listResult = await api.list(xtlink, token)
			  return new Response(JSON.stringify(listResult), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			  })
			}
		
			case '/download': {
			  const xtlink  = params.get('xtlink')
			  const file_id = params.get('file_id')
			  if (!xtlink || !file_id) {
				return new Response('Missing required parameters', { status: 400 })
			  }
			  const downloadResult = await api.download(xtlink, file_id, token)
			  const upstreamUrl = downloadResult.download_url
			  if (!upstreamUrl) {
				return new Response('No download_url returned', { status: 502 })
			  }
			
			  // 第二步：从客户端请求里拷贝断点续传相关头
			  const clientRange    = request.headers.get('range')
			  const clientIfRange  = request.headers.get('if-range')
			  console.log(clientRange, clientIfRange)
			
			  // 第三步：向上游发起 fetch，带上 UA + 透传头
			  const upstreamResp = await fetch(upstreamUrl, {
				headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
								'(KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36',
				'Connection': 'keep-alive',
				  ...(clientRange   ? { 'Range': clientRange }   : {}),
				  ...(clientIfRange ? { 'If-Range': clientIfRange } : {}),
				},
			  })
			
			  // 第四步：把上游的状态码和支持分片下载的头原样返回给客户端
			  const responseHeaders = new Headers(upstreamResp.headers)
			  // 只保留对客户端有用的那几项，避免不必要的 hop-by-hop 或安全头
			  const allowed = ['Content-Type','Content-Length','Content-Range','Accept-Ranges','ETag','Last-Modified']
			  const filtered = new Headers()
			  for (let name of allowed) {
				if (responseHeaders.has(name)) {
				  filtered.set(name, responseHeaders.get(name))
				}
			  }
			  return new Response(upstreamResp.body, {
				status: upstreamResp.status,
				headers: filtered
			  })
			}
		
			case '/download_info': {
			  var xtlink   = params.get('xtlink')
			  const token    = params.get('token')
			  const download = params.get('download') === 'true'
			  const file_id = params.getAll('file_id')  // ?file_id=1&file_id=2
		
			  if (!xtlink) {
				return new Response('Missing "xtlink" parameter', { status: 400 })
			  }
			  if (!xtlink.startsWith("ctfile://")) {
				xtlink = "ctfile://" + xtlink
			  }
		
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
