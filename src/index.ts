import type { ZodTypeAny } from "zod";

import { z } from "zod";

import { generatePath } from "./generate-path";
import { parse, serialize } from "./json";

export type EndpointOptions = {
  params?: ZodTypeAny;
  search?: ZodTypeAny;
  body?: ZodTypeAny;
  expects: { success: ZodTypeAny; failure?: ZodTypeAny };
};

export type EndpointsRecord = Record<string, EndpointOptions>;

export type EndpointVariables<
  Endpoints extends EndpointsRecord,
  Endpoint extends keyof Endpoints
> = Pick<Endpoints[Endpoint], "params" | "search" | "body">;

export type VariablesBody<
  Endpoints extends EndpointsRecord,
  Endpoint extends keyof Endpoints
> = EndpointVariables<Endpoints, Endpoint>["body"] extends z.ZodTypeAny
  ? { body: z.input<EndpointVariables<Endpoints, Endpoint>["body"]> }
  : {};

export type VariablesParams<
  Endpoints extends EndpointsRecord,
  Endpoint extends keyof Endpoints
> = EndpointVariables<Endpoints, Endpoint>["params"] extends z.ZodTypeAny
  ? { params: z.input<EndpointVariables<Endpoints, Endpoint>["params"]> }
  : {};

export type VariablesSearch<
  Endpoints extends EndpointsRecord,
  Endpoint extends keyof Endpoints
> = EndpointVariables<Endpoints, Endpoint>["search"] extends z.ZodTypeAny
  ? { search: z.input<EndpointVariables<Endpoints, Endpoint>["search"]> }
  : {};

export type Variables<
  Endpoints extends EndpointsRecord,
  Endpoint extends keyof Endpoints
> = VariablesBody<Endpoints, Endpoint> &
  VariablesParams<Endpoints, Endpoint> &
  VariablesSearch<Endpoints, Endpoint>;

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
            ? z.output<Endpoints[Endpoint]["expects"]["failure"]>
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
  measure?: typeof measure;
  credentials?(options: { url: URL; headers: Headers; token?: string }): void;
}

const RequestMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export function createAPIClient<Endpoints extends EndpointsRecord>(
  configuration: APIClientConfiguration<Endpoints>
) {
  return class APIClient {
    constructor(private token?: string) {}

    async request<Endpoint extends keyof Endpoints>(
      endpoint: Endpoint,
      options: RequestOptions<Endpoints, Endpoint>
    ): Promise<EndpointResult<Endpoints, Endpoint>> {
      if (typeof endpoint !== "string") {
        throw new TypeError("Invalid endpoint.");
      }

      if (!(endpoint in configuration.endpoints)) {
        throw new ReferenceError(
          `Missing endpoint "${endpoint}", did you forget to add it to the endpoints map?`
        );
      }

      let [method, path] = z
        .tuple([RequestMethodSchema, z.string()])
        .parse(endpoint.split(" "));

      let url =
        "variables" in options && "params" in options.variables
          ? await getURL(path, endpoint, options?.variables?.params)
          : await getURL(path, endpoint);

      if ("variables" in options && "search" in options.variables) {
        url = await getSearchParams(endpoint, url, options.variables.search);
      }

      let headers = mergeHeaders(
        new Headers(configuration.fetch?.headers),
        new Headers(options?.headers)
      );

      if (configuration.credentials) {
        configuration.credentials({ url, headers, token: this.token });
      }

      let init: RequestInit = {
        ...configuration.fetch,
        method,
        headers,
      };

      if (options?.signal) init.signal = options.signal;

      if (
        method !== "GET" &&
        "variables" in options &&
        "body" in options.variables
      ) {
        init.body = getBody(endpoint, options.variables.body);
      }

      let measurer = configuration.measure ?? measure;

      return measurer(endpoint, async () => {
        let request = new Request(url, init);

        let response = await fetch(request);

        let body = await response.text().then(parse);

        let success = configuration.endpoints[endpoint].expects.success;
        let failure = configuration.endpoints[endpoint].expects.failure;

        if (response.status >= 200 && response.status < 300) {
          if (!failure) return await success.parseAsync(body);
          return {
            status: "success" as const,
            data: await success.parseAsync(body),
          };
        }

        if (response.status >= 400 && response.status < 500) {
          if (!failure) {
            throw new ReferenceError(
              `Missing failure schema for endpoint "${endpoint}"`
            );
          }

          return {
            status: "failure" as const,
            data: await failure.parseAsync(body),
            code: response.status,
          };
        }

        throw new Error(
          `The endpoint ${endpoint} throw a ${response.status} code.`
        );
      });
    }
  };

  async function getURL<Endpoint extends keyof Endpoints>(
    path: string,
    endpoint: Endpoint,
    options?: VariablesParams<Endpoints, Endpoint>
  ) {
    let route = configuration.endpoints[endpoint];
    let params =
      "params" in route && options
        ? await route.params?.parseAsync(options)
        : {};
    return new URL(generatePath(path, params).slice(1), configuration.baseURL);
  }

  async function getSearchParams<Endpoint extends keyof Endpoints>(
    endpoint: Endpoint,
    url: URL,
    options: VariablesSearch<Endpoints, Endpoint>
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

  function getBody<Endpoint extends keyof Endpoints>(
    endpoint: Endpoint,
    options: VariablesBody<Endpoints, Endpoint>
  ) {
    let route = configuration.endpoints[endpoint];
    if ("body" in route) return serialize(route.body?.parseAsync(options));
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
