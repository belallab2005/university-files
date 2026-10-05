const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PASS = process.env.ADMIN_PASSWORD;
if (!PASS || PASS.length < 12) {
  console.error("ADMIN_PASSWORD must be set and contain at least 12 characters.");
  process.exit(1);
}

// Render: set DATA_DIR=/var/data and attach a persistent disk mounted at /var/data.
// Local development: defaults to ./storage.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "storage");
const DB = path.join(DATA_DIR, "db.json");
const FILES = path.join(DATA_DIR, "files");

fs.mkdirSync(FILES, { recursive: true });

const load = () => {
  if (!fs.existsSync(DB)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(DB, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    throw new Error("Database file is invalid.");
  }
};

const save = (data) => {
  const tmp = `${DB}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, DB);
};

const today = () => new Date().toISOString().slice(0, 10);
const sha = (s) => crypto.createHash("sha256").update(s).digest();
const safeId = (id) => /^[0-9a-f-]{36}$/i.test(id);

const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "50kb" }));

app.use(express.static(path.join(__dirname, "public"), {
  index: "index.html",
  dotfiles: "deny",
}));

// Uploaded university files are intentionally public to students.
app.use("/files", express.static(FILES, {
  dotfiles: "deny",
  index: false,
  fallthrough: false,
}));

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "طلبات كثيرة. حاول مرة أخرى بعد قليل." },
});

const admin = (req, res, next) => {
  const supplied = req.get("x-admin-password") || "";
  const suppliedHash = sha(supplied);
  const passHash = sha(PASS);

  if (crypto.timingSafeEqual(suppliedHash, passHash)) return next();
  return res.status(401).json({ error: "كلمة المرور غير صحيحة" });
};

const adminOnly = [adminLimiter, admin];

const exists = (req, res, next) => {
  if (!safeId(req.params.id)) {
    return res.status(400).json({ error: "معرّف المادة غير صالح" });
  }
  return load().some((s) => s.id === req.params.id)
    ? next()
    : res.status(404).json({ error: "المادة غير موجودة" });
};

const decodeOriginalName = (name) => {
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return path.basename(decoded).replace(/[\x00-\x1F\x7F]/g, "_").trim();
};

const makeStoredName = (originalName) => {
  const ext = path.extname(originalName).slice(0, 20).replace(/[^a-zA-Z0-9.]/g, "");
  return `${crypto.randomUUID()}${ext}`;
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(FILES, req.params.id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const original = decodeOriginalName(file.originalname) || "file";
      cb(null, makeStoredName(original));
    },
  }),
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 30,
  },
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/subjects", (req, res) => {
  const subjects = load();
  res.json(subjects.map((s) => ({
    id: s.id,
    name: s.name,
    date: s.date,
    files: (s.files || []).map((f) => {
      // Support both the new object format and the original string format.
      const file = typeof f === "string" ? { n: f, stored: f } : f;
      return { n: file.n, u: `files/${s.id}/${encodeURIComponent(file.stored)}` };
    }),
  })));
});

app.get("/api/check", ...adminOnly, (req, res) => res.json({ ok: true }));

app.post("/api/subjects", ...adminOnly, (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "أدخل اسم المادة" });
  if (name.length > 120) return res.status(400).json({ error: "اسم المادة طويل جدًا" });

  const d = load();
  if (d.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: "هذه المادة موجودة بالفعل" });
  }

  const s = { id: crypto.randomUUID(), name, date: today(), files: [] };
  d.push(s);
  save(d);
  res.status(201).json(s);
});

app.delete("/api/subjects/:id", ...adminOnly, exists, (req, res) => {
  save(load().filter((s) => s.id !== req.params.id));
  fs.rmSync(path.join(FILES, req.params.id), { recursive: true, force: true });
  res.json({ ok: true });
});

app.post("/api/subjects/:id/files", ...adminOnly, exists, upload.array("files"), (req, res) => {
  const d = load();
  const s = d.find((x) => x.id === req.params.id);
  const added = [];

  for (const file of req.files || []) {
    const original = decodeOriginalName(file.originalname) || "file";
    if (!s.files.some((f) => f.n === original)) {
      s.files.push({ n: original, stored: file.filename });
      added.push(original);
    } else {
      fs.rmSync(file.path, { force: true });
    }
  }

  s.date = today();
  save(d);
  res.json({ ...s, added });
});

app.delete("/api/subjects/:id/files/:name", ...adminOnly, exists, (req, res) => {
  const d = load();
  const s = d.find((x) => x.id === req.params.id);
  const name = decodeURIComponent(req.params.name);
  const file = s.files.find((f) => (typeof f === "string" ? f : f.n) === name);

  if (!file) return res.status(404).json({ error: "الملف غير موجود" });

  s.files = s.files.filter((f) => f !== file);
  const stored = typeof file === "string" ? file : file.stored;
  fs.rmSync(path.join(FILES, s.id, path.basename(stored)), { force: true });
  s.date = today();
  save(d);
  res.json(s);
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "حجم الملف أكبر من 100 ميغابايت" });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ error: "يمكن رفع 30 ملفًا كحد أقصى في المرة الواحدة" });
    }
  }
  console.error(err);
  res.status(400).json({ error: "فشل الرفع" });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`University Files Portal listening on port ${port}`);
});
