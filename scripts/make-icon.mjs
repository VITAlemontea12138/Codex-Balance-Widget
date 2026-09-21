import sharp from "sharp";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../build/icon.svg", import.meta.url));
const output = fileURLToPath(new URL("../build/icon.png", import.meta.url));

await sharp(source)
  .resize(512, 512)
  .png()
  .toFile(output);

console.log("Generated build/icon.png");
