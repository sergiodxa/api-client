import { camelize, underscore } from "inflected";

/**
 * Serialize a value to a JSON string using snake_case for the keys
 */
export function serialize<Input>(input: Input): string {
  return JSON.stringify(input, (_: string, value: unknown) => {
    if (typeof value === "object" && !Array.isArray(value) && value !== null) {
      let entries = Object.entries(value).map(([key, value]) => [
        underscore(key),
        value,
      ]);
      return Object.fromEntries(entries);
    }
    return value;
  });
}

/**
 * Parse an JSON string to a JS object with the keys in camelCase
 */
export function parse<Output>(input: string): Output {
  return JSON.parse(input, (_key, value: unknown) => {
    if (typeof value === "object" && !Array.isArray(value) && value !== null) {
      let entries = Object.entries(value).map(([key, value]) => [
        camelize(key, false),
        value,
      ]);
      return Object.fromEntries(entries);
    }
    return value;
  });
}
