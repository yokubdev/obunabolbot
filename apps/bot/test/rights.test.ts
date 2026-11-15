import { describe, expect, it } from "vitest";
import { missingChannelRights, missingGroupRights, splitStartPayload } from "../src/handlers.js";

describe("missingChannelRights", () => {
  it("accepts a channel admin with every right, where can_restrict_members is false", () => {
    // What Telegram sends for a channel admin given all rights: there is no ban toggle in channels.
    expect(missingChannelRights({ can_invite_users: true, can_restrict_members: false } as never)).toEqual([]);
  });
  it("asks for the invite right when it is missing", () => {
    expect(missingChannelRights({ can_invite_users: false })).toHaveLength(1);
  });
});

describe("splitStartPayload", () => {
  it("reads a promo code after the channel link", () => {
    expect(splitStartPayload("fitness-akademiya")).toEqual(["fitness-akademiya", null]);
    expect(splitStartPayload("fitness-akademiya_bahor20")).toEqual(["fitness-akademiya", "BAHOR20"]);
    expect(splitStartPayload("kanal_<x>")).toEqual(["kanal", null]);
  });
});

describe("missingGroupRights", () => {
  it("needs both the invite and the ban right in a group", () => {
    expect(missingGroupRights({ can_invite_users: true, can_restrict_members: true })).toEqual([]);
    expect(missingGroupRights({ can_invite_users: true, can_restrict_members: false })).toHaveLength(1);
    expect(missingGroupRights({})).toHaveLength(2);
  });
});
