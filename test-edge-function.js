import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import "dotenv/config";

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mkdir = promisify(fs.mkdir);

const FRAME_COUNT = 4;
const EDGE_FUNCTION_URL = `${process.env.SUPABASE_URL}/functions/v1/analyze-serve`;

function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(new Error(`ffprobe failed: ${err.message}`));
      resolve(metadata.format.duration);
    });
  });
}

function extractFrameAtTime(videoPath, outputPath, timeSeconds) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timeSeconds)
      .frames(1)
      .size("640x?")
      .outputOptions(["-q:v", "5"])
      .output(outputPath)
      .on("end", resolve)
      .on("error", (err) => reject(new Error(`Frame extraction failed: ${err.message}`)))
      .run();
  });
}

async function main() {
  const videoPath = process.argv[2];
  if (!videoPath) {
    console.error("Usage: node test-edge-function.js ./my-serve.mp4");
    process.exit(1);
  }

  console.log("Extracting frames...");
  const duration = await getVideoDuration(videoPath);
  const tmpDir = path.join(__dirname, ".tmp-frames");
  await mkdir(tmpDir, { recursive: true });

  const margin = duration * 0.05;
  const usable = duration - margin * 2;
  const interval = usable / (FRAME_COUNT - 1);

  const frames = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const t = margin + i * interval;
    const outPath = path.join(tmpDir, `frame-${i}.jpg`);
    await extractFrameAtTime(videoPath, outPath, t);
    frames.push(fs.readFileSync(outPath).toString("base64"));
    console.log(`  Frame ${i + 1}/${FRAME_COUNT} extracted`);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\nSending ${FRAME_COUNT} frames to Edge Function...`);
  console.log(`URL: ${EDGE_FUNCTION_URL}\n`);

  const response = await fetch(EDGE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ frames, user_id: "test-user" }),
  });

  const data = await response.json();

  if (data.error) {
    console.error("Error:", data.error);
    if (data.raw) console.error("Raw:", data.raw);
    process.exit(1);
  }

  console.log(JSON.stringify(data.result, null, 2));
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
