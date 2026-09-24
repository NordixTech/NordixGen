import type { NordixIr } from '../../core/ir/types.js';

export function generateDockerComposeCode(ir: NordixIr): string {
  const { docker } = ir.config;
  const services: string[] = [];

  if (docker.postgres) {
    services.push(`  postgres:
    image: postgres:16-alpine
    container_name: ${ir.projectName}-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ${ir.projectName.replace(/-/g, '_')}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5`);
  }

  if (docker.mailpit) {
    services.push(`  mailpit:
    image: axllent/mailpit:latest
    container_name: ${ir.projectName}-mailpit
    restart: unless-stopped
    ports:
      - "1025:1025" # SMTP port
      - "8025:8025" # Web UI`);
  }

  if (docker.minio) {
    services.push(`  minio:
    image: minio/minio:latest
    container_name: ${ir.projectName}-minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000" # S3 API
      - "9001:9001" # Web Console
    volumes:
      - minio_data:/data`);
  }

  if (docker.redis) {
    services.push(`  redis:
    image: redis:7-alpine
    container_name: ${ir.projectName}-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data`);
  }

  const volumes: string[] = [];
  if (docker.postgres) volumes.push('  postgres_data:');
  if (docker.minio) volumes.push('  minio_data:');
  if (docker.redis) volumes.push('  redis_data:');

  return `services:
${services.join('\n\n')}

${volumes.length > 0 ? `volumes:\n${volumes.join('\n')}\n` : ''}`;
}
