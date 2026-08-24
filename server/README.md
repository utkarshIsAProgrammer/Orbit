# Orbit Backend - Complete Guide

<!-- freebuff --continue 2026-08-10T19-35-03.109Z -->
<!-- freebuff --continue 2026-08-10T19-35-03.109Z -->

A production-ready social media backend built with TypeScript, Express.js, MongoDB, and Redis.

## Overview

Orbit is a simpler social feed platform. This backend provides a RESTful API with real-time capabilities via Socket.io, featuring JWT authentication, Redis caching, Cloudinary file storage, and comprehensive rate limiting.

## Features

- **JWT Authentication**: httpOnly cookie-based auth with login lockout protection
- **User Profiles**: Full CRUD with avatar/banner images
- **Posts**: Create, edit, delete with image upload, hashtags, and @mentions
- **Threaded Comments**: Nested replies with real-time sync
- **Interactions**: Like, follow, save, repost with optimistic sync
- **Real-time**: Socket.io for instant notifications, chat, and presence
- **Search**: Dual-strategy (text index + regex fallback) for users and posts
- **Direct Messaging**: 1-on-1 chat with message edit/delete (5-min window), file attachments, read receipts, typing indicators
- **Caching**: Redis-based with per-endpoint TTL and pattern-based invalidation
- **Rate Limiting**: Per-endpoint limits (auth, OTP, comments, interactions, search, uploads)
- **Security**: CSRF double-submit cookie, Helmet headers, XSS sanitization, Zod validation, bcrypt password hashing, brute-force lockout, rate limiting
- **Health check**: `GET /api/health` endpoint with DB + Redis status for orchestrator probes
- **Process safety**: `uncaughtException` / `unhandledRejection` handlers for graceful shutdown
- **Request tracing**: UUID per-request for log correlation
- **Email**: Transactional emails via Nodemailer (welcome, OTP, password reset, account deletion)

## Tech Stack

| Technology             | Purpose                 |
| ---------------------- | ----------------------- |
| **Node.js**            | Runtime                 |
| **TypeScript**         | Type safety             |
| **Express.js**         | Web framework           |
| **MongoDB + Mongoose** | Database + ODM          |
| **Redis (Upstash)**    | Caching + presence      |
| **Socket.io**          | Real-time communication |
| **Cloudinary**         | Image storage + CDN     |
| **Nodemailer**         | Email delivery          |
| **Zod**                | Schema validation       |
| **Helmet**             | Security headers        |
| **sanitize-html**      | XSS prevention          |
| **bcryptjs**           | Password hashing        |
| **express-rate-limit** | Rate limiting           |
| **Multer**             | File upload parsing     |

## Prerequisites

- Node.js 18+
- MongoDB database
- Redis instance (Upstash recommended)
- Cloudinary account
- SMTP server (Gmail App Password, SendGrid, etc.)

## Installation

```bash
npm install
```

### Environment Variables

```bash
cp .env.example .env
# Edit .env with your credentials
```

| Variable                   | Required | Description                 |
| -------------------------- | -------- | --------------------------- |
| `PORT`                     | No       | Server port (default: 5000) |
| `MONGO_URI`                | Yes      | MongoDB connection string   |
| `JWT_SECRET`               | Yes      | JWT signing secret          |
| `UPSTASH_REDIS_REST_URL`   | Yes      | Upstash Redis REST URL      |
| `UPSTASH_REDIS_REST_TOKEN` | Yes      | Upstash Redis token         |
| `CLOUDINARY_NAME`          | Yes      | Cloudinary cloud name       |
| `CLOUDINARY_API_KEY`       | Yes      | Cloudinary API key          |
| `CLOUDINARY_API_SECRET`    | Yes      | Cloudinary API secret       |
| `SMTP_HOST`                | Yes      | SMTP server host            |
| `SMTP_USER`                | Yes      | SMTP username               |
| `SMTP_PASS`                | Yes      | SMTP password               |
| `CLIENT_URL`               | Yes      | Frontend URL for CORS       |
| `NODE_ENV`                 | No       | production/development      |

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

## Project Structure

```
src/
├── configs/          # Service configurations
│   ├── cache.ts          # Redis cache helpers
│   ├── cloudinary.ts     # Cloudinary setup
│   ├── cookie.ts         # Cookie options
│   ├── env.ts            # Zod env validation
│   ├── nodeMailer.ts     # Email transporter
│   ├── sanitize.ts       # XSS sanitization
│   └── socket.ts         # Socket.io server
├── controllers/      # Request handlers (12 controllers)
├── db/               # MongoDB connection with retry logic
├── middlewares/       # Auth, rate limit, upload, view
├── models/           # Mongoose schemas (10 models)
├── routes/           # Express route definitions (12 route files)
├── schemas/          # Zod validation schemas
├── utilities/        # Helpers (errors, logger, notification)
└── server.ts         # Entry point
```

## Beginner's Guide to Backend Development

### What is a Backend?

The backend is the server-side of the application. It:

- Stores and retrieves data from the database
- Handles business logic (calculations, validations)
- Provides APIs that the frontend can call
- Manages authentication and security
- Sends emails and notifications

### Key Concepts Explained

#### 1. Routes (API Endpoints)

Routes are like "doors" that define how the frontend can talk to the backend.

**Example:**

```typescript
// GET /api/posts - Get all posts
router.get("/", getAllPosts);

// POST /api/posts - Create a new post
router.post("/", createPost);

// PUT /api/posts/:id - Update a post
router.put("/:id", updatePost);

// DELETE /api/posts/:id - Delete a post
router.delete("/:id", deletePost);
```

#### 2. Controllers (Business Logic)

Controllers contain the actual logic for handling requests.

**Example:**

```typescript
export const createPost = async (req, res) => {
    try {
        // 1. Get data from request
        const { title, content } = req.body;

        // 2. Validate data
        if (!title || !content) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        // 3. Save to database
        const post = await Post.create({
            title,
            content,
            author: req.user._id,
        });

        // 4. Send response
        res.status(201).json({ success: true, data: post });
    } catch (error) {
        // 5. Handle errors
        res.status(500).json({ message: "Server error" });
    }
};
```

#### 3. Models (Database Structure)

Models define what data looks like in the database.

**Example:**

```typescript
const postSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true,
    },
    content: {
        type: String,
        required: true,
    },
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});
```

#### 4. Middlewares (Security & Processing)

Middlewares are functions that run before the controller.

**Example:**

```typescript
// Check if user is logged in
router.post("/", protect, createPost);

// Rate limit (prevent spam)
router.post("/", protect, rateLimiter, createPost);

// Upload files
router.post("/", protect, uploadMiddleware, createPost);
```

### Common Tasks for Beginners

#### Task 1: Adding a New API Endpoint

**Step 1:** Create the controller function in `src/controllers/`

```typescript
export const myNewFunction = async (req, res) => {
    try {
        // Your logic here
        const result = await SomeModel.find();
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ message: "Error occurred" });
    }
};
```

**Step 2:** Add the route in `src/routes/`

```typescript
import { myNewFunction } from "../controllers/myController";

router.get("/my-endpoint", myNewFunction);
```

**Step 3:** Test it using curl or Postman

```bash
curl http://localhost:5000/api/my-endpoint
```

#### Task 2: Adding Database Fields

**Step 1:** Update the model in `src/models/`

```typescript
const schema = new mongoose.Schema({
    existingField: String,
    newField: {
        type: String,
        default: "default value",
    },
});
```

**Step 2:** Restart the server

#### Task 3: Adding Validation

**Step 1:** Create a schema in `src/schemas/`

```typescript
import { z } from "zod";

export const mySchema = z.object({
    name: z.string().min(3).max(50),
    email: z.string().email(),
});
```

**Step 2:** Use it in your controller

```typescript
import { mySchema } from "../schemas/mySchema";

export const myFunction = async (req, res) => {
    const result = mySchema.safeParse(req.body);

    if (!result.success) {
        return res.status(400).json({ errors: result.error.issues });
    }

    // Proceed with valid data
};
```

### Testing the Backend

#### Health Check

```bash
curl http://localhost:5000/api/health
```

Expected response:

```json
{
    "success": true,
    "message": "Server is healthy!",
    "checks": {
        "database": "connected",
        "redis": "connected"
    }
}
```

#### Testing an Endpoint

```bash
# Get all posts
curl http://localhost:5000/api/posts

# Create a post (requires authentication)
curl -X POST http://localhost:5000/api/posts \
  -H "Content-Type: application/json" \
  -d '{"title":"My Post","content":"Hello World"}'
```

### Troubleshooting

**Server won't start:**

- Check if MongoDB is running
- Check if Redis is running
- Verify all environment variables in `.env`
- Check if port 5000 is already in use

**Database connection error:**

- Verify `MONGO_URI` in `.env`
- Check if MongoDB is running
- Try restarting MongoDB

**Redis connection error:**

- Verify Redis URL and token in `.env`
- Check if Redis is running
- Try restarting Redis

## API Endpoints

### Auth

- `POST /api/auth/signup` — Register new user
- `POST /api/auth/login` — Login
- `POST /api/auth/logout` — Logout

### Posts

- `GET /api/posts` — Paginated feed
- `GET /api/posts/:postId` — Single post
- `GET /api/posts/slug/:slug` — Post by slug
- `GET /api/posts/hashtag/:hashtag` — Posts by hashtag
- `POST /api/posts` — Create post (with image)
- `PUT /api/posts/:postId` — Update post
- `DELETE /api/posts/:postId` — Delete post
- `POST /api/posts/:postId/share` — Share post
- `POST /api/posts/:postId/view` — View count

### Comments

- `GET /api/comments/:postId` — Get comments for post
- `GET /api/comments/replies/:commentId` — Get replies
- `POST /api/comments/:postId` — Add comment
- `PUT /api/comments/:commentId` — Edit comment
- `DELETE /api/comments/:commentId` — Delete comment

### Interactions

- `POST /api/likes/post/:postId` — Toggle post like
- `POST /api/likes/comment/:commentId` — Toggle comment like
- `POST /api/follows/:userId` — Toggle follow
- `POST /api/saves/:postId` — Toggle save
- `POST /api/reposts/:postId` — Toggle repost

### Users

- `GET /api/users/:userId` — Get user by ID
- `GET /api/users/username/:username` — Get user by username
- `GET /api/users/:userId/posts` — Get user's posts
- `PUT /api/users/update-profile` — Update profile
- `DELETE /api/users/delete-account` — Delete account
- `POST /api/users/:userId/share` — Share profile
- `POST /api/users/:userId/view` — View count

### Chat

- `POST /api/chats/conversations` — Start/get conversation
- `GET /api/chats/conversations` — List conversations
- `GET /api/chats/conversations/:id/messages` — Get messages
- `POST /api/chats/conversations/:id/messages` — Send message
- `PUT /api/chats/messages/:messageId` — Edit message
- `DELETE /api/chats/messages/:messageId` — Delete message

### Other

- `GET /api/search/users?q=` — Search users
- `GET /api/search/posts?q=` — Search posts
- `GET /api/notifications` — Get notifications
- `PUT /api/notifications/read` — Mark all read
- `POST /api/password/forgot` — Request OTP
- `POST /api/password/reset` — Reset password
- `GET /api/health` — Health check

## Rate Limits

| Endpoint     | Limit                 |
| ------------ | --------------------- |
| Auth routes  | 20 requests / 15 min  |
| OTP requests | 5 requests / 10 min   |
| Comments     | 20 requests / min     |
| Interactions | 30 requests / min     |
| Search       | 30 requests / min     |
| Uploads      | 10 requests / min     |
| General      | 100 requests / 15 min |

## Caching

- **Provider**: Redis (Upstash)
- **TTL**: 30 min (posts, users) / 5 min (auth sessions) / 2 min (comments) / 1 min (search)
- **Invalidation**: Mutation endpoints clear related cache patterns automatically
