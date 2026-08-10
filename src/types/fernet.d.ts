declare module "fernet" {
  export class Secret {
    constructor(secret: string);
  }
  export class Token {
    constructor(options: { secret: Secret; token?: string; ttl?: number; time?: number });
    encode(value: string): string;
    decode(): string;
  }
}
