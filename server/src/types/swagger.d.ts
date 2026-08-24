/**
 * Ambient type declarations for swagger-jsdoc and swagger-ui-express.
 * These packages don't ship their own TypeScript declarations.
 */
declare module "swagger-jsdoc" {
  interface Options {
    definition: Record<string, any>;
    apis: string[];
  }

  function swaggerJsdoc(options: Options): Record<string, any>;

  export = swaggerJsdoc;
}

declare module "swagger-ui-express" {
  import { RequestHandler } from "express";

  function serve(...args: any[]): RequestHandler[];
  function setup(
    spec: Record<string, any>,
    options?: Record<string, any>,
  ): RequestHandler;

  export { serve, setup };
}
