import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number.parseInt(process.env.PORT ?? "4393", 10);
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".webp", "image/webp"],
  [".xml", "application/xml; charset=utf-8"],
]);

async function existingFile(candidates) {
  for (const candidate of candidates) {
    const candidatePath = path.resolve(root, candidate);
    if (!candidatePath.startsWith(root)) continue;
    const details = await stat(candidatePath).catch(() => null);
    if (details?.isFile()) return candidatePath;
  }
  return null;
}

const server = createServer(async (request, response) => {
  const requestURL = new URL(request.url ?? "/", "http://127.0.0.1");
  let pathname;
  try {
    pathname = decodeURIComponent(requestURL.pathname);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  const relativePath = pathname.replace(/^\/+/, "");
  const candidates =
    pathname === "/" ? ["index.html"] : [relativePath, `${relativePath}.html`, path.join(relativePath, "index.html")];
  const file = await existingFile(candidates);
  const responseFile = file ?? path.join(root, "404.html");

  response.writeHead(file ? 200 : 404, {
    "Cache-Control": "no-store",
    "Content-Type": contentTypes.get(path.extname(responseFile)) ?? "application/octet-stream",
  });
  createReadStream(responseFile).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Static preview ready at http://127.0.0.1:${port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
