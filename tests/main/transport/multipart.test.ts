import { describe, it, expect } from "vitest";
import { multipartBody } from "../../../src/main/transport/http";

describe("multipartBody", () => {
  it("emits text fields, then the binary file part, then the closing boundary", () => {
    const fileData = Buffer.from([0x00, 0x01, 0xff, 0x10]); // includes non-UTF8 bytes
    const body = multipartBody(
      "BOUND",
      { token: "abc", keep: "1" },
      [{ field: "image", filename: "fw.tar.gz", data: fileData }],
    );
    const text = body.toString("latin1");

    expect(text).toContain('--BOUND\r\nContent-Disposition: form-data; name="token"\r\n\r\nabc\r\n');
    expect(text).toContain('--BOUND\r\nContent-Disposition: form-data; name="keep"\r\n\r\n1\r\n');
    expect(text).toContain(
      '--BOUND\r\nContent-Disposition: form-data; name="image"; filename="fw.tar.gz"\r\n' +
        "Content-Type: application/octet-stream\r\n\r\n",
    );
    expect(text.endsWith("--BOUND--\r\n")).toBe(true);
    // The exact raw file bytes survive intact (binary-safe, not mangled as a string).
    expect(body.includes(fileData)).toBe(true);
  });
});
