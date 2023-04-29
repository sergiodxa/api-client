# createAPIClient

> A strongly typed API client using Zod

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

Then create a new API client, there are two required parameters:

- `baseURL` which is a URL object
- `endpoints` which is an object with the endpoints the API supports

And the following parameters are optional:

- `fetch` which are all `RequestInit` options supported by `fetch` except `body` and `method`, these will be added to every request.
- `measure` which is a function used to measure the perfomance of the request, it receives the endpoint and an async function that will be the one doing the request and parsing the response. The default function will do a simple `console.log` with the message `[API] GET /users took 50ms` where `GET /users` is the endpoint and `50ms` is the time it took to do the request, a custom function can be used to avoid the logs or customize the usage.
- `credentials` is a function that receives an object with the `URL` and `Headers` instances that will be used by the request, and an optional `token`, this method can be used to attach such token to the URL or headers before the request is sent based on the API requirements.

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

Once you have you APIClient class (feel free to use another name) you can create a new instance:

```ts
let client = new APIClient();
```

> **Note** there's a single optional `token` string parameter accepted by the constructor, this token will be passed to the `credentials` function if provided.

Finally, use `client.request` method to call your different endpoints.

```ts
const users = await client.request("GET /users", {}); // second argument always required, working on that
```

The `client.request` method receives the endpoint as `METHOD /path` and an object with extra options which can be:

- `variables` which is an object with the variables the endpoint needs, this includes route params, search params and the body for non-GET requests.
- `headers` which is a `HeadersInit` object with the headers you want to apply to your request.
- `signal` which is an `AbortSignal` instance that can be used to abort the request.

The reesult of `client.request` will depend on the endpoint configuration, if the endpoint doesn't have a `failure` schema the result will be the output of the `success` schema.

If the endpoint does have a `failure` schema then the result will be a `Result` object with the following properties:

- `status` which is a string with the status of the request, it can be `success` or `failure`.
- `data` which is the output of the `success` schema.
- `code` which is the HTTP status code of the response, only on `failure`.

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

In case the response is not a JSON one, then `client.request` will throw an error with the message `The endpoint "GET /users" returned a non-JSON response.` where `GET /users` is the endpoint that failed. This is determined by the response Content-Type header which must include `json`, this means `application/json` or `application/json; charset=utf-8` and other variants are all valid.

In case the response has the Content-Type header but it's not really a JSON one, it will fail when trying to parse it, in such case `client.request` will throw an error with the message `The endpoint "GET /users" returned an invalid JSON response.` where `GET /users` is the endpoint that failed.

When defining endpoints, an endpoint can have route params, search params, body params and the expected response results.

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

The `search` schema is used to validate the search params, the `body` schema is used to validate the body of non-GET requests, and the `expected` schema is used to validate the response.

The route params are automatically inferred from the endpoint path, in the example above `:userId` is a route param so you will have to use that endpoint like this:

```ts
await client.request("GET /users/:userId", {
  variables: { params: { userId: 123 } },
});
```

In this case all route params are typed as `string | number`.

The `search` params can be almost anything, but since not anything is supported by URLSearchParams there are a few considerations based on the type:

- strings is used as is
- booleans and numbers are converted to strings using `String(value)`
- arrays are iterate and added with `searchParams.append` sharing the same key, values are converted to strings using `String(value)`, e.g. `[1, 2, 3]` for the key `id` will be `?id=1&id=2&id=3`
- objects are added like `?param[key]=value`, values are converted to strings using `String(value)`, e.g. `{ color: "red", quantity: 1 }` for the key `filter` will be `?filter[color]=red&filter[quantity]=1`.

Any other type of vaue is ignored.

The `body` params needs to be JSON compatible since the value will be converted with `JSON.stringify`.

> **Note**: Support for file uploads may come in the future.

If you don't want to use `client.request(endpoint)` you can extend and provide your own methods:

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

And then use your custom class as API client.

```ts
let client = new APIClient();

let users = await client.fetchUsers();
let userResult = await client.fetchUser(123);
```

## Author

- [Sergio Xalambrí](https://sergiodxa.com)
