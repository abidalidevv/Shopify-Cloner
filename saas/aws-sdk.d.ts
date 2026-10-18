// Ambient declarations for AWS S3 SDK

declare module "@aws-sdk/client-s3" {
  export class S3Client {
    constructor(config: any);
    send(command: any): Promise<any>;
  }
  export class GetObjectCommand {
    constructor(input: any);
  }
  export class PutObjectCommand {
    constructor(input: any);
  }
}

declare module "@aws-sdk/s3-request-presigner" {
  export function getSignedUrl(client: any, command: any, options?: any): Promise<string>;
}
