import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, ne } from "drizzle-orm";
import { getAssetDatabase } from "@/features/assets/server/database";
import { canvasDocuments, projectAssets, projects } from "@/features/assets/server/schema";
import type { CanvasDocumentState, ProjectSummary } from "../types";

const knownProjects: Record<string, string> = {
  "emoji-workflow": "表情包工作流",
  storyboard: "动画分镜整理",
  "brand-assets": "品牌素材处理",
  "video-notes": "视频灵感与脚本",
  "product-research": "产品调研画布",
  "weekly-plan": "本周工作规划",
};

const emptyDocument: CanvasDocumentState = {
  schemaVersion: 1,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

function toProjectSummary(row: {
  id: string;
  name: string;
  assetCount: number;
  createdAt: Date;
  updatedAt: Date;
}): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    assetCount: row.assetCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function ensureKnownProjects() {
  const database = await getAssetDatabase();
  const now = new Date();
  database.insert(projects).values(
    Object.entries(knownProjects).map(([id, name]) => ({ id, name, createdAt: now, updatedAt: now })),
  ).onConflictDoNothing().run();
}

export async function ensureProject(projectId: string, name = knownProjects[projectId] ?? "画布项目") {
  await ensureKnownProjects();
  const database = await getAssetDatabase();
  const now = new Date();
  database.insert(projects).values({ id: projectId, name, createdAt: now, updatedAt: now }).onConflictDoNothing().run();
  return database.select().from(projects).where(eq(projects.id, projectId)).get()!;
}

export async function createProject(name = "未命名画布") {
  const database = await getAssetDatabase();
  const id = randomUUID();
  const now = new Date();
  database.transaction((transaction) => {
    transaction.insert(projects).values({ id, name, createdAt: now, updatedAt: now }).run();
    transaction.insert(canvasDocuments).values({
      projectId: id,
      schemaVersion: emptyDocument.schemaVersion,
      nodesJson: JSON.stringify(emptyDocument.nodes),
      edgesJson: JSON.stringify(emptyDocument.edges),
      viewportJson: JSON.stringify(emptyDocument.viewport),
      createdAt: now,
      updatedAt: now,
    }).run();
  });
  return { id, name, assetCount: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() } satisfies ProjectSummary;
}

export async function listProjects(excludeProjectId?: string) {
  await ensureKnownProjects();
  const database = await getAssetDatabase();
  const where = excludeProjectId
    ? and(ne(projects.id, "new"), ne(projects.id, excludeProjectId))
    : ne(projects.id, "new");
  const rows = database.select({
    id: projects.id,
    name: projects.name,
    assetCount: count(projectAssets.assetId),
    createdAt: projects.createdAt,
    updatedAt: projects.updatedAt,
  }).from(projects)
    .leftJoin(projectAssets, eq(projects.id, projectAssets.projectId))
    .where(where)
    .groupBy(projects.id)
    .orderBy(desc(projects.updatedAt), asc(projects.name))
    .all();
  return rows.map(toProjectSummary);
}

export async function openProject(projectId: string) {
  const project = await ensureProject(projectId);
  const database = await getAssetDatabase();
  const now = new Date();
  database.update(projects).set({ updatedAt: now }).where(eq(projects.id, projectId)).run();
  return { ...project, updatedAt: now };
}

export async function getCanvasDocument(projectId: string): Promise<CanvasDocumentState | null> {
  const database = await getAssetDatabase();
  const document = database.select().from(canvasDocuments).where(eq(canvasDocuments.projectId, projectId)).get();
  if (!document) return null;
  try {
    return {
      schemaVersion: 1,
      nodes: JSON.parse(document.nodesJson) as CanvasDocumentState["nodes"],
      edges: JSON.parse(document.edgesJson) as CanvasDocumentState["edges"],
      viewport: JSON.parse(document.viewportJson) as CanvasDocumentState["viewport"],
    };
  } catch {
    throw new Error("画布文档数据损坏，无法读取");
  }
}

export async function saveCanvasDocument(projectId: string, document: CanvasDocumentState) {
  await ensureProject(projectId);
  const database = await getAssetDatabase();
  const now = new Date();
  database.transaction((transaction) => {
    transaction.insert(canvasDocuments).values({
      projectId,
      schemaVersion: 1,
      nodesJson: JSON.stringify(document.nodes),
      edgesJson: JSON.stringify(document.edges),
      viewportJson: JSON.stringify(document.viewport),
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: canvasDocuments.projectId,
      set: {
        schemaVersion: 1,
        nodesJson: JSON.stringify(document.nodes),
        edgesJson: JSON.stringify(document.edges),
        viewportJson: JSON.stringify(document.viewport),
        updatedAt: now,
      },
    }).run();
    transaction.update(projects).set({ updatedAt: now }).where(eq(projects.id, projectId)).run();
  });
  return { updatedAt: now.toISOString() };
}
