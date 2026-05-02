# 🚀 TaskFlow — Project & Task Management System

A full-stack web application for managing projects, assigning tasks, and tracking progress with **role-based access control (Admin/Member)**.

## 🌐 Live Demo
> **[Your Railway URL here]** — Deploy in < 2 minutes (see below)

## ✨ Features

### Authentication
- JWT-based signup/login with bcrypt password hashing
- First registered user is automatically assigned **Admin** role
- Token stored in localStorage with 7-day expiry

### Role-Based Access Control
| Feature | Admin | Member |
|---|---|---|
| Create/Edit/Delete Projects | ✅ | ❌ |
| View assigned projects | ✅ | ✅ |
| Create tasks | ✅ | ✅ (own projects) |
| Assign tasks to users | ✅ | ❌ |
| Update task status | ✅ | ✅ (assigned tasks) |
| Manage team members | ✅ | ❌ |
| View dashboard | ✅ | ✅ (own data) |

### Projects
- Create/edit/archive projects
- Add/remove team members per project
- Progress tracking (% completion)
- Kanban board view (Todo / In Progress / Done)

### Tasks
- Create tasks with title, description, priority, due date
- Assign tasks to project members
- Status tracking: `todo` → `in-progress` → `done`
- Overdue detection and highlighting
- Filter by status (All / Todo / In Progress / Done / Overdue)

### Dashboard
- Stats: Active projects, total tasks, completion rate, overdue count
- Task status breakdown with progress bars
- Priority breakdown (High / Medium / Low)
- Recent tasks table

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express.js |
| Database | SQLite (better-sqlite3) |
| Auth | JWT + bcryptjs |
| Frontend | Vanilla JS SPA |
| Deployment | Railway |

## 📡 REST API Endpoints

### Auth
```
POST /api/auth/signup     — Register new user
POST /api/auth/login      — Login & get JWT token
GET  /api/auth/me         — Get current user info
```

### Users (Admin only for write operations)
```
GET    /api/users          — List all users
PATCH  /api/users/:id/role — Change user role
DELETE /api/users/:id      — Remove user
```

### Projects
```
GET    /api/projects       — List projects (filtered by role)
POST   /api/projects       — Create project [Admin]
GET    /api/projects/:id   — Get project details + members + tasks
PUT    /api/projects/:id   — Update project [Admin]
DELETE /api/projects/:id   — Delete project [Admin]
POST   /api/projects/:id/members    — Add member [Admin]
DELETE /api/projects/:id/members/:userId — Remove member [Admin]
```

### Tasks
```
GET    /api/tasks          — List tasks (filtered by role/project/status)
POST   /api/tasks          — Create task
GET    /api/tasks/:id      — Get task details
PUT    /api/tasks/:id      — Update task (status always editable by assignee)
DELETE /api/tasks/:id      — Delete task
```

### Dashboard
```
GET /api/dashboard         — Stats, recent tasks, priority breakdown
```

## 🚀 Deploy to Railway (< 2 min)

1. Push code to GitHub:
```bash
git init && git add . && git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/taskflow.git
git push -u origin main
```

2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo → Select your repo

3. Set environment variable in Railway dashboard:
```
JWT_SECRET=your_super_secret_key_here
```

4. Click **Deploy** — Railway auto-detects Node.js and runs `node server.js`

5. Your app is live! Click the generated URL.

## 💻 Run Locally

```bash
# Clone & install
git clone https://github.com/YOUR_USERNAME/taskflow.git
cd taskflow
npm install

# Start server
npm start
# → http://localhost:3000
```

## 🗄️ Database Schema

```sql
users         — id, name, email, password, role, created_at
projects      — id, name, description, status, created_by, created_at
project_members — project_id, user_id (many-to-many)
tasks         — id, title, description, status, priority, project_id,
                assigned_to, due_date, created_by, created_at
```

## 🔐 Security Features
- Passwords hashed with bcrypt (salt rounds: 10)
- JWT with expiry (7 days)
- All routes protected by auth middleware
- Role checks on every write operation
- SQL injection protection via parameterized queries
- Foreign key constraints enforced

## 📁 Project Structure
```
taskflow/
├── server.js          # Express server + all API routes
├── public/
│   └── index.html     # Complete SPA frontend
├── package.json
├── Procfile           # Railway deployment
├── railway.toml       # Railway config
└── README.md
```

---
Built with ❤️ for Ethara.ai assignment
