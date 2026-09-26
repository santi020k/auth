import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

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

async function existingFile(root, candidates) {
  for (const candidate of candidates) {
    const candidatePath = path.resolve(root, candidate);
    if (!candidatePath.startsWith(root)) continue;
    const details = await stat(candidatePath).catch(() => null);
    if (details?.isFile()) return candidatePath;
  }
  return null;
}

export function createStaticServer(root) {
  return createServer(async (request, response) => {
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
    const file = await existingFile(root, candidates);
    const fallbackFile = file ? null : await existingFile(root, ["404.html"]);
    const responseFile = file ?? fallbackFile;

    if (!responseFile) {
      response.writeHead(404, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Not found");
      return;
    }

    response.writeHead(file ? 200 : 404, {
      "Cache-Control": "no-store",
      "Content-Type": contentTypes.get(path.extname(responseFile)) ?? "application/octet-stream",
    });
    createReadStream(responseFile)
      .on("error", (error) => {
        // A file can disappear after stat and before streaming. Keep the process alive and
        // terminate only this response rather than raising an uncaught stream error.
        process.stderr.write(`Failed to stream ${responseFile}: ${error.message}\n`);
        response.destroy(error);
      })
      .pipe(response);
  });
}

function main() {
  const root = fileURLToPath(new URL("../dist/", import.meta.url));
  const port = Number.parseInt(process.env.PORT ?? "4393", 10);
  const server = createStaticServer(root);

  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`Static preview ready at http://127.0.0.1:${port}\n`);
  });

  function shutdown() {
    server.close(() => process.exit(0));
  }

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
