/**
 * @file user.schema.ts
 * @description Zod validation schemas for user-related inputs.
 */

import { z } from "zod";

/**
 * Base user schema for common fields.
 */
const userSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters long!")
    .max(30, "Username must be less than 30 characters!")
    .regex(/^[a-zA-Z0-9_.]+$/, "Username can only contain letters, numbers, underscores, and dots!")
    .trim()
    .lowercase(),

  fullName: z
    .string()
    .min(3, "Full name must be at least 3 characters long!")
    .max(50, "Full name must be less than 50 characters!")
    .trim(),

  gender: z.enum(["male", "female", "others"]).optional(),

  email: z.string().email("Invalid email format!").trim().lowercase(),

  bio: z
    .string()
    .max(300, "Bio must be less than 300 characters!")
    .trim()
    .optional(),

  profilePic: z.string().trim().optional().refine(
    (val) => !val || z.string().url().safeParse(val).success,
    "Invalid profile picture URL!"
  ),

  bannerImage: z.string().trim().optional().refine(
    (val) => !val || z.string().url().safeParse(val).success,
    "Invalid banner image URL!"
  ),

  password: z
    .string()
    .min(8, "Password must be at least 8 characters long!")
    .regex(/[A-Z]/, "Must include uppercase letter!")
    .regex(/[a-z]/, "Must include lowercase letter!")
    .regex(/[0-9]/, "Must include number!")
    .regex(/[^A-Za-z0-9]/, "Must include special character!"),
});

/** Schema for user signup */
export const signupSchema = userSchema
  .extend({
    // Full name & bio are no longer collected at signup — the profile is
    // completed later from Settings → Edit Profile. The controller defaults
    // fullName to the username so no blank display name ever renders.
    fullName: z
      .string()
      .max(50, "Full name must be less than 50 characters!")
      .trim()
      .optional(),
    confirmPassword: z.string(),
  })
  .refine((data) => {
    if (data.password !== data.confirmPassword) {
      return false;
    }
    return true;
  }, {
    message: "Passwords do not match!",
    path: ["confirmPassword"],
  });

/** Schema for user login */
export const loginSchema = z.object({
  usernameOrEmail: z.string().min(1, "Username or email is required!").trim().toLowerCase(),
  password: z.string().min(1, "Password is required!"),
  // Optional new-device detection payload — the client sends a stable
  // deviceId (persisted in localStorage). When absent (old clients / API
  // callers) the login simply skips the new-device email.
  deviceId: z.string().max(200).optional(),
  deviceLabel: z.string().max(200).optional(),
});

/** Schema for updating password while logged in */
export const updatePasswordSchema = z
  .object({
    email: z.string().email("Invalid email format!").trim().lowercase().optional(),
    currentPassword: z.string().min(1, "Current password is required!"),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters long!")
      .max(100, "Password must be less than 100 characters!")
      .regex(/[A-Z]/, "Must include uppercase letter!")
      .regex(/[a-z]/, "Must include lowercase letter!")
      .regex(/[0-9]/, "Must include number!")
      .regex(/[^A-Za-z0-9]/, "Must include special character!"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match!",
    path: ["confirmPassword"],
  });

/** Schema for requesting password reset via email */
export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email format!").trim().lowercase(),
});

/** Schema for verifying OTP and resetting password */
export const verifyOtpSchema = z
  .object({
    email: z.string().email("Invalid email format!").trim().lowercase(),
    otp: z.string(),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters long!")
      .max(100, "Password must be less than 100 characters!")
      .regex(/[A-Z]/, "Must include uppercase letter!")
      .regex(/[a-z]/, "Must include lowercase letter!")
      .regex(/[0-9]/, "Must include number!")
      .regex(/[^A-Za-z0-9]/, "Must include special character!"),
    // The forgot-password UI has a single password field, so confirmPassword
    // is optional here — it is still enforced when a client sends it.
    confirmPassword: z.string().optional(),
  })
  .refine((data) => {
    if (data.confirmPassword !== undefined && data.newPassword !== data.confirmPassword) {
      return false;
    }
    return true;
  }, {
    message: "Passwords do not match!",
    path: ["confirmPassword"],
  });

/** Schema for account deletion */
export const deleteAccountSchema = z.object({
  email: z.string().email("Invalid email format!").trim().lowercase(),
  password: z.string().min(1, "Password is required!"),
});

/** Schema for updating profile */
export const updateProfileSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters long!")
    .max(30, "Username must be less than 30 characters!")
    .regex(/^[a-zA-Z0-9_.]+$/, "Username can only contain letters, numbers, underscores, and dots!")
    .trim()
    .lowercase()
    .optional(),

  fullName: z
    .string()
    .min(3, "Full name must be at least 3 characters long!")
    .max(50, "Full name must be less than 50 characters!")
    .trim()
    .optional(),

  gender: z.enum(["male", "female", "others"]).optional(),

  bio: z
    .string()
    .max(300, "Bio must be less than 300 characters!")
    .trim()
    .optional(),

  // Custom status / presence text ("Busy", "On vacation", etc.)
  statusText: z
    .string()
    .max(80, "Status text must be less than 80 characters!")
    .trim()
    .optional(),

  // Private account — new followers must be approved before they can follow.
  isPrivate: z.boolean().optional(),

  removeProfilePic: z.preprocess(
    (val) => val === "true" || val === true,
    z.boolean().optional(),
  ),

  removeBannerImage: z.preprocess(
    (val) => val === "true" || val === true,
    z.boolean().optional(),
  ),
});

// Type definitions derived from Zod schemas
export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type updatePasswordInput = z.infer<typeof updatePasswordSchema>;
export type forgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type verifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type deleteAccountInput = z.infer<typeof deleteAccountSchema>;
export type updateProfileInput = z.infer<typeof updateProfileSchema>;
