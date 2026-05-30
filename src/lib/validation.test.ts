import { describe, it, expect } from "vitest";
import {
  emailSchema,
  nameSchema,
  phoneSchema,
  parseOrError,
} from "./validation";

describe("emailSchema", () => {
  it("trims + lowercases a valid email", () => {
    const r = parseOrError(emailSchema, "  Foo@Bar.COM ");
    expect(r).toEqual({ data: "foo@bar.com" });
  });

  it("rejects a malformed email", () => {
    expect(parseOrError(emailSchema, "not-an-email")).toEqual({
      error: "Email looks invalid.",
    });
  });

  it("rejects empty", () => {
    expect(parseOrError(emailSchema, "   ")).toEqual({ error: "Email is required." });
  });
});

describe("nameSchema", () => {
  it("accepts + trims", () => {
    expect(parseOrError(nameSchema, "  Jane Doe ")).toEqual({ data: "Jane Doe" });
  });
  it("rejects empty + over-long", () => {
    expect(parseOrError(nameSchema, "  ")).toEqual({ error: "Name is required." });
    expect(parseOrError(nameSchema, "x".repeat(121))).toEqual({
      error: "Name is too long.",
    });
  });
});

describe("phoneSchema", () => {
  it("normalises empty to undefined", () => {
    expect(parseOrError(phoneSchema, "")).toEqual({ data: undefined });
    expect(parseOrError(phoneSchema, undefined)).toEqual({ data: undefined });
  });
  it("trims a value", () => {
    expect(parseOrError(phoneSchema, "  07700 900000 ")).toEqual({
      data: "07700 900000",
    });
  });
  it("rejects over-long", () => {
    expect(parseOrError(phoneSchema, "1".repeat(33))).toEqual({
      error: "Phone number is too long.",
    });
  });
});
