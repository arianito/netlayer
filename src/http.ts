import { match, MatchResult } from './uri';

export type HttpHeaders = { [key: string]: string };
export type HttpDriver = (request: HttpRequest) => Promise<HttpResponse>;
export type HttpRequestMiddleware = (request: HttpRequest) => HttpRequest;
export type HttpResponseMiddleware = (response: HttpResponse) => HttpResponse;
export type HttpMethod = 'POST' | 'GET' | 'PUT' | 'DELETE';
export type HttpProgressType = 'download' | 'upload' | 'any';
export type HttpResponseHelper = {
	setHeader: (key: string, value: string) => any;
	setStatus: (code: number) => any;
	send: (text: any) => any;
};
export type HttpRequest = {
	baseUrl?: string;
	url: string;
	method?: HttpMethod;
	context?: any;
	timeout?: number;
	withCredentials?: boolean;
	payload?: any;
	headers?: HttpHeaders;
	progress?: (status: HttpProgressType, total: number, loaded: number) => any;
	[key: string]: any;
};

export type HttpResponse<T = any> = {
	status?: number;
	statusText?: string;
	errorCode?: string;
	context?: any;
	payload?: T;
	headers?: HttpHeaders;
	[key: string]: any;
};


export type HttpConfig = {
	baseUrl: string;
	timeout: number;
	method: HttpMethod;
	withCredentials: boolean;
	logger: any;
	[key: string]: any;
};

export interface HttpController {
	path: string;
	method?: HttpMethod;
	handler: (request: HttpRequest, response: HttpMockResponse) => any;
}

let defaultDriver: HttpDriver = null;
const requestMiddlewareChain: {name: string, middleware: HttpRequestMiddleware}[] = [];
const responseMiddlewareChain: {name: string, middleware: HttpResponseMiddleware}[] = [];
const mockedRoutes: HttpController[] = [];

export const configuration: HttpConfig = {
	baseUrl: '',
	timeout: 3600,
	logger: null,
	method: 'POST',
	withCredentials: false,
};

export const config = (driver: HttpDriver) => {
	defaultDriver = driver;
};

export class HttpMockResponse {
	private context: any = null;

	constructor(context: any) {
		this.context = context;
	}

	public set status(value: number) {
		this.context.status = value;
	}

	public write(data: string) {
		this.context.body += data;
	};
	public set body(data: string) {
		this.context.body = data;
	};

	public json(data: any) {
		this.context.headers['Content-Type'] = 'application/json';
		this.context.body = JSON.stringify(data);
	};

	header(key: string, value: string){
		this.context.headers[key] = value;
	};
}

export function mock(path:string, method: HttpMethod = 'POST') {
	return (target: any, key: string) => {
		mockedRoutes.push({
			path,
			method,
			handler: target[key],
		})
	};
}

export function requestMiddleware(name: string, middleware: HttpRequestMiddleware) {
	const index = requestMiddlewareChain.findIndex(a=>a.name == name);
	if(index > -1){
		if(middleware) {
			requestMiddlewareChain[index].middleware = middleware;
		}else {
			requestMiddlewareChain.splice(index, 1);
		}
	}else {
		requestMiddlewareChain.push({
			name,
			middleware,
		});
	}
}
export function responseMiddleware(name: string, middleware: HttpResponseMiddleware) {
	const index = requestMiddlewareChain.findIndex(a=>a.name == name);
	if(index > -1){
		if(middleware) {
			responseMiddlewareChain[index].middleware = middleware;
		}else {
			responseMiddlewareChain.splice(index, 1);
		}
	}else {
		responseMiddlewareChain.push({
			name,
			middleware,
		});
	}
}

export const request = async <R = any>(
	request: HttpRequest,
	driver: HttpDriver = null,
): Promise<HttpResponse<R>> => {
	let requestCache = request;
	for (const m of requestMiddlewareChain) {
		requestCache = m.middleware(requestCache);
	}
	//
	let responseCache = null;
	try {
		responseCache = await (driver || defaultDriver)(requestCache);
	} catch (e) {
		let failureCache = e as HttpResponse;
		for (const m of responseMiddlewareChain) {
			failureCache = m.middleware(failureCache);
		}
		throw failureCache;
	}
	//
	for (const m of responseMiddlewareChain) {
		responseCache = m.middleware(responseCache);
	}
	return responseCache;
};

export const mockDriver = (fallback?: HttpDriver) => {
	return async (request: HttpRequest): Promise<HttpResponse> => {
		const logger = configuration.logger;

		function log(...args: any[]) {
			logger && logger(...args);
		}
		const path = (request.baseUrl || configuration.baseUrl) + request.url;
		const method = request.method || configuration.method;
		const oldPath = request.url;
		const oldMethod = request.method;
		request.url = path;
		request.method = method;

		log('request', request);

		let methodNotFound = false;
		for (const route of mockedRoutes) {
			const matchedPath: MatchResult = match(path, {
				path: configuration.baseHref + route.path,
				exact: true,
				sensitive: true,
				strict: true,
			});
			if (matchedPath) {
				if (route.method === method) {
					const output: HttpResponse = {
						headers: {},
						status: 200,
						body: '',
					};
					let isError = false;
					try {
						request.context = request.context || {};
						request.context.match =matchedPath;
						const res = new HttpMockResponse(output);

						await route.handler(request, res);

						log('response', output);

						if (output.headers['Content-Type'] == 'application/json') {
							try {
								output.payload = JSON.parse(output.payload || '{}');
							} catch (e) {
								throw output;
							}
						}
						if (output.status >= 400) {
							isError = true;
						} else {
							return output;
						}
					} catch (e) {
						log('error', '500 internal server error');
						throw <HttpResponse>{
							status: 500,
							statusText: '500 internal server error',
							payload: e,
						};
					}
					throw output;
				} else {
					methodNotFound = true;
				}
			}
		}
		if (methodNotFound) {
			log('error', '405 method not allowed');
			throw <HttpResponse>{
				status: 405,
				statusText: '405 method not allowed',
			};
		}

		if (fallback) {
			log('fallback', oldPath);
			request.url = oldPath;
			request.method = oldMethod;
			return fallback(request);
		}

		log('error', '404 not found');
		throw <HttpResponse>{
			status: 404,
			statusText: '404 not found',
		};
	};
};
