import { describe, expect, it } from "vitest";
import { errorMessage } from "../src/components/common";

describe("errorMessage", () => {
  it("ブラウザの英語の通信エラーを、分かる言葉にする", () => {
    for (const m of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."]) {
      expect(errorMessage(new TypeError(m))).toContain("通信できませんでした");
    }
  });
  it("容量不足は、どうすればよいかを伝える", () => {
    expect(errorMessage(new DOMException("The quota has been exceeded.", "QuotaExceededError"))).toContain("空き容量");
  });
  it("ほかのエラーはそのまま", () => {
    expect(errorMessage(new Error("天気の形式が想定と違いました"))).toBe("天気の形式が想定と違いました");
    expect(errorMessage(new TypeError("x is not a function"))).toBe("x is not a function");
    expect(errorMessage("文字")).toBe("文字");
  });
});
