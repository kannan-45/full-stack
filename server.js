const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "taskflow_super_secret_key_2024";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "taskflow.db");

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Database Setup ───────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY(project_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in-progress','done')),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    due_date TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }
  try {
    const decoded = jwt.verify(auth.split(" ")[1], JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.post("/api/auth/signup", (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: "Name, email & password required" });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters" });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email))
    return res.status(400).json({ error: "Invalid email format" });

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const hash = bcrypt.hashSync(password, 10);
  // First user becomes admin automatically
  const count = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
  const assignedRole = count === 0 ? "admin" : (role === "admin" ? "admin" : "member");

  const result = db.prepare(
    "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)"
  ).run(name, email, hash, assignedRole);

  const user = { id: result.lastInsertRowid, name, email, role: assignedRole };
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });
  res.status(201).json({ token, user });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email & password required" });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: "Invalid credentials" });

  const payload = { id: user.id, name: user.name, email: user.email, role: user.role };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: payload });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  const user = db.prepare("SELECT id, name, email, role, created_at FROM users WHERE id = ?").get(req.user.id);
  res.json(user);
});

// ─── USER ROUTES ──────────────────────────────────────────────────────────────
app.get("/api/users", authMiddleware, (req, res) => {
  const users = db.prepare("SELECT id, name, email, role, created_at FROM users ORDER BY name").all();
  res.json(users);
});

app.patch("/api/users/:id/role", authMiddleware, adminOnly, (req, res) => {
  const { role } = req.body;
  if (!["admin", "member"].includes(role))
    return res.status(400).json({ error: "Role must be admin or member" });
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, req.params.id);
  res.json({ message: "Role updated" });
});

app.delete("/api/users/:id", authMiddleware, adminOnly, (req, res) => {
  if (parseInt(req.params.id) === req.user.id)
    return res.status(400).json({ error: "Cannot delete yourself" });
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ message: "User deleted" });
});

// ─── PROJECT ROUTES ───────────────────────────────────────────────────────────
app.get("/api/projects", authMiddleware, (req, res) => {
  let projects;
  if (req.user.role === "admin") {
    projects = db.prepare(`
      SELECT p.*, u.name as creator_name,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') as done_count,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) as member_count
      FROM projects p JOIN users u ON p.created_by = u.id
      ORDER BY p.created_at DESC
    `).all();
  } else {
    projects = db.prepare(`
      SELECT p.*, u.name as creator_name,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') as done_count,
        (SELECT COUNT(*) FROM project_members pm2 WHERE pm2.project_id = p.id) as member_count
      FROM projects p JOIN users u ON p.created_by = u.id
      WHERE p.created_by = ? OR EXISTS (
        SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?
      )
      ORDER BY p.created_at DESC
    `).all(req.user.id, req.user.id);
  }
  res.json(projects);
});

app.post("/api/projects", authMiddleware, adminOnly, (req, res) => {
  const { name, description, memberIds } = req.body;
  if (!name) return res.status(400).json({ error: "Project name required" });

  const result = db.prepare(
    "INSERT INTO projects (name, description, created_by) VALUES (?, ?, ?)"
  ).run(name, description || null, req.user.id);

  const projectId = result.lastInsertRowid;

  // Add creator as member
  db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)").run(projectId, req.user.id);

  // Add other members
  if (memberIds && Array.isArray(memberIds)) {
    const stmt = db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)");
    for (const uid of memberIds) stmt.run(projectId, uid);
  }

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  res.status(201).json(project);
});

app.get("/api/projects/:id", authMiddleware, (req, res) => {
  const project = db.prepare(`
    SELECT p.*, u.name as creator_name FROM projects p
    JOIN users u ON p.created_by = u.id WHERE p.id = ?
  `).get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const members = db.prepare(`
    SELECT u.id, u.name, u.email, u.role FROM users u
    JOIN project_members pm ON u.id = pm.user_id WHERE pm.project_id = ?
  `).all(req.params.id);

  const tasks = db.prepare(`
    SELECT t.*, u.name as assignee_name FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id WHERE t.project_id = ? ORDER BY t.created_at DESC
  `).all(req.params.id);

  res.json({ ...project, members, tasks });
});

app.put("/api/projects/:id", authMiddleware, adminOnly, (req, res) => {
  const { name, description, status, memberIds } = req.body;
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  db.prepare("UPDATE projects SET name = ?, description = ?, status = ? WHERE id = ?")
    .run(name || project.name, description ?? project.description, status || project.status, req.params.id);

  if (memberIds && Array.isArray(memberIds)) {
    db.prepare("DELETE FROM project_members WHERE project_id = ?").run(req.params.id);
    const stmt = db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)");
    for (const uid of [project.created_by, ...memberIds]) stmt.run(req.params.id, uid);
  }

  res.json(db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id));
});

app.delete("/api/projects/:id", authMiddleware, adminOnly, (req, res) => {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  res.json({ message: "Project deleted" });
});

app.get("/api/projects/:id/members", authMiddleware, (req, res) => {
  const members = db.prepare(`
    SELECT u.id, u.name, u.email, u.role FROM users u
    JOIN project_members pm ON u.id = pm.user_id WHERE pm.project_id = ?
  `).all(req.params.id);
  res.json(members);
});

app.post("/api/projects/:id/members", authMiddleware, adminOnly, (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });
  db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)").run(req.params.id, userId);
  res.json({ message: "Member added" });
});

app.delete("/api/projects/:id/members/:userId", authMiddleware, adminOnly, (req, res) => {
  db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run(req.params.id, req.params.userId);
  res.json({ message: "Member removed" });
});

// ─── TASK ROUTES ──────────────────────────────────────────────────────────────
app.get("/api/tasks", authMiddleware, (req, res) => {
  let tasks;
  const { project_id, assigned_to, status } = req.query;
  let where = [];
  let params = [];

  if (req.user.role !== "admin") {
    where.push(`(t.assigned_to = ? OR t.created_by = ? OR EXISTS (
      SELECT 1 FROM project_members pm WHERE pm.project_id = t.project_id AND pm.user_id = ?
    ))`);
    params.push(req.user.id, req.user.id, req.user.id);
  }

  if (project_id) { where.push("t.project_id = ?"); params.push(project_id); }
  if (assigned_to) { where.push("t.assigned_to = ?"); params.push(assigned_to); }
  if (status) { where.push("t.status = ?"); params.push(status); }

  const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
  tasks = db.prepare(`
    SELECT t.*, u.name as assignee_name, p.name as project_name
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    JOIN projects p ON t.project_id = p.id
    ${whereClause}
    ORDER BY t.created_at DESC
  `).all(...params);

  res.json(tasks);
});

app.post("/api/tasks", authMiddleware, (req, res) => {
  const { title, description, status, priority, project_id, assigned_to, due_date } = req.body;
  if (!title || !project_id) return res.status(400).json({ error: "Title and project_id required" });

  // Members can only create tasks in their projects
  if (req.user.role !== "admin") {
    const member = db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?").get(project_id, req.user.id);
    if (!member) return res.status(403).json({ error: "Not a member of this project" });
  }

  const result = db.prepare(`
    INSERT INTO tasks (title, description, status, priority, project_id, assigned_to, due_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title, description || null,
    status || "todo", priority || "medium",
    project_id, assigned_to || null, due_date || null, req.user.id
  );

  const task = db.prepare(`
    SELECT t.*, u.name as assignee_name, p.name as project_name
    FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
    JOIN projects p ON t.project_id = p.id WHERE t.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(task);
});

app.get("/api/tasks/:id", authMiddleware, (req, res) => {
  const task = db.prepare(`
    SELECT t.*, u.name as assignee_name, p.name as project_name
    FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
    JOIN projects p ON t.project_id = p.id WHERE t.id = ?
  `).get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json(task);
});

app.put("/api/tasks/:id", authMiddleware, (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  // Members can only update status of tasks assigned to them
  if (req.user.role !== "admin") {
    if (task.assigned_to !== req.user.id && task.created_by !== req.user.id) {
      return res.status(403).json({ error: "Not authorized to update this task" });
    }
  }

  const { title, description, status, priority, assigned_to, due_date } = req.body;
  db.prepare(`
    UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, assigned_to = ?, due_date = ?
    WHERE id = ?
  `).run(
    title || task.title, description ?? task.description,
    status || task.status, priority || task.priority,
    req.user.role === "admin" ? (assigned_to ?? task.assigned_to) : task.assigned_to,
    due_date ?? task.due_date, req.params.id
  );

  const updated = db.prepare(`
    SELECT t.*, u.name as assignee_name, p.name as project_name
    FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
    JOIN projects p ON t.project_id = p.id WHERE t.id = ?
  `).get(req.params.id);
  res.json(updated);
});

app.delete("/api/tasks/:id", authMiddleware, (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (req.user.role !== "admin" && task.created_by !== req.user.id)
    return res.status(403).json({ error: "Not authorized" });
  db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
  res.json({ message: "Task deleted" });
});

// ─── DASHBOARD STATS ──────────────────────────────────────────────────────────
app.get("/api/dashboard", authMiddleware, (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  let stats;

  if (req.user.role === "admin") {
    stats = {
      totalProjects: db.prepare("SELECT COUNT(*) as c FROM projects").get().c,
      activeProjects: db.prepare("SELECT COUNT(*) as c FROM projects WHERE status='active'").get().c,
      totalUsers: db.prepare("SELECT COUNT(*) as c FROM users").get().c,
      totalTasks: db.prepare("SELECT COUNT(*) as c FROM tasks").get().c,
      todoTasks: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status='todo'").get().c,
      inProgressTasks: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status='in-progress'").get().c,
      doneTasks: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status='done'").get().c,
      overdueTasks: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE due_date < ? AND status != 'done'").get(today).c,
      recentTasks: db.prepare(`
        SELECT t.*, u.name as assignee_name, p.name as project_name
        FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
        JOIN projects p ON t.project_id = p.id
        ORDER BY t.created_at DESC LIMIT 5
      `).all(),
      tasksByPriority: {
        high: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE priority='high' AND status!='done'").get().c,
        medium: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE priority='medium' AND status!='done'").get().c,
        low: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE priority='low' AND status!='done'").get().c,
      }
    };
  } else {
    stats = {
      totalProjects: db.prepare(`SELECT COUNT(DISTINCT p.id) as c FROM projects p
        JOIN project_members pm ON p.id = pm.project_id WHERE pm.user_id = ?`).get(req.user.id).c,
      activeProjects: db.prepare(`SELECT COUNT(DISTINCT p.id) as c FROM projects p
        JOIN project_members pm ON p.id = pm.project_id WHERE pm.user_id = ? AND p.status='active'`).get(req.user.id).c,
      totalUsers: 0,
      totalTasks: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE assigned_to = ? OR created_by = ?").get(req.user.id, req.user.id).c,
      todoTasks: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE (assigned_to = ? OR created_by = ?) AND status='todo'").get(req.user.id, req.user.id).c,
      inProgressTasks: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE (assigned_to = ? OR created_by = ?) AND status='in-progress'").get(req.user.id, req.user.id).c,
      doneTasks: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE (assigned_to = ? OR created_by = ?) AND status='done'").get(req.user.id, req.user.id).c,
      overdueTasks: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE (assigned_to = ? OR created_by = ?) AND due_date < ? AND status != 'done'").get(req.user.id, req.user.id, today).c,
      recentTasks: db.prepare(`
        SELECT t.*, u.name as assignee_name, p.name as project_name
        FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
        JOIN projects p ON t.project_id = p.id
        WHERE t.assigned_to = ? OR t.created_by = ?
        ORDER BY t.created_at DESC LIMIT 5
      `).all(req.user.id, req.user.id),
      tasksByPriority: {
        high: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE (assigned_to=? OR created_by=?) AND priority='high' AND status!='done'").get(req.user.id, req.user.id).c,
        medium: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE (assigned_to=? OR created_by=?) AND priority='medium' AND status!='done'").get(req.user.id, req.user.id).c,
        low: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE (assigned_to=? OR created_by=?) AND priority='low' AND status!='done'").get(req.user.id, req.user.id).c,
      }
    };
  }

  res.json(stats);
});

// ─── Catch-All (SPA) ──────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 TaskFlow running on http://localhost:${PORT}`);
});

module.exports = app;
