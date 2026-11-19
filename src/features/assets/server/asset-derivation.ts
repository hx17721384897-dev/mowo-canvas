import "server-only";

import { randomUUID } from "node:crypto";
import { getAssetDatabase } from "./database";
import { assetDerivationInputs, assetDerivationOutputs, assetDerivations } from "./schema";

export async function recordAssetDerivation(projectId: string, operationType: "image-crop",
  inputAssetIds: string[], outputAssetIds: string[]) {
  if (!inputAssetIds.length || !outputAssetIds.length) throw new Error("派生关系缺少输入或输出");
  const db = await getAssetDatabase();
  db.transaction((tx) => {
    const derivationId = randomUUID();
    tx.insert(assetDerivations).values({ id: derivationId, projectId, operationType,
      processorVersion: "1.0.0", parametersJson: "{}", createdAt: new Date() }).run();
    tx.insert(assetDerivationInputs).values(inputAssetIds.map((assetId, position) => ({
      id: randomUUID(), derivationId, assetId, position }))).run();
    tx.insert(assetDerivationOutputs).values(outputAssetIds.map((assetId, position) => ({
      id: randomUUID(), derivationId, assetId, position }))).run();
  });
}

export async function recordCropDerivations(projectId: string, inputAssetIds: string[], outputAssetIds: string[]) {
  if (!inputAssetIds.length || inputAssetIds.length !== outputAssetIds.length) throw new Error("裁切来源与结果数量不一致");
  const db = await getAssetDatabase();
  db.transaction((tx) => {
    inputAssetIds.forEach((assetId, position) => {
      if (assetId === outputAssetIds[position]) return;
      const derivationId = randomUUID();
      tx.insert(assetDerivations).values({ id: derivationId, projectId, operationType: "image-crop",
        processorVersion: "1.0.0", parametersJson: "{}", createdAt: new Date() }).run();
      tx.insert(assetDerivationInputs).values({ id: randomUUID(), derivationId, assetId, position: 0 }).run();
      tx.insert(assetDerivationOutputs).values({ id: randomUUID(), derivationId, assetId: outputAssetIds[position], position: 0 }).run();
    });
  });
}
