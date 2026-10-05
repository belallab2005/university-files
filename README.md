# University Files Portal

A simple Arabic university subject-files portal built with Node.js, Express and Multer.

## Project structure

```text
.
├── public/
│   ├── index.html
│   └── admin.html
├── server.js
├── package.json
├── package-lock.json
├── render.yaml
├── .env.example
└── .gitignore
```

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Set an admin password of at least 12 characters.

PowerShell:

```powershell
$env:ADMIN_PASSWORD="your-strong-password-here"
npm start
```

Open:

- http://localhost:3000
- http://localhost:3000/admin.html

Local data is stored in `storage/` and is ignored by Git.

## GitHub

Do not commit passwords, `storage/`, `node_modules/`, or uploaded files. The included `.gitignore` protects these paths. Render can install the dependencies directly from `package.json`.

## Render

Create a **Web Service** connected to this GitHub repository.

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`
- Environment variable: `ADMIN_PASSWORD` = your strong password
- Environment variable: `DATA_DIR` = `/var/data`

### Important: persistent uploaded files

This application writes the subject database and uploaded files to `DATA_DIR`.
Render's default filesystem is ephemeral, so uploaded files and the JSON database are lost after restarts/redeploys unless you attach a persistent disk. Render documents that persistent disks are available on paid web services, while Free web services do not support them.

For a real deployment, attach a Render persistent disk mounted at `/var/data`. Then keep `DATA_DIR=/var/data`.

If you intentionally use Render Free, treat the deployment as a demo/test environment and do not rely on uploaded files surviving restarts or redeploys.
