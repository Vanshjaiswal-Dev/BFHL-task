# DeskFlow

DeskFlow is a MERN support ticket triage board built for the assessment requirements.

## Project Structure

- `backend/` - Express, MongoDB, Mongoose API
- `frontend/` - Vite React single-page board UI

## Local Setup

1. Create `backend/.env` from `backend/.env.example` and set `MONGODB_URI`.
2. Create `frontend/.env` from `frontend/.env.example` and set `VITE_API_URL`.
3. Install and run the backend:

```bash
cd backend
npm install
npm run dev
```

4. Install and run the frontend:

```bash
cd frontend
npm install
npm run dev
```

## Required Deployment Variables

Backend:

- `MONGODB_URI`
- `CLIENT_ORIGIN`
- `PORT` is optional. Render/Railway usually provides it automatically.

Frontend:

- `VITE_API_URL`

## Submission Links Needed

- Public GitHub repository URL
- Live deployed frontend URL
