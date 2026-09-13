const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcryptjs");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const LINKS_FILE = path.join(DATA_DIR, "links.json");

const PORT = Number(process.env.PORT) || 3000;
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES) || 200 * 1024 * 1024;
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-session-secret";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function loadUsers() {
  return readJson(USERS_FILE, []);
}

function saveUsers(users) {
  writeJson(USERS_FILE, users);
}

function loadLinks() {
  return readJson(LINKS_FILE, []);
}

function saveLinks(links) {
  writeJson(LINKS_FILE, links);
}

function slugify(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return raw.slice(0, 40);
}

function makeId() {
  return crypto.randomBytes(8).toString("hex");
}

function makeSlug() {
  return crypto.randomBytes(5).toString("hex");
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ ok: false, error: "ログインが必要です" });
  }
  next();
}

function publicUser(user) {
  return { id: user.id, username: user.username };
}

function publicLink(link, req) {
  const base = `${req.protocol}://${req.get("host")}`;
  return {
    id: link.id,
    slug: link.slug,
    title: link.title,
    downloadName: link.downloadName,
    originalName: link.originalName,
    size: link.size,
    mimeType: link.mimeType,
    downloads: link.downloads || 0,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    url: `${base}/d/${link.slug}`,
  };
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, _file, cb) => cb(null, `${Date.now()}-${makeId()}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
});

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(
  session({
    name: "dl.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 14 * 24 * 60 * 60 * 1000,
    },
  })
);

app.get("/d/:slug", (req, res) => {
  const links = loadLinks();
  const link = links.find((item) => item.slug === req.params.slug);
  if (!link) {
    return res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"));
  }

  const filePath = path.join(UPLOAD_DIR, link.storedName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"));
  }

  link.downloads = (link.downloads || 0) + 1;
  saveLinks(links);

  res.download(filePath, link.downloadName || link.originalName || "download", (err) => {
    if (err && !res.headersSent) {
      res.status(500).send("ダウンロードに失敗しました");
    }
  });
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) {
    return res.json({ ok: true, user: null });
  }
  const user = loadUsers().find((item) => item.id === req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.json({ ok: true, user: null });
  }
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/register", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({
      ok: false,
      error: "ユーザー名は3〜20文字の英数字と_のみです",
    });
  }
  if (password.length < 6 || password.length > 72) {
    return res.status(400).json({
      ok: false,
      error: "パスワードは6〜72文字です",
    });
  }

  const users = loadUsers();
  if (users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ ok: false, error: "そのユーザー名は使われています" });
  }

  const user = {
    id: makeId(),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = loadUsers().find(
    (item) => item.username.toLowerCase() === username.toLowerCase()
  );

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ ok: false, error: "ユーザー名またはパスワードが違います" });
  }

  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/links", requireAuth, (req, res) => {
  const links = loadLinks()
    .filter((link) => link.userId === req.session.userId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map((link) => publicLink(link, req));
  res.json({ ok: true, links });
});

app.post("/api/links", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: "ファイルを選んでください" });
  }

  const title = String(req.body.title || "").trim() || req.file.originalname;
  const downloadName = String(req.body.downloadName || "").trim() || req.file.originalname;
  let slug = slugify(req.body.slug) || makeSlug();
  const links = loadLinks();

  if (links.some((link) => link.slug === slug)) {
    slug = `${slug}-${makeSlug()}`;
  }

  const now = new Date().toISOString();
  const link = {
    id: makeId(),
    userId: req.session.userId,
    slug,
    title,
    downloadName,
    originalName: req.file.originalname,
    storedName: req.file.filename,
    size: req.file.size,
    mimeType: req.file.mimetype,
    downloads: 0,
    createdAt: now,
    updatedAt: now,
  };
  links.push(link);
  saveLinks(links);
  res.json({ ok: true, link: publicLink(link, req) });
});

app.put("/api/links/:id", requireAuth, (req, res) => {
  const links = loadLinks();
  const link = links.find(
    (item) => item.id === req.params.id && item.userId === req.session.userId
  );
  if (!link) {
    return res.status(404).json({ ok: false, error: "リンクが見つかりません" });
  }

  if (req.body.title !== undefined) {
    const title = String(req.body.title || "").trim();
    if (!title) {
      return res.status(400).json({ ok: false, error: "タイトルを入力してください" });
    }
    link.title = title;
  }

  if (req.body.downloadName !== undefined) {
    const downloadName = String(req.body.downloadName || "").trim();
    if (!downloadName) {
      return res.status(400).json({ ok: false, error: "ダウンロード名を入力してください" });
    }
    link.downloadName = downloadName;
  }

  if (req.body.slug !== undefined) {
    let slug = slugify(req.body.slug);
    if (!slug) {
      return res.status(400).json({
        ok: false,
        error: "リンクIDは英数字と-_のみです",
      });
    }
    if (links.some((item) => item.slug === slug && item.id !== link.id)) {
      return res.status(409).json({ ok: false, error: "そのリンクIDは使われています" });
    }
    link.slug = slug;
  }

  link.updatedAt = new Date().toISOString();
  saveLinks(links);
  res.json({ ok: true, link: publicLink(link, req) });
});

app.post("/api/links/:id/file", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: "ファイルを選んでください" });
  }

  const links = loadLinks();
  const link = links.find(
    (item) => item.id === req.params.id && item.userId === req.session.userId
  );
  if (!link) {
    fs.unlink(req.file.path, () => {});
    return res.status(404).json({ ok: false, error: "リンクが見つかりません" });
  }

  const oldPath = path.join(UPLOAD_DIR, link.storedName);
  if (fs.existsSync(oldPath)) {
    fs.unlink(oldPath, () => {});
  }

  link.storedName = req.file.filename;
  link.originalName = req.file.originalname;
  link.size = req.file.size;
  link.mimeType = req.file.mimetype;
  if (!String(req.body.keepName || "") && !String(req.body.downloadName || "")) {
    link.downloadName = req.file.originalname;
  }
  if (req.body.downloadName) {
    link.downloadName = String(req.body.downloadName).trim();
  }
  link.updatedAt = new Date().toISOString();
  saveLinks(links);
  res.json({ ok: true, link: publicLink(link, req) });
});

app.delete("/api/links/:id", requireAuth, (req, res) => {
  const links = loadLinks();
  const index = links.findIndex(
    (item) => item.id === req.params.id && item.userId === req.session.userId
  );
  if (index === -1) {
    return res.status(404).json({ ok: false, error: "リンクが見つかりません" });
  }

  const [removed] = links.splice(index, 1);
  const filePath = path.join(UPLOAD_DIR, removed.storedName);
  if (fs.existsSync(filePath)) {
    fs.unlink(filePath, () => {});
  }
  saveLinks(links);
  res.json({ ok: true });
});

app.use(express.static(PUBLIC_DIR));

app.use((err, _req, res, _next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({
      ok: false,
      error: `ファイルサイズは${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MBまでです`,
    });
  }
  res.status(500).json({ ok: false, error: "サーバーエラーが発生しました" });
});

app.listen(PORT, () => {
  console.log(`Direct DL running at http://localhost:${PORT}`);
});
