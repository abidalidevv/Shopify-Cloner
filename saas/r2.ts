/// <reference path="./aws-sdk.d.ts" />
// r2.ts — Cloudflare R2 through its S3-compatible API. Needs: @aws-sdk/client-s3, @aws-sdk/s3-request-presigner.
// Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

const endpoint = process.env.AWS_ENDPOINT_URL_S3 || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
const accessKey = process.env.AWS_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || "mock-key";
const secretKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || "mock-secret";
const region = process.env.AWS_REGION || "us-east-2";
const Bucket = process.env.S3_BUCKET_NAME || process.env.R2_BUCKET || "assets";

const s3 = new S3Client({
  region,
  endpoint,
  credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  forcePathStyle: true,
});

export interface R2 {
  put(key: string, body: Uint8Array | string, contentType?: string): Promise<void>;
  presign(key: string, ttlSec?: number): Promise<string>;
  streamJsonl(key: string): AsyncIterable<any>;
}
export const r2: R2 = {
  async put(key, body, contentType = "application/octet-stream") { await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType })); },
  presign: (key, ttlSec = 3600) => getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: ttlSec }),
  async *streamJsonl(key) {
    const out = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
    for await (const line of createInterface({ input: out.Body as Readable, crlfDelay: Infinity })) if (line.trim()) yield JSON.parse(line);
  },
};
