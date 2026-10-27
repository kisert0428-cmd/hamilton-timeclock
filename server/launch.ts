import "dotenv/config";
import { migrate } from "./db.js";
await migrate();
await import("./index.js");
