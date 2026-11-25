#!/usr/bin/env bash
# Statische Demo-Login-Seite für den Auto-Fill-Akzeptanztest (ADR-006).
#   scripts/serve-demo.sh  → http://127.0.0.1:8123/
PORT="${DEMO_PORT:-8123}"
DIR="$(cd "$(dirname "$0")" && pwd)"
exec /nix/store/3kfmdqn711fqcc2y1qnjssancqf7b36l-nodejs-24.22.2/bin/node -e '
const http = require("http");
const fs = require("fs");
const path = require("path");
const dir = process.argv[1], port = Number(process.argv[2]);
http.createServer((req, res) => {
  const file = path.join(dir, req.url === "/" ? "demo-login-page.html" : req.url.replace(/^\/+/, ""));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
    res.end(data);
  });
}).listen(port, "127.0.0.1", () => console.log(`Demo-Login: http://127.0.0.1:${port}/`));
' "$DIR" "$PORT"
