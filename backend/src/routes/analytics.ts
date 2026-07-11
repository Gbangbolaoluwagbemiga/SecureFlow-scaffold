import { Router } from "express";
import { getSupabase } from "../lib/supabase.js";

const router = Router();

/**
 * GET /v1/analytics/platform
 * Platform-wide stats derived from Supabase tables.
 */
router.get("/platform", async (_req, res) => {
  const supabase = getSupabase();
  if (!supabase) {
    res.status(503).json({ error: "Database not configured" });
    return;
  }

  try {
    const [appRes, msgRes, notifRes] = await Promise.all([
      supabase
        .from("applications")
        .select("id", { count: "exact", head: true }),
      supabase.from("messages").select("id", { count: "exact", head: true }),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true }),
    ]);

    res.json({
      totalApplications: appRes.count ?? 0,
      totalMessages: msgRes.count ?? 0,
      totalNotifications: notifRes.count ?? 0,
    });
  } catch (error: any) {
    console.error("[analytics] platform error:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to fetch analytics" });
  }
});

/**
 * GET /v1/analytics/user/:address
 * Per-user stats: application and message counts.
 */
router.get("/user/:address", async (req, res) => {
  const supabase = getSupabase();
  if (!supabase) {
    res.json({
      address: req.params.address,
      totalApplications: 0,
      totalMessages: 0,
    });
    return;
  }

  const address = req.params.address;
  if (!address || address.length < 10) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  try {
    const [appRes, msgRes] = await Promise.all([
      supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("freelancer_address", address),
      supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("sender_address", address),
    ]);

    res.json({
      address,
      totalApplications: appRes.count ?? 0,
      totalMessages: msgRes.count ?? 0,
    });
  } catch (error: any) {
    console.error("[analytics] user error:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to fetch user analytics" });
  }
});

export { router as analyticsRouter };
