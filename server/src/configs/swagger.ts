/**
 * Swagger / OpenAPI Documentation Setup
 *
 * Generates interactive API documentation from JSDoc annotations.
 * Accessible at GET /api/docs when the server is running.
 */

import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import type { Express } from "express";

const options: { definition: Record<string, any>; apis: string[] } = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Orbit API",
      version: "1.0.0",
      description: `
Orbit is a real-time social platform API with support for posts, comments, chat, communities, stories (glimpses), group calls, and more.

## Features
- **Auth**: JWT-based authentication with CSRF protection
- **Real-time**: Socket.IO for instant messaging, presence, and notifications
- **Feed**: Personalized affinity-based feed with diversity ranking
- **Social**: Posts, comments, likes, saves, reposts, follows
- **Content**: Images, video, polls, collab posts, drafts, scheduling
- **Communities**: Group chats with members and admin controls
- **Calls**: 1:1 WebRTC and community group calls via LiveKit
- **Glimpses**: Ephemeral stories with reactions and replies
- **Analytics**: Per-user engagement metrics and trends
`,
      contact: {
        name: "Orbit Team",
        url: "https://github.com/orbit",
      },
    },
    servers: [
      {
        url: "http://localhost:5000",
        description: "Development server",
      },
      {
        url: "https://api.orbit.app",
        description: "Production server",
      },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "jwt",
          description: "JWT token stored in httpOnly cookie (set by /api/auth/login)",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT token in Authorization header: Bearer <token>",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string" },
            requestId: { type: "string" },
          },
        },
        User: {
          type: "object",
          properties: {
            _id: { type: "string" },
            username: { type: "string" },
            fullName: { type: "string" },
            email: { type: "string" },
            bio: { type: "string" },
            profilePic: {
              type: "object",
              properties: {
                url: { type: "string" },
                public_id: { type: "string" },
              },
            },
            followersCount: { type: "integer" },
            followingCount: { type: "integer" },
          },
        },
        Post: {
          type: "object",
          properties: {
            _id: { type: "string" },
            title: { type: "string" },
            content: { type: "string" },
            slug: { type: "string" },
            author: { $ref: "#/components/schemas/User" },
            image: { type: "object" },
            hashtags: { type: "array", items: { type: "string" } },
            likesCount: { type: "integer" },
            commentsCount: { type: "integer" },
            repostsCount: { type: "integer" },
            savesCount: { type: "integer" },
            viewsCount: { type: "integer" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Pagination: {
          type: "object",
          properties: {
            nextCursor: { type: "string", nullable: true },
            hasMore: { type: "boolean" },
          },
        },
      },
    },
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    tags: [
      { name: "Auth", description: "Authentication endpoints" },
      { name: "Users", description: "User profile management" },
      { name: "Posts", description: "Post CRUD and interactions" },
      { name: "Comments", description: "Comments and replies" },
      { name: "Chat", description: "Direct messaging and group chats" },
      { name: "Communities", description: "Community management" },
      { name: "Feed", description: "Personalized and ranked feed" },
      { name: "Notifications", description: "Push and in-app notifications" },
      { name: "Search", description: "Search users, posts, hashtags" },
      { name: "Analytics", description: "User analytics dashboard" },
      { name: "Admin", description: "Admin-only moderation endpoints" },
    ],
  },
  apis: ["./src/routes/*.ts", "./src/controllers/*.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);

/**
 * Mount Swagger UI at the given path on the Express app.
 */
export const setupSwagger = (app: Express, path: string = "/api/docs"): void => {
  app.use(
    path,
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      explorer: true,
      customCss: ".swagger-ui .topbar { display: none }",
      customSiteTitle: "Orbit API Documentation",
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
      },
    }),
  );

  // Serve raw OpenAPI spec as JSON
  app.get(`${path}.json`, (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.json(swaggerSpec);
  });
};
