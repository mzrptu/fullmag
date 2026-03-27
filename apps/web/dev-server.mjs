import http from "node:http";
import net from "node:net";

import next from "next";

function parseArgs(argv) {
  const args = {
    hostname: process.env.FULLMAG_WEB_BIND_HOST || "0.0.0.0",
    port: Number(process.env.PORT || process.env.FULLMAG_WEB_PORT || 3000),
    apiTarget: process.env.FULLMAG_API_PROXY_TARGET || "http://localhost:8080",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = argv[index + 1];
    if (arg === "--hostname" && nextValue) {
      args.hostname = nextValue;
      index += 1;
    } else if (arg === "--port" && nextValue) {
      args.port = Number(nextValue);
      index += 1;
    } else if (arg === "--api-target" && nextValue) {
      args.apiTarget = nextValue;
      index += 1;
    }
  }

  return args;
}

function shouldProxyHttp(pathname) {
  return pathname === "/healthz" || pathname.startsWith("/v1/");
}

function shouldProxyWs(pathname) {
  return pathname.startsWith("/ws/live/");
}

function requestPathname(req) {
  const originHost = req.headers.host || "localhost";
  return new URL(req.url || "/", `http://${originHost}`).pathname;
}

function writeHttpError(res, error) {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.statusCode = 502;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: `API proxy error: ${error.message}` }));
}

function proxyHttpRequest(req, res, apiUrl) {
  const upstream = http.request(
    {
      protocol: apiUrl.protocol,
      hostname: apiUrl.hostname,
      port: apiUrl.port,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        host: apiUrl.host,
      },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (error) => writeHttpError(res, error));
  req.pipe(upstream);
}

function proxyWsUpgrade(req, socket, head, apiUrl) {
  const upstream = net.connect(Number(apiUrl.port || 80), apiUrl.hostname, () => {
    const requestLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    const headers = Object.entries(req.headers)
      .flatMap(([name, value]) => {
        if (name.toLowerCase() === "host") return [];
        if (value == null) return [];
        if (Array.isArray(value)) {
          return value.map((entry) => `${name}: ${entry}\r\n`);
        }
        return [`${name}: ${value}\r\n`];
      })
      .join("");

    upstream.write(requestLine);
    upstream.write(headers);
    upstream.write(`host: ${apiUrl.host}\r\n`);
    upstream.write("\r\n");
    if (head.length > 0) {
      upstream.write(head);
    }

    socket.pipe(upstream).pipe(socket);
  });

  const closeSockets = () => {
    if (!socket.destroyed) socket.destroy();
    if (!upstream.destroyed) upstream.destroy();
  };

  upstream.on("error", closeSockets);
  socket.on("error", closeSockets);
}

async function main() {
  const { hostname, port, apiTarget } = parseArgs(process.argv.slice(2));
  const apiUrl = new URL(apiTarget);
  const dev = process.env.NODE_ENV !== "production";

  const app = next({
    dev,
    dir: process.cwd(),
    hostname,
    port,
  });

  await app.prepare();
  const handle = app.getRequestHandler();
  const handleUpgrade = app.getUpgradeHandler();

  const server = http.createServer((req, res) => {
    const pathname = requestPathname(req);

    if (shouldProxyHttp(pathname)) {
      proxyHttpRequest(req, res, apiUrl);
      return;
    }

    handle(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    const pathname = requestPathname(req);
    if (shouldProxyWs(pathname)) {
      proxyWsUpgrade(req, socket, head, apiUrl);
      return;
    }
    handleUpgrade(req, socket, head);
  });

  server.listen(port, hostname, () => {
    // eslint-disable-next-line no-console
    console.log(
      `fullmag control room ready on http://${hostname}:${port} (api proxy ${apiUrl.origin})`,
    );
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
