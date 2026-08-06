import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  ClipboardList,
  Factory,
  Map,
  Network,
  Newspaper,
  Shield,
  Zap,
} from "lucide-react";
import type { PermissionCode } from "./types";

/** Lucide icons referenced by feature registry `hub.icon` names. */
export const HUB_ICONS: Record<string, LucideIcon> = {
  Zap,
  Map,
  Network,
  Shield,
  BookOpen,
  Newspaper,
  Factory,
  ClipboardList,
};

export type MiniAppStatus = "live" | "soon";

export interface MiniAppDef {
  id: string;
  title: string;
  description: string;
  path: string;
  status: MiniAppStatus;
  icon: LucideIcon;
  accent: string;
  permission: PermissionCode;
}

export type HubAppDto = {
  id: string;
  title: string;
  description: string;
  path: string;
  status: MiniAppStatus;
  accent: string;
  icon: string;
  permission: string;
};

/** Map registry DTO from `/api/hub/apps` into UI defs. */
export function hubAppsFromDto(apps: HubAppDto[]): MiniAppDef[] {
  return apps.map((app) => ({
    id: app.id,
    title: app.title,
    description: app.description,
    path: app.path,
    status: app.status,
    accent: app.accent,
    permission: app.permission,
    icon: HUB_ICONS[app.icon] ?? ClipboardList,
  }));
}

export const STOCKMAP_EMBED_URL = "/stockmap-app/";

/** @deprecated Prefer hub apps from API; kept for ComingSoon stubs. */
export type AppId =
  | "tasks"
  | "stockmap"
  | "structure"
  | "administration"
  | "reference"
  | "news"
  | "orders";

export function getMiniAppFromList(apps: MiniAppDef[], id: string): MiniAppDef | undefined {
  return apps.find((a) => a.id === id);
}

/** Placeholder icon for generic chrome */
export const HubIcon = ClipboardList;

/** Standard object permission code helper (mirrors backend registry). */
export function objectPerm(appId: string, objectId: string, action: string): PermissionCode {
  return `${appId}.${objectId}.${action}`;
}
