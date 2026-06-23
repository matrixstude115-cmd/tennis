import Anthropic from "@anthropic-ai/sdk";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mkdir = promisify(fs.mkdir);

// ── Config ──────────────────────────────────────────────────────────────────

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

const FRAME_COUNT = 4;
const MODEL = "claude-sonnet-4-6";
const RESULTS_DIR = path.join(__dirname, "results");

const SYSTEM_PROMPT = `You are an expert tennis coach with 20 years of experience coaching players from beginner to 4.0 level.
You are analyzing frames from a video of a tennis serve.

Analyze the serve mechanics shown across these frames and respond ONLY with valid JSON in this exact format:
{
  "player_level": "beginner|intermediate|advanced",
  "serve_phase_detected": "flat|slice|kick|unknown",
  "strengths": [
    "specific observation about what they are doing well"
  ],
  "fixes": [
    {
      "issue": "one specific, concrete problem (e.g. 'toss is dropping 8 inches to the right of your head')",
      "impact": "one sentence on exactly how this hurts the serve",
      "drill": "one specific named drill to fix it, with brief instructions"
    }
  ],
  "priority": "the single most important thing to fix right now, in one sentence",
  "encouragement": "one short genuine coaching note"
}

Rules:
- Maximum 2 items in strengths[]
- Maximum 2 items in fixes[]
- Be specific and concrete, never generic
- Say 'your toss is drifting right' not 'work on your toss'
- If frames are unclear or not a tennis serve, say so in priority field
- No markdown, no explanation, only the JSON object`;

// ── Validation ───────────────────────────────────────────────────────────────

function validateInputs() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "Error: ANTHROPIC_API_KEY is not set. Add it to a .env file:\n  ANTHROPIC_API_KEY=sk-ant-..."
    );
    process.exit(1);
  }

  const videoPath = process.argv[2];
  if (!videoPath) {
    console.error(
      "Error: No video file provided.\nUsage: node analyze-serve.js ./my-serve.mp4"
    );
    process.exit(1);
  }

  const resolvedPath = path.resolve(videoPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: Video file not found: ${resolvedPath}`);
    process.exit(1);
  }

  return resolvedPath;
}

// ── Frame extraction ─────────────────────────────────────────────────────────

function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(new Error(`ffprobe failed: ${err.message}`));
      const duration = metadata.format.duration;
      if (!duration || duration <= 0) {
        return reject(new Error("Could not determine video duration"));
      }
      resolve(duration);
    });
  });
}

function extractFrameAtTime(videoPath, outputPath, timeSeconds) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timeSeconds)
      .frames(1)
      .size("480x?")
      .outputOptions(["-q:v", "8"])
      .output(outputPath)
      .on("end", resolve)
      .on("error", (err) => reject(new Error(`Frame extraction failed: ${err.message}`)))
      .run();
  });
}

async function extractFrames(videoPath) {
  const duration = await getVideoDuration(videoPath);
  console.log(`  Video duration: ${duration.toFixed(2)}s`);

  const tmpDir = path.join(__dirname, ".tmp-frames");
  await mkdir(tmpDir, { recursive: true });

  // Space frames evenly, skipping the very first and last frame to avoid
  // black leader frames that some cameras add.
  const margin = duration * 0.05;
  const usable = duration - margin * 2;
  const interval = usable / (FRAME_COUNT - 1);

  const framePaths = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const t = margin + i * interval;
    const outPath = path.join(tmpDir, `frame-${i}.jpg`);
    process.stdout.write(`  Extracting frame ${i + 1}/${FRAME_COUNT} at ${t.toFixed(2)}s...`);
    await extractFrameAtTime(videoPath, outPath, t);
    console.log(" done");
    framePaths.push(outPath);
  }

  return { framePaths, tmpDir };
}

function framesToBase64(framePaths) {
  return framePaths.map((p) => fs.readFileSync(p).toString("base64"));
}

function cleanupFrames(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ── Claude API call ──────────────────────────────────────────────────────────

async function analyzeFrames(base64Frames) {
  const client = new Anthropic();

  const imageContent = base64Frames.map((b64, i) => [
    {
      type: "text",
      text: `Frame ${i + 1} of ${FRAME_COUNT}:`,
    },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: b64,
      },
    },
  ]).flat();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...imageContent,
          {
            type: "text",
            text: "Analyze these serve frames and return the JSON coaching report.",
          },
        ],
      },
    ],
  });

  return response.content[0].text;
}

// ── Output ───────────────────────────────────────────────────────────────────

function parseResponse(raw) {
  try {
    // Strip any accidental markdown fences just in case
    const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function saveResult(data) {
  await mkdir(RESULTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(RESULTS_DIR, `${timestamp}-analysis.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const videoPath = validateInputs();

  console.log(`\nCouch to Court — Serve Analyzer`);
  console.log(`================================`);
  console.log(`Video: ${videoPath}\n`);

  // 1. Extract frames
  console.log(`[1/3] Extracting ${FRAME_COUNT} frames from video...`);
  const { framePaths, tmpDir } = await extractFrames(videoPath);

  // 2. Convert to base64
  console.log(`\n[2/3] Sending frames to Claude (${MODEL})...`);
  const base64Frames = framesToBase64(framePaths);
  cleanupFrames(tmpDir);

  const raw = await analyzeFrames(base64Frames);

  // 3. Parse and display
  console.log(`\n[3/3] Analysis complete.\n`);
  const parsed = parseResponse(raw);

  if (!parsed) {
    console.error("Warning: Claude returned malformed JSON. Raw response:\n");
    console.error(raw);
    process.exit(1);
  }

  // Pretty terminal output
  console.log("━".repeat(50));
  console.log(`  SERVE ANALYSIS`);
  console.log("━".repeat(50));
  console.log(`  Level detected : ${parsed.player_level}`);
  console.log(`  Serve type     : ${parsed.serve_phase_detected}`);
  console.log();

  console.log("  STRENGTHS");
  parsed.strengths.forEach((s) => console.log(`  ✓ ${s}`));
  console.log();

  console.log("  FIXES");
  parsed.fixes.forEach((f, i) => {
    console.log(`  ${i + 1}. Issue  : ${f.issue}`);
    console.log(`     Impact : ${f.impact}`);
    console.log(`     Drill  : ${f.drill}`);
    console.log();
  });

  console.log(`  PRIORITY`);
  console.log(`  → ${parsed.priority}`);
  console.log();

  console.log(`  COACH'S NOTE`);
  console.log(`  "${parsed.encouragement}"`);
  console.log("━".repeat(50));

  // Save to file
  const savedPath = await saveResult(parsed);
  console.log(`\nFull JSON saved to: ${savedPath}\n`);
}

main().catch((err) => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});
