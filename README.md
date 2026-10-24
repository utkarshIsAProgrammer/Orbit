# 🪐 ORBIT — Spatial Social Network & Real-Time Workspace

<div align="center">

```
   ____  ____  ____  ____ _____
  / __ \/ __ \/ __ )/  _//_  __/
 / / / / /_/ / __  | / /   / /   
/ /_/ / _, _/ /_/ /_/ /   / /    
\____/_/ |_/_____//___/  /_/     
                                 
Next-Generation Gesture-First Social Network, Realtime Messaging & Spatial Video
```

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-3178C6.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.0+-20232a.svg?style=for-the-badge&logo=react&logoColor=61dafb)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2+-646CFF.svg?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-v4-38B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933.svg?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.21+-000000.svg?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248.svg?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8+-010101.svg?style=for-the-badge&logo=socket.io&logoColor=white)](https://socket.io/)
[![LiveKit](https://img.shields.io/badge/LiveKit-WebRTC-black.svg?style=for-the-badge&logo=webrtc&logoColor=white)](https://livekit.io/)
[![Three.js](https://img.shields.io/badge/Three.js-R3F-black.svg?style=for-the-badge&logo=three.js&logoColor=white)](https://threejs.org/)

[Features](#-key-features) • [Architecture](#-system-architecture) • [Monorepo Apps](#-monorepo-structure) • [Quickstart](#-quickstart) • [Documentation Index](#-documentation-index) • [API Directory](#-api-routes) • [Deployment](#-deployment)

</div>

---

## 🛰️ Overview

**Orbit** is a full-featured, mobile-first social platform and real-time collaboration environment engineered from scratch with **React 19**, **Node.js**, **Express**, **TypeScript**, **MongoDB**, **Socket.IO**, and **LiveKit WebRTC**.

Orbit merges discovery feeds, rich media publication, end-to-end real-time direct/group messaging, crystal-clear WebRTC audio/video rooms, gamified engagement loops (XP progression, streaks, daily missions), and an offline-first client architecture powered by **Dexie IndexedDB** and **Service Workers**.

The project is structured as a scalable monorepo containing three deployable applications:
1. **`client/`**: Main React 19 single-page application and progressive web app (PWA).
2. **`server/`**: Scalable Node.js / Express API and Socket.IO real-time engine.
3. **`landingpage/`**: Standalone 3D interactive space storytelling website powered by Three.js and GSAP.

---

## ✨ Key Features

### 📰 Dynamic Discovery & Content Feeds
- **Personalized "For You" Feed**: Algorithmic scoring balancing post recency, engagement velocity, and topic affinity.
- **Following & Trending**: Real-time chronological timelines, trending hashtags, and curated topic streams.
- **Rich Media & Micro-Posts**: Markdown support, code syntax highlighting, link previews, multi-image carousels, and video players.
- **Glimpse (Stories)**: Ephemeral, 24-hour media stories with interactive sticker reactions.

### ⚡ Real-Time Communications & Calling
- **Socket.IO Messaging**: Instant direct and group chat with typing indicators, online presence, read receipts, and message reactions.
- **Spatial Video & Audio (LiveKit)**: Multi-party WebRTC voice and video calls with dynamic layout switching, screen sharing, and active-speaker tracking.

### 🎮 Gamification & Retention Engine
- **XP Progression & Levels**: Earn experience points by interacting, sharing thoughtful commentary, and publishing content.
- **Daily Missions**: Dynamic daily quests with milestone rewards that incentivize engagement.
- **Streaks & Leaderboards**: Global and community leaderboards driven by persistent daily user streaks.

### 📱 Gesture-First UI & Offline-First Storage
- **Native Touch Dynamics**: Custom pull-to-refresh, swipe-to-dismiss, drawer reveals, and haptic feedback triggers.
- **Dexie.js Offline Cache**: Stores messages, posts, feeds, and notifications in local IndexedDB. If network connectivity drops, the app functions seamlessly and queues writes.
- **PWA Service Worker**: Full caching with Workbox NetworkFirst and CacheFirst strategies.

### 🛡️ Hardened Security & Administration
- **Granular RBAC**: Role-based permissions across Admins, Moderators, and standard Members.
- **Moderation Engine**: User report processing queue, content flagging, automated word filters, and shadowban controls.
- **Telemetry**: Full error monitoring with Sentry and centralized logging with Logtail.

---

## 🏛️ System Architecture

```
                                  ┌──────────────────────────────┐
                                  │      Client Browser / PWA    │
                                  │   (React 19 + Tailwind v4)   │
                                  └──────┬───────────────┬───────┘
                                         │               │
                     HTTP / REST Requests│               │ Socket.IO Events
                                         ▼               ▼
┌──────────────────────────┐      ┌──────────────────────────────┐      ┌──────────────────────────┐
│     LiveKit Cloud        │ ◄──► │      Orbit API Server        │ ◄──► │     Cloudinary CDN       │
│  - WebRTC Video Mesh     │      │   (Node.js + Express + TS)   │      │  - Image Optimization   │
│  - Spatial Audio Rooms   │      └──────┬───────────────┬───────┘      │  - Video Transcoding     │
└──────────────────────────┘             │               │              └──────────────────────────┘
                                         ▼               ▼
                                  ┌─────────────┐ ┌──────────────┐
                                  │ MongoDB     │ │ Upstash /    │
                                  │ Atlas       │ │ Redis REST   │
                                  │ (35 Models) │ │ (BullMQ /    │
                                  │             │ │ Rate Limit)  │
                                  └─────────────┘ └──────────────┘
```

---

## 📁 Monorepo Structure

```
orbit/
├── client/                     # Main React 19 Frontend SPA & PWA
│   ├── src/
│   │   ├── components/         # Feed cards, chat windows, video grid, modals
│   │   ├── hooks/              # Realtime socket, auth, gesture, and store hooks
│   │   ├── utils/              # Dexie DB instance, formatting, crypto helpers
│   │   ├── landing/            # In-app onboarding and authentication screens
│   │   ├── App.tsx             # Root router and global providers
│   │   └── sw.js               # Service Worker implementation
│   ├── package.json
│   └── vite.config.ts
├── server/                     # Backend API & Realtime Gateway
│   ├── src/
│   │   ├── configs/            # Database, Redis, Socket, LiveKit, and Env setup
│   │   ├── controllers/        # Express route business logic
│   │   ├── middlewares/        # JWT auth, rate limiting, role validation
│   │   ├── models/             # 35 Mongoose schemas (User, Post, Chat, Mission...)
│   │   ├── routes/             # Modular REST endpoint routing definitions
│   │   ├── sockets/            # Socket.IO event handlers and rooms
│   │   └── server.ts           # Server entrypoint and cluster bootstrap
│   ├── scripts/                # Database migration, backup, and seeding scripts
│   └── package.json
├── landingpage/                # Standalone Three.js 3D space scene landing site
│   ├── src/                    # 3D canvas, shaders, GSAP animations
│   └── package.json
├── docs/                       # Complete operational and architectural documentation
├── roadmap/                    # Learning curriculum & codebase walkthrough
├── render.yaml                 # Render infrastructure deployment blueprint
└── README.md
```

---

## 🚀 Quickstart

### Prerequisites
- **Node.js 20+** (v24 recommended)
- **MongoDB** (Local instance or MongoDB Atlas cluster URI)
- *(Optional)*: **Redis** (Local or Upstash Redis URL/Token for BullMQ & rate limiting)

---

### 1. Server Setup

```bash
cd server

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
# Minimum required variables:
# PORT=5006
# NODE_ENV=development
# MONGO_URI=mongodb://localhost:27017/orbit
# JWT_SECRET=your_super_secret_jwt_key
# CLIENT_ORIGIN=http://localhost:5173

# Start development server with hot-reload
npm run dev
```

The API will start at `http://localhost:5006`. Verify health:
```bash
curl http://localhost:5006/api/health
```

---

### 2. Client Setup

```bash
cd ../client

# Install dependencies
npm install # or pnpm install

# Start Vite development server
npm run dev
```

Open `http://localhost:5173` to experience Orbit!

---

### 3. Standalone 3D Landing Page Setup (Optional)

```bash
cd ../landingpage
npm install
npm run dev
```

The 3D space experience will run at `http://localhost:5174`.

---

## 📚 Documentation Index

Orbit features comprehensive documentation located inside the [`docs/`](docs/) directory:

| Document | Purpose |
| :--- | :--- |
| [`STACK.md`](docs/STACK.md) | Full architectural breakdown, third-party libraries, and system limits |
| [`ENV.md`](docs/ENV.md) | Exhaustive catalog of every environment variable (Client + Server) |
| [`ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md) | Administration controls, moderator workflows, and feature flags |
| [`API_REFERENCE.md`](docs/API_REFERENCE.md) | Comprehensive API endpoints, parameters, and authentication requirements |
| [`DATABASE.md`](docs/DATABASE.md) | Schema reference for all 35 Mongoose models, indexes, and repair scripts |
| [`FEATURES.md`](docs/FEATURES.md) | Complete inventory of user-facing and backend features |
| [`GESTURES.md`](docs/GESTURES.md) | Interactive touch gesture map, spring mechanics, and haptics |
| [`RUNBOOK.md`](docs/RUNBOOK.md) | Production operations, health audits, incident mitigation, and rollback |
| [`TESTING.md`](docs/TESTING.md) | Test suite organization, unit tests, and end-to-end Socket tests |

---

## 📡 API Routes

The backend exposes over 35 distinct modular route controllers under `/api`:

| Route Prefix | Primary Purpose |
| :--- | :--- |
| `/api/auth` | Authentication, password reset, OAuth, sessions |
| `/api/user` | Profile management, settings, avatar uploads |
| `/api/post` | Post publishing, media attachments, feeds |
| `/api/feedForYou` | Algorithmic timeline personalization |
| `/api/trending` | Trending tags, viral discussions, search volume |
| `/api/comment` | Threaded discussions and comment reactions |
| `/api/like` & `/api/repost` | Social engagement and timeline redistribution |
| `/api/chat` | Real-time conversations and message archives |
| `/api/glimpse` | Ephemeral 24-hour stories |
| `/api/community` | Community groups, rules, and memberships |
| `/api/dailyMission` | Daily task assignment and reward verification |
| `/api/streak` & `/api/xp` | User retention, streaks, and level calculations |
| `/api/leaderboard` | Global and friends XP rankings |
| `/api/notification` | Push notifications and in-app alert streams |
| `/api/moderation` | Content moderation, ban hammers, report queues |
| `/api/admin` | System-wide statistics and configuration flags |

---

## 🚢 Deployment

The repository includes a ready-to-run **Render Blueprint** (`render.yaml`) for deploying the backend API service:

1. Push this repository to GitHub.
2. In Render: Select **New → Blueprint** and link your repository.
3. Configure secret environment variables in the Render dashboard:
   - `MONGO_URI`, `JWT_SECRET`, `CLOUDINARY_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
4. Deploy the `client/` frontend to **Vercel** or **Cloudflare Pages** with `VITE_API_URL` pointing to your deployed Render URL.

---

## 📄 License

This project is licensed under the MIT License.  
Engineered with precision by [Utkarsh Yadav](https://github.com/utkarshIsAProgrammer).
