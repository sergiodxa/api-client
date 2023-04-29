import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { createAPIClient } from "../src";
import { z } from "zod";
import { setupServer } from "msw/node";
import { rest } from "msw";

// @ts-expect-error We're using this to simulate a location object
window.location = new URL("https://example.com");

describe(createAPIClient.name, () => {
  const server = setupServer(
    rest.all("*", (_, res, ctx) => {
      return res(ctx.status(404), ctx.json({ error: "Not found" }));
    })
  );

  beforeAll(() => {
    server.listen();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  test("creates a new API client", () => {
    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("https://example.com"),
      endpoints: {},
    });

    let client = new Client();

    expect(client).toBeInstanceOf(Client);
    expect(client).toHaveProperty("request", expect.any(Function));
    expect(Client).toHaveProperty("endpoints");
  });

  test("defines endpoints", () => {
    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("https://example.com"),
      endpoints: { "GET /users": { expects: { success: z.string() } } },
    });

    expect(Client.endpoints).toMatchInlineSnapshot(`
      {
        "GET /users": {
          "expects": {
            "success": ZodString {
              "_def": {
                "checks": [],
                "coerce": false,
                "typeName": "ZodString",
              },
              "_regex": [Function],
              "and": [Function],
              "array": [Function],
              "brand": [Function],
              "catch": [Function],
              "default": [Function],
              "describe": [Function],
              "isNullable": [Function],
              "isOptional": [Function],
              "nonempty": [Function],
              "nullable": [Function],
              "nullish": [Function],
              "optional": [Function],
              "or": [Function],
              "parse": [Function],
              "parseAsync": [Function],
              "pipe": [Function],
              "promise": [Function],
              "refine": [Function],
              "refinement": [Function],
              "safeParse": [Function],
              "safeParseAsync": [Function],
              "spa": [Function],
              "superRefine": [Function],
              "toLowerCase": [Function],
              "toUpperCase": [Function],
              "transform": [Function],
              "trim": [Function],
            },
          },
        },
      }
    `);
  });

  test("aborts request using AbortController", async () => {
    let controller = new AbortController();

    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("https://example.com"),
      endpoints: { "GET /users": { expects: { success: z.string() } } },
    });

    let client = new Client();

    controller.abort();

    await expect(
      client.request("GET /users", { signal: controller.signal })
    ).rejects.toThrowError(DOMException);
  });

  test("accepts custom one-time headers", async () => {
    server.use(
      rest.get("http://example.com/users", (req, res, ctx) => {
        let header = req.headers.get("X-Test");
        return res.once(ctx.json({ header }));
      })
    );

    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("http://example.com"),
      endpoints: {
        "GET /users": {
          expects: { success: z.object({ header: z.string() }) },
        },
      },
    });

    let client = new Client();

    await expect(
      client.request("GET /users", { headers: { "X-Test": "test" } })
    ).resolves.toEqual({ header: "test" });
  });

  test("throws if response was a non-JSON", async () => {
    server.use(
      rest.get("http://example.com/users", (_, res, ctx) => {
        return res.once(ctx.text("Internal server error"));
      })
    );

    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("http://example.com"),
      endpoints: {
        "GET /users": {
          expects: { success: z.object({ header: z.string() }) },
        },
      },
    });

    let client = new Client();

    await expect(client.request("GET /users", {})).rejects.toThrowError(
      'The endpoint "GET /users" returned a non-JSON response.'
    );
  });

  test("throws if request failed and there was not failure schema", async () => {
    server.use(
      rest.get("http://example.com/users", (_, res, ctx) => {
        return res.once(ctx.status(400), ctx.json({ error: "Failed" }));
      })
    );

    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("http://example.com"),
      endpoints: {
        "GET /users": {
          expects: { success: z.object({ header: z.string() }) },
        },
      },
    });

    let client = new Client();

    await expect(client.request("GET /users", {})).rejects.toThrowError(
      'Missing "failure" schema for endpoint "GET /users".'
    );
  });

  test("throws if request said it was JSON but body is invalid", async () => {
    server.use(
      rest.get("http://example.com/users", (_, res, ctx) => {
        return res.once(
          ctx.set("content-type", "application/json"),
          ctx.text("Not really JSON")
        );
      })
    );

    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("http://example.com"),
      endpoints: {
        "GET /users": {
          expects: { success: z.object({ header: z.string() }) },
        },
      },
    });

    let client = new Client();

    await expect(client.request("GET /users", {})).rejects.toThrowError(
      'The endpoint "GET /users" returned an invalid JSON response.'
    );
  });

  test("throw if the requested endpoint is not a string", async () => {
    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("http://example.com"),
      endpoints: {
        "GET /users": {
          expects: { success: z.object({ header: z.string() }) },
        },
      },
    });

    let client = new Client();

    // @ts-expect-error We're testing something that TS catches but JS no
    await expect(client.request({})).rejects.toThrowError(
      "The endpoint must be a string."
    );
  });

  test("throw if the requested endpoint is not defined", async () => {
    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("http://example.com"),
      endpoints: {
        "GET /users": {
          expects: { success: z.object({ header: z.string() }) },
        },
      },
    });

    let client = new Client();

    // @ts-expect-error We're testing something that TS catches but JS no
    await expect(client.request("GET /posts")).rejects.toThrowError(
      'Missing endpoint "GET /posts". You can add it to your API client configuration'
    );
  });

  test("throws when ther response is a 5xx", async () => {
    server.use(
      rest.get("http://example.com/users", (_, res, ctx) => {
        return res.once(ctx.status(500), ctx.json(""));
      })
    );

    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("http://example.com"),
      endpoints: {
        "GET /users": {
          expects: {
            success: z.object({ name: z.string() }),
            failure: z.object({ error: z.string() }),
          },
        },
      },
    });

    let client = new Client();

    await expect(client.request("GET /users", {})).rejects.toThrowError(
      'The endpoint "GET /users" throw a 500 code.'
    );
  });

  test("applies credentials using the URL", async () => {
    server.use(
      rest.get("http://example.com/users", (req, res, ctx) => {
        let token = req.url.searchParams.get("token");
        return res.once(ctx.json({ token }));
      })
    );

    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("http://example.com"),
      credentials({ url, token }) {
        if (token) url.searchParams.set("token", token);
      },
      endpoints: {
        "GET /users": { expects: { success: z.object({ token: z.string() }) } },
      },
    });

    let client = new Client("a valid token");

    await expect(client.request("GET /users", {})).resolves.toEqual({
      token: "a valid token",
    });
  });

  test("applies credentials using the Headers", async () => {
    server.use(
      rest.get("http://example.com/users", (req, res, ctx) => {
        let token = req.headers.get("Authorization");
        return res.once(ctx.json({ token }));
      })
    );

    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("http://example.com"),
      credentials({ headers, token }) {
        if (token) headers.set("Authorization", token);
      },
      endpoints: {
        "GET /users": { expects: { success: z.object({ token: z.string() }) } },
      },
    });

    let client = new Client("a valid token");

    await expect(client.request("GET /users", {})).resolves.toEqual({
      token: "a valid token",
    });
  });

  test("sends basic request with AbortSignal", async () => {
    server.use(
      rest.get("http://example.com/users", (req, res, ctx) => {
        return res.once(ctx.json([{ name: "Sergio" }]));
      })
    );

    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("http://example.com"),
      endpoints: {
        "GET /users": {
          expects: { success: z.object({ name: z.string() }).array() },
        },
      },
    });

    let client = new Client();

    await expect(
      client.request("GET /users", { signal: new AbortSignal() })
    ).resolves.toEqual([{ name: "Sergio" }]);
  });

  test("defines endpoints with params", async () => {
    server.use(
      rest.get("http://example.com/users/:userId", (req, res, ctx) => {
        return res.once(ctx.json({ userId: req.params.userId }));
      })
    );

    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("http://example.com"),
      endpoints: {
        "GET /users/:userId": {
          expects: { success: z.object({ userId: z.string() }) },
        },
      },
    });

    let client = new Client();

    await expect(
      client.request("GET /users/:userId", {
        variables: { params: { userId: 1 } },
      })
    ).resolves.toEqual({ userId: "1" });
  });

  test("defines endpoints with search params", async () => {
    server.use(
      rest.get("http://example.com/users", (req, res, ctx) => {
        let name = req.url.searchParams.get("name");
        return res.once(ctx.json([{ name }]));
      })
    );

    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("http://example.com"),
      endpoints: {
        "GET /users": {
          search: z.object({
            name: z.string(),
            age: z.number(),
            isActive: z.boolean(),
            nullish: z.null(),
            list: z.string().array(),
            record: z.record(z.string()),
            symbol: z.symbol(),
          }),
          expects: { success: z.object({ name: z.string() }).array() },
        },
      },
    });

    let client = new Client();

    await expect(
      client.request("GET /users", {
        variables: {
          search: {
            name: "Sergio",
            age: 30,
            isActive: true,
            nullish: null,
            list: ["a", "b"],
            record: { a: "a", b: "b" },
            symbol: Symbol(),
          },
        },
      })
    ).resolves.toEqual([{ name: "Sergio" }]);
  });

  test("defines endpoint with body", async () => {
    server.use(
      rest.post("http://example.com/users", async (req, res, ctx) => {
        let { name } = await req.json();
        return res.once(ctx.json({ name }));
      })
    );

    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("http://example.com"),
      endpoints: {
        "POST /users": {
          body: z.object({ name: z.string() }),
          expects: { success: z.object({ name: z.string() }) },
        },
      },
    });

    let client = new Client();

    await expect(
      client.request("POST /users", {
        variables: { body: { name: "Sergio" } },
      })
    ).resolves.toEqual({ name: "Sergio" });
  });

  test("sets client-level headers", async () => {
    server.use(
      rest.get("http://example.com/header", (req, res, ctx) => {
        return res.once(ctx.json({ value: req.headers.get("X-Client") }));
      })
    );

    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("http://example.com"),
      fetch: { headers: { "X-Client": "MyClient" } },
      endpoints: {
        "GET /header": {
          expects: { success: z.object({ value: z.string() }) },
        },
      },
    });

    let client = new Client();

    await expect(client.request("GET /header", {})).resolves.toEqual({
      value: "MyClient",
    });
  });

  test("returns Result object when there's a failure schema", async () => {
    server.use(
      rest.get("http://example.com/users/123", (_, res, ctx) => {
        return res.once(ctx.json({ name: "Sergio" }));
      }),

      rest.get("http://example.com/users/456", (_, res, ctx) => {
        return res.once(ctx.status(404), ctx.json({ error: "User not found" }));
      })
    );

    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("http://example.com"),
      endpoints: {
        "GET /users/:userId": {
          expects: {
            success: z.object({ name: z.string() }),
            failure: z.object({ error: z.string() }),
          },
        },
      },
    });

    let client = new Client();

    await expect(
      client.request("GET /users/:userId", {
        variables: { params: { userId: "123" } },
      })
    ).resolves.toEqual({ status: "success", data: { name: "Sergio" } });

    await expect(
      client.request("GET /users/:userId", {
        variables: { params: { userId: "456" } },
      })
    ).resolves.toEqual({
      code: 404,
      status: "failure",
      data: { error: "User not found" },
    });
  });

  test("uses default measure function", async () => {
    server.use(
      rest.get("http://example.com/users", (_, res, ctx) => {
        return res.once(ctx.json([{ name: "Sergio" }]));
      })
    );

    vi.useFakeTimers();
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    let logger = vi.spyOn(console, "log").mockImplementationOnce(() => {});

    let Client = createAPIClient({
      baseURL: new URL("http://example.com"),
      endpoints: {
        "GET /users": {
          expects: { success: z.object({ name: z.string() }).array() },
        },
      },
    });

    let client = new Client();
    await client.request("GET /users", {});

    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith("[API] GET /users took 0ms");

    logger.mockClear();
    vi.useRealTimers();
  });

  test("uses custom measure function", async () => {
    server.use(
      rest.get("http://example.com/users", (_, res, ctx) => {
        return res.once(ctx.json([{ name: "Sergio" }]));
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    let logger = vi.spyOn(console, "log").mockImplementationOnce(() => {});

    let Client = createAPIClient({
      measure: (name, fn) => {
        console.log(`[API] ${name} took 100ms`);
        return fn();
      },
      baseURL: new URL("http://example.com"),
      endpoints: {
        "GET /users": {
          expects: { success: z.object({ name: z.string() }).array() },
        },
      },
    });

    let client = new Client();
    await client.request("GET /users", {});

    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith("[API] GET /users took 100ms");

    logger.mockClear();
  });

  test("can extend client class", async () => {
    server.use(
      rest.get("http://example.com/users", (_, res, ctx) => {
        return res.once(ctx.json([{ name: "Sergio" }]));
      })
    );

    let Client = createAPIClient({
      measure: (_, fn) => fn(),
      baseURL: new URL("http://example.com"),
      endpoints: {
        "GET /users": {
          expects: { success: z.object({ name: z.string() }).array() },
        },
      },
    });

    class CustomClient extends Client {
      async getUsers() {
        return this.request("GET /users", {});
      }
    }

    let client = new CustomClient();

    await expect(client.getUsers()).resolves.toEqual([{ name: "Sergio" }]);
  });
});
