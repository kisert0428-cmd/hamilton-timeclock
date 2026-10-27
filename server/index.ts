import "dotenv/config";
import express from "express";
import path from "node:path";
import { createApp } from "./app.js";
if (!process.env.APP_ORIGIN && process.env.RENDER_EXTERNAL_URL)
  process.env.APP_ORIGIN = process.env.RENDER_EXTERNAL_URL;
if (process.env.NODE_ENV === "production") {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required in production");
  if (!process.env.APP_ORIGIN?.startsWith("https://"))
    throw new Error("APP_ORIGIN must use HTTPS in production");
}
const app = createApp();
app.use(express.static(path.resolve("dist")));
app.get("/{*path}", (_req, res) =>
  res.sendFile(path.resolve("dist/index.html")),
);
app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log(
    "Hamilton Time Clock listening on port " + (process.env.PORT || 3000),
  ),
);
