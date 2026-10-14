
import { Router } from "express";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { Resend } from "resend";
import {
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdirSync } from "node:fs";

const router = Router();

const frontendUrl =
  process.env.FRONTEND_URL ?? "http://localhost:5173";

const apiUrl =
  process.env.API_URL ?? "http://localhost:3000";

const resend = new Resend(process.env.RESEND_API_KEY);

mkdirSync("data", { recursive: true });

const db = new Database("data/chatapp.sqlite");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS verification_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);

const SESSION_COOKIE = "chatapp_session";
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;
const VERIFICATION_DURATION = 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createToken() {
  return randomBytes(32).toString("hex");
}

function getCookie(
  cookieHeader: string | undefined,
  name: string
) {
  if (!cookieHeader) return undefined;

  const prefix = `${name}=`;

  for (const part of cookieHeader.split(";")) {
    const cookie = part.trim();

    if (cookie.startsWith(prefix)) {
      return cookie.slice(prefix.length);
    }
  }

  return undefined;
}

function setSessionCookie(
  res: import("express").Response,
  token: string
) {
  const secure = process.env.NODE_ENV === "production";

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION,
  });
}

function clearSessionCookie(
  res: import("express").Response
) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

function getCurrentUser(req: import("express").Request) {
  const token = getCookie(
    req.headers.cookie,
    SESSION_COOKIE
  );

  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return null;
  }

  const session = db.prepare(`
    SELECT users.id, users.email, users.verified,
           sessions.token_hash
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > ?
  `).get(hashToken(token), Date.now()) as
    | {
        id: number;
        email: string;
        verified: number;
        token_hash: string;
      }
    | undefined;

  if (!session || session.verified !== 1) {
    return null;
  }

  return {
    id: session.id,
    email: session.email,
  };
}

router.post("/register", async (req, res) => {
  try {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password =
      typeof req.body?.password === "string"
        ? req.body.password
        : "";

    const confirmPassword =
      typeof req.body?.confirmPassword === "string"
        ? req.body.confirmPassword
        : "";

    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      res.status(400).json({
        error: "Please enter a valid email address.",
      });
      return;
    }

    if (password.length < 8 || password.length > 72) {
      res.status(400).json({
        error: "Password must be between 8 and 72 characters.",
      });
      return;
    }

    if (password !== confirmPassword) {
      res.status(400).json({
        error: "Passwords do not match.",
      });
      return;
    }

    const existingUser = db.prepare(
      "SELECT id FROM users WHERE email = ?"
    ).get(email);

    if (existingUser) {
      res.status(409).json({
        error:
          "An account with this email already exists. Try logging in.",
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = db.prepare(`
      INSERT INTO users (
        email, password_hash, verified, created_at
      )
      VALUES (?, ?, 0, ?)
    `).run(email, passwordHash, Date.now());

    const userId = Number(result.lastInsertRowid);
    const verificationToken = createToken();
    const tokenHash = hashToken(verificationToken);

    db.prepare(`
      INSERT INTO verification_tokens (
        token_hash, user_id, expires_at
      )
      VALUES (?, ?, ?)
    `).run(
      tokenHash,
      userId,
      Date.now() + VERIFICATION_DURATION
    );

    const verificationUrl = new URL(
      "/api/auth/verify",
      apiUrl
    );

    verificationUrl.searchParams.set(
      "token",
      verificationToken
    );

    const { error } = await resend.emails.send({
      from:
        process.env.EMAIL_FROM ??
        "ChatApp <onboarding@resend.dev>",
      to: email,
      subject: "Verify your ChatApp email",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
          <h1>Welcome to ChatApp!</h1>
          <p>Please confirm that this email address belongs to you.</p>
          <p>
            <a href="${verificationUrl.toString()}"
               style="display:inline-block;padding:12px 20px;background:#5145cd;color:white;text-decoration:none;border-radius:8px">
              Verify my email
            </a>
          </p>
          <p>This link expires in 24 hours and can only be used once.</p>
          <p>If you did not create a ChatApp account, you can ignore this email.</p>
        </div>
      `,
    });

    if (error) {
      db.prepare(
        "DELETE FROM users WHERE id = ?"
      ).run(userId);

      res.status(502).json({
        error:
          "We couldn't send the verification email. Check the Resend configuration and try again.",
      });
      return;
    }

    res.status(201).json({
      message:
        "Account created. Check your inbox for the verification link.",
    });
  } catch (error) {
    console.error("Registration error:", error);

    res.status(500).json({
      error: "Registration failed. Please try again.",
    });
  }
});

router.get("/verify", (req, res) => {
  const token =
    typeof req.query.token === "string"
      ? req.query.token
      : "";

  if (!/^[a-f0-9]{64}$/.test(token)) {
    res.status(400).send(`
      <h1>Invalid verification link</h1>
      <p>Please register again or request a new verification email.</p>
    `);
    return;
  }

  const tokenHash = hashToken(token);

  const record = db.prepare(`
    SELECT user_id
    FROM verification_tokens
    WHERE token_hash = ? AND expires_at > ?
  `).get(tokenHash, Date.now()) as
    | { user_id: number }
    | undefined;

  if (!record) {
    res.status(400).send(`
      <h1>Link expired or already used</h1>
      <p>This verification link is invalid, expired, or has already been used.</p>
      <a href="${frontendUrl}">Return to ChatApp</a>
    `);
    return;
  }

  const verifyUser = db.transaction(() => {
    db.prepare(`
      UPDATE users SET verified = 1 WHERE id = ?
    `).run(record.user_id);

    db.prepare(`
      DELETE FROM verification_tokens WHERE token_hash = ?
    `).run(tokenHash);
  });

  verifyUser();

  res.send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Email verified - ChatApp</title>
      </head>
      <body style="font-family:Arial,sans-serif;max-width:560px;margin:80px auto;padding:24px;text-align:center">
        <h1>Email verified!</h1>
        <p>Your ChatApp email address has been confirmed.</p>
        <p>You can now log in with your email and password.</p>
        <a href="${frontendUrl}" style="display:inline-block;padding:12px 20px;background:#5145cd;color:white;text-decoration:none;border-radius:8px">Return to ChatApp</a>
      </body>
    </html>
  `);
});

router.post("/login", async (req, res) => {
  try {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password =
      typeof req.body?.password === "string"
        ? req.body.password
        : "";

    const user = db.prepare(`
      SELECT id, email, password_hash, verified
      FROM users
      WHERE email = ?
    `).get(email) as
      | {
          id: number;
          email: string;
          password_hash: string;
          verified: number;
        }
      | undefined;

    if (
      !user ||
      !(await bcrypt.compare(password, user.password_hash))
    ) {
      res.status(401).json({
        error: "Invalid email or password.",
      });
      return;
    }

    if (user.verified !== 1) {
      res.status(403).json({
        error:
          "Please verify your email using the link we sent before logging in.",
      });
      return;
    }

    const sessionToken = createToken();
    const sessionHash = hashToken(sessionToken);
    const expiresAt = Date.now() + SESSION_DURATION;

    db.prepare(`
      INSERT INTO sessions (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
    `).run(sessionHash, user.id, expiresAt);

    setSessionCookie(res, sessionToken);

    res.json({
      user: {
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      error: "Login failed. Please try again.",
    });
  }
});

router.get("/me", (req, res) => {
  const user = getCurrentUser(req);

  if (!user) {
    res.status(401).json({
      error: "Not logged in.",
    });
    return;
  }

  res.json({ user: { email: user.email } });
});

router.post("/logout", (req, res) => {
  const token = getCookie(
    req.headers.cookie,
    SESSION_COOKIE
  );

  if (token && /^[a-f0-9]{64}$/.test(token)) {
    db.prepare(
      "DELETE FROM sessions WHERE token_hash = ?"
    ).run(hashToken(token));
  }

  clearSessionCookie(res);

  res.json({ message: "Logged out." });
});

export default router;
