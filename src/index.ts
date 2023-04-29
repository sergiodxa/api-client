/* eslint-disable @typescript-eslint/ban-types */
import { z } from "zod";

import { generatePath } from "./generate-path";
import { parse, serialize } from "./json";

type ParseUrlParams<Url> = Url extends `${infer Path}(${infer OptionalPath})`
  ? ParseUrlParams<Path> & Partial<ParseUrlParams<OptionalPath>>
  : Url extends `${infer Start}/${infer Rest}`
  ? ParseUrlParams<Start> & ParseUrlParams<Rest>
  : Url extends `:${infer Param}`
  ? { [K in Param]: string | number }
  : {};

type EndpointOptions = {
  search?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
  expects: { success: z.ZodTypeAny; failure?: z.ZodTypeAny };
};

type EndpointsRecord = Record<string, EndpointOptions>;

type EndpointVariables<
  Endpoints extends EndpointsRecord,
  Endpoint extends keyof Endpoints
> = Pick<Endpoints[Endpoint], "search" | "body">;

export type EndpointParams<
  Endpoints extends EndpointsRecord,
  Endpoint extends keyof Endpoints
> = {} extends ParseUrlParams<Endpoint> ? {} : ParseUrlParams<Endpoint>;

export type EndpointSearch<
  Endpoints extends EndpointsRecord,
  Endpoint extends keyof Endpoints
> = EndpointVariables<Endpoints, Endpoint>["search"] extends undefined
  ? {}
  : z.input<NonNullable<EndpointVariables<Endpoints, Endpoint>["search"]>>;

export type EndpointBody<
  Endpoints extends EndpointsRecord,
  Endpoint extends keyof Endpoints
> = EndpointVariables<Endpoints, Endpoint>["body"] extends undefined
  ? {}
  : z.input<NonNullable<EndpointVariables<Endpoints, Endpoint>["body"]>>;

export type VariablesParams<
  Endpoints extends EndpointsRecord,
  Endpoint extends keyof Endpoints
> = {} extends ParseUrlParams<Endpoint>
  ? {}
  : { params: EndpointParams<Endpoints, Endpoint> };

type VariablesSearch<
  Endpoints extends EndpointsRecord,
  Endpoint extends keyof Endpoints
> = {} extends EndpointSearch<Endpoints, Endpoint>
  ? {}
  : { search: EndpointSearch<Endpoints, Endpoint> };

type VariablesBody<
  Endpoints extends EndpointsRecord,
  Endpoint extends keyof Endpoints
> = {} extends EndpointBody<Endpoints, Endpoint>
  ? {}
  : { body: EndpointBody<Endpoints, Endpoint> };

export type Variables<
  Endpoints extends EndpointsRecord,
  Endpoint extends keyof Endpoints
> = VariablesParams<Endpoints, Endpoint> &
  VariablesSearch<Endpoints, Endpoint> &
  VariablesBody<Endpoints, Endpoint>;

export type HasVariables<
  Endpoints extends EndpointsRecord,
  Endpoint extends keyof Endpoints
> = {} extends Variables<Endpoints, Endpoint> ? false : true;

export type EndpointResult<
  Endpoints extends EndpointsRecord,
  Endpoint extends keyof Endpoints
> = Endpoints[Endpoint]["expects"]["failure"] extends z.ZodTypeAny
  ?
      | {
          status: "success";
          data: Endpoint extends keyof Endpoints
            ? z.output<Endpoints[Endpoint]["expects"]["success"]>
            : never;
        }
      | {
          status: "failure";
          code: number;
          data: Endpoint extends keyof Endpoints
            ? Endpoints[Endpoint]["expects"]["failure"] extends z.ZodTypeAny
              ? z.output<Endpoints[Endpoint]["expects"]["failure"]>
              : never
            : never;
        }
  : z.output<Endpoints[Endpoint]["expects"]["success"]>;

export type RequestOptions<
  Endpoints extends EndpointsRecord,
  Endpoint extends keyof Endpoints
> = HasVariables<Endpoints, Endpoint> extends false
  ? { signal?: AbortSignal; headers?: HeadersInit }
  : {
      variables: Variables<Endpoints, Endpoint>;
      signal?: AbortSignal;
      headers?: HeadersInit;
    };

export interface APIClientConfiguration<Endpoints extends EndpointsRecord> {
  baseURL: URL;
  endpoints: Endpoints;
  fetch?: Omit<RequestInit, "body" | "method">;
  measure?: Measurer;
  credentials?(options: { url: URL; headers: Headers; token?: string }): void;
}

export type Measurer = typeof measure;

const RequestMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export type APIClient = InstanceType<ReturnType<typeof createAPIClient>>;

export function createAPIClient<Endpoints extends EndpointsRecord>(
  configuration: APIClientConfiguration<Endpoints>
) {
  return class APIClient {
    #token?: string;

    constructor(token?: string) {
      this.#token = token;
    }

    static get endpoints() {
      return configuration.endpoints;
    }

    async request<Endpoint extends keyof Endpoints>(
      endpoint: Endpoint,
      options: RequestOptions<Endpoints, Endpoint>
    ): Promise<EndpointResult<Endpoints, Endpoint>> {
      if (typeof endpoint !== "string") {
        throw new TypeError("The endpoint must be a string.");
      }

      if (!(endpoint in configuration.endpoints)) {
        throw new ReferenceError(
          `Missing endpoint "${endpoint}". You can add it to your API client configuration.`
        );
      }

      let [method, path] = z
        .tuple([RequestMethodSchema, z.string()])
        .parse(endpoint.split(" "));

      let url =
        "variables" in options && "params" in options.variables
          ? await getURL<Endpoint>(path, options?.variables?.params)
          : await getURL<Endpoint>(path);

      if ("variables" in options && "search" in options.variables) {
        url = await getSearchParams(endpoint, url, options.variables.search);
      }

      let headers = mergeHeaders(
        new Headers(configuration.fetch?.headers),
        new Headers(options?.headers)
      );

      if (configuration.credentials) {
        configuration.credentials({ url, headers, token: this.#token });
      }

      let init: RequestInit = {
        ...configuration.fetch,
        method,
        headers,
      };

      if (options?.signal) {
        // Check if the signal is already aborted and stop there
        if (options.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        init.signal = options.signal;
      }

      if (
        method !== "GET" &&
        "variables" in options &&
        "body" in options.variables
      ) {
        init.body = await getBody(endpoint, options.variables.body);
      }

      let measurer = configuration.measure ?? measure;

      return measurer(endpoint, async () => {
        let request = new Request(url, init);

        let response = await fetch(request);

        // We only accept JSON response, if the Content-Type doesn't have `json`
        // we throw an error and stop here the execution.
        if (!response.headers.get("content-type")?.includes("json")) {
          throw new TypeError(
            `The endpoint "${endpoint}" returned a non-JSON response.`
          );
        }

        let body = await response
          .text()
          .then(parse)
          .catch(() => {
            throw new Error(
              `The endpoint "${endpoint}" returned an invalid JSON response.`
            );
          });

        let SuccessSchema = configuration.endpoints[endpoint].expects.success;
        let FailureSchema = configuration.endpoints[endpoint].expects.failure;

        if (response.status >= 200 && response.status < 300) {
          if (!FailureSchema) return await SuccessSchema.parseAsync(body);
          return {
            status: "success" as const,
            data: await SuccessSchema.parseAsync(body),
          };
        }

        if (response.status >= 400 && response.status < 500) {
          if (!FailureSchema) {
            throw new ReferenceError(
              `Missing "failure" schema for endpoint "${endpoint}".`
            );
          }

          return {
            status: "failure" as const,
            data: await FailureSchema.parseAsync(body),
            code: response.status,
          };
        }

        throw new Error(
          `The endpoint "${endpoint}" throw a ${response.status} code.`
        );
      });
    }
  };

  async function getURL<Endpoint extends keyof Endpoints>(
    path: string,
    params?: EndpointParams<Endpoints, Endpoint>
  ) {
    return new URL(generatePath(path, params).slice(1), configuration.baseURL);
  }

  async function getSearchParams<Endpoint extends keyof Endpoints>(
    endpoint: Endpoint,
    url: URL,
    options: EndpointSearch<Endpoints, Endpoint>
  ) {
    let route = configuration.endpoints[endpoint];
    if (!("search" in route)) return url;

    for (let [key, value] of Object.entries(
      await route.search?.parseAsync(options)
    )) {
      switch (typeof value) {
        case "string": {
          url.searchParams.set(key, value);
          break;
        }
        case "boolean":
        case "number": {
          url.searchParams.set(key, String(value));
          break;
        }
        case "object": {
          if (value === null) break;
          if (Array.isArray(value)) {
            for (let item of value) {
              url.searchParams.append(key, String(item));
            }
          } else {
            for (let [k, v] of Object.entries(value)) {
              url.searchParams.append(`${key}[${k}]`, String(v));
            }
            break;
          }
          break;
        }
        default: {
          break;
        }
      }
    }

    return url;
  }

  async function getBody<Endpoint extends keyof Endpoints>(
    endpoint: Endpoint,
    options: EndpointBody<Endpoints, Endpoint>
  ) {
    let route = configuration.endpoints[endpoint];
    if ("body" in route) {
      return serialize(await route.body?.parseAsync(options));
    }
    return;
  }
}

/**
 * Measure the duration of a function call.
 * @param key The name used to identify this measurement in the console.
 * @param fn The function to measure.
 * @returns The result of the measured function.
 */
async function measure<Result>(key: string, fn: () => Promise<Result>) {
  let start = Date.now();
  try {
    return await fn();
  } finally {
    let duration = Date.now() - start;
    console.log(`[API] ${key} took ${duration}ms`);
  }
}

/**
 * Assert that a value is an object.
 * @param value The value to check.
 * @assert value is Record<string, unknown>
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/**
 * Merge multiple headers objects into a single headers object.
 * @note Order matters. Headers from later objects will overwrite headers from
 * earlier objects.
 * @param sources The list of headers or header-like objects to merge.
 * @returns A new Headers object containing the merged headers.
 */
function mergeHeaders(...sources: HeadersInit[]) {
  let result: Record<string, string> = {};

  for (let source of sources) {
    if (!isObject(source)) {
      throw new TypeError("All arguments must be of type object");
    }

    let headers = new Headers(source);

    for (let [key, value] of headers.entries()) {
      if (value === undefined || value === "undefined") {
        delete result[key];
      } else {
        result[key] = value;
      }
    }
  }

  return new Headers(result);
}
