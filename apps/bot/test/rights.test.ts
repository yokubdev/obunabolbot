import { describe, expect, it } from "vitest";
import { missingChannelRights } from "../src/handlers.js";

describe("missingChannelRights", () => {
  it("accepts a channel admin with every right, where can_restrict_members is false", () => {
    // What Telegram sends for a channel admin given all rights: there is no ban toggle in channels.
    expect(missingChannelRights({ can_invite_users: true, can_restrict_members: false } as never)).toEqual([]);
  });
  it("asks for the invite right when it is missing", () => {
    expect(missingChannelRights({ can_invite_users: false })).toHaveLength(1);
  });
});
