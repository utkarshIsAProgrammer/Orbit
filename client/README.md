# Orbit Frontend - Complete Guide

A modern, responsive social media frontend built with React 19, TypeScript, Tailwind CSS v4, and Socket.io.

## Overview

Orbit is a simpler social feed platform. This frontend provides a polished dark-themed glassmorphic UI with real-time chat, post feeds, user profiles, threaded comments, and live notifications — all optimized for both mobile and desktop.

## Features

- **User Authentication**: Login, signup, logout with JWT httpOnly cookies
- **User Profiles**: View and edit profiles with avatar and banner image cropping
- **Post Feed**: Create, like, comment, save, and repost posts with hashtag/mention support
- **Real-time Updates**: Live notifications and post interactions via Socket.io
- **Direct Messaging**: Full chat system with message edit/delete, reactions, file attachments, and presence indicators
- **Search**: Search users and posts with partial matching
- **Responsive Design**: Mobile-first with bottom dock navigation + desktop sidebar layout
- **Dark Mode**: Forced dark space theme with glassmorphic elements
- **Image Cropping**: Built-in crop modal for profile and post images
- **Smooth Animations**: Framer Motion spring animations throughout
- **Pull-to-Refresh**: Touch gesture support for mobile feed reload
- **CSRF Protection**: Double-submit cookie pattern — CSRF token sent as header on all mutations
- **Error Boundaries**: Root + content-area error boundaries prevent white screen crashes
- **Form Validation**: Field-level inline error messages across all forms
- **Client-side Caching**: Per-endpoint TTL caching with automatic invalidation

## Tech Stack

| Technology                       | Purpose                                 |
| -------------------------------- | --------------------------------------- |
| **React 19**                     | UI framework                            |
| **TypeScript**                   | Type safety                             |
| **Vite**                         | Build tool (fast HMR, optimized builds) |
| **Tailwind CSS v4**              | Utility-first styling                   |
| **Framer Motion (motion/react)** | Spring animations, layout animations    |
| **Lucide React**                 | Icon library                            |
| **Socket.io Client**             | Real-time bidirectional communication   |
| **GSAP**                         | Hero section timeline animations        |
| **react-easy-crop**              | Image crop UI                           |

## Prerequisites

- Node.js 18+
- Backend server running (see [orbit-server](../orbit-server/README.md))

## Installation

```bash
npm install
```

### Environment Variables (optional)

```bash
VITE_API_URL=http://localhost:5000
# WebRTC calls — production-grade TURN relay (recommended for reliable
# calls behind NAT/cellular networks). Falls back to free public relays.
VITE_TURN_URL=turn:your-turn-server.example.com:3478
VITE_TURN_USERNAME=your-turn-username
VITE_TURN_CREDENTIAL=your-turn-password
# OR provide a full JSON array of RTCIceServer objects
VITE_ICE_SERVERS=[{"urls":"turn:your-turn-server.example.com:3478","username":"u","credential":"p"}]
```

### Development

```bash
npm run dev
```

### Production Build

```bash
npm run build
npm run preview
```

## Project Structure

```
src/
├── components/       # React components
│   ├── Auth.tsx          # Login/Signup forms
│   ├── Feed.tsx          # Main post feed with composer
│   ├── Explore.tsx       # Search/browse users & posts
│   ├── Profile.tsx       # User profile view/edit
│   ├── Chat.tsx          # Real-time direct messaging
│   ├── Notifications.tsx # Notification inbox
│   ├── Settings.tsx      # Account settings (profile, password, delete)
│   ├── Dock.tsx          # Bottom navigation (macOS-style)
│   ├── LeftSidebar.tsx   # Desktop sidebar navigation
│   ├── GlassCard.tsx     # Reusable glassmorphic card wrapper
│   ├── ConfirmDialog.tsx # Reusable confirmation modal
│   ├── CommentNode.tsx   # Recursive threaded comment component
│   ├── Skeleton.tsx      # Loading skeleton with shimmer
│   └── ... (PostModal, ImageCropModal, etc.)
├── utils/
│   └── api.ts            # API client with caching
├── types.ts              # Shared TypeScript interfaces
├── App.tsx               # Root component with global state & routing
└── main.tsx              # Entry point
```

## Beginner's Guide to Frontend Development

### What is a Frontend?

The frontend is what users see and interact with in their browser. It:

- Displays the user interface (buttons, forms, posts)
- Handles user interactions (clicks, typing, scrolling)
- Sends requests to the backend
- Shows data from the backend
- Provides real-time updates via Socket.io

### Key Concepts Explained

#### 1. Components (Building Blocks)

Components are reusable pieces of UI. Think of them like Lego blocks.

**Example:**

```typescript
function MyComponent() {
  return (
    <div>
      <h1>Hello World</h1>
      <p>This is my component</p>
    </div>
  );
}

export default MyComponent;
```

#### 2. State (Data Management)

State is data that can change over time. When state changes, React updates the UI automatically.

**Example:**

```typescript
function Counter() {
  const [count, setCount] = useState(0); // State

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </div>
  );
}
```

#### 3. Props (Passing Data)

Props are how you pass data between components.

**Example:**

```typescript
function Greeting({ name }) { // Receive props
  return <h1>Hello, {name}!</h1>;
}

// Usage
<Greeting name="John" />
```

#### 4. useEffect (Side Effects)

useEffect runs code when something changes (like when component mounts or data changes).

**Example:**

```typescript
function UserProfile() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    // This runs when component mounts
    fetchUser().then(data => setUser(data));
  }, []); // Empty array = run once

  return user ? <p>{user.name}</p> : <p>Loading...</p>;
}
```

#### 5. Styling with Tailwind CSS

Tailwind CSS uses utility classes for styling.

**Example:**

```typescript
<div className="bg-white text-black p-4 rounded-lg shadow">
  <h1 className="text-2xl font-bold">Title</h1>
  <p className="text-gray-600">Description</p>
</div>
```

Common classes:

- `p-4` = padding: 1rem
- `m-4` = margin: 1rem
- `bg-white` = background color: white
- `text-black` = text color: black
- `rounded-lg` = border radius: large
- `shadow` = box shadow

### Common Tasks for Beginners

#### Task 1: Creating a New Component

**Step 1:** Create the file in `src/components/`

```typescript
// MyNewComponent.tsx
function MyNewComponent() {
  return (
    <div className="p-4">
      <h2>My New Component</h2>
    </div>
  );
}

export default MyNewComponent;
```

**Step 2:** Import and use it in another component

```typescript
import MyNewComponent from './components/MyNewComponent';

function App() {
  return (
    <div>
      <MyNewComponent />
    </div>
  );
}
```

#### Task 2: Making an API Call

```typescript
import { apiFetch } from './utils/api';
import { useState, useEffect } from 'react';

function MyComponent() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/posts')
      .then(response => {
        setData(response);
        setLoading(false);
      })
      .catch(error => {
        console.error(error);
        setLoading(false);
      });
  }, []);

  if (loading) return <p>Loading...</p>;

  return data ? <div>{JSON.stringify(data)}</div> : <p>Error loading data</p>;
}
```

#### Task 3: Adding User Interactions

```typescript
function LikeButton({ postId }) {
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);

  const handleLike = async () => {
    try {
      // Optimistic update (update UI immediately)
      setLiked(!liked);
      setLikesCount(prev => liked ? prev - 1 : prev + 1);

      // Make API call
      await apiFetch(`/api/likes/post/${postId}`, { method: 'POST' });
    } catch (error) {
      // Revert on error
      setLiked(!liked);
      setLikesCount(prev => liked ? prev + 1 : prev - 1);
    }
  };

  return (
    <button onClick={handleLike}>
      {liked ? '❤️' : '🤍'} {likesCount}
    </button>
  );
}
```

#### Task 4: Handling Forms

```typescript
function PostForm() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      await apiFetch('/api/posts', {
        method: 'POST',
        body: JSON.stringify({ title, content }),
      });

      // Clear form
      setTitle('');
      setContent('');
    } catch (error) {
      setError('Failed to create post');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Content"
      />
      {error && <p className="text-red-500">{error}</p>}
      <button type="submit">Create Post</button>
    </form>
  );
}
```

### Testing the Frontend

The frontend should automatically reload when you make changes. If not:

1. Check the terminal for errors
2. Try refreshing the browser
3. Restart the dev server: `npm run dev`

### Troubleshooting

**Frontend won't start:**

- Check if Node.js version is 18+
- Delete `node_modules` and run `npm install` again
- Check if port 5173 is already in use

**Can't connect to backend:**

- Check if backend server is running
- Verify `VITE_API_URL` in `.env`
- Check browser console for CORS errors

**Styles not loading:**

- Check if Tailwind CSS is properly configured
- Try clearing browser cache
- Restart the dev server

**Component not updating:**

- Check if state is being updated correctly
- Verify useEffect dependencies
- Check console for errors

## Architecture

- **Global state** lives in `App.tsx` (user, conversations, notifications, following states)
- **Cross-component sync** uses `window.dispatchEvent` + `CustomEvent` for post interactions
- **Lazy loading** via `React.lazy()` + `Suspense` for all tab content
- **Optimistic updates**: Like/save/repost update UI immediately, rollback on error
- **Socket.io**: Single persistent connection for real-time features

## Socket.io Events

### Listen (Server → Client)

- `notification` — New notification received
- `message:new` / `message:edit` / `message:delete` — Chat messages
- `messages:seen` — Read receipts
- `chat:typing` — Typing indicator
- `user:presence` — Online/offline status
- `post:like/unlike` / `post:save/unsave` / `post:repost/unrepost` — Real-time interaction sync
- `post:created` / `post:deleted` / `post:updated` — Real-time post changes
- `comment:reply` / `comment:updated` / `comment:deleted` — Real-time comment changes

### Emit (Client → Server)

- `chat:join` / `chat:leave` — Join/leave conversation room
- `chat:typing` — Typing status

## Scripts

| Script             | Description              |
| ------------------ | ------------------------ |
| `npm run dev`      | Start Vite dev server    |
| `npm run build`    | Production build         |
| `npm run preview`  | Preview production build |
| `npx tsc --noEmit` | TypeScript type check    |
