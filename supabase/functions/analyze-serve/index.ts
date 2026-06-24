const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

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
      "issue": "one specific, concrete problem",
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
- If frames are unclear or not a tennis serve, say so in priority field
- No markdown, no explanation, only the JSON object`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  try {
    // Expects JSON body: { frames: ["base64jpg", ...], user_id: "..." }
    const { frames, user_id } = await req.json();

    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      return Response.json({ error: "No frames provided" }, { status: 400 });
    }

    const imageContent = frames.flatMap((b64: string, i: number) => [
      { type: "text", text: `Frame ${i + 1} of ${frames.length}:` },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
    ]);

    const anthropicResponse = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "Accept-Encoding": "identity",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              ...imageContent,
              { type: "text", text: "Analyze these serve frames and return the JSON coaching report." },
            ],
          },
        ],
      }),
    });

    const claudeData = await anthropicResponse.json();

    if (!claudeData.content?.[0]?.text) {
      return Response.json({ error: "Unexpected Claude response", raw: claudeData }, { status: 500 });
    }

    const raw = claudeData.content[0].text;
    let result;
    try {
      const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      result = JSON.parse(cleaned);
    } catch {
      return Response.json({ error: "Failed to parse Claude response", raw }, { status: 500 });
    }

    return Response.json({ result }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});
