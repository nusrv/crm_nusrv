import { extractJsonObject } from './llm-json-output.util';

describe('extractJsonObject', () => {
  it('parses a plain raw JSON object', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips a ```json ... ``` markdown code fence', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('strips a plain ``` ... ``` fence with no language tag', () => {
    expect(extractJsonObject('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('extracts a JSON object from surrounding prose when no fence is present', () => {
    expect(extractJsonObject('Sure, here you go: {"a":1} — let me know if you need anything else.')).toEqual({ a: 1 });
  });

  it('handles leading/trailing whitespace', () => {
    expect(extractJsonObject('   {"a":1}   ')).toEqual({ a: 1 });
  });

  it('throws (never silently coerces) when no JSON object can be found at all', () => {
    expect(() => extractJsonObject('I cannot help with that.')).toThrow();
  });

  it('throws when the extracted braces do not contain valid JSON', () => {
    expect(() => extractJsonObject('{not: valid, json}')).toThrow();
  });
});
