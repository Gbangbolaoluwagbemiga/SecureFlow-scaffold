import { Router } from "express";
import { getSupabase } from "../lib/supabase.js";

export const applicationsRouter = Router();

// Store application data when a freelancer applies to an open job
applicationsRouter.post("/", async (req, res) => {
  const supabase = getSupabase();
  if (!supabase) {
    res.status(503).json({ error: "Database not configured" });
    return;
  }

  const { escrow_id, freelancer_address, cover_letter, proposed_timeline } =
    req.body ?? {};

  if (!escrow_id || !freelancer_address) {
    res
      .status(400)
      .json({ error: "escrow_id and freelancer_address are required" });
    return;
  }

  try {
    const { data, error } = await supabase
      .from("applications")
      .upsert(
        {
          escrow_id: Number(escrow_id),
          freelancer_address: String(freelancer_address),
          cover_letter: cover_letter || "",
          proposed_timeline: Number(proposed_timeline) || 0,
          applied_at: new Date().toISOString(),
        },
        { onConflict: "escrow_id,freelancer_address" },
      )
      .select("id")
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json({ id: data.id, success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get all applications for an escrow
applicationsRouter.get("/:escrowId", async (req, res) => {
  const supabase = getSupabase();
  if (!supabase) {
    res.json({ applications: [] });
    return;
  }

  const escrowId = Number(req.params.escrowId);
  if (isNaN(escrowId)) {
    res.status(400).json({ error: "Invalid escrow ID" });
    return;
  }

  try {
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .eq("escrow_id", escrowId)
      .order("applied_at", { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ applications: data || [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
