import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.CLICKY_BACKEND_PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-5";
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || "shimmer";
const CLICKY_CALL_NAME =
  (process.env.CLICKY_CALL_NAME || "pintO").trim() || "pintO";
const CLICKY_ENABLE_AUTO_CLICK =
  String(process.env.CLICKY_ENABLE_AUTO_CLICK || "1") === "1";
const CLICKY_LOG_CHAT_TEXT =
  String(process.env.CLICKY_LOG_CHAT_TEXT || "1") === "1";
const CLICKY_LOG_TEXT_LIMIT = Number(process.env.CLICKY_LOG_TEXT_LIMIT || 320);
const EMPTY_AUDIO_BUFFER = Buffer.alloc(0);

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function respondWithFallbackAudio(res, reason) {
  // Keep 200 on TTS failures so the app does not map errors to "credits exhausted".
  res.writeHead(200, {
    "content-type": "audio/mpeg",
    "x-clicky-tts-fallback": "1",
    "x-clicky-tts-reason": reason,
  });
  res.end(EMPTY_AUDIO_BUFFER);
}

function compactTextForLog(value, maxLen = CLICKY_LOG_TEXT_LIMIT) {
  if (typeof value !== "string") return "";
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (!singleLine) return "";
  if (!Number.isFinite(maxLen) || maxLen <= 0) return singleLine;
  if (singleLine.length <= maxLen) return singleLine;
  return `${singleLine.slice(0, maxLen)}...`;
}

function logTextLine(label, value) {
  if (!CLICKY_LOG_CHAT_TEXT) return;
  const text = compactTextForLog(value);
  if (!text) return;
  console.log(`[${nowIso()}] ${label}=${JSON.stringify(text)}`);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function nowIso() {
  return new Date().toISOString();
}

function toOpenAiInput(messages) {
  if (!Array.isArray(messages)) return [];

  return messages.map((message) => {
    const role = message?.role === "assistant" ? "assistant" : "user";
    const content = message?.content;
    const textPartType = role === "assistant" ? "output_text" : "input_text";

    if (typeof content === "string") {
      return {
        role,
        content: [{ type: textPartType, text: content }],
      };
    }

    if (!Array.isArray(content)) {
      return {
        role,
        content: [{ type: textPartType, text: "" }],
      };
    }

    const mapped = [];

    for (const item of content) {
      if (!item || typeof item !== "object") continue;

      if (item.type === "text" && typeof item.text === "string") {
        mapped.push({ type: textPartType, text: item.text });
        continue;
      }

      if (item.type === "image" && item.source?.type === "base64") {
        const mediaType = item.source?.media_type || "image/png";
        const data = item.source?.data || "";
        if (data) {
          mapped.push({
            type: "input_image",
            image_url: `data:${mediaType};base64,${data}`,
          });
        }
      }
    }

    if (mapped.length === 0) {
      mapped.push({ type: textPartType, text: "" });
    }

    return { role, content: mapped };
  });
}

function extractTextFromOpenAiResponse(payload) {
  if (
    typeof payload?.output_text === "string" &&
    payload.output_text.length > 0
  ) {
    return payload.output_text;
  }

  const output = Array.isArray(payload?.output) ? payload.output : [];
  const chunks = [];

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string") {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function ensureCallName(text, callName) {
  const clean = typeof text === "string" ? text.trim() : "";
  if (!clean) return `${callName}.`;

  const escaped = callName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasName = new RegExp(`\\b${escaped}\\b`, "i").test(clean);
  if (hasName) return clean;

  return `${callName}, ${clean}`;
}

function latestUserTextFromBody(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "user") continue;

    if (typeof message?.content === "string") {
      return message.content;
    }

    if (Array.isArray(message?.content)) {
      const parts = [];
      for (const item of message.content) {
        if (item?.type === "text" && typeof item?.text === "string") {
          parts.push(item.text);
        }
      }
      if (parts.length) return parts.join(" ");
    }
  }
  return "";
}

function shouldTriggerAutoClick(userText) {
  if (!userText) return false;
  const text = String(userText).toLowerCase();
  if (/\b(click|tap|press|hit|open|select|interact)\b/.test(text)) return true;
  if (/\b(this|that)\s+one\b/.test(text)) return true;
  if (/\b(right here|here|there)\b/.test(text)) return true;
  if (/\bdev info\b/.test(text)) return true;
  return false;
}

function parsePointTag(text) {
  if (typeof text !== "string") return null;
  const matches = [...text.matchAll(/\[POINT:\s*(none|(\d+)\s*,\s*(\d+)(?::([^\]]+))?)\]/gi)];
  if (matches.length === 0) return null;
  const match = matches[matches.length - 1];
  if (String(match[1]).toLowerCase() === "none") return null;
  return {
    x: Number(match[2]),
    y: Number(match[3]),
    label: match[4] ? String(match[4]).trim() : "target",
  };
}

function extractImageDimensions(text) {
  if (typeof text !== "string") return null;
  const match = text.match(/image dimensions:\s*(\d{2,5})\D+(\d{2,5})/i);
  if (!match) return null;
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function fallbackPointFromContext(userText) {
  const dims = extractImageDimensions(userText);
  if (dims && Number.isFinite(dims.width) && Number.isFinite(dims.height)) {
    return {
      x: Math.max(1, Math.round(dims.width * 0.5)),
      y: Math.max(1, Math.round(dims.height * 0.5)),
      label: "center",
    };
  }

  return { x: 500, y: 500, label: "center" };
}

function normalizePointTag(text, { hasClickIntent, userText }) {
  const clean = typeof text === "string" ? text.trim() : "";
  const tagMatches = [...clean.matchAll(/\[POINT:\s*(none|(\d+)\s*,\s*(\d+)(?::([^\]]+))?)\]/gi)];
  const textWithoutTags = clean
    .replace(/\[POINT:\s*(?:none|(?:\d+\s*,\s*\d+(?::[^\]]+)?))\]/gi, "")
    .trim();

  let finalTag = "[POINT:none]";
  if (tagMatches.length > 0) {
    const last = tagMatches[tagMatches.length - 1];
    const isNone = String(last[1]).toLowerCase() === "none";
    if (!isNone) {
      const x = Number(last[2]);
      const y = Number(last[3]);
      const label = last[4] ? String(last[4]).trim() : "target";
      finalTag = `[POINT:${x},${y}:${label}]`;
    } else if (hasClickIntent) {
      const fallback = fallbackPointFromContext(userText);
      finalTag = `[POINT:${fallback.x},${fallback.y}:${fallback.label}]`;
    }
  } else if (hasClickIntent) {
    const fallback = fallbackPointFromContext(userText);
    finalTag = `[POINT:${fallback.x},${fallback.y}:${fallback.label}]`;
  }

  if (!textWithoutTags) return finalTag;
  return `${textWithoutTags} ${finalTag}`;
}

function clickAtCoordinates(x, y) {
  return new Promise((resolve) => {
    const script = `tell application "System Events" to click at {${x}, ${y}}`;
    execFile("osascript", ["-e", script], (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          error: String(error.message || error),
          stderr: String(stderr || "").trim(),
        });
        return;
      }
      resolve({ ok: true, stdout: String(stdout || "").trim() });
    });
  });
}

function anthropicMessageTemplate({ model, text, usage = {} }) {
  const usageAny = /** @type {any} */ (usage);
  return {
    model,
    id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: usageAny?.input_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: {
        ephemeral_5m_input_tokens: 0,
        ephemeral_1h_input_tokens: 0,
      },
      output_tokens: usageAny?.output_tokens ?? 0,
      service_tier: "standard",
      inference_geo: "global",
    },
  };
}

function writeAnthropicSse(res, model, text, usage = {}) {
  const message = anthropicMessageTemplate({
    model,
    text: "",
    usage: { ...usage, output_tokens: 1 },
  });

  const event = (name, data) => {
    res.write(`event: ${name}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  event("message_start", { type: "message_start", message });
  event("content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  event("ping", { type: "ping" });

  const size = 140;
  for (let i = 0; i < text.length; i += size) {
    const chunk = text.slice(i, i + size);
    event("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: chunk },
    });
  }

  event("content_block_stop", { type: "content_block_stop", index: 0 });
  event("message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null, stop_details: null },
    usage: {
      input_tokens: usage?.input_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: usage?.output_tokens ?? 0,
    },
  });
  event("message_stop", { type: "message_stop" });
  res.end();
}

async function callOpenAiResponses(body) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const model = OPENAI_CHAT_MODEL;
  const isGpt5 = model.startsWith("gpt-5");
  const input = Array.isArray(body?.messages)
    ? toOpenAiInput(body.messages)
    : body?.input;

  const payload = {
    model,
    instructions:
      `Always address the user as "${CLICKY_CALL_NAME}" in every reply. ` +
      `If the user asks to click, tap, open, press, select, or interact with something on screen, ` +
      `you must include a coordinate tag like [POINT:x,y:label]. ` +
      `Do not say you cannot interact with the screen. Give a best-effort point.`,
    input:
      input && input.length !== 0
        ? input
        : "Please respond briefly and helpfully.",
    temperature:
      typeof body?.temperature === "number" ? body.temperature : undefined,
    max_output_tokens: Number.isFinite(body?.max_tokens)
      ? body.max_tokens
      : undefined,
    reasoning: isGpt5 ? { effort: "minimal" } : undefined,
    text: isGpt5 ? { format: { type: "text" }, verbosity: "low" } : undefined,
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI chat failed (${response.status}): ${text}`);
  }

  const jsonPayload = JSON.parse(text);
  const rawText =
    extractTextFromOpenAiResponse(jsonPayload) ||
    "sorry, i could not generate a response right now.";
  return {
    text: ensureCallName(rawText, CLICKY_CALL_NAME),
    usage: jsonPayload?.usage || {},
  };
}

async function handleChat(req, res, bodyOverride) {
  const body = bodyOverride ?? (await readJsonBody(req));
  const targetModel =
    typeof body?.model === "string" ? body.model : "claude-sonnet-4-6";
  const wantsStream = body?.stream === true;
  const latestUserText = latestUserTextFromBody(body);
  console.log(`[${nowIso()}] /chat model=${targetModel} stream=${wantsStream}`);
  logTextLine("/chat user", latestUserText);

  try {
    const { text: modelText, usage } = await callOpenAiResponses(body);
    const hasClickIntent = shouldTriggerAutoClick(latestUserText);
    const text = normalizePointTag(modelText, {
      hasClickIntent,
      userText: latestUserText,
    });
    const normalizedPoint = parsePointTag(text);
    logTextLine("/chat assistant", text);
    console.log(
      `[${nowIso()}] point-tag final=${normalizedPoint ? `${normalizedPoint.x},${normalizedPoint.y}` : "none"} clickIntent=${hasClickIntent}`,
    );
    if (hasClickIntent && !normalizedPoint) {
      console.log(`[${nowIso()}] auto-click skipped: no POINT tag in response`);
    }
    if (CLICKY_ENABLE_AUTO_CLICK && normalizedPoint && hasClickIntent) {
      const clickResult = await clickAtCoordinates(normalizedPoint.x, normalizedPoint.y);
      if (clickResult.ok) {
        console.log(
          `[${nowIso()}] auto-click success x=${normalizedPoint.x} y=${normalizedPoint.y}`,
        );
      } else {
        console.error(
          `[${nowIso()}] auto-click failed x=${normalizedPoint.x} y=${normalizedPoint.y} ${clickResult.error} ${clickResult.stderr || ""}`.trim(),
        );
      }
    }

    if (wantsStream) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      writeAnthropicSse(res, targetModel, text, usage);
      console.log(
        `[${nowIso()}] /chat stream success tokens_in=${usage?.input_tokens ?? 0} tokens_out=${usage?.output_tokens ?? 0}`,
      );
      return;
    }

    json(
      res,
      200,
      anthropicMessageTemplate({ model: targetModel, text, usage }),
    );
    console.log(
      `[${nowIso()}] /chat success tokens_in=${usage?.input_tokens ?? 0} tokens_out=${usage?.output_tokens ?? 0}`,
    );
  } catch (error) {
    console.error(`[${nowIso()}] /chat error`, String(error?.message || error));
    const hasClickIntent = shouldTriggerAutoClick(latestUserText);
    const fallbackText = normalizePointTag(
      ensureCallName(
        "temporary backend issue. try that action again now.",
        CLICKY_CALL_NAME,
      ),
      { hasClickIntent, userText: latestUserText },
    );
    logTextLine("/chat assistant_fallback", fallbackText);
    if (wantsStream) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      writeAnthropicSse(res, targetModel, fallbackText, {});
      return;
    }
    json(res, 200, anthropicMessageTemplate({ model: targetModel, text: fallbackText, usage: {} }));
  }
}

async function handleTts(req, res, bodyOverride) {
  const body = bodyOverride ?? (await readJsonBody(req));
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  console.log(`[${nowIso()}] /tts chars=${text.length}`);
  logTextLine("/tts text", text);

  if (!text) {
    console.error(`[${nowIso()}] /tts fallback: missing text`);
    respondWithFallbackAudio(res, "missing_text");
    return;
  }

  if (!OPENAI_API_KEY) {
    console.error(`[${nowIso()}] /tts fallback: missing OPENAI_API_KEY`);
    respondWithFallbackAudio(res, "missing_openai_key");
    return;
  }

  try {
    const openAiResp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        authorization: `Bearer ${OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_TTS_MODEL,
        voice: OPENAI_TTS_VOICE,
        input: text,
        response_format: "mp3",
      }),
    });

    if (!openAiResp.ok) {
      const failure = await openAiResp.text();
      console.error(`[${nowIso()}] /tts upstream error ${openAiResp.status}`);
      console.error(`[${nowIso()}] /tts upstream body ${failure}`);
      respondWithFallbackAudio(res, `upstream_${openAiResp.status}`);
      return;
    }

    const audioBuffer = Buffer.from(await openAiResp.arrayBuffer());
    res.writeHead(200, { "content-type": "audio/mpeg" });
    res.end(audioBuffer);
    console.log(`[${nowIso()}] /tts success bytes=${audioBuffer.length}`);
  } catch (error) {
    console.error(`[${nowIso()}] /tts error`, String(error?.message || error));
    respondWithFallbackAudio(res, "exception");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "127.0.0.1"}`,
  );
  const method = req.method || "GET";
  const path = url.pathname;
  const contentType = String(req.headers["content-type"] || "");
  const contentLength = String(req.headers["content-length"] || "");

  console.log(
    `[${nowIso()}] request ${method} ${path} ct=${contentType || "-"} len=${contentLength || "-"}`,
  );

  if (method === "GET" && path === "/health") {
    json(res, 200, {
      ok: true,
      time: nowIso(),
      hasOpenAiKey: Boolean(OPENAI_API_KEY),
      chatModel: OPENAI_CHAT_MODEL,
      ttsModel: OPENAI_TTS_MODEL,
      ttsVoice: OPENAI_TTS_VOICE,
      callName: CLICKY_CALL_NAME,
      autoClickEnabled: CLICKY_ENABLE_AUTO_CLICK,
    });
    return;
  }

  if (
    method === "GET" &&
    (path === "/" ||
      path === "/status" ||
      path === "/healthz" ||
      path === "/credits" ||
      path === "/usage")
  ) {
    json(res, 200, {
      ok: true,
      status: "ready",
      hasCredits: true,
      creditsRemaining: 999999,
      unlimited: true,
      time: nowIso(),
    });
    return;
  }

  if (method === "GET" && (path === "/chat" || path === "/tts")) {
    json(res, 200, {
      ok: true,
      endpoint: path.slice(1),
      hasCredits: true,
      creditsRemaining: 999999,
      unlimited: true,
      time: nowIso(),
    });
    return;
  }

  if (method === "POST" && path === "/chat") {
    await handleChat(req, res);
    return;
  }

  if (method === "POST" && path === "/tts") {
    await handleTts(req, res);
    return;
  }

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === "HEAD") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Compatibility fallback: some app builds hit alternate endpoints.
  if (method === "POST") {
    const body = await readJsonBody(req);
    if (typeof body?.text === "string") {
      console.log(`[${nowIso()}] fallback -> /tts for ${path}`);
      await handleTts(req, res, body);
      return;
    }

    if (
      body?.model ||
      body?.messages ||
      body?.input ||
      body?.stream !== undefined
    ) {
      console.log(`[${nowIso()}] fallback -> /chat for ${path}`);
      await handleChat(req, res, body);
      return;
    }
  }

  json(res, 200, { ok: true, status: "noop", path, method });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[clicky-backend] listening on http://127.0.0.1:${PORT}`);
});
