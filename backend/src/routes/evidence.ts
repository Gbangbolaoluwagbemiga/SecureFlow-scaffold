/**
 * Evidence Room route
 *
 * Accepts a file upload, pins it to IPFS via the Pinata API, then returns
 * the IPFS CID. The frontend is responsible for calling the on-chain
 * `submit_evidence(escrow_id, cid)` function so the CID is permanently
 * anchored in contract event logs.
 *
 * Required env vars:
 *   PINATA_JWT  – Pinata API JWT (Bearer token)
 */

import { Router } from "express";
import multer from "multer";

export const evidenceRouter = Router();

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
  "video/mp4",
  "video/webm",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed for evidence`));
    }
  },
});

/**
 * POST /v1/evidence/upload
 *
 * Body (multipart/form-data):
 *   file            – the evidence file
 *   escrow_id       – the escrow ID (used as Pinata group metadata)
 *   milestone_index – the milestone index (used as metadata)
 *   submitter       – the submitter's Stellar address (stored as metadata)
 *
 * Response:
 *   { cid: string, url: string, filename: string, size: number }
 */
evidenceRouter.post("/upload", upload.single("file"), async (req, res) => {
  const pinataJwt = process.env.PINATA_JWT?.trim();
  if (!pinataJwt) {
    res
      .status(503)
      .json({ error: "IPFS storage not configured (PINATA_JWT missing)" });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  const escrowId = String(req.body.escrow_id ?? "unknown");
  const milestoneIndex = String(req.body.milestone_index ?? "0");
  const submitter = String(req.body.submitter ?? "unknown");

  // Build multipart form for Pinata using native Node.js FormData (Node 22+)
  const form = new FormData();
  const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });
  form.append("file", blob, file.originalname);

  const metadata = JSON.stringify({
    name: `secureflow-evidence-${escrowId}-${milestoneIndex}-${Date.now()}`,
    keyvalues: {
      escrowId,
      milestoneIndex,
      submitter,
      uploadedAt: new Date().toISOString(),
    },
  });
  form.append("pinataMetadata", metadata);
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

  try {
    const pinataRes = await fetch(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${pinataJwt}` },
        body: form,
      },
    );

    if (!pinataRes.ok) {
      const errBody = await pinataRes.text();
      console.error("[evidence] Pinata error:", errBody);
      res
        .status(502)
        .json({ error: "Failed to pin file to IPFS", detail: errBody });
      return;
    }

    const pinataData = (await pinataRes.json()) as {
      IpfsHash: string;
      PinSize: number;
    };
    const cid = pinataData.IpfsHash;

    res.status(201).json({
      cid,
      url: `https://cloudflare-ipfs.com/ipfs/${cid}`,
      filename: file.originalname,
      size: file.size,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "IPFS upload failed";
    console.error("[evidence]", msg);
    res.status(500).json({ error: msg });
  }
});
