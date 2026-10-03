import { describe, expect, it } from "vitest";

import { peaks } from "./RecordingWaveform";

describe("peaks", () => {
  it("takes each slice's loudest sample, scaled to the loudest slice", () => {
    expect(peaks(new Float32Array([0.1, -0.2, 0.4, 0, -0.1, 0.05]), 3)).toEqual([0.5, 1, 0.25]);
  });

  it("keeps silence at zero", () => {
    expect(peaks(new Float32Array(8), 4)).toEqual([0, 0, 0, 0]);
  });
});
