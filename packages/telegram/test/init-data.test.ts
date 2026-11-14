import { describe, expect, it } from "vitest";
import { signInitData, validateInitData } from "../src/init-data.js";

describe("validateInitData", () => {
  const token = "123:ABC";
  const user = { id: 42, first_name: "Aziz" };
  it("accepts a correctly signed payload", () => {
    expect(validateInitData(signInitData(user, token), token)).toEqual(user);
  });
  it("rejects a tampered payload", () => {
    const tampered = signInitData(user, token).replace("Aziz", "Bobur");
    expect(validateInitData(tampered, token)).toBeNull();
  });
  it("rejects another bot's signature and stale data", () => {
    expect(validateInitData(signInitData(user, "999:XYZ"), token)).toBeNull();
    expect(validateInitData(signInitData(user, token, 1_000_000), token)).toBeNull();
  });
});
