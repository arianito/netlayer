import {match} from './match';

export type HttpHeaders = { [key: string]: string };
export type HttpDriver = (request: HttpRequest) => Promise<HttpResponse>;
export type HttpRequestMiddleware = (request: HttpRequest) => HttpRequest;
export type HttpResponseMiddleware = (response: HttpResponse) => HttpResponse;
export type HttpMethod = 'POST' | 'GET' | 'PUT' | 'DELETE';
export type HttpRequest = {
	baseUrl?: string;
	url: string;
	method?: HttpMethod;
	context?: any;
	timeout?: number;
	payload?: any;
	headers?: HttpHeaders;
	[key: string]: any;
};
export type HttpResponse<T = any> = {
	status?: number;
	statusText?: string;
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
export type HttpHandler = (request: HttpRequest, response: HttpMockResponse) => any

export interface HttpController {
	path: string;
	method?: HttpMethod;
	handler: (request: HttpRequest, response: HttpMockResponse) => any;
}

export class HttpMockResponse {
	private context: any = null;

	constructor(context: any) {
		this.context = context;
	}

	public set status(value: number) {
		this.context.status = value;
	}

	public set body(data: string) {
		this.context.body = data;
	};

	public write(data: string) {
		this.context.body += data;
	};

	public json(data: any, status: number = 200) {
		this.context.status = status;
		this.context.headers['Content-Type'] = 'application/json';
		this.context.body = JSON.stringify(data);
	};

	header(key: string, value: string) {
		this.context.headers[key] = value;
	};
}

export class NetworkingLayer {
	private requestMiddlewareChain: { name: string, middleware: HttpRequestMiddleware }[] = [];
	private responseMiddlewareChain: { name: string, middleware: HttpResponseMiddleware }[] = [];
	private mockedRoutes: HttpController[] = [];
	baseUrl = '';
	timeout = 10000;
	internetDelay = 30;
	driver: HttpDriver = null;
	mockGET = (path: string, handler: HttpHandler) => {
		this.mockedRoutes.push({
			path,
			handler,
			method: 'GET',
		})
	};
	mockPOST = (path: string, handler: HttpHandler) => {
		this.mockedRoutes.push({
			path,
			handler,
			method: 'POST',
		})
	};
	mockPUT = (path: string, handler: HttpHandler) => {
		this.mockedRoutes.push({
			path,
			handler,
			method: 'PUT',
		})
	};
	mockDELETE = (path: string, handler: HttpHandler) => {
		this.mockedRoutes.push({
			path,
			handler,
			method: 'DELETE',
		})
	};
	mockDRIVER = (fallback?: HttpDriver) => {
		return async (request: HttpRequest): Promise<HttpResponse> => {
			const path = (request.baseUrl || this.baseUrl) + request.url;
			const method = request.method;
			const oldPath = request.url;
			const oldMethod = request.method;
			request.url = path;
			request.method = method;
			let methodNotFound = false;
			for (const route of this.mockedRoutes) {
				const matchedPath = match(path, {
					path: this.baseUrl + route.path,
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
						request.context = request.context || {};
						request.context.params = matchedPath.params;
						const res = new HttpMockResponse(output);
						try {
							if (this.internetDelay) {
								await new Promise(a => setTimeout(a, (250 + Math.random() * 1000) * this.internetDelay / 100))
							}
							await route.handler(request, res);
						} catch (e) {
							// eslint-disable-next-line no-throw-literal
							throw {
								status: 500,
								payload: e.toString(),
								statusText: 'internal server error',
							}
						}
						Object.keys(output.headers).forEach(key => output.headers[key] = output.headers[key].toLowerCase());
						if (output.headers['content-type'] === 'application/json') {
							try {
								output.payload = JSON.parse(output.body || '{}');
							} catch (e) {
								// eslint-disable-next-line no-throw-literal
								throw {
									status: 500,
									payload: output.body,
									statusText: 'invalid body',
								}
							}
						} else {
							output.payload = output.body;
						}
						const obj = {
							status: output.status,
							payload: output.payload,
						};
						if (obj.status >= 400) {
							throw obj;
						}
						return obj;
					} else {
						methodNotFound = true;
					}
				}
			}
			if (methodNotFound) {
				// eslint-disable-next-line no-throw-literal
				throw {
					status: 405,
					statusText: '405 method not allowed',
				};
			}
			if (fallback) {
				request.url = oldPath;
				request.method = oldMethod;
				return fallback(request);
			}
			// eslint-disable-next-line no-throw-literal
			throw {
				status: 404,
				statusText: '404 not found',
			};
		};
	};
	MIDDLEWARE = (name: string, middleware: HttpRequestMiddleware) => {
		const index = this.requestMiddlewareChain.findIndex(a => a.name === name);
		if (index > -1) {
			if (middleware) {
				this.requestMiddlewareChain[index].middleware = middleware;
			} else {
				this.requestMiddlewareChain.splice(index, 1);
			}
		} else {
			this.requestMiddlewareChain.push({
				name,
				middleware,
			});
		}
	};
	INTERCEPTOR = (name: string, middleware: HttpResponseMiddleware) => {
		const index = this.responseMiddlewareChain.findIndex(a => a.name === name);
		if (index > -1) {
			if (middleware) {
				this.responseMiddlewareChain[index].middleware = middleware;
			} else {
				this.responseMiddlewareChain.splice(index, 1);
			}
		} else {
			this.responseMiddlewareChain.push({
				name,
				middleware,
			});
		}
	};
	GET = <T>(path: string, payload?: any) => {
		return this.REQUEST<T>({
			url: path,
			payload: payload || {},
			method: 'GET'
		});
	};
	POST = <T>(path: string, payload?: any) => {
		return this.REQUEST<T>({
			url: path,
			payload: payload || {},
			method: 'POST',
		});
	};
	PUT = <T>(path: string, payload?: any) => {
		return this.REQUEST<T>({
			url: path,
			payload: payload || {},
			method: 'PUT'
		});
	};
	DELETE = <T>(path: string, payload?: any) => {
		return this.REQUEST<T>({
			url: path,
			payload: payload || {},
			method: 'DELETE'
		});
	};
	REQUEST = async <R = any>(
		request: HttpRequest
	): Promise<HttpResponse<R>> => {
		if (!this.driver) {
			throw new Error('NO DRIVER ASSIGNED');
		}
		let requestCache = request;
		for (const m of this.requestMiddlewareChain) {
			requestCache = m.middleware(requestCache);
		}
		//
		let responseCache = null;
		try {
			if (!requestCache.headers) {
				requestCache.headers = {};
			} else {
				Object.keys(requestCache.headers).forEach(key => requestCache.headers[key] = requestCache.headers[key].toLowerCase());
			}
			responseCache = await this.driver(requestCache);
		} catch (e) {
			let failureCache = e as HttpResponse;
			for (const m of this.responseMiddlewareChain) {
				failureCache = m.middleware(failureCache);
			}
			throw failureCache;
		}
		//
		for (const m of this.responseMiddlewareChain) {
			responseCache = m.middleware(responseCache);
		}
		return responseCache;
	};
}