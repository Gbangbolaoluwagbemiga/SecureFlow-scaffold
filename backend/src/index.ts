import "dotenv/config";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { requireApiSecret } from "./middleware/auth.js";
import { aiRouter } from "./routes/ai.js";
import { notificationsRouter } from "./routes/notifications.js";
import { uploadRouter } from "./routes/upload.js";
import { messagesRouter } from "./routes/messages.js";
import { gaslessRouter } from "./routes/gasless.js";
import { evidenceRouter } from "./routes/evidence.js";
import { analyticsRouter } from "./routes/analytics.js";
import { applicationsRouter } from "./routes/applications.js";
import { getSupabase } from "./lib/supabase.js";
import { autopilotRouter } from "./routes/autopilot.js";
import { archiveRouter } from "./routes/archive.js";
import { startAutopilot } from "./lib/autopilot/runner.js";
import {
  diditWebhookRouter,
  verificationRouter,
} from "./routes/verification.js";

const app = express();
const port = Number(process.env.PORT) || 8787;
const apiSecret = process.env.API_SECRET;

// Build a CORS origin matcher that supports:
//  - FRONTEND_URL: comma-separated list of exact origins
//  - FRONTEND_URL_PATTERN: a regex string to allow preview deployments
//  - If neither is set, allow all origins (open for local dev).
const rawOrigins = (process.env.FRONTEND_URL ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const rawPattern = process.env.FRONTEND_URL_PATTERN?.trim();

function buildOriginMatcher(): cors.CorsOptions["origin"] {
  const exactSet = new Set(rawOrigins);
  const pattern = rawPattern ? new RegExp(rawPattern) : null;

  if (exactSet.size === 0 && !pattern) {
    return true;
  }

  return (origin, callback) => {
    if (!origin) return callback(null, true);
    if (exactSet.has(origin)) return callback(null, true);
    if (pattern && pattern.test(origin)) return callback(null, true);
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  };
}

app.use(
  cors({
    origin: buildOriginMatcher(),
    credentials: true,
  }),
);
app.use(
  express.json({
    limit: "10mb",
    // Keep the exact bytes for webhook signatures computed over the raw body.
    verify: (req, _res, buf) => {
      (req as typeof req & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

// General rate limiter — 60 requests per minute per IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});

// Strict limiter for expensive AI endpoints — 20 requests per 15 min per IP
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "AI rate limit reached. Please try again in 15 minutes." },
});

app.use(generalLimiter);

// Reports whether Supabase actually answers, not just whether its env vars are
// set: a paused or deleted project used to show `supabase: true` here while
// every notification, message and application request failed.
app.get("/health", async (_req, res) => {
  const supabase = getSupabase();
  let supabaseStatus: "ok" | "unconfigured" | "unreachable" = "unconfigured";
  if (supabase) {
    try {
      const { error } = await supabase
        .from("notifications")
        .select("id", { head: true, count: "exact" })
        .limit(1)
        .abortSignal(AbortSignal.timeout(5000));
      supabaseStatus = error ? "unreachable" : "ok";
    } catch {
      supabaseStatus = "unreachable";
    }
  }
  res.status(supabaseStatus === "unreachable" ? 503 : 200).json({
    ok: supabaseStatus !== "unreachable",
    groq: !!process.env.GROQ_API_KEY,
    supabase: supabaseStatus,
  });
});

const auth = requireApiSecret(apiSecret);

app.use("/v1/ai", aiLimiter, auth, aiRouter);
app.use("/v1/notifications", auth, notificationsRouter);
app.use("/v1/upload", auth, uploadRouter);
app.use("/v1/messages", auth, messagesRouter);
app.use("/v1/gasless", auth, gaslessRouter);
app.use("/v1/evidence", auth, evidenceRouter);
app.use("/v1/analytics", auth, analyticsRouter);
app.use("/v1/applications", auth, applicationsRouter);
app.use("/v1/verification", auth, verificationRouter);
// Writing criteria is an LLM call, so previews share the AI limiter.
app.use("/v1/autopilot/preview", aiLimiter);
app.use("/v1/autopilot", auth, autopilotRouter);
app.use("/v1/archive", auth, archiveRouter);
// Called by Didit, not the browser: authenticated by Didit's HMAC signature,
// so it sits outside the API-secret check.
app.use("/webhooks/didit", diditWebhookRouter);

app.listen(port, () => {
  console.log(`secureflow-api listening on :${port}`);
  startAutopilot();
  if (!apiSecret) {
    console.warn(
      "[secureflow-api] API_SECRET is unset; /v1 routes are open (set API_SECRET for production)",
    );
  }
});
