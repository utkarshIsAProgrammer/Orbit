import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/user.model";
import {
	updatePasswordSchema,
	forgotPasswordSchema,
	verifyOtpSchema,
} from "../schemas/user.schema";
import {
	sendPasswordUpdateMail,
	sendForgotPasswordMail,
	sendOtpMail,
} from "../configs/nodeMailer";
import { generateOTP } from "../configs/generateOtp";
import { cookieOptions } from "../configs/cookie";
import { logger } from "../utilities/logger";
import {
	AppError,
	BadRequestError,
	NotFoundError,
	UnauthorizedError,
} from "../utilities/errors";
import { env } from "../configs/env";

// Maximum number of previous passwords to keep in history
const PASSWORD_HISTORY_LIMIT = 5;
const MAX_OTP_ATTEMPTS = 5;
const OTP_LOCKOUT_MS = 15 * 60 * 1000;

// Check if new password was used recently
const isPasswordInHistory = async (
	newPassword: string,
	passwordHistory: { password: string; changedAt: Date }[],
): Promise<boolean> => {
	for (const entry of passwordHistory.slice(0, PASSWORD_HISTORY_LIMIT)) {
		if (await bcrypt.compare(newPassword, entry.password)) {
			return true;
		}
	}
	return false;
};

// update password
export const updatePassword = async (req: Request, res: Response) => {
	const result = updatePasswordSchema.safeParse(req.body);

	try {
		if (!result.success) {
			throw new BadRequestError(
				result.error.issues[0]?.message || "Invalid data!",
			);
		}

		// req.user is populated by protect middleware
		const user = await User.findById(req.user?._id);
		if (!user) {
			throw new NotFoundError("User not found!");
		}

		// check current password
		const isMatch = await user.comparePassword(result.data.currentPassword);
		if (!isMatch) {
			throw new UnauthorizedError("Incorrect Password!");
		}

		if (result.data.currentPassword === result.data.newPassword) {
			throw new BadRequestError(
				"New password cannot be the same as your current password!",
			);
		}

		// check password history to prevent reuse
		const passwordHistory = (user as any).passwordHistory || [];
		if (
			await isPasswordInHistory(result.data.newPassword, passwordHistory)
		) {
			throw new BadRequestError(
				"Cannot reuse a recently used password. Please choose a different password!",
			);
		}

		// Save current password to history before updating
		const updatedHistory = [
			{ password: user.password, changedAt: new Date() },
			...passwordHistory.slice(0, PASSWORD_HISTORY_LIMIT - 1),
		];

		// update and save new password (hashed by pre-save hook)
		(user as any).passwordHistory = updatedHistory;
		user.password = result.data.newPassword;
		await user.save();

		// notify via email before sending response
		await sendPasswordUpdateMail({
			email: user.email,
			username: user.username,
		});

		// clear cookie and respond
		res.clearCookie("jwt", { ...cookieOptions, path: "/" });

		return res.status(200).json({
			success: true,
			message: "Password updated successfully!",
		});
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in the updatePassword controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

// request password reset
export const requestOtpForForgotPassword = async (
	req: Request,
	res: Response,
) => {
	const result = forgotPasswordSchema.safeParse(req.body);
	try {
		if (!result.success) {
			throw new BadRequestError(
				result.error.issues[0]?.message || "Invalid Data!",
			);
		}

		const user = await User.findOne({ email: result.data.email });

		// Always return success to prevent email enumeration
		// But only send OTP if user exists and email is verified
		if (!user) {
			return res.status(200).json({
				success: true,
				message:
					"If the email is registered and verified, an OTP has been sent!",
			});
		}

		if (user.otpLockedUntil && user.otpLockedUntil.getTime() > Date.now()) {
			return res.status(200).json({
				success: true,
				message: "Too many OTP attempts. Please try again later.",
			});
		}

		// Prevent repeated OTP requests for a short window to reduce abuse.
		const otpCooldownMs = 60 * 1000;
		if (
			user.otpExpiry &&
			user.otpExpiry.getTime() > Date.now() + otpCooldownMs
		) {
			return res.status(200).json({
				success: true,
				message:
					"A new OTP was recently sent. Please wait a moment before requesting another one.",
			});
		}

		// Check if email is verified (if verification is required)
		if (!user.isEmailVerified) {
			// Don't reveal that email exists but is not verified
			return res.status(200).json({
				success: true,
				message:
					"If the email is registered and verified, an OTP has been sent!",
			});
		}

		// generate and hash otp for security
		const otp = generateOTP();
		const hashedOTP = await bcrypt.hash(otp, 12);

		user.otp = hashedOTP;
		user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // Expires in 10 minutes
		user.otpAttempts = 0;
		user.otpLockedUntil = null;

		await user.save();

		// send otp via email before sending response
		await sendOtpMail({ email: user.email, username: user.username }, otp);

		// clear cookie and respond
		res.clearCookie("jwt", { ...cookieOptions, path: "/" });

		const message = "If the email is registered and verified, an OTP has been sent!";

		return res.status(200).json({
			success: true,
			message,
		});
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in the requestPasswordReset controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};

// verify otp and forgot password
export const verifyOtpAndForgotPassword = async (
	req: Request,
	res: Response,
) => {
	const result = verifyOtpSchema.safeParse(req.body);

	try {
		if (!result.success) {
			throw new BadRequestError(
				result.error.issues[0]?.message || "Invalid data!",
			);
		}

		const { email, otp, newPassword } = result.data;

		const user = await User.findOne({ email });
		if (!user) throw new BadRequestError("Invalid OTP or email!");

		// check otp exists and valid
		if (user.otpLockedUntil && user.otpLockedUntil.getTime() > Date.now()) {
			throw new BadRequestError(
				"Too many OTP attempts. Please try again later!",
			);
		}

		if (!user.otp || !user.otpExpiry) {
			throw new BadRequestError("OTP not found!");
		}

		if (user.otpExpiry < new Date()) {
			throw new BadRequestError("OTP expired!");
		}

		const isValid = await bcrypt.compare(otp, user.otp);
		if (!isValid) {
			const nextAttempts = (user.otpAttempts || 0) + 1;
			user.otpAttempts = nextAttempts;
			if (nextAttempts >= MAX_OTP_ATTEMPTS) {
				user.otpLockedUntil = new Date(Date.now() + OTP_LOCKOUT_MS);
			}
			await user.save();
			throw new BadRequestError("Invalid OTP!");
		}

		// Check if it matches current password
		if (await bcrypt.compare(newPassword, user.password)) {
			throw new BadRequestError(
				"New password cannot be the same as your current password!",
			);
		}

		// check password history to prevent reuse
		const passwordHistory = (user as any).passwordHistory || [];
		if (await isPasswordInHistory(newPassword, passwordHistory)) {
			throw new BadRequestError(
				"Cannot reuse a recently used password. Please choose a different password!",
			);
		}

		// Save current password to history before updating
		const updatedHistory = [
			{ password: user.password, changedAt: new Date() },
			...passwordHistory.slice(0, PASSWORD_HISTORY_LIMIT - 1),
		];

		// update password and clear otp fields
		(user as any).passwordHistory = updatedHistory;
		user.password = newPassword;
		user.loginAttempts = 0;
		user.lockUntil = null;
		user.otp = null;
		user.otpExpiry = null;
		user.otpAttempts = 0;
		user.otpLockedUntil = null;

		await user.save();

		// notify via email before sending response
		await sendForgotPasswordMail({
			email: user.email,
			username: user.username,
		});

		// clear cookie and respond
		res.clearCookie("jwt", { ...cookieOptions, path: "/" });

		return res.status(200).json({
			success: true,
			message: "Password reset successfully!",
		});
	} catch (err: any) {
		if (err.statusCode && err.statusCode < 500) throw err;
		logger.error(`Error in the verifyOtpAndResetPassword controller!`, {
			error: err.message,
		});
		throw new AppError("Internal server error!");
	}
};
