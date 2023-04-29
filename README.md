# createAPIClient

## Features

- Completely type-safe
- Automatic route params
- Typed search and body params with Zod
- Typed responses with Zod
- Automatic error handling
- Automatic JSON parsing
- AbortController/AbortSignal built-in support
- Customizable fetch options
- Customizable performance measuring
- Customizable credentials handling

## Install

```bash
npm add @sergiodxa/api-client zod
```

## Usage

Import `createAPIClient` and `z` from Zod

```ts
import { createAPIClient } from "@sergiodxa/api-client";
import { z } from "zod";
```

Then create a new API client. There are two required parameters:

- `baseURL`, which is a URL object
- `endpoints` which is an object with the endpoints the API supports

And the following parameters are optional:

- `fetch`, all `RequestInit` options supported by `fetch` except `body` and `method`. Every request will have these options.
- `measure` is a function used to measure the performance of the request. It receives the endpoint and an async function that performs the request and parses the response. The default function will do a simple `console.log` with the message `[API] GET /users took 50ms` where `GET /users` is the endpoint and `50ms` is the time it took to fetch the endpoint. You can use it to remove the logs or customize the usage.
- `credentials` is a function that receives an object with the `URL` and `Headers` instances that the request will use and an optional `token`. Use this method to attach that token to the URL or headers before sending the request based on the API requirements.

```ts
let APIClient = createAPIClient({
  baseURL: "https://api.example.com",
  endpoints: {
    "GET /users": {
      expected: {
        success: z.object({ id: z.string(), name: z.string() }).array(),
      },
    },
    "GET /users/:userId": {
      expected: {
        success: z.object({ id: z.string(), name: z.string() }),
        failure: z.object({ error: z.string() }),
      },
    },
  },
});
```

Once you have your APIClient class (feel free to use another name), you can create a new instance:

```ts
let client = new APIClient();
```

> **Note**: The constructor accepts a single optional `token` string parameter. This token will be passed to the `credentials` function if provided.

Finally, use `client.request` method to call your different endpoints.

```ts
const users = await client.request("GET /users", {}); // second argument always required, working on that
```

The `client.request` method receives the endpoint as `METHOD /path` and an object with extra options, which can be:

- `variables` is an object with the variables the endpoint needs. The route params, search params, and the body for non-GET requests are part of the `variables`.
- `headers`, is a `HeadersInit` object with the headers you want to apply to your request.
- `signal` , is an `AbortSignal` instance you can use to abort the request.

The `client.request` result will depend on the endpoint configuration. If the endpoint doesn't have a `failure` schema, the result will be the output of the `success` schema.

If the endpoint does have a `failure` schema, then the result will be a `Result` object with the following properties:

- `status`, is a string with the result's status. It can be `success` or `failure`.
- `data`, is the output of the `success` schema.
- `code`, is the HTTP status code of the response, only on `failure`.

```ts
const userResult = await client.request("GET /users/:userId", {
  variables: { params: { userId: 123 } },
});

if (userResult.status === "failure") {
  console.log(userResult.code);
  console.log(userResult.data);
}

if (userResult.status === "success") {
  console.log(userResult.data);
}
```

In case the response is a 4xx, and there's no `failure` schema, then `client.request` will throw an error with the message `Missing "failure" schema for endpoint "GET /users".` where `GET /users` is the endpoint that failed.

In case the response is a 5xx, then `client.request` will throw an error with the message `The endpoint "GET /users" throw a 500 code.` where `GET /users` is the endpoint that failed and `500` is the status code of the response.

If the response is not JSON, then `client.request` will throw an error with the message `The endpoint "GET /users" returned a non-JSON response.` where `GET /users` is the endpoint that failed. The response Content-Type header determines whether the response is considered a JSON. It must include `json`, which means `application/json` or `application/json; charset=utf-8`, and other variants are all valid.

In case the response has the Content-Type header but it's not a JSON one, it will fail when trying to parse it, such case `client.request` will throw an error with the message `The endpoint "GET /users" returned an invalid JSON response.` where `GET /users` is the endpoint that failed.

When defining endpoints, an endpoint can have route params, search params, body params, and the expected response results.

```ts
const endpoints = {
  "GET /users": {
    search: z.object({ page: z.number() }),
    expected: {
      success: z.object({ id: z.number() }).array(),
    },
  },
  "POST /users": {
    body: z.object({ name: z.string() }),
    expected: {
      success: z.object({ id: z.number() }),
      failure: z.object({ error: z.string() }),
    },
  },
  "GET /users/:userId": {
    expected: {
      success: z.object({ id: z.number() }),
      failure: z.object({ error: z.string() }),
    },
  },
};
```

The `search` schema validates the search parameters. The `body` schema validates the body of non-GET requests, and the `expected` schema validates the response.

There's automatic inference of route parameters from the endpoint path. In the example above, `:userId` is a route param, so you will have to use that endpoint like this:

```ts
await client.request("GET /users/:userId", {
  variables: { params: { userId: 123 } },
});
```

All route params are typed as `string | number` in this case.

The `search` params can be almost anything, but since URLSearchParams doesn't support everything there are a few considerations based on the type:

- strings are used as is
- booleans and numbers are converted to strings using `String(value)`
- arrays are iterated and added with `searchParams.append` sharing the same key, the values are converted to strings using `String(value)`, e.g. `[1, 2, 3]` for the key `id` will be `?id=1&id=2&id=3`
- objects are added like `?param[key]=value`, values are converted to strings using `String(value)`, e.g. `{ color: "red", quantity: 1 }` for the key `filter` will be `?filter[color]=red&filter[quantity]=1`.

Any other type of value will be ignored.

The `body` params must be JSON compatible.

> **Note**: Support for file uploads may come in the future.

If you don't want to use `client.request(endpoint)` you can extend and provide your methods:

```ts
let BaseAPIClient = createAPIClient({
  baseURL: "https://api.example.com",
  endpoints: {
    "GET /users": {
      expected: {
        success: z.object({ id: z.string(), name: z.string() }).array(),
      },
    },
    "GET /users/:userId": {
      expected: {
        success: z.object({ id: z.string(), name: z.string() }),
        failure: z.object({ error: z.string() }),
      },
    },
  },
});

class APIClient extends BaseAPIClient {
  fetchUsers() {
    return this.request("GET /users", {});
  }

  fetchUser(id: number) {
    return this.request("GET /users/:userId", {
      variables: { params: { userId: id } },
    });
  }
}
```

And then use your custom class as an API client.

```ts
let client = new APIClient();

let users = await client.fetchUsers();
let userResult = await client.fetchUser(123);
```

## Author

- [Sergio Xalambrí](https://sergiodxa.com)
