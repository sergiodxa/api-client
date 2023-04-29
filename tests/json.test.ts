import { describe, expect, test } from "vitest";

import { serialize, parse } from "../src/json";

describe(parse.name, () => {
  test("parses a JSON string to a JS object with the keys in camelCase", () => {
    let input = `{"foo_bar": "baz"}`;
    let output = parse(input);
    expect(output).toEqual({ fooBar: "baz" });
  });
});

describe(serialize.name, () => {
  test("serializes a value to a JSON string using snake_case for the keys", () => {
    let input = { fooBar: "baz" };
    let output = serialize(input);
    expect(output).toEqual(`{"foo_bar":"baz"}`);
  });
});
