import "server-only";
import { CanvasDocumentError, validateCanvasDocument } from "../canvas-document";

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

export async function ensureProject(projectId: string, name = knownProjects[projectId] ?? "画布项目") {
  const database = await getAssetDatabase();
  const now = new Date();
  database.insert(projects).values({ id: projectId, name, createdAt: now, updatedAt: now }).onConflictDoNothing().run();
  return database.select().from(projects).where(eq(projects.id, projectId)).get()!;
}

export async function createProject(requestedName?: string) {
  const database = await getAssetDatabase();
  const id = randomUUID();
  const now = new Date();
  const name = database.transaction((transaction) => {
    const rows = transaction.select().from(projects).orderBy(asc(projects.createdAt), asc(projects.id)).all();
    let next = rows.reduce((max, row) => {
      const match = /^无限画布 (\d+)$/.exec(row.name);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    for (const row of rows) {
      if (row.id !== "new" && ["未命名画布", "画布项目"].includes(row.name)) {
        transaction.update(projects).set({ name: `无限画布 ${next++}` }).where(eq(projects.id, row.id)).run();
      }
    }
    const name = requestedName ?? `无限画布 ${next}`;
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
    return name;
  });
  return { id, name, assetCount: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() } satisfies ProjectSummary;
}

export async function listProjects(excludeProjectId?: string) {
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
    documentId: canvasDocuments.projectId,
  }).from(projects)
    .leftJoin(projectAssets, eq(projects.id, projectAssets.projectId))
    .leftJoin(canvasDocuments, eq(projects.id, canvasDocuments.projectId))
    .where(where)
    .groupBy(projects.id)
    .orderBy(desc(projects.createdAt), desc(projects.id))
    .all();
  return rows.filter((row) => !Object.hasOwn(knownProjects, row.id) || row.assetCount > 0 || row.documentId).map(toProjectSummary);
}

export async function openProject(projectId: string) {
  const database = await getAssetDatabase();
  return database.select().from(projects).where(eq(projects.id, projectId)).get();
}

export async function renameProject(id: string, name: string) {
  const database = await getAssetDatabase();
  const updatedAt = new Date();
  const result = database.update(projects).set({ name, updatedAt }).where(eq(projects.id, id)).run();
  return result.changes ? { name, updatedAt: updatedAt.toISOString() } : null;
}

export async function getCanvasDocument(projectId: string): Promise<CanvasDocumentState | null> {
  const database = await getAssetDatabase();
  const document = database.select().from(canvasDocuments).where(eq(canvasDocuments.projectId, projectId)).get();
  if (!document) return null;
  let decoded: unknown;
  try {
    decoded = {
      schemaVersion: document.schemaVersion,
      nodes: JSON.parse(document.nodesJson),
      edges: JSON.parse(document.edgesJson),
      viewport: JSON.parse(document.viewportJson),
    };
  } catch {
    throw new CanvasDocumentError("document", "画布文档数据损坏，无法读取", "INVALID_JSON");
  }
  validateCanvasDocument(decoded);
  return decoded;
}

export async function saveCanvasDocument(projectId: string, document: CanvasDocumentState) {
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
