import { describe, expect, it, vi } from "vitest";
import { fetchWeather, outingTemperature, weatherUrl } from "../src/weather/openMeteo";

describe("weatherUrl", () => {
  it("位置を小数2桁に丸めて送る", () => {
    const url = new URL(weatherUrl(35.681236, 139.767125));
    expect(url.searchParams.get("latitude")).toBe("35.68");
    expect(url.searchParams.get("longitude")).toBe("139.77");
    expect(url.searchParams.get("timezone")).toBe("auto");
  });
});

describe("fetchWeather", () => {
  it("今・最高・最低の気温を取り出す", async () => {
    const f = vi.fn(async () =>
      new Response(JSON.stringify({ current: { temperature_2m: 17.4 }, daily: { temperature_2m_max: [21.2], temperature_2m_min: [12.1] } })),
    );
    expect(await fetchWeather(35, 139, f as unknown as typeof fetch)).toEqual({ currentC: 17.4, maxC: 21.2, minC: 12.1 });
  });
  it("形が違えば分かる言葉で失敗する", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({})));
    await expect(fetchWeather(35, 139, f as unknown as typeof fetch)).rejects.toThrow("形式");
  });
  it("通信できないときは、英語のエラーではなく、代わりに選べることを伝える", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("Load failed");
    });
    await expect(fetchWeather(35, 139, down as unknown as typeof fetch)).rejects.toThrow("「寒い〜暑い」からも選べます");
    const busy = vi.fn(async () => new Response("", { status: 503 }));
    await expect(fetchWeather(35, 139, busy as unknown as typeof fetch)).rejects.toThrow("（503）。気温は上の「寒い〜暑い」からも選べます");
  });
});

describe("outingTemperature", () => {
  it("最高気温寄りの値にする", () => {
    expect(outingTemperature({ currentC: 10, maxC: 21, minC: 12 })).toBe(18);
  });
});
