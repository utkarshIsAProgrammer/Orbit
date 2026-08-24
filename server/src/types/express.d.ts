import { UserDocument } from "../models/user.model";

declare global {
  namespace Express {
    interface User {
      _id: string;
    }

    interface Request {
      requestId: string;
      user?: UserDocument;
    }
  }
}
