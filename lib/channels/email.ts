import { connect as tlsConnect } from "node:tls";
import { Socket } from "node:net";
import { readEnv } from "./config";
import { RESEND_API, parseEmailInbound, sameEmail } from "./parse";
import { clipOutboundText } from "./safety";

export { RESEND_API, parseEmailInbound, sameEmail } from "./parse";

export function emailFrom(env: NodeJS.ProcessEnv = process.env) {
  return readEnv("EMAIL_FROM", env);
}

export function emailTo(env: NodeJS.ProcessEnv = process.env) {
  return readEnv("EMAIL_TO", env);
}

export function isIanEmail(from: string, env: NodeJS.ProcessEnv = process.env) {
  return sameEmail(from, emailTo(env));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function smtpConfig(env: NodeJS.ProcessEnv = process.env) {
  const host = readEnv("SMTP_HOST", env);
  const user = readEnv("SMTP_USER", env);
  const pass = readEnv("SMTP_PASS", env);
  if (!host || !user || !pass) return null;
  const port = Number(readEnv("SMTP_PORT", env) || "587");
  return { host, user, pass, port: Number.isFinite(port) ? port : 587 };
}

export function isOutboundEmailConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(emailFrom(env) && (readEnv("RESEND_API_KEY", env) || smtpConfig(env)));
}

function headerSafe(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

async function sendViaResend(
  to: string,
  subject: string,
  text: string,
  env: NodeJS.ProcessEnv,
) {
  const key = readEnv("RESEND_API_KEY", env);
  const from = emailFrom(env);
  if (!key || !from || !to) return { ok: false as const, status: 503, error: "Email is not configured." };
  const content = clipOutboundText(text, 8000);
  if (!content) return { ok: false as const, status: 400, error: "Message is empty." };

  const response = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text: content,
    }),
  });
  let data: unknown = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    const message =
      typeof asRecord(data)?.message === "string" ? (asRecord(data)?.message as string) : "Resend send failed.";
    return { ok: false as const, status: response.status >= 400 ? response.status : 502, error: message };
  }
  return { ok: true as const, status: 200, platform: "email" as const, via: "resend" as const };
}

function smtpWrite(socket: Socket, line: string) {
  socket.write(`${line}\r\n`);
}

function readSmtp(socket: Socket) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf8");
      if (/\r\n$/.test(text) && /^\d{3}[\s-]/.test(text.split("\r\n").filter(Boolean).at(-1) ?? "")) {
        socket.off("data", onData);
        socket.off("error", onError);
        resolve(text);
      }
    };
    const onError = (error: Error) => {
      socket.off("data", onData);
      socket.off("error", onError);
      reject(error);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function expectCode(socket: Socket, prefix: string) {
  const reply = await readSmtp(socket);
  if (!reply.startsWith(prefix)) {
    throw new Error(reply.trim() || `SMTP expected ${prefix}`);
  }
  return reply;
}

async function sendViaSmtp(to: string, subject: string, text: string, env: NodeJS.ProcessEnv) {
  const smtp = smtpConfig(env);
  const from = emailFrom(env);
  if (!smtp || !from || !to) {
    return { ok: false as const, status: 503, error: "Email is not configured." };
  }
  const content = clipOutboundText(text, 8000);
  if (!content) return { ok: false as const, status: 400, error: "Message is empty." };

  const implicitTls = smtp.port === 465;
  const socket: Socket = implicitTls
    ? tlsConnect({ host: smtp.host, port: smtp.port, servername: smtp.host })
    : new Socket();

  try {
    if (!implicitTls) {
      await new Promise<void>((resolve, reject) => {
        socket.once("error", reject);
        socket.connect(smtp.port, smtp.host, resolve);
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        socket.once("error", reject);
        socket.once("secureConnect", resolve);
      });
    }
    await expectCode(socket, "220");
    smtpWrite(socket, `EHLO lexi`);
    await expectCode(socket, "250");

    let secure = socket as Socket;
    if (!implicitTls) {
      smtpWrite(socket, "STARTTLS");
      await expectCode(socket, "220");
      secure = tlsConnect({ socket, servername: smtp.host });
      await new Promise<void>((resolve, reject) => {
        secure.once("error", reject);
        secure.once("secureConnect", resolve);
      });
      smtpWrite(secure, `EHLO lexi`);
      await expectCode(secure, "250");
    }

    smtpWrite(secure, "AUTH LOGIN");
    await expectCode(secure, "334");
    smtpWrite(secure, Buffer.from(smtp.user).toString("base64"));
    await expectCode(secure, "334");
    smtpWrite(secure, Buffer.from(smtp.pass).toString("base64"));
    await expectCode(secure, "235");
    smtpWrite(secure, `MAIL FROM:<${from}>`);
    await expectCode(secure, "250");
    smtpWrite(secure, `RCPT TO:<${to}>`);
    await expectCode(secure, "250");
    smtpWrite(secure, "DATA");
    await expectCode(secure, "354");
    smtpWrite(secure, `From: ${headerSafe(from)}`);
    smtpWrite(secure, `To: ${headerSafe(to)}`);
    smtpWrite(secure, `Subject: ${headerSafe(subject)}`);
    smtpWrite(secure, "Content-Type: text/plain; charset=utf-8");
    smtpWrite(secure, "");
    smtpWrite(secure, content.replaceAll("\r\n.", "\r\n.."));
    smtpWrite(secure, ".");
    await expectCode(secure, "250");
    smtpWrite(secure, "QUIT");
    secure.end();
    socket.end();
    return { ok: true as const, status: 200, platform: "email" as const, via: "smtp" as const };
  } catch (error) {
    socket.destroy();
    return {
      ok: false as const,
      status: 502,
      error: error instanceof Error ? error.message : "SMTP send failed.",
    };
  }
}

export async function sendOutboundEmail(
  options: { to: string; subject: string; text: string },
  env: NodeJS.ProcessEnv = process.env,
) {
  const to = headerSafe(options.to);
  const subject = headerSafe(options.subject) || "Lexi";
  if (readEnv("RESEND_API_KEY", env)) return sendViaResend(to, subject, options.text, env);
  if (smtpConfig(env)) return sendViaSmtp(to, subject, options.text, env);
  return { ok: false as const, status: 503, error: "Email is not configured." };
}

export async function sendEmail(text: string, env: NodeJS.ProcessEnv = process.env) {
  return sendOutboundEmail({ to: emailTo(env), subject: "Lexi", text }, env);
}
