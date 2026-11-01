// Local only: lets the browser reach the devnet stand-in. /rpc goes to the RPC
// stand-in on 8798, /address and /sign to its test wallet on 8799.
import http from "node:http";

http
  .createServer((req, res) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    const target = req.url === "/rpc" ? { port: 8798, path: "/" } : { port: 8799, path: req.url };
    const up = http.request({ host: "127.0.0.1", port: target.port, path: target.path, method: req.method, headers: { "content-type": "application/json" } }, (r) => {
      res.writeHead(r.statusCode ?? 502, { ...cors, "content-type": "application/json" });
      r.pipe(res);
    });
    up.on("error", () => res.writeHead(502, cors).end());
    req.pipe(up);
  })
  .listen(8797, "127.0.0.1", () => console.log("cors proxy on 8797"));
