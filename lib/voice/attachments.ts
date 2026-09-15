import { PHOTO_MAX_EDGE } from "@/lib/voice/vision";

const PHOTO_JPEG_QUALITY = 0.72;

let photoCanvas: HTMLCanvasElement | null = null;
let photoCtx: CanvasRenderingContext2D | null = null;

function jpegFromSource(image: CanvasImageSource, sourceWidth: number, sourceHeight: number) {
  if (!sourceWidth || !sourceHeight) return null;
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  if (!photoCanvas) photoCanvas = document.createElement("canvas");
  if (!photoCtx) {
    photoCtx = photoCanvas.getContext("2d", { alpha: false });
  }
  if (!photoCtx) return null;
  photoCanvas.width = width;
  photoCanvas.height = height;
  photoCtx.drawImage(image, 0, 0, width, height);
  return photoCanvas.toDataURL("image/jpeg", PHOTO_JPEG_QUALITY);
}

export const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
export const ATTACHMENT_TEXT_MAX_CHARS = 24_000;
export const ATTACHMENT_ACCEPT = "image/*,.pdf,.txt,.md,.json";

export type ReadyAttachment =
  | { kind: "image"; name: string; dataUrl: string }
  | { kind: "text"; name: string; text: string };

export type ProcessAttachmentResult =
  | { ok: true; attachment: ReadyAttachment }
  | { ok: false; message: string };

const TEXT_EXT = /\.(txt|md|markdown|json|csv)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif|svg)$/i;

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || IMAGE_EXT.test(file.name);
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isTextFile(file: File) {
  return (
    file.type.startsWith("text/") ||
    file.type === "application/json" ||
    TEXT_EXT.test(file.name)
  );
}

function truncateText(text: string) {
  const trimmed = text.replace(/^\uFEFF/, "");
  if (trimmed.length <= ATTACHMENT_TEXT_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, ATTACHMENT_TEXT_MAX_CHARS)}\n\n[truncated]`;
}

function fileNote(file: File, extra = "") {
  const type = file.type || "unknown type";
  const suffix = extra ? ` ${extra}` : "";
  return `FILE ${file.name} (${type}, ${formatFileSize(file.size)}): attached.${suffix}`;
}

function extractPdfTextIfTrivial(buffer: ArrayBuffer) {
  const raw = new TextDecoder("latin1").decode(buffer);
  if (!raw.includes("%PDF")) return null;
  const chunks: string[] = [];
  const pattern = /\((?:\\.|[^\\)])+\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw))) {
    const close = match[0].lastIndexOf(")");
    const inner = match[0].slice(1, close);
    const text = inner
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, "\t")
      .replace(/\\(.)/g, "$1")
      .trim();
    if (text && /[A-Za-z]{3,}/.test(text)) chunks.push(text);
    if (chunks.join(" ").length >= ATTACHMENT_TEXT_MAX_CHARS) break;
  }
  const joined = chunks.join(" ").replace(/\s+/g, " ").trim();
  return joined.length >= 40 ? truncateText(joined) : null;
}

async function jpegFromFile(file: File) {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const dataUrl = jpegFromSource(bitmap, bitmap.width, bitmap.height);
      if (dataUrl) return dataUrl;
    } finally {
      bitmap.close();
    }
  } catch {
    // Fall through to HTMLImageElement for formats createImageBitmap rejects.
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image."));
      el.src = objectUrl;
    });
    const dataUrl = jpegFromSource(
      image,
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
    );
    if (!dataUrl) throw new Error("Could not encode photo.");
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function processAttachment(file: File): Promise<ProcessAttachmentResult> {
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return {
      ok: false,
      message: `${file.name} is ${formatFileSize(file.size)}. Max size is 4 MB.`,
    };
  }

  if (isImageFile(file)) {
    try {
      const dataUrl = await jpegFromFile(file);
      return { ok: true, attachment: { kind: "image", name: file.name, dataUrl } };
    } catch {
      return { ok: false, message: `Could not read photo ${file.name}.` };
    }
  }

  if (isTextFile(file)) {
    const text = truncateText(await file.text());
    return {
      ok: true,
      attachment: { kind: "text", name: file.name, text: `FILE ${file.name}:\n${text}` },
    };
  }

  if (isPdfFile(file)) {
    const buffer = await file.arrayBuffer();
    const extracted = extractPdfTextIfTrivial(buffer);
    if (extracted) {
      return {
        ok: true,
        attachment: {
          kind: "text",
          name: file.name,
          text: `FILE ${file.name} (extracted text):\n${extracted}`,
        },
      };
    }
    return {
      ok: true,
      attachment: {
        kind: "text",
        name: file.name,
        text: fileNote(file, "Binary contents were not sent."),
      },
    };
  }

  return {
    ok: true,
    attachment: {
      kind: "text",
      name: file.name,
      text: fileNote(file, "Binary contents were not sent."),
    },
  };
}
