import sharp from "sharp";
import type { stitchLayout } from "../stitch-layout";

export function renderStitch(layout: ReturnType<typeof stitchLayout>, inputs: Array<string | Buffer>) {
  const background = layout.background === "white" ? "#ffffff" : { r: 0, g: 0, b: 0, alpha: 0 };
  return sharp({ create: { width: layout.width, height: layout.height, channels: 4, background } })
    .composite(inputs.map((input, index) => ({ input, ...layout.cells[index] }))).png().toBuffer();
}
