import express from "express";
import { env } from "./config/env.js";

const app = express();

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "api"
  });
});

app.listen(env.apiPort, () => {
  console.log(
    `API running on http://localhost:${env.apiPort}`
  );
});