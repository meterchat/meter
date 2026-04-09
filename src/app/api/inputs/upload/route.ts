import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import pdfParse from "pdf-parse";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** Extensions we treat as text (content extracted and stored in DB). */
const TEXT_EXTENSIONS = new Set([
  "md", "txt", "json", "yaml", "yml", "csv", "html", "css", "xml",
  "js", "jsx", "ts", "tsx", "py", "go", "rs", "toml", "env", "sh",
  "sql", "graphql", "gql", "svelte", "vue", "rb", "java", "kt",
  "swift", "c", "cpp", "h", "hpp", "cs", "php", "lua", "r",
]);

/** Binary types we accept (stored in Supabase Storage only). */
const BINARY_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf",
]);

function isTextFile(fileName: string, mimeType: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (mimeType.startsWith("text/")) return true;
  if (mimeType === "application/json") return true;
  return false;
}

function isAllowed(fileName: string, mimeType: string): boolean {
  if (isTextFile(fileName, mimeType)) return true;
  if (BINARY_TYPES.has(mimeType)) return true;
  return false;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const sessionId = formData.get("sessionId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max: 10MB.` },
        { status: 400 },
      );
    }
    if (!isAllowed(file.name, file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.name}` },
        { status: 400 },
      );
    }

    const supabase = getSupabaseServer();
    const ext = file.name.split(".").pop() || "bin";
    const storagePath = `${userId}/inputs/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    // Upload to Supabase Storage
    const { error: uploadErr } = await supabase.storage
      .from("attachments")
      .upload(storagePath, buffer, { contentType: file.type, upsert: false });

    if (uploadErr) {
      console.error("[inputs/upload] Storage error:", uploadErr.message);
      return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
    }

    const { data: urlData } = supabase.storage
      .from("attachments")
      .getPublicUrl(storagePath);

    // Extract text content for text-based files and PDFs
    let contentText: string | null = null;
    if (isTextFile(file.name, file.type)) {
      try {
        contentText = buffer.toString("utf-8");
      } catch {
        // Not valid UTF-8 — treat as binary
      }
    } else if (file.type === "application/pdf") {
      try {
        const pdf = await pdfParse(buffer);
        if (pdf.text?.trim()) {
          contentText = pdf.text.trim();
        }
      } catch (err) {
        console.warn("[inputs/upload] PDF text extraction failed:", err);
      }
    }

    const inputId = `inp_${crypto.randomBytes(8).toString("hex")}`;
    const dbSessionId = sessionId.startsWith(`${userId}:`) ? sessionId : `${userId}:${sessionId}`;

    const { error: dbErr } = await supabase.from("workspace_inputs").insert({
      id: inputId,
      user_id: userId,
      session_id: dbSessionId,
      file_name: file.name,
      file_path: storagePath,
      public_url: urlData.publicUrl,
      mime_type: file.type,
      file_size: file.size,
      content_text: contentText,
    });

    if (dbErr) {
      console.error("[inputs/upload] DB error:", dbErr.message);
      return NextResponse.json({ error: "Failed to save input metadata" }, { status: 500 });
    }

    return NextResponse.json({
      id: inputId,
      fileName: file.name,
      filePath: storagePath,
      publicUrl: urlData.publicUrl,
      mimeType: file.type,
      fileSize: file.size,
      contentText,
      sessionId,
      createdAt: Date.now(),
    });
  } catch (err) {
    console.error("[inputs/upload] Error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
