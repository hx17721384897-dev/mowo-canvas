import "server-only";

import { eq } from "drizzle-orm";
import { getAssetDatabase } from "./database";
import { belongsToLegacyDownloadBatch } from "./legacy-download-batches";
import { assetCollectionItems, assetCollections, assetDerivationInputs, assetDerivationOutputs, assetDerivations,
  assetFolderItems, assetFolders, assetIntakes, assets, downloadTasks, projectAssets, videoClips } from "./schema";

export async function listAssetSourceView(projectId: string) {
  const db = await getAssetDatabase();
  const owned = new Set(db.select({ assetId: projectAssets.assetId }).from(projectAssets)
    .where(eq(projectAssets.projectId, projectId)).all().map((row) => row.assetId));
  const folders = db.select().from(assetFolders).where(eq(assetFolders.projectId, projectId)).all()
    .map((row) => ({ id: row.id, name: row.name, category: row.sourceCategory }));
  const placements = db.select({ assetId: assetFolderItems.assetId, folderId: assetFolderItems.folderId })
    .from(assetFolderItems).where(eq(assetFolderItems.projectId, projectId)).all();
  const tasks = db.select().from(downloadTasks).all();
  const collections = db.select().from(assetCollections).all().filter((collection) =>
    collection.projectId === projectId || belongsToLegacyDownloadBatch(collection, projectId, tasks));
  const collectionIds = new Set(collections.map((collection) => collection.id));
  const members = db.select().from(assetCollectionItems).all().filter((item) => collectionIds.has(item.collectionId));
  const batches = collections.filter((collection) => collection.kind === "download-batch")
    .map((collection) => ({ id: collection.id, name: collection.name, category: "download" as const,
      createdAt: collection.createdAt.toISOString(), assetIds: members.filter((item) => item.collectionId === collection.id)
        .sort((a, b) => a.position - b.position).map((item) => item.assetId).filter((id) => owned.has(id)) }))
    .filter((batch) => batch.assetIds.length > 0);
  const sequences = collections.filter((collection) => collection.kind === "frame-sequence")
    .map((collection) => ({ id: collection.id, name: collection.name,
      assetIds: members.filter((item) => item.collectionId === collection.id).sort((a, b) => a.position - b.position)
        .map((item) => item.assetId).filter((id) => owned.has(id)) }));
  const derivations = db.select().from(assetDerivations).where(eq(assetDerivations.projectId, projectId)).all();
  const derivationIds = new Set(derivations.map((item) => item.id));
  const inputs = db.select().from(assetDerivationInputs).all().filter((item) => derivationIds.has(item.derivationId));
  const outputs = db.select().from(assetDerivationOutputs).all().filter((item) => derivationIds.has(item.derivationId));
  const links = derivations.map((item) => ({ id: item.id, operation: item.operationType as string,
    inputAssetIds: inputs.filter((row) => row.derivationId === item.id && row.assetId && owned.has(row.assetId))
      .map((row) => row.assetId!),
    inputCollectionIds: inputs.filter((row) => row.derivationId === item.id && row.collectionId && collectionIds.has(row.collectionId))
      .map((row) => row.collectionId!),
    outputAssetIds: outputs.filter((row) => row.derivationId === item.id && row.assetId && owned.has(row.assetId))
      .map((row) => row.assetId!),
    outputCollectionIds: outputs.filter((row) => row.derivationId === item.id && row.collectionId && collectionIds.has(row.collectionId))
      .map((row) => row.collectionId!) }));
  const clips = db.select({ id: videoClips.id, sourceAssetId: videoClips.sourceAssetId })
    .from(videoClips).where(eq(videoClips.projectId, projectId)).all();
  const raw = db.select({ id: assets.id, sourceType: assets.sourceType, sourceUrl: assets.sourceUrl })
    .from(assets).all().filter((row) => owned.has(row.id));
  const intakes = db.select().from(assetIntakes).where(eq(assetIntakes.projectId, projectId)).all()
    .map((row) => ({ id: row.id, assetId: row.assetId, sourceType: row.sourceType,
      sourceName: row.sourceName, sourceUrl: row.sourceUrl, batchId: row.batchId, createdAt: row.createdAt.toISOString() }));
  for (const row of raw) {
    if (!["image-crop", "video-cutting"].includes(row.sourceType) || !row.sourceUrl?.startsWith("asset:")) continue;
    const sourceId = row.sourceUrl.slice(6);
    if (!owned.has(sourceId) || links.some((link) => link.outputAssetIds.includes(row.id))) continue;
    links.push({ id: `legacy:${row.id}`, operation: row.sourceType, inputAssetIds: [sourceId], inputCollectionIds: [],
      outputAssetIds: [row.id], outputCollectionIds: [] });
  }
  return { folders, placements, batches, sequences, links, clips, origins: raw, intakes };
}
