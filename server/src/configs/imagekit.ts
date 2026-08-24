import ImageKit from "imagekit";
import { env } from "./env";
import { logger } from "../utilities/logger";

let imagekit: ImageKit | null = null;

if (env.IMAGEKIT_PUBLIC_KEY && env.IMAGEKIT_PRIVATE_KEY) {
  imagekit = new ImageKit({
    publicKey: env.IMAGEKIT_PUBLIC_KEY,
    privateKey: env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: env.IMAGEKIT_URL_ENDPOINT,
  });
  logger.info("ImageKit SDK initialized successfully");
} else {
  logger.warn("ImageKit credentials missing in environment variables. ImageKit operations will fail.");
}

export { imagekit };
