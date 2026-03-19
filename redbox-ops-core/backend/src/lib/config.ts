import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  port: parseInt(process.env.PORT || "3001"),
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  hexstrikeApiUrl: process.env.HEXSTRIKE_API_URL || "http://127.0.0.1:8888",
  jwtSecret: process.env.JWT_SECRET || "redbox-dev-secret-change-in-production",
  jwtExpiresIn: "24h",
  dbPath: process.env.DB_PATH || path.join(__dirname, "../../data/redbox.db"),
  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, "../../uploads"),
  promptsDir: path.join(__dirname, "../../prompts"),
  corsOrigins: [
    process.env.FRONTEND_URL || "http://localhost:5173",
    "http://localhost:5173",
    "http://localhost:8080",
    "http://localhost:3000",
  ],
};
