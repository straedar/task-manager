import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { getUserAuthById } from "../db/queries/users.js";
import type { UserPublic } from "../types.js";

const SESSION_COOKIE = "session";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

export function createSessionToken(userId: number): string {
  const payload = JSON.stringify({ userId, exp: Date.now() + MAX_AGE_MS });
  const signature = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

export function parseSessionToken(token: string): number | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const lastDot = decoded.lastIndexOf(".");
    if (lastDot === -1) return null;

    const payload = decoded.slice(0, lastDot);
    const signature = decoded.slice(lastDot + 1);
    const expected = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");

    if (signature !== expected) return null;

    const data = JSON.parse(payload) as { userId: number; exp: number };
    if (Date.now() > data.exp) return null;

    return data.userId;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, userId: number) {
  const token = createSessionToken(userId);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export interface AuthRequest extends Request {
  user?: UserPublic;
}

function attachUser(req: AuthRequest, userId: number): boolean {
  const user = getUserAuthById(userId);
  if (!user) return false;
  req.user = user;
  return true;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: "Не авторизован" });
    return;
  }

  const userId = parseSessionToken(token);
  if (!userId || !attachUser(req, userId)) {
    res.status(401).json({ error: "Сессия истекла" });
    return;
  }

  next();
}

export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const userId = parseSessionToken(token);
    if (userId) attachUser(req, userId);
  }
  next();
}
