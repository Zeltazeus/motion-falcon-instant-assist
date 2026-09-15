import { readFile } from "node:fs/promises";
import { join } from "node:path";

const knowledgeDirectory = join(process.cwd(), "api", "knowledge");

async function readKnowledgeFile(name) {
  return readFile(join(knowledgeDirectory, name), "utf8");
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).end();
  }

  const expectedToken = process.env.MOTION_FALCON_KNOWLEDGE_TOKEN;
  const authorization = request.headers.authorization;
  if (!expectedToken || authorization !== `Bearer ${expectedToken}`) {
    response.setHeader("Cache-Control", "no-store");
    return response.status(401).json({ error: "Unauthorized" });
  }

  const [policy, publicKnowledge] = await Promise.all([
    readKnowledgeFile("motion-falcon-policy.md"),
    readKnowledgeFile("motion-falcon-public-knowledge.md"),
  ]);

  response.setHeader("Cache-Control", "private, no-store");
  return response.status(200).json({ policy, publicKnowledge });
}