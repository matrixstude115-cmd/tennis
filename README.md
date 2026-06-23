# Couch to Court — AI Serve Analyzer (POC)

A Node.js proof-of-concept that extracts frames from a tennis serve video and returns structured coaching feedback via the Claude API.

## Prerequisites

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/)
- A video of a tennis serve (`.mp4` or `.mov`)

`ffmpeg` is **bundled** via `ffmpeg-static` — no system install required.

## Setup

```bash
# 1. Clone and install
git clone <your-repo>
cd couch-to-court
npm install

# 2. Add your API key
cp .env.example .env
# Edit .env and paste your key:  ANTHROPIC_API_KEY=sk-ant-...

# 3. Run
node analyze-serve.js ./my-serve.mp4
```

## Example Output

```
Couch to Court — Serve Analyzer
================================
Video: /path/to/my-serve.mp4

[1/3] Extracting 6 frames from video...
  Video duration: 3.84s
  Extracting frame 1/6 at 0.19s... done
  Extracting frame 2/6 at 0.93s... done
  ...

[2/3] Sending frames to Claude (claude-sonnet-4-6)...

[3/3] Analysis complete.

──────────────────────────────────────────────────
  SERVE ANALYSIS
──────────────────────────────────────────────────
  Level detected : beginner
  Serve type     : flat

  STRENGTHS
  ✓ Good continental grip visible at ball toss phase
  ✓ Weight transfer from back to front foot is present

  FIXES
  1. Issue  : Ball toss is releasing 12 inches too far in front and to the right
     Impact : Forces you to reach forward at contact, losing 30-40% of potential racket speed
     Drill  : Wall Toss Drill — stand 6 inches from a wall, toss straight up so the ball just
              brushes it; repeat 20x until the pattern is automatic

  2. Issue  : Back knee is barely bending at trophy position
     Impact : Skips the leg-drive phase that powers 40% of serve velocity for most players
     Drill  : Squat-and-explode drill — shadow serve with an exaggerated knee bend to 90°,
              hold the trophy pose 2 seconds, then drive upward; 3 sets of 10

  PRIORITY
  → Fix the ball toss first — it is the root cause of every timing problem in your serve.

  COACH'S NOTE
  "Your grip is already where it needs to be, which most beginners struggle with for months —
  that's real progress."
──────────────────────────────────────────────────

Full JSON saved to: ./results/2025-01-15T10-30-00-000Z-analysis.json
```

## Prompt Variants

`prompts.js` contains three drop-in coaching personalities:

| Export | Style | Best for |
|---|---|---|
| `PROMPT_STRICT` | Blunt, technical, high standards | Competitive players who want no sugarcoating |
| `PROMPT_ENCOURAGING` | Warm, supportive, celebrates wins | Beginners who need confidence |
| `PROMPT_TECHNICAL` | Biomechanical, kinematic terminology | Coaches, analysts, data-driven players |

To swap in a variant, import it in `analyze-serve.js` and replace the `SYSTEM_PROMPT` constant:

```js
import { PROMPT_STRICT as SYSTEM_PROMPT } from "./prompts.js";
```

## Testing Checklist

### Basic functionality
- [ ] Runs without error on a 3–10 second serve video
- [ ] Extracts exactly 6 frames (check `.tmp-frames/` before it's cleaned up by adding a `console.log`)
- [ ] Saves a valid `.json` file in `./results/`
- [ ] Pretty-prints to terminal without crashing

### Edge cases
- [ ] Run with no argument → clear error message
- [ ] Run with a path that doesn't exist → clear error message
- [ ] Remove `ANTHROPIC_API_KEY` from `.env` → clear error message
- [ ] Use a very short video (< 1s) → should still extract frames, may warn
- [ ] Use a non-video file (e.g. a `.jpg`) → ffprobe will error; confirm the message is readable

### Quality of analysis
- [ ] Test with a beginner serve — does the level classification feel right?
- [ ] Test with a strong serve — does it say `advanced` or `intermediate`?
- [ ] Test all 3 prompt variants (`PROMPT_STRICT`, `PROMPT_ENCOURAGING`, `PROMPT_TECHNICAL`) on the same video
- [ ] Confirm the JSON is always valid (pipe to `node -e "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))"`)
- [ ] Confirm `strengths` ≤ 2 items and `fixes` ≤ 2 items across multiple runs

### Robustness
- [ ] Run twice on the same video — does it produce different (reasonable) results? Good — LLMs are non-deterministic.
- [ ] Try a video filmed from behind vs. the side — does the feedback adapt?

## Moving into an Expo App — Next Steps

1. **Extract the core logic into a service module** (`services/serveAnalyzer.ts`).
   Replace the `fs`-based base64 read with `expo-file-system`'s `readAsStringAsync` with `EncodingType.Base64`.

2. **Frame extraction on mobile** — `fluent-ffmpeg` won't work in React Native.
   Use [`react-native-ffmpeg`](https://github.com/tanersener/react-native-ffmpeg) or offload extraction to a Supabase Edge Function that accepts the raw video upload and returns frames.

3. **Recommended architecture for v1:**
   ```
   Expo app
     → uploads video to Supabase Storage
     → calls Supabase Edge Function
       → extracts frames (ffmpeg in Deno)
       → calls Claude API
       → returns JSON
     → renders coaching cards
   ```
   This keeps the API key server-side, avoids bundling ffmpeg into the app, and gives you a natural place to store results per user.

4. **Supabase schema to add:**
   ```sql
   create table analyses (
     id uuid primary key default gen_random_uuid(),
     user_id uuid references auth.users,
     video_url text,
     result jsonb,
     created_at timestamptz default now()
   );
   ```
