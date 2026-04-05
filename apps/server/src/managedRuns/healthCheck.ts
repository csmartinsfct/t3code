import * as net from "node:net";

import type { ServiceHealthCheck } from "@t3tools/contracts";
import { Effect } from "effect";

import { runProcess } from "../processRunner";

export type ServiceHealthStatus = "healthy" | "unhealthy";

const URL_CHECK_TIMEOUT_MS = 5_000;
const PORT_CHECK_TIMEOUT_MS = 3_000;
const COMMAND_CHECK_TIMEOUT_MS = 10_000;
const DOCKER_CHECK_TIMEOUT_MS = 5_000;

/**
 * Check if a URL responds with any successful HTTP status.
 */
export function checkUrl(url: string): Effect.Effect<ServiceHealthStatus> {
  return Effect.tryPromise({
    try: async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), URL_CHECK_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
        });
        return response.status > 0 ? ("healthy" as const) : ("unhealthy" as const);
      } finally {
        clearTimeout(timeout);
      }
    },
    catch: () => "unhealthy" as const,
  }).pipe(Effect.catch(() => Effect.succeed("unhealthy" as const)));
}

/**
 * Check if a Docker container is running by name.
 */
export function checkDocker(container: string): Effect.Effect<ServiceHealthStatus> {
  return Effect.tryPromise({
    try: async () => {
      const result = await runProcess(
        "docker",
        ["inspect", "--format", "{{.State.Running}}", container],
        { allowNonZeroExit: true, timeoutMs: DOCKER_CHECK_TIMEOUT_MS, outputMode: "truncate" },
      );
      return result.code === 0 && result.stdout.trim() === "true"
        ? ("healthy" as const)
        : ("unhealthy" as const);
    },
    catch: () => "unhealthy" as const,
  }).pipe(Effect.catch(() => Effect.succeed("unhealthy" as const)));
}

/**
 * Check if a TCP port is reachable.
 */
export function checkPort(
  port: number,
  host: string = "127.0.0.1",
): Effect.Effect<ServiceHealthStatus> {
  return Effect.tryPromise({
    try: () =>
      new Promise<ServiceHealthStatus>((resolve) => {
        const socket = net.createConnection({ port, host, timeout: PORT_CHECK_TIMEOUT_MS });
        socket.on("connect", () => {
          socket.destroy();
          resolve("healthy");
        });
        socket.on("error", () => {
          socket.destroy();
          resolve("unhealthy");
        });
        socket.on("timeout", () => {
          socket.destroy();
          resolve("unhealthy");
        });
      }),
    catch: () => "unhealthy" as const,
  }).pipe(Effect.catch(() => Effect.succeed("unhealthy" as const)));
}

/**
 * Check a service by running a command and checking the exit code.
 */
export function checkCommand(command: string, cwd?: string): Effect.Effect<ServiceHealthStatus> {
  return Effect.tryPromise({
    try: async () => {
      const result = await runProcess("sh", ["-c", command], {
        allowNonZeroExit: true,
        timeoutMs: COMMAND_CHECK_TIMEOUT_MS,
        outputMode: "truncate",
        ...(cwd ? { cwd } : {}),
      });
      return result.code === 0 ? ("healthy" as const) : ("unhealthy" as const);
    },
    catch: () => "unhealthy" as const,
  }).pipe(Effect.catch(() => Effect.succeed("unhealthy" as const)));
}

/**
 * Run the appropriate health check for a declared service.
 */
export function checkService(healthCheck: ServiceHealthCheck): Effect.Effect<ServiceHealthStatus> {
  switch (healthCheck.type) {
    case "url":
      return checkUrl(healthCheck.url);
    case "docker":
      return checkDocker(healthCheck.container);
    case "port":
      return checkPort(healthCheck.port, healthCheck.host ?? "127.0.0.1");
    case "command":
      return checkCommand(healthCheck.command, healthCheck.cwd);
    default:
      return Effect.succeed("unhealthy" as const);
  }
}

/**
 * Check all services in parallel and return their statuses.
 */
export function checkAllServices(
  services: ReadonlyArray<{ readonly name: string; readonly healthCheck: ServiceHealthCheck }>,
): Effect.Effect<ReadonlyArray<{ name: string; status: ServiceHealthStatus }>> {
  return Effect.forEach(
    services,
    (service) =>
      checkService(service.healthCheck).pipe(
        Effect.map((status) => ({ name: service.name, status })),
      ),
    { concurrency: "unbounded" },
  );
}
