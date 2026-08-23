import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, IMAGES_DIR } from "../db";
import { requireAuth } from "./auth";
import { signAccess, verifyToken } from "../auth";

// Reject any filename that could escape IMAGES_DIR (path traversal). Uploads
// only ever create `<uuid>.<ext>` names, so a plain basename check is enough
// and never rejects a legitimately stored image.
function safeImageName(name: string): string | null {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("\0")) return null;
  if (name === "." || name === ".." || name.includes("..")) return null;
  if (path.basename(name) !== name) return null;
  return name;
}

export async function imagesRoutes(app: FastifyInstance) {
  app.post(
    "/presigned-urls/:type",
    { preHandler: requireAuth },
    async (
      req: FastifyRequest<{
        Params: { type: "profile-image" | "background-image" };
        Body: { imageExt: string; imageLength: number };
      }>
    ) => {
      const userId = (req as any).userId;
      const { type } = req.params;
      const { imageExt } = req.body;
      const id = crypto.randomUUID();
      const filename = `${id}.${imageExt}`;

      const uploadToken = signAccess(userId);
      const host = req.headers.host ?? "localhost:3000";
      const proto = req.headers["x-forwarded-proto"] ?? "http";
      const presignedUrl = `${proto}://${host}/images/${filename}/upload?token=${uploadToken}&type=${type}&userId=${userId}`;

      const imageUrl = `${proto}://${host}/images/${filename}`;

      return {
        presignedUrl,
        profileImageUrl: type === "profile-image" ? imageUrl : undefined,
        backgroundImageUrl: type === "background-image" ? imageUrl : undefined,
      };
    }
  );

  app.put(
    "/images/:filename/upload",
    async (
      req: FastifyRequest<{
        Params: { filename: string };
        Querystring: { token: string; type: string; userId: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        verifyToken(req.query.token, "access");
      } catch {
        return reply.code(401).send({ error: "invalid token" });
      }

      const filename = safeImageName(req.params.filename);
      if (!filename) return reply.code(400).send({ error: "invalid filename" });
      const filePath = path.join(IMAGES_DIR, filename);
      await fs.promises.writeFile(filePath, req.body as Buffer);

      const { type, userId } = req.query;
      if (type === "profile-image") {
        db.prepare("UPDATE users SET profile_image_url = ? WHERE id = ?").run(`/images/${filename}`, userId);
      } else {
        db.prepare("UPDATE users SET background_image_url = ? WHERE id = ?").run(`/images/${filename}`, userId);
      }

      return {};
    }
  );

  app.get(
    "/images/:filename",
    async (
      req: FastifyRequest<{ Params: { filename: string } }>,
      reply: FastifyReply
    ) => {
      const filename = safeImageName(req.params.filename);
      if (!filename) return reply.code(400).send({ error: "invalid filename" });
      const filePath = path.join(IMAGES_DIR, filename);
      if (!fs.existsSync(filePath)) return reply.code(404).send({ error: "not found" });

      const ext = path.extname(filename).slice(1).toLowerCase();
      const mimeMap: Record<string, string> = {
        jpg: "image/jpeg", jpeg: "image/jpeg",
        png: "image/png", gif: "image/gif",
        webp: "image/webp",
      };

      return reply
        .type(mimeMap[ext] ?? "application/octet-stream")
        .send(fs.createReadStream(filePath));
    }
  );
}
