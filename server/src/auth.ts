import "dotenv/config";
import { Router } from "express";
import type { Request, Response } from "express";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
 
const router = Router();
 
const frontendUrl =
  process.env.FRONTEND_URL ?? "http://localhost:5173";
 
const apiUrl =
  process.env.API_URL ?? "http://localhost:3000";

// Free email sending through a Gmail account (app password required).
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, ""),
  },
});
 
mkdirSync("data", { recursive: true });
 
const db = new Database("data/chatapp.sqlite");
 
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
 
// Create tables. The username column is also migrated below
// for databases that were created before usernames existed.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    username TEXT
  );
 
  CREATE TABLE IF NOT EXISTS verification_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
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
 
// Migration for existing databases.
const columns = db.prepare("PRAGMA table_info(users)").all() as {
  name: string;
}[];
 
if (!columns.some((column) => column.name === "username")) {
  db.exec("ALTER TABLE users ADD COLUMN username TEXT");
}
 
// Give existing accounts a username without deleting their data.
const existingUsers = db.prepare(`
  SELECT id FROM users
  WHERE username IS NULL OR TRIM(username) = ''
`).all() as { id: number }[];
 
const updateExistingUsername = db.prepare(`
  UPDATE users SET username = ? WHERE id = ?
`);
 
const migrateUsernames = db.transaction(() => {
  for (const user of existingUsers) {
    updateExistingUsername.run(`user_${user.id}`, user.id);
  }
});
 
migrateUsernames();
 
// Usernames are unique regardless of capitalization.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique
  ON users(username COLLATE NOCASE);
`);
 
const SESSION_COOKIE = "orbit_session";
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;
const VERIFICATION_DURATION = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_DURATION = 60 * 60 * 1000;
 
type CurrentUser = {
  id: number;
  email: string;
  username: string;
};
 
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
 
function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION,
  });
}
 
function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}
 
function getCurrentUser(req: Request): CurrentUser | null {
  const token = getCookie(req.headers.cookie, SESSION_COOKIE);
 
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return null;
  }
 
  const session = db.prepare(`
    SELECT
      users.id,
      users.email,
      users.username,
      users.verified
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > ?
  `).get(hashToken(token), Date.now()) as
    | {
        id: number;
        email: string;
        username: string;
        verified: number;
      }
    | undefined;
 
  if (!session || session.verified !== 1) {
    return null;
  }
 
  return {
    id: session.id,
    email: session.email,
    username: session.username,
  };
}
 
function isValidUsername(username: string) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}
 
// Escape user-provided text before inserting it into HTML.
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
 
    return replacements[character] ?? character;
  });
}
 
// REGISTER
router.post("/register", async (req, res) => {
  let userId: number | undefined;
 
  try {
    const username =
      typeof req.body?.username === "string"
        ? req.body.username.trim()
        : "";
 
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
 
    if (!isValidUsername(username)) {
      res.status(400).json({
        error:
          "Username must be 3–20 characters and contain only letters, numbers, and underscores.",
      });
      return;
    }
 
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
 
    const existingEmail = db.prepare(
      "SELECT id FROM users WHERE email = ?"
    ).get(email);
 
    if (existingEmail) {
      res.status(409).json({
        error:
          "An account with this email already exists. Try logging in.",
      });
      return;
    }
 
    const existingUsername = db.prepare(
      "SELECT id FROM users WHERE username = ? COLLATE NOCASE"
    ).get(username);
 
    if (existingUsername) {
      res.status(409).json({
        error: "That username is already taken. Please choose another.",
      });
      return;
    }
 
    const passwordHash = await bcrypt.hash(password, 12);
 
    const result = db.prepare(`
      INSERT INTO users (
        username, email, password_hash, verified, created_at
      )
      VALUES (?, ?, ?, 0, ?)
    `).run(username, email, passwordHash, Date.now());
 
    userId = Number(result.lastInsertRowid);
 
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
 
    const verificationUrl = new URL("/api/auth/verify", apiUrl);
    verificationUrl.searchParams.set("token", verificationToken);
 
    let sendFailed = false;
 
    try {
      await transporter.sendMail({
        from: `Orbit <${process.env.GMAIL_USER}>`,
        to: email,
        subject: "Verify your Orbit email",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
            <h1>Welcome to Orbit, ${escapeHtml(username)}!</h1>
            <p>Please confirm that this email address belongs to you.</p>
            <p>
              <a href="${verificationUrl.toString()}"
                 style="display:inline-block;padding:12px 20px;background:#5145cd;color:white;text-decoration:none;border-radius:8px">
                Verify my email
              </a>
            </p>
            <p>This link expires in 24 hours and can only be used once.</p>
            <p>If you did not create an Orbit account, you can ignore this email.</p>
          </div>
        `,
      });
    } catch (emailError) {
      console.error("Email error:", emailError);
      sendFailed = true;
    }
 
    if (sendFailed) {
      db.prepare("DELETE FROM users WHERE id = ?").run(userId);
 
      res.status(502).json({
        error:
          "We couldn't send the verification email. Please try again.",
      });
      return;
    }
 
    res.status(201).json({
      message:
        "Account created. Check your inbox for the verification link.",
    });
  } catch (error) {
    console.error("Registration error:", error);
 
    // Clean up an incomplete registration if an error occurs.
    if (userId !== undefined) {
      db.prepare("DELETE FROM users WHERE id = ? AND verified = 0")
        .run(userId);
    }
 
    if (
      error instanceof Error &&
      error.message.includes("users.username")
    ) {
      res.status(409).json({
        error: "That username is already taken. Please choose another.",
      });
      return;
    }
 
    res.status(500).json({
      error: "Registration failed. Please try again.",
    });
  }
});
 
// VERIFY EMAIL
router.get("/verify", (req, res) => {
  const token =
    typeof req.query.token === "string" ? req.query.token : "";
 
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
      <a href="${frontendUrl}">Return to Orbit</a>
    `);
    return;
  }
 
  const verifyUser = db.transaction(() => {
    db.prepare("UPDATE users SET verified = 1 WHERE id = ?")
      .run(record.user_id);
 
    db.prepare("DELETE FROM verification_tokens WHERE token_hash = ?")
      .run(tokenHash);
  });
 
  verifyUser();
 
  res.send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Email verified - Orbit</title>
      </head>
      <body style="font-family:Arial,sans-serif;max-width:560px;margin:80px auto;padding:24px;text-align:center">
        <h1>Email verified!</h1>
        <p>Your Orbit email address has been confirmed.</p>
        <p>You can now log in with your email and password.</p>
        <a href="${frontendUrl}" style="display:inline-block;padding:12px 20px;background:#5145cd;color:white;text-decoration:none;border-radius:8px">Return to Orbit</a>
      </body>
    </html>
  `);
});

// REQUEST PASSWORD RESET
router.post("/forgot-password", async (req, res) => {
  const email =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";

  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Please enter a valid email address." });
    return;
  }

  const user = db.prepare(`
    SELECT id, username
    FROM users
    WHERE email = ? AND verified = 1
  `).get(email) as { id: number; username: string } | undefined;

  if (!user) {
    res.json({
      message: "If a verified account exists for that email, a reset link will be sent.",
    });
    return;
  }

  const resetToken = createToken();
  const tokenHash = hashToken(resetToken);
  const expiresAt = Date.now() + PASSWORD_RESET_DURATION;

  const storeToken = db.transaction(() => {
    db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?")
      .run(user.id);
    db.prepare(`
      INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
    `).run(tokenHash, user.id, expiresAt);
  });
  storeToken();

  try {
    const resetUrl = new URL("/", frontendUrl);
    resetUrl.searchParams.set("resetToken", resetToken);

    await transporter.sendMail({
      from: `Orbit <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Reset your Orbit password",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
          <h1>Reset your Orbit password</h1>
          <p>Hi ${escapeHtml(user.username)},</p>
          <p>Use the link below to choose a new password. This link expires in one hour and can only be used once.</p>
          <p>
            <a href="${escapeHtml(resetUrl.toString())}"
               style="display:inline-block;padding:12px 20px;background:#5145cd;color:white;text-decoration:none;border-radius:8px">
              Reset my password
            </a>
          </p>
          <p>If you didn't request this, you can ignore this email.</p>
        </div>
      `,
    });
  } catch (error) {
    db.prepare("DELETE FROM password_reset_tokens WHERE token_hash = ?")
      .run(tokenHash);
    console.error("Password reset email error:", error);
    res.status(502).json({
      error: "We couldn't send the password reset email. Please try again.",
    });
    return;
  }

  res.json({
    message: "If a verified account exists for that email, a reset link will be sent.",
  });
});

// RESET PASSWORD
router.post("/reset-password", async (req, res) => {
  const token =
    typeof req.body?.token === "string" ? req.body.token : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  const confirmPassword =
    typeof req.body?.confirmPassword === "string"
      ? req.body.confirmPassword
      : "";

  if (!/^[a-f0-9]{64}$/.test(token)) {
    res.status(400).json({
      error: "This password reset link is invalid or expired. Request a new one.",
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
    res.status(400).json({ error: "Passwords do not match." });
    return;
  }

  const tokenHash = hashToken(token);
  const existingToken = db.prepare(`
    SELECT user_id
    FROM password_reset_tokens
    WHERE token_hash = ? AND expires_at > ?
  `).get(tokenHash, Date.now()) as { user_id: number } | undefined;

  if (!existingToken) {
    res.status(400).json({
      error: "This password reset link is invalid or expired. Request a new one.",
    });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const applyPasswordReset = db.transaction(() => {
      const currentToken = db.prepare(`
        SELECT user_id
        FROM password_reset_tokens
        WHERE token_hash = ? AND expires_at > ?
      `).get(tokenHash, Date.now()) as { user_id: number } | undefined;

      if (!currentToken) return false;

      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
        .run(passwordHash, currentToken.user_id);
      db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?")
        .run(currentToken.user_id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?")
        .run(currentToken.user_id);

      return true;
    });

    if (!applyPasswordReset()) {
      res.status(400).json({
        error: "This password reset link is invalid or expired. Request a new one.",
      });
      return;
    }

    res.json({ message: "Your password has been reset. You can now log in." });
  } catch (error) {
    console.error("Password reset error:", error);
    res.status(500).json({
      error: "We couldn't reset your password. Please try again.",
    });
  }
});

// LOGIN
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
      SELECT id, username, email, password_hash, verified
      FROM users
      WHERE email = ?
    `).get(email) as
      | {
          id: number;
          username: string;
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
 
    db.prepare(`
      INSERT INTO sessions (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
    `).run(
      hashToken(sessionToken),
      user.id,
      Date.now() + SESSION_DURATION
    );
 
    setSessionCookie(res, sessionToken);
 
    res.json({
      user: {
        id: user.id,
        username: user.username,
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
 
// GET CURRENT USER
router.get("/me", (req, res) => {
  const user = getCurrentUser(req);
 
  if (!user) {
    res.status(401).json({ error: "Not logged in." });
    return;
  }
 
  res.json({ user });
});
 
// CHANGE USERNAME
router.patch("/username", (req, res) => {
  const user = getCurrentUser(req);
 
  if (!user) {
    res.status(401).json({
      error: "Please log in before changing your username.",
    });
    return;
  }
 
  const username =
    typeof req.body?.username === "string"
      ? req.body.username.trim()
      : "";
 
  if (!isValidUsername(username)) {
    res.status(400).json({
      error:
        "Username must be 3–20 characters and contain only letters, numbers, and underscores.",
    });
    return;
  }
 
  const existingUsername = db.prepare(`
    SELECT id FROM users
    WHERE username = ? COLLATE NOCASE AND id != ?
  `).get(username, user.id);
 
  if (existingUsername) {
    res.status(409).json({
      error: "That username is already taken. Please choose another.",
    });
    return;
  }
 
  try {
    db.prepare("UPDATE users SET username = ? WHERE id = ?")
      .run(username, user.id);
 
    res.json({
      message: "Username updated successfully.",
      user: {
        ...user,
        username,
      },
    });
  } catch (error) {
    console.error("Username update error:", error);
 
    if (
      error instanceof Error &&
      error.message.includes("users.username")
    ) {
      res.status(409).json({
        error: "That username is already taken. Please choose another.",
      });
      return;
    }
 
    res.status(500).json({
      error: "Couldn't update your username. Please try again.",
    });
  }
});
 
// LOGOUT
router.post("/logout", (req, res) => {
  const token = getCookie(req.headers.cookie, SESSION_COOKIE);
 
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(hashToken(token));
  }
 
  clearSessionCookie(res);
 
  res.json({ message: "Logged out." });
});
 
export default router;