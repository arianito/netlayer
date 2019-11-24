import {match, MatchResult} from './uri';
export type HttpHeaders = { [key: string]: string };
export type HttpDriver = (request: HttpRequest) => Promise<HttpResponse>;
export type HttpRequestMiddleware = (request: HttpRequest) => HttpRequest;
export type HttpResponseMiddleware = (response: HttpResponse) => HttpResponse;
export type HttpMethod = 'POST' | 'GET' | 'PUT' | 'DELETE';
export type HttpProgressType = 'download' | 'upload' | 'any';
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
	public json(data: any) {
		this.context.headers['Content-Type'] = 'application/json';
		this.context.body = JSON.stringify(data);
	};
	header(key: string, value: string) {
		this.context.headers[key] = value;
	};
}
export class NetLayer {
	driver: HttpDriver = null;
	requestMiddlewareChain: { name: string, middleware: HttpRequestMiddleware }[] = [];
	responseMiddlewareChain: { name: string, middleware: HttpResponseMiddleware }[] = [];
	mockedRoutes: HttpController[] = [];
	configuration: HttpConfig = {
		baseUrl: '',
		timeout: 10000,
		logger: null,
		method: 'POST',
		withCredentials: false,
	};
	constructor(driver: HttpDriver) {
		this.driver = driver;
	}

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
			const logger = this.configuration.logger;
			function log(...args: any[]) {
				logger && logger(...args);
			}
			const path = (request.baseUrl || this.configuration.baseUrl) + request.url;
			const method = request.method || this.configuration.method;
			const oldPath = request.url;
			const oldMethod = request.method;
			request.url = path;
			request.method = method;
			log(request.url);
			log(request);
			let methodNotFound = false;
			for (const route of this.mockedRoutes) {
				const matchedPath: MatchResult = match(path, {
					path: this.configuration.baseUrl + route.path,
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
							request.context.match = matchedPath;
							const res = new HttpMockResponse(output);
							await route.handler(request, res);
              log(output.status);
							log(output);
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
							log('ERROR', '500 internal server error');
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
				log('ERROR', '405 method not allowed');
				throw <HttpResponse>{
					status: 405,
					statusText: '405 method not allowed',
				};
			}
			if (fallback) {
				log('FALLBACK', oldPath);
				request.url = oldPath;
				request.method = oldMethod;
				return fallback(request);
			}
			log('ERROR', '404 not found');
			throw <HttpResponse>{
				status: 404,
				statusText: '404 not found',
			};
		};
	};
	MIDDLEWARE = (name: string, middleware: HttpRequestMiddleware) => {
		const index = this.requestMiddlewareChain.findIndex(a => a.name == name);
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
		const index = this.responseMiddlewareChain.findIndex(a => a.name == name);
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
	GET = <T>(path: string, payload: any) => {
		return this.REQUEST<T>({
			url: path,
			payload: payload,
			method: 'GET'
		});
	};
	POST = <T>(path: string, payload: any) => {
		return this.REQUEST<T>({
			url: path,
			payload: payload,
			method: 'POST',
		});
	};
	PUT = <T>(path: string, payload: any) => {
		return this.REQUEST<T>({
			url: path,
			payload: payload,
			method: 'PUT'
		});
	};
	DELETE = <T>(path: string, payload: any) => {
		return this.REQUEST<T>({
			url: path,
			payload: payload,
			method: 'DELETE'
		});
	};
	REQUEST = async <R = any>(
		request: HttpRequest,
		driver: HttpDriver = null,
	): Promise<HttpResponse<R>> => {
		let requestCache = request;
		for (const m of this.requestMiddlewareChain) {
			requestCache = m.middleware(requestCache);
		}
		//
		let responseCache = null;
		try {
			responseCache = await (driver || this.driver)(requestCache);
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
